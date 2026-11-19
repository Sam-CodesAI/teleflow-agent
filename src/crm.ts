/**
 * Multi-Sink CRM & Webhook Dispatcher
 * Synchronizes verified leads across Supabase, custom webhook sinks (Zapier/Make/n8n),
 * and pushes real-time alerts to the administrator's Telegram account.
 */

import crypto from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { InquiryPayload, CRMDispatchResult } from "./types.js";
import { TelegramClient } from "./client.js";

export interface CRMDispatcherOptions {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  adminChatId?: string;
  telegramClient?: TelegramClient;
}

export class CRMDispatcher {
  private supabase: SupabaseClient | null = null;
  private webhookUrl?: string;
  private webhookSecret?: string;
  private adminChatId?: string;
  private telegramClient?: TelegramClient;

  constructor(options: CRMDispatcherOptions = {}) {
    const url = options.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = options.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
      });
    }

    this.webhookUrl = options.webhookUrl || process.env.EXTERNAL_CRM_WEBHOOK_URL;
    this.webhookSecret = options.webhookSecret || process.env.EXTERNAL_CRM_WEBHOOK_SECRET;
    this.adminChatId = options.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
    this.telegramClient = options.telegramClient || new TelegramClient();
  }

  /**
   * Dispatches the qualified lead to all configured sinks concurrently.
   */
  async dispatchLead(payload: InquiryPayload): Promise<CRMDispatchResult[]> {
    const tasks: Promise<CRMDispatchResult>[] = [];

    // 1. Supabase Database Sink
    if (this.supabase) {
      tasks.push(this.persistToSupabase(payload));
    }

    // 2. External Webhook Sink (Zapier/Make/n8n/Slack)
    if (this.webhookUrl) {
      tasks.push(this.dispatchWebhook(payload));
    }

    // 3. Admin Push Alert
    if (this.adminChatId && this.telegramClient) {
      tasks.push(this.notifyAdmin(payload));
    }

    if (tasks.length === 0) {
      return [
        {
          sink: "noop",
          success: true,
          recordId: "local-dry-run",
        },
      ];
    }

    return Promise.all(tasks);
  }

  private async persistToSupabase(payload: InquiryPayload): Promise<CRMDispatchResult> {
    if (!this.supabase) {
      return { sink: "supabase", success: false, error: "Supabase client not configured" };
    }

    try {
      // 1. Strict sanitization to comply with PostgreSQL check constraints:
      // - chk_inquiries_name_len: length(trim(name)) >= 1 AND <= 150
      // - chk_inquiries_service_len: length(service_requested) <= 150
      // - chk_inquiries_message_len: length(trim(message)) >= 3 AND <= 5000
      // - chk_inquiries_email_format: email IS NULL OR regex match
      const sanitizedName = (payload.name?.trim() || "Prospective Client").slice(0, 150);
      const sanitizedService = (payload.serviceRequested?.trim() || "Custom System Engineering").slice(0, 150);
      const sanitizedMessage = (payload.message?.trim() || "Lead intake via Teleflow Agent").slice(0, 5000);

      let sanitizedEmail: string | null = null;
      if (payload.email) {
        const clean = payload.email.trim();
        if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(clean)) {
          sanitizedEmail = clean;
        } else {
          const match = clean.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
          if (match && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(match[0])) {
            sanitizedEmail = match[0];
          }
        }
      }

      const basePayload: Record<string, any> = {
        name: sanitizedName,
        email: sanitizedEmail,
        contact_method: payload.contactMethod || "Telegram",
        service_requested: sanitizedService,
        message: sanitizedMessage,
        status: "NEW",
        user_agent: "telegram_agent",
        private_notes: `[Lead Source: telegram_agent | Chat: ${payload.metadata?.chatId || "direct"}]`,
      };

      // Try inserting with source column first (v2 schema)
      let res = await this.supabase
        .from("inquiries")
        .insert({ ...basePayload, source: "telegram_agent" })
        .select("id")
        .single();

      // If source column does not exist (v1 schema), retry without source
      if (res.error && res.error.message.includes("source")) {
        res = await this.supabase
          .from("inquiries")
          .insert(basePayload)
          .select("id")
          .single();
      }

      // If optional column insertion still fails, fall back to minimal required schema
      if (res.error) {
        const minimalPayload = {
          name: sanitizedName,
          email: sanitizedEmail,
          contact_method: payload.contactMethod || "Telegram",
          service_requested: sanitizedService,
          message: sanitizedMessage,
          status: "NEW",
        };
        const fallbackRes = await this.supabase
          .from("inquiries")
          .insert(minimalPayload)
          .select("id")
          .single();

        if (fallbackRes.error) {
          return { sink: "supabase", success: false, error: fallbackRes.error.message };
        }
        return { sink: "supabase", success: true, recordId: fallbackRes.data?.id };
      }

      return { sink: "supabase", success: true, recordId: res.data?.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sink: "supabase", success: false, error: msg };
    }
  }

  private async dispatchWebhook(payload: InquiryPayload): Promise<CRMDispatchResult> {
    if (!this.webhookUrl) {
      return { sink: "webhook", success: false, error: "Webhook URL not configured" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const body = JSON.stringify({
        event: "lead.qualified",
        timestamp: new Date().toISOString(),
        payload,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Teleflow-Agent/2.0.0",
      };

      if (this.webhookSecret) {
        const signature = crypto
          .createHmac("sha256", this.webhookSecret)
          .update(body)
          .digest("hex");
        headers["X-Teleflow-Signature"] = signature;
      }

      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { sink: "webhook", success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      return { sink: "webhook", success: true };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      return { sink: "webhook", success: false, error: msg };
    }
  }

  private async notifyAdmin(payload: InquiryPayload): Promise<CRMDispatchResult> {
    if (!this.adminChatId || !this.telegramClient) {
      return { sink: "telegram_alert", success: false, error: "Admin chat ID or client missing" };
    }

    try {
      const briefPreview = payload.message.slice(0, 400);
      const text =
        `⚡ *NEW TELEFLOW LEAD QUALIFIED*\n\n` +
        `👤 *Client:* ${payload.name}\n` +
        `🛠 *Service:* ${payload.serviceRequested}\n` +
        `📬 *Contact:* ${payload.contactMethod}\n` +
        `📝 *Summary:*\n${briefPreview}\n\n` +
        `[Open Command Center](https://sam-codes.vercel.app/admin/inquiries)`;

      const res = await this.telegramClient.sendMessage(this.adminChatId, text, {
        parseMode: "Markdown",
      });

      return {
        sink: "telegram_alert",
        success: !!res.ok,
        error: res.ok ? undefined : res.description,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sink: "telegram_alert", success: false, error: msg };
    }
  }
}
