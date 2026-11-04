import test from "node:test";
import assert from "node:assert";
import { LeadQualifierAgent, SessionLruCache } from "../src/agent.js";
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

test("SessionLruCache In-Memory Eviction & MRU Ordering", async (t) => {
  await t.test("Evicts oldest key when capacity is exceeded", () => {
    const cache = new SessionLruCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.get("a"), "1");

    // Adding 'c' should evict 'b' since 'a' was recently accessed
    cache.set("c", "3");
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.has("b"), false);
    assert.strictEqual(cache.get("a"), "1");
    assert.strictEqual(cache.get("c"), "3");
  });
});

test("Durable Supabase Telegram Sessions Backing", async (t) => {
  function createMockSupabase(initialRecords: Record<string, any> = {}) {
    const store = new Map<string, any>(Object.entries(initialRecords));
    const mockClient = {
      from: (table: string) => {
        assert.strictEqual(table, "telegram_sessions");
        return {
          select: (_cols?: string) => ({
            eq: (field: string, val: string) => ({
              maybeSingle: async () => {
                assert.strictEqual(field, "chat_id");
                const record = store.get(val);
                return { data: record || null, error: null };
              },
            }),
          }),
          upsert: async (payload: any) => {
            store.set(String(payload.chat_id), payload);
            return { data: [payload], error: null };
          },
          delete: () => ({
            eq: async (field: string, val: string) => {
              assert.strictEqual(field, "chat_id");
              store.delete(val);
              return { data: null, error: null };
            },
          }),
        };
      },
      _store: store,
    };
    return mockClient;
  }

  await t.test("Loads existing session from Supabase on LRU cache miss", async () => {
    const mockSupabase = createMockSupabase({
      "123456": {
        chat_id: "123456",
        username: "founder_mark",
        first_name: "Mark",
        phase: "QUALIFICATION",
        messages_count: 2,
        lead_draft: {
          serviceRequested: "AI Chatbots & Intelligent Agents",
        },
        last_active_at: new Date().toISOString(),
      },
    });

    const agent = new LeadQualifierAgent({
      supabaseClient: mockSupabase as any,
    });
    assert.strictEqual(agent.isSupabaseConfigured, true);

    // Initial cache is empty
    assert.strictEqual(agent.cacheSize, 0);

    // Turn execution should load from Supabase and hydrate LRU cache
    const res = await agent.executeTurn(123456, "We need it in 2 weeks");
    assert.strictEqual(agent.cacheSize, 1);
    assert.strictEqual(res.phase, "QUALIFICATION");
    assert.strictEqual(res.leadDraft.serviceRequested, "AI Chatbots & Intelligent Agents");
    assert.strictEqual(res.leadDraft.timeline, "2 weeks");
  });

  await t.test("Write-through persists updated session state to Supabase", async () => {
    const mockSupabase = createMockSupabase();
    const agent = new LeadQualifierAgent({
      supabaseClient: mockSupabase as any,
    });

    const res = await agent.executeTurn("998877", "/start", {
      username: "alice_dev",
      firstName: "Alice",
    });
    assert.strictEqual(res.phase, "DISCOVERY");

    // Supabase store should now contain the updated session
    const stored = mockSupabase._store.get("998877");
    assert.ok(stored);
    assert.strictEqual(stored.chat_id, "998877");
    assert.strictEqual(stored.username, "alice_dev");
    assert.strictEqual(stored.phase, "DISCOVERY");
  });

  await t.test("ResetSession removes session from cache and Supabase", async () => {
    const mockSupabase = createMockSupabase({
      "55555": {
        chat_id: "55555",
        phase: "CONFIRMED",
      },
    });
    const agent = new LeadQualifierAgent({
      supabaseClient: mockSupabase as any,
    });

    // Hydrate
    await agent.loadSession("55555");
    assert.strictEqual(agent.cacheSize, 1);

    // Reset
    await agent.resetSessionAsync("55555");
    assert.strictEqual(agent.cacheSize, 0);
    assert.strictEqual(mockSupabase._store.has("55555"), false);
  });

  await t.test("Gracefully handles Supabase 500 error / outage on loadSession without dropping turn", async () => {
    const errorSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "Internal server error: 500 network timeout", code: "500" },
            }),
          }),
        }),
        upsert: async () => {
          throw new Error("Supabase write timeout");
        },
      }),
    };

    const agent = new LeadQualifierAgent({
      supabaseClient: errorSupabase as any,
    });

    // Should not throw; should gracefully initialize a fresh session
    const res = await agent.executeTurn("chat_err_123", "Hello, I need an AI agent", {
      username: "resilient_user",
      firstName: "Resilient",
    });

    assert.strictEqual(res.phase, "DISCOVERY");
    assert.match(res.replyText, /Resilient/);
    assert.strictEqual(agent.cacheSize, 1);
  });

  await t.test("Lead finalization persists inquiryId into session lead_draft", async () => {
    const mockSupabase = createMockSupabase();
    const agent = new LeadQualifierAgent({
      supabaseClient: mockSupabase as any,
      onInquiryQualified: async () => "inq-final-777",
    });

    await agent.executeTurn("990011", "/start", { username: "charlie" });
    await agent.executeCallbackQuery("990011", "svc:ai_chatbot", { username: "charlie" });
    const finalRes = await agent.executeCallbackQuery("990011", "time:urgent", { username: "charlie" });

    assert.strictEqual(finalRes.leadQualified, true);
    assert.strictEqual(finalRes.inquiryId, "inq-final-777");

    const session = agent.getSession("990011");
    assert.strictEqual(session.inquiryId, "inq-final-777");

    const storedInDb = mockSupabase._store.get("990011");
    assert.ok(storedInDb);
    assert.strictEqual(storedInDb.lead_draft.inquiryId, "inq-final-777");
  });
});

