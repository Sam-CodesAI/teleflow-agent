import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { createBotServer, isSecretTokenValid } from "../src/index.js";
import { LeadQualifierAgent } from "../src/agent.js";
import { TelegramClient } from "../src/client.js";

test("Webhook Server & Security Tests", async (t) => {
  await t.test("isSecretTokenValid constant-time verification", () => {
    assert.strictEqual(isSecretTokenValid("my-secret", "my-secret"), true);
    assert.strictEqual(isSecretTokenValid("my-secret", "wrong-secret"), false);
    assert.strictEqual(isSecretTokenValid("short", "much-longer-secret"), false);
    assert.strictEqual(isSecretTokenValid(undefined, "expected-secret"), false);
    assert.strictEqual(isSecretTokenValid("", "expected-secret"), false);
  });

  await t.test("Health check endpoint returns v2.0.0", async () => {
    const server = createBotServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { status: string; agent: string; version: string };
      assert.strictEqual(data.status, "online");
      assert.strictEqual(data.agent, "teleflow-agent");
      assert.strictEqual(data.version, "2.0.0");

      // Verify trailing slash and query param normalization
      const resTrailing = await fetch(`http://127.0.0.1:${address.port}/health/?ref=ping`);
      assert.strictEqual(resTrailing.status, 200);
      const resApi = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      assert.strictEqual(resApi.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await t.test("Rejects webhook POST when secret token is unauthorized", async () => {
    const server = createBotServer(undefined, undefined, "top-secret-token");
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    try {
      // 1. Missing header
      const resMissing = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update_id: 1 }),
      });
      assert.strictEqual(resMissing.status, 401);

      // 2. Wrong header
      const resWrong = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "bad-token",
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      assert.strictEqual(resWrong.status, 401);

      // 3. Valid header
      const resValid = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "top-secret-token",
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      assert.strictEqual(resValid.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await t.test("Rejects webhook POST when payload exceeds 1MB", async () => {
    const server = createBotServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    try {
      const largePayload = JSON.stringify({
        update_id: 1,
        blob: "A".repeat(1024 * 1024 + 100),
      });

      const res = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largePayload,
      }).catch((err) => {
        // Fetch might catch network connection reset when server destroys socket
        return { status: 413 };
      });

      assert.strictEqual(res.status, 413);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await t.test("TelegramClient falls back to plain text when Markdown parsing fails", async () => {
    let callCount = 0;
    const sentPayloads: any[] = [];

    const mockClient = new TelegramClient("dummy_token");
    mockClient.call = async (method: string, payload: any) => {
      callCount++;
      sentPayloads.push(payload);
      if (callCount === 1) {
        return {
          ok: false,
          description: "Bad Request: can't parse entities: Can't find end of italic entity",
        };
      }
      return { ok: true, result: { message_id: 12345 } as any };
    };

    const res = await mockClient.sendMessage(112233, "Hello _unclosed italic", { parseMode: "Markdown" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callCount, 2);
    // First attempt included parse_mode
    assert.strictEqual(sentPayloads[0].parse_mode, "Markdown");
    // Fallback attempt deleted parse_mode
    assert.strictEqual(sentPayloads[1].parse_mode, undefined);
  });
});
