/**
 * Telegram Bot API Client
 * High-performance, timeout-protected client for standalone bot execution.
 */

import { TelegramMessage, TelegramUser } from "./types.js";

export interface SendMessageOptions {
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  replyMarkup?: unknown;
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
  async call<T>(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
    if (!this.token) {
      return { ok: false, description: "TELEGRAM_BOT_TOKEN missing" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

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
      return { ok: false, description: `Request failed: ${msg}` };
    }
  }

  /**
   * Send a text message.
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
    return this.call<TelegramMessage>("sendMessage", payload);
  }

  /**
   * Send chat action (e.g., 'typing').
   */
  async sendChatAction(chatId: number | string, action: string = "typing"): Promise<boolean> {
    const res = await this.call<{ ok: boolean }>("sendChatAction", { chat_id: chatId, action });
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
}
