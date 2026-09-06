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
      const { data, error } = await this.supabase
        .from("inquiries")
        .insert({
          name: payload.name,
          email: payload.email,
          contact_method: payload.contactMethod,
          service_requested: payload.serviceRequested,
          message: payload.message,
          status: "NEW",
          source: "telegram_agent",
        })
        .select("id")
        .single();

      if (error) {
        return { sink: "supabase", success: false, error: error.message };
      }

      return { sink: "supabase", success: true, recordId: data?.id };
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
        "User-Agent": "Teleflow-Agent/1.2.0",
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
