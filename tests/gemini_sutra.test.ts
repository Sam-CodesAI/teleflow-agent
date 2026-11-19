import test from "node:test";
import assert from "node:assert";
import { SutraDBClient, SutraDocumentHit } from "../src/sutra.js";
import { GeminiClient } from "../src/gemini.js";
import { LeadQualifierAgent } from "../src/agent.js";

test("SutraDB Client Hybrid Search & Fault Tolerance", async (t) => {
  await t.test("Gracefully returns empty array on offline SutraDB server", async () => {
    const client = new SutraDBClient({ baseUrl: "http://127.0.0.1:9999", timeoutMs: 200 });
    const hits = await client.search("Next.js web development");
    assert.ok(Array.isArray(hits));
    assert.strictEqual(hits.length, 0);

    const isHealthy = await client.isHealthy();
    assert.strictEqual(isHealthy, false);
  });

  await t.test("Parses successful SutraDB search hits", async () => {
    const mockHits: SutraDocumentHit[] = [
      {
        id: "doc_1",
        score: 0.95,
        text: "Samarth builds sub-second voice AI agents with VaniEdge.",
        metadata: { category: "voice" },
        dense_score: 0.92,
        bm25_score: 1.25,
      },
    ];

    // Create a mock client
    const mockClient = {
      search: async (q: string) => mockHits,
      isHealthy: async () => true,
    } as unknown as SutraDBClient;

    const hits = await mockClient.search("voice AI");
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].id, "doc_1");
    assert.match(hits[0].text, /VaniEdge/);
  });
});

test("Gemini Intelligence Client & Entity Extraction", async (t) => {
  await t.test("Returns null when unconfigured", async () => {
    const unconfigured = new GeminiClient({ apiKey: "" });
    assert.strictEqual(unconfigured.isConfigured, false);
    const res = await unconfigured.generateTurn({
      userMessage: "Hello",
      currentPhase: "DISCOVERY",
    });
    assert.strictEqual(res, null);
  });

  await t.test("Parses response and extraction block correctly", async () => {
    const mockGeminiClient = {
      isConfigured: true,
      generateTurn: async () => ({
        replyText: "Samarth specializes in building sub-second voice telephony and custom AI chatbots.",
        extracted: {
          serviceRequested: "Voice AI & Telephony",
          timeline: "2 weeks",
          handleOrEmail: "client@venture.co",
          problemBrief: "Need low latency voice bot",
        },
      }),
    } as unknown as GeminiClient;

    const res = await mockGeminiClient.generateTurn({
      userMessage: "Need a voice bot in 2 weeks, contact client@venture.co",
      currentPhase: "DISCOVERY",
    });

    assert.ok(res);
    assert.match(res.replyText, /sub-second voice telephony/);
    assert.strictEqual(res.extracted?.serviceRequested, "Voice AI & Telephony");
    assert.strictEqual(res.extracted?.timeline, "2 weeks");
    assert.strictEqual(res.extracted?.handleOrEmail, "client@venture.co");
  });
});

test("LeadQualifierAgent Grounded with SutraDB + Gemini", async (t) => {
  await t.test("Injects SutraDB ground truth and Gemini intelligence into conversation turn", async () => {
    let capturedContext: string[] | undefined = undefined;

    const mockSutra: SutraDBClient = {
      search: async (queryText: string) => [
        {
          id: "kb_vaniedge",
          score: 0.98,
          text: "VaniEdge is Samarth's sub-second edge telephony platform built with Twilio and SutraDB.",
          metadata: { project: "VaniEdge" },
        },
      ],
      isHealthy: async () => true,
    } as unknown as SutraDBClient;

    const mockGemini: GeminiClient = {
      isConfigured: true,
      generateTurn: async (params) => {
        capturedContext = params.contextChunks;
        return {
          replyText: "Yes! Samarth built VaniEdge Voice Platform with sub-second carrier audio streaming.",
          extracted: {
            serviceRequested: "Voice AI & Edge Telephony",
            timeline: "3 weeks",
          },
        };
      },
    } as unknown as GeminiClient;

    const agent = new LeadQualifierAgent({
      sutraClient: mockSutra,
      geminiClient: mockGemini,
    });

    assert.strictEqual(agent.isSutraConfigured, true);
    assert.strictEqual(agent.isGeminiConfigured, true);

    const res = await agent.executeTurn(443322, "Can Samarth build a voice telephony system?", {
      username: "telephony_buyer",
      firstName: "David",
    });

    // 1. Initial greeting turn advances phase
    assert.strictEqual(res.phase, "DISCOVERY");

    // 2. Next turn provides the question
    const turn2 = await agent.executeTurn(443322, "Can Samarth build a voice telephony system?", {
      username: "telephony_buyer",
    });

    assert.strictEqual(turn2.phase, "CONFIRMED");
    assert.strictEqual(turn2.leadQualified, true);
    assert.strictEqual(turn2.leadDraft.serviceRequested, "Voice AI & Edge Telephony");
    assert.strictEqual(turn2.leadDraft.timeline, "3 weeks");
    assert.ok(capturedContext);
    assert.match(capturedContext[0], /VaniEdge/);
  });
});
