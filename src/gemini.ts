/**
 * Google Gemini Intelligence Client
 * Powers natural conversational turns, factual grounding via SutraDB context,
 * and structured lead entity extraction using Gemini 2.5 Flash.
 */

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface GeminiTurnResult {
  replyText: string;
  extracted?: {
    serviceRequested?: string;
    timeline?: string;
    handleOrEmail?: string;
    problemBrief?: string;
  };
}

export class GeminiClient {
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    this.timeoutMs = options.timeoutMs ?? 6000;
  }

  get isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  /**
   * Generates a conversational turn grounded in SutraDB context chunks.
   */
  async generateTurn(params: {
    userMessage: string;
    userName?: string;
    currentPhase: string;
    contextChunks?: string[];
  }): Promise<GeminiTurnResult | null> {
    if (!this.isConfigured) {
      return null;
    }

    const systemPrompt = `You are the official AI Assistant for Samarth Nimangre (SAM CODES) on Telegram.
You represent Samarth professionally: a 17-year-old systems engineer and builder based in Karnataka, India, who builds production systems (AI chatbots, workflow automation, modern Next.js web applications, SutraDB hybrid vector search, and VaniEdge voice telephony).

CRITICAL INSTRUCTIONS:
1. Speak with confidence, brevity, and craftsmanship. Keep responses concise (2 to 4 sentences max for Telegram readability).
2. Use the provided GROUND TRUTH CONTEXT from SutraDB to answer technical questions with factual accuracy.
3. NEVER make up fake client names or false statistics.
4. Always guide the user toward scoping their project or booking an architecture call with Samarth.

At the very end of your response, append an optional extraction JSON block if the user mentioned a service, timeline, email, or brief:
<<<EXTRACTION
{
  "serviceRequested": "string or null",
  "timeline": "string or null",
  "handleOrEmail": "string or null",
  "problemBrief": "string or null"
}
>>>`;

    const contextText = params.contextChunks && params.contextChunks.length > 0
      ? `\n\n[GROUND TRUTH CONTEXT FROM SUTRADB]:\n${params.contextChunks.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "";

    const userPrompt = `User: ${params.userName || "Client"}
Current Conversation Phase: ${params.currentPhase}
User Message: "${params.userMessage}"${contextText}

Generate a concise, helpful response representing Samarth:`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as any;
      const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!rawText.trim()) {
        return null;
      }

      // Parse optional extraction block
      let replyText = rawText;
      let extracted: GeminiTurnResult["extracted"] = undefined;

      const extractionMatch = rawText.match(/<<<EXTRACTION\s*([\s\S]*?)\s*>>>/);
      if (extractionMatch) {
        replyText = rawText.replace(/<<<EXTRACTION[\s\S]*?>>>/, "").trim();
        try {
          const parsed = JSON.parse(extractionMatch[1]);
          extracted = {
            serviceRequested: parsed.serviceRequested || undefined,
            timeline: parsed.timeline || undefined,
            handleOrEmail: parsed.handleOrEmail || undefined,
            problemBrief: parsed.problemBrief || undefined,
          };
        } catch {
          // Ignored if JSON parsing fails
        }
      }

      return {
        replyText: replyText.trim(),
        extracted,
      };
    } catch {
      clearTimeout(timer);
      return null;
    }
  }
}
