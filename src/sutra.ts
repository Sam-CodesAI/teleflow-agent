/**
 * SutraDB Vector & Lexical Hybrid Search Client
 * Communicates with SutraDB's HTTP REST server (FastAPI ASGI / Port 8765)
 * for sub-millisecond factual grounding and semantic retrieval.
 */

export interface SutraDocumentHit {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
  dense_score?: number;
  bm25_score?: number;
}

export interface SutraDBClientOptions {
  baseUrl?: string;
  collectionName?: string;
  timeoutMs?: number;
}

export class SutraDBClient {
  private baseUrl: string;
  private collectionName: string;
  private timeoutMs: number;

  constructor(options: SutraDBClientOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.SUTRADB_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
    this.collectionName = options.collectionName || process.env.SUTRADB_COLLECTION || "knowledge_base";
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  /**
   * Performs hybrid vector + BM25 lexical search against SutraDB collection.
   * Returns top matching document hits or empty array on timeout/network failure.
   */
  async search(queryText: string, topK: number = 3): Promise<SutraDocumentHit[]> {
    if (!queryText || !queryText.trim()) {
      return [];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: queryText,
          top_k: topK,
          hybrid: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { results?: SutraDocumentHit[] };
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      clearTimeout(timer);
      // Graceful fallback: return empty without throwing to keep conversation live
      return [];
    }
  }

  /**
   * Health check verifying whether SutraDB server is reachable.
   */
  async isHealthy(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  }
}
