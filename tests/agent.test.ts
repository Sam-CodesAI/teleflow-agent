import test from "node:test";
import assert from "node:assert";
import { LeadQualifierAgent } from "../src/agent.js";
import { InquiryPayload } from "../src/types.js";

test("LeadQualifierAgent Multi-Turn Lifecycle", async (t) => {
  let capturedInquiry: InquiryPayload | null = null;
  const agent = new LeadQualifierAgent({
    onInquiryQualified: async (payload) => {
      capturedInquiry = payload;
      return "mock-inq-123";
    },
  });

  const testChatId = 998877;

  await t.test("Turn 1: Greets user and sets DISCOVERY phase", async () => {
    const res = await agent.executeTurn(testChatId, "/start", {
      username: "tech_founder",
      firstName: "Marcus",
    });

    assert.strictEqual(res.phase, "DISCOVERY");
    assert.strictEqual(res.leadQualified, false);
    assert.match(res.replyText, /Marcus/);
    assert.match(res.replyText, /AI Qualifier/);
  });

  await t.test("Turn 2: Matches requirement and sets QUALIFICATION phase", async () => {
    const res = await agent.executeTurn(
      testChatId,
      "I need a custom WhatsApp CRM sync and automation pipeline.",
      { username: "tech_founder" }
    );

    assert.strictEqual(res.phase, "QUALIFICATION");
    assert.strictEqual(res.leadDraft.serviceRequested, "Workflow & Business Automation");
    assert.match(res.replyText, /timeline/i);
  });

  await t.test("Turn 3: Extracts timeline and contact, confirms lead, triggers callback", async () => {
    const res = await agent.executeTurn(
      testChatId,
      "We need this in 2 weeks. Email me at marcus@innovatecorp.com.",
      { username: "tech_founder" }
    );

    assert.strictEqual(res.phase, "CONFIRMED");
    assert.strictEqual(res.leadQualified, true);
    assert.strictEqual(res.inquiryId, "mock-inq-123");
    assert.ok(capturedInquiry);
    assert.strictEqual(capturedInquiry?.email, "marcus@innovatecorp.com");
    assert.match(res.replyText, /logged directly into Samarth's Command Center/i);
  });

  await t.test("Turn 4: Answers FAQ without resetting confirmed state", async () => {
    const res = await agent.executeTurn(
      testChatId,
      "Who is Samarth?",
      { username: "tech_founder" }
    );

    assert.strictEqual(res.phase, "CONFIRMED");
    assert.match(res.replyText, /Samarth Nimangre/);
  });
});
