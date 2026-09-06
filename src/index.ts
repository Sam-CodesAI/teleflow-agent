/**
 * Teleflow Agent — Main Entry Point
 * High-performance autonomous lead qualifier and edge CRM router for Telegram.
 * Supports dual-mode execution:
 * 1) Serverless/Edge HTTP Webhook Mode (Default)
 * 2) Long-Polling Mode (for local development or persistent background workers)
 */

import http from "node:http";
import { TelegramClient } from "./client.js";
import { LeadQualifierAgent } from "./agent.js";
import { CRMDispatcher } from "./crm.js";
import { TelegramUpdate } from "./types.js";

export * from "./types.js";
export * from "./client.js";
export * from "./agent.js";
export * from "./scheduler.js";
export * from "./crm.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const MODE = process.argv.includes("--poll") || process.env.TELEFLOW_MODE === "polling" ? "polling" : "webhook";

/**
 * Creates the HTTP Webhook Server for Teleflow Agent.
 */
export function createBotServer(agent?: LeadQualifierAgent, client?: TelegramClient) {
  const crm = new CRMDispatcher();
  const botClient = client || new TelegramClient();
  const botAgent =
    agent ||
    new LeadQualifierAgent({
      onInquiryQualified: async (payload) => {
        const results = await crm.dispatchLead(payload);
        const supabaseRes = results.find((r) => r.sink === "supabase");
        return supabaseRes?.recordId;
      },
    });

  const server = http.createServer(async (req, res) => {
    // Healthcheck
    if (req.method === "GET" && (req.url === "/health" || req.url === "/api/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "online",
          agent: "teleflow-agent",
          version: "1.2.0",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Webhook POST
    if (req.method === "POST" && (req.url === "/webhook" || req.url === "/api/webhook" || req.url === "/")) {
      if (WEBHOOK_SECRET) {
        const secret = req.headers["x-telegram-bot-api-secret-token"];
        if (secret !== WEBHOOK_SECRET) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized token" }));
          return;
        }
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", async () => {
        try {
          const update = JSON.parse(body) as TelegramUpdate;
          await processTelegramUpdate(update, botAgent, botClient);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error("[Teleflow Webhook] Error:", err);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Processing error" }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  return server;
}

/**
 * Processes a single Telegram update (message or callback query).
 */
export async function processTelegramUpdate(
  update: TelegramUpdate,
  agent: LeadQualifierAgent,
  client: TelegramClient
): Promise<void> {
  // 1. Handle Callback Query (Button Press)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id || cb.from.id;
    const data = cb.data || "";

    // Acknowledge receipt to clear Telegram spinner immediately
    void client.answerCallbackQuery(cb.id);

    const result = await agent.executeCallbackQuery(chatId, data, {
      username: cb.from.username,
      firstName: cb.from.first_name,
      lastName: cb.from.last_name,
    });

    await client.sendMessage(chatId, result.replyText, {
      parseMode: "Markdown",
      replyMarkup: result.replyMarkup,
    });
    return;
  }

  // 2. Handle Text Message
  const msg = update.message || update.edited_message;
  if (msg && msg.chat && msg.chat.id && msg.text) {
    void client.sendChatAction(msg.chat.id, "typing");
    const result = await agent.executeTurn(msg.chat.id, msg.text, {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
    });

    await client.sendMessage(msg.chat.id, result.replyText, {
      parseMode: "Markdown",
      replyMarkup: result.replyMarkup,
    });
  }
}

/**
 * Runs a persistent long-polling worker for local development or background processes.
 */
export async function startPolling(agent?: LeadQualifierAgent, client?: TelegramClient): Promise<void> {
  const crm = new CRMDispatcher();
  const botClient = client || new TelegramClient();
  const botAgent =
    agent ||
    new LeadQualifierAgent({
      onInquiryQualified: async (payload) => {
        const results = await crm.dispatchLead(payload);
        const supabaseRes = results.find((r) => r.sink === "supabase");
        return supabaseRes?.recordId;
      },
    });

  console.log("⚡ [Teleflow Agent] Starting long-polling mode...");
  // Clear any existing webhook so polling can receive updates
  await botClient.deleteWebhook();

  const me = await botClient.getMe();
  if (me.ok && me.result) {
    console.log(`🤖 Logged in as @${me.result.username} (${me.result.first_name})`);
  }

  let offset: number | undefined = undefined;
  let running = true;

  const shutdown = () => {
    console.log("\n🛑 Stopping long-polling gracefully...");
    running = false;
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      const updates = await botClient.getUpdates(offset, 100, 20);
      for (const update of updates) {
        offset = update.update_id + 1;
        await processTelegramUpdate(update, botAgent, botClient);
      }
    } catch (err) {
      console.error("[Teleflow Poller] Error during poll iteration:", err);
      // Wait 3 seconds before reconnecting
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

// Execution Entry
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  if (MODE === "polling") {
    void startPolling();
  } else {
    const server = createBotServer();
    server.listen(PORT, () => {
      console.log(`🚀 Teleflow Agent Webhook Server listening on port ${PORT}`);
      console.log(`📡 Ready for Telegram updates at POST http://localhost:${PORT}/webhook`);
    });
  }
}
