/**
 * Main Entry Point for Sam CodeAI Telegram Bot
 * Can run as a standalone HTTP webhook server or be imported into any Node/Serverless environment.
 */

import http from "node:http";
import { TelegramClient } from "./client.js";
import { LeadQualifierAgent } from "./agent.js";
import { TelegramUpdate } from "./types.js";

export * from "./types.js";
export * from "./client.js";
export * from "./agent.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

export function createBotServer(agent?: LeadQualifierAgent, client?: TelegramClient) {
  const botAgent = agent || new LeadQualifierAgent();
  const botClient = client || new TelegramClient();

  const server = http.createServer(async (req, res) => {
    // Healthcheck
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "online", time: new Date().toISOString() }));
      return;
    }

    // Webhook POST
    if (req.method === "POST" && (req.url === "/webhook" || req.url === "/")) {
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
          const msg = update.message || update.edited_message;

          if (msg && msg.chat && msg.chat.id && msg.text) {
            void botClient.sendChatAction(msg.chat.id, "typing");
            const result = await botAgent.executeTurn(msg.chat.id, msg.text, {
              username: msg.from?.username,
              firstName: msg.from?.first_name,
              lastName: msg.from?.last_name,
            });
            await botClient.sendMessage(msg.chat.id, result.replyText);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error("Webhook error:", err);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Internal error" }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  return server;
}

// If executed directly, start HTTP server
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const server = createBotServer();
  server.listen(PORT, () => {
    console.log(`🚀 Sam CodeAI Telegram Webhook Server listening on port ${PORT}`);
  });
}
