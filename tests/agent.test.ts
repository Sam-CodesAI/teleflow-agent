import test from "node:test";
import assert from "node:assert";
import { LeadQualifierAgent } from "../src/agent.js";
import { buildSchedulingUrl } from "../src/scheduler.js";
import { CRMDispatcher } from "../src/crm.js";
import { InquiryPayload } from "../src/types.js";

test("LeadQualifierAgent Multi-Turn & Interactive Workflow", async (t) => {
  let capturedInquiry: InquiryPayload | null = null;
  const agent = new LeadQualifierAgent({
    calBaseUrl: "https://cal.com/samarth/discovery",
    onInquiryQualified: async (payload) => {
      capturedInquiry = payload;
      return "inq-mock-999";
    },
  });

  const testChatId = 887766;

  await t.test("Turn 1: Greets user and presents service selection buttons", async () => {
    const res = await agent.executeTurn(testChatId, "/start", {
      username: "founder_jane",
      firstName: "Jane",
      lastName: "Doe",
    });

    assert.strictEqual(res.phase, "DISCOVERY");
    assert.strictEqual(res.leadQualified, false);
    assert.match(res.replyText, /Jane/);
    assert.ok(res.replyMarkup?.inline_keyboard);
    assert.strictEqual(res.replyMarkup.inline_keyboard.length, 2);
    assert.strictEqual(res.replyMarkup.inline_keyboard[0][0].callback_data, "svc:ai_chatbot");
  });

  await t.test("Turn 2 (Callback Query): User taps '⚡ Workflow Automation' button", async () => {
    const res = await agent.executeCallbackQuery(testChatId, "svc:automation", {
      username: "founder_jane",
      firstName: "Jane",
    });

    assert.strictEqual(res.phase, "QUALIFICATION");
    assert.strictEqual(res.leadDraft.serviceRequested, "Workflow & Business Automation");
    assert.match(res.replyText, /Workflow & Business Automation/);
    assert.ok(res.replyMarkup?.inline_keyboard);
    assert.strictEqual(res.replyMarkup.inline_keyboard[0][0].callback_data, "time:urgent");
  });

  await t.test("Turn 3 (Callback Query): User taps '⏱️ 2–4 Weeks' timeline button", async () => {
    const res = await agent.executeCallbackQuery(testChatId, "time:2_4_weeks", {
      username: "founder_jane",
      firstName: "Jane",
    });

    // Since username is present in context, it finalizes the lead
    assert.strictEqual(res.phase, "CONFIRMED");
    assert.strictEqual(res.leadQualified, true);
    assert.strictEqual(res.inquiryId, "inq-mock-999");
    assert.ok(res.bookingUrl);
    assert.match(res.bookingUrl, /cal\.com\/samarth\/discovery/);
    assert.match(res.replyText, /Command Center/);
    assert.ok(capturedInquiry);
    assert.strictEqual(capturedInquiry?.name, "Jane Doe");
  });

  await t.test("Turn 4: Answers FAQ while preserving confirmed state", async () => {
    const res = await agent.executeTurn(testChatId, "Who is Samarth?", {
      username: "founder_jane",
    });

    assert.strictEqual(res.phase, "CONFIRMED");
    assert.match(res.replyText, /Samarth Nimangre/);
  });

  await t.test("Turn 5 (Callback Query): Reset action clears state", async () => {
    const res = await agent.executeCallbackQuery(testChatId, "action:reset", {
      username: "founder_jane",
      firstName: "Jane",
    });

    assert.strictEqual(res.phase, "DISCOVERY");
    assert.strictEqual(res.leadQualified, false);
    assert.match(res.replyText, /Conversation reset/);
  });
});

test("Scheduler URL Builder", async (t) => {
  await t.test("Constructs valid scheduling URL with parameters", () => {
    const url = buildSchedulingUrl({
      name: "Alex Smith",
      email: "alex@venture.io",
      notes: "Need rapid MVP built",
      calBaseUrl: "https://cal.com/samarth/discovery",
    });

    const parsed = new URL(url);
    assert.strictEqual(parsed.hostname, "cal.com");
    assert.strictEqual(parsed.pathname, "/samarth/discovery");
    assert.strictEqual(parsed.searchParams.get("name"), "Alex Smith");
    assert.strictEqual(parsed.searchParams.get("email"), "alex@venture.io");
    assert.strictEqual(parsed.searchParams.get("notes"), "Need rapid MVP built");
  });

  await t.test("Gracefully handles invalid URL fallback", () => {
    const url = buildSchedulingUrl({ calBaseUrl: "not-a-valid-url" });
    assert.strictEqual(url, "https://sam-codes.vercel.app/#contact");
  });
});

test("CRM Dispatcher Dry Run", async (t) => {
  await t.test("Handles unconfigured environment without throwing", async () => {
    const dispatcher = new CRMDispatcher();
    const results = await dispatcher.dispatchLead({
      name: "Test User",
      email: "test@example.com",
      contactMethod: "Telegram",
      serviceRequested: "AI Assistant",
      message: "Build an AI bot",
    });

    assert.ok(Array.isArray(results));
    assert.strictEqual(results[0].sink, "noop");
    assert.strictEqual(results[0].success, true);
  });
});
