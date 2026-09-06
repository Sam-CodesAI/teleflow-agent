/**
 * Telegram Bot API Client
 * High-performance, timeout-protected client for standalone bot execution.
 * Supports webhooks, long polling, inline keyboard markup, and callback query acknowledgment.
 */

import {
  TelegramMessage,
  TelegramUser,
  TelegramUpdate,
  InlineKeyboardMarkup,
} from "./types.js";

export interface SendMessageOptions {
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  replyMarkup?: InlineKeyboardMarkup | unknown;
  replyToMessageId?: number;
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;

  constructor(token?: string) {
    this.token = token || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!this.token) {
      console.warn("[TelegramClient] Warning: TELEGRAM_BOT_TOKEN is not configured.");
    }
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  /**
   * Make a generic API call to Telegram.
   */
  async call<T>(
    method: string,
    payload: Record<string, unknown> = {},
    timeoutMs: number = 7000
  ): Promise<{ ok: boolean; result?: T; description?: string }> {
    if (!this.token) {
      return { ok: false, description: "TELEGRAM_BOT_TOKEN missing" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return (await response.json()) as { ok: boolean; result?: T; description?: string };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : "Network error";
      return { ok: false, description: `Request to /${method} failed: ${msg}` };
    }
  }

  /**
   * Send a text message with optional inline keyboard buttons.
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: SendMessageOptions
  ): Promise<{ ok: boolean; result?: TelegramMessage; description?: string }> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (options?.parseMode) payload.parse_mode = options.parseMode;
    if (options?.replyMarkup) payload.reply_markup = options.replyMarkup;
    if (options?.replyToMessageId) payload.reply_to_message_id = options.replyToMessageId;

    return this.call<TelegramMessage>("sendMessage", payload);
  }

  /**
   * Acknowledge an interactive inline button callback query to dismiss client loading spinners.
   */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {
      callback_query_id: callbackQueryId,
    };
    if (text) payload.text = text;
    if (showAlert) payload.show_alert = showAlert;

    const res = await this.call<boolean>("answerCallbackQuery", payload, 3000);
    return !!res.ok;
  }

  /**
   * Send chat action (e.g. 'typing').
   */
  async sendChatAction(chatId: number | string, action: string = "typing"): Promise<boolean> {
    const res = await this.call<{ ok: boolean }>("sendChatAction", { chat_id: chatId, action }, 3000);
    return !!res.ok;
  }

  /**
   * Verify token and fetch bot identity.
   */
  async getMe(): Promise<{ ok: boolean; result?: TelegramUser; description?: string }> {
    return this.call<TelegramUser>("getMe", {});
  }

  /**
   * Configure Telegram webhook URL.
   */
  async setWebhook(url: string, secretToken?: string): Promise<boolean> {
    const payload: Record<string, unknown> = {
      url,
      allowed_updates: ["message", "callback_query"],
    };
    if (secretToken) payload.secret_token = secretToken;
    const res = await this.call<boolean>("setWebhook", payload);
    return !!res.ok;
  }

  /**
   * Delete existing webhook (required when running in local long-polling mode).
   */
  async deleteWebhook(dropPendingUpdates: boolean = false): Promise<boolean> {
    const res = await this.call<boolean>("deleteWebhook", {
      drop_pending_updates: dropPendingUpdates,
    });
    return !!res.ok;
  }

  /**
   * Fetch updates via long polling.
   */
  async getUpdates(
    offset?: number,
    limit: number = 100,
    timeoutSec: number = 20
  ): Promise<TelegramUpdate[]> {
    const payload: Record<string, unknown> = {
      limit,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    };
    if (offset !== undefined) {
      payload.offset = offset;
    }

    // Give HTTP timeout extra buffer over Telegram long-poll timeout
    const res = await this.call<TelegramUpdate[]>("getUpdates", payload, (timeoutSec + 5) * 1000);
    if (res.ok && Array.isArray(res.result)) {
      return res.result;
    }
    return [];
  }
}
