/**
 * Agentic Reasoning & Qualification Engine
 * 4-Phase Deterministic State Machine for Telegram Client Ingestion with
 * Interactive Inline Keyboards, Dynamic Scheduling, and Callback Query Routing.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  ConversationPhase,
  TelegramSession,
  AgentTurnResult,
  UserContext,
  KnowledgeItem,
  InquiryPayload,
  InlineKeyboardMarkup,
  LeadDraft,
} from "./types.js";
import { buildSchedulingUrl } from "./scheduler.js";

export const DEFAULT_KNOWLEDGE_BASE: KnowledgeItem[] = [
  {
    id: "services",
    question: "What does Samarth build?",
    keywords: ["build", "services", "offer", "capabilities", "skills"],
    answer:
      "Samarth builds high-velocity production systems: custom AI chatbots, multi-app workflow automations, modern Next.js web applications, and fast clickable MVPs.",
  },
  {
    id: "philosophy",
    question: "Who is Samarth?",
    keywords: ["who", "sam", "samarth", "about", "bio"],
    answer:
      "Samarth Nimangre (Sam) is a 17-year-old student and builder based in Karnataka, India. He builds with curiosity, velocity, and craftsmanship — turning ideas into working digital systems.",
  },
  {
    id: "contact",
    question: "How to work with Samarth?",
    keywords: ["hire", "work", "contact", "collaborate", "email"],
    answer:
      "You can connect directly on Telegram (@Samarth1306), email (samarthknimangre@gmail.com), or submit an inquiry through his portfolio (https://sam-codes.vercel.app).",
  },
];

/**
 * High-performance in-memory Least-Recently-Used (LRU) cache with capacity eviction.
 */
export class SessionLruCache<V> {
  private cache = new Map<string, V>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string): V | undefined {
    const item = this.cache.get(key);
    if (item !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export interface AgentOptions {
  knowledge?: KnowledgeItem[];
  onInquiryQualified?: (payload: InquiryPayload) => Promise<string | void>;
  calBaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseClient?: SupabaseClient;
  cacheCapacity?: number;
}

export class LeadQualifierAgent {
  private sessions: SessionLruCache<TelegramSession>;
  private knowledge: KnowledgeItem[];
  private onInquiryQualified?: (payload: InquiryPayload) => Promise<string | void>;
  private calBaseUrl?: string;
  private supabase: SupabaseClient | null = null;

  constructor(options?: AgentOptions) {
    this.knowledge = options?.knowledge || DEFAULT_KNOWLEDGE_BASE;
    this.onInquiryQualified = options?.onInquiryQualified;
    this.calBaseUrl = options?.calBaseUrl;
    this.sessions = new SessionLruCache<TelegramSession>(options?.cacheCapacity ?? 1000);

    const sbUrl =
      options?.supabaseUrl ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL;
    const sbKey =
      options?.supabaseServiceRoleKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (options?.supabaseClient) {
      this.supabase = options.supabaseClient;
    } else if (
      sbUrl &&
      sbKey &&
      !sbUrl.includes("placeholder") &&
      !sbUrl.includes("your-project")
    ) {
      this.supabase = createClient(sbUrl, sbKey, {
        auth: { persistSession: false },
      });
    }
  }

  get isSupabaseConfigured(): boolean {
    return this.supabase !== null;
  }

  get cacheSize(): number {
    return this.sessions.size;
  }

  async loadSession(chatId: string | number, context?: UserContext): Promise<TelegramSession> {
    const key = String(chatId);
    const cached = this.sessions.get(key);
    if (cached) {
      if (context?.username && !cached.username) cached.username = context.username;
      if (context?.firstName && !cached.firstName) cached.firstName = context.firstName;
      return cached;
    }

    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from("telegram_sessions")
          .select("*")
          .eq("chat_id", key)
          .maybeSingle();

        if (!error && data) {
          const session: TelegramSession = {
            chatId: data.chat_id,
            username: data.username || context?.username,
            firstName: data.first_name || context?.firstName,
            phase: (data.phase as ConversationPhase) || "INITIAL",
            messagesCount: data.messages_count ?? 0,
            leadDraft: (data.lead_draft as LeadDraft) || {
              name: context?.firstName
                ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}`
                : undefined,
              handleOrEmail: context?.username ? `@${context.username}` : undefined,
            },
            inquiryId: (data.lead_draft as any)?.inquiryId,
            lastActiveAt: data.last_active_at ? new Date(data.last_active_at).getTime() : Date.now(),
          };
          this.sessions.set(key, session);
          return session;
        }
      } catch (err) {
        // Fall back gracefully to fresh session
        console.warn(`[teleflow-agent] Failed loading session ${key} from Supabase:`, err);
      }
    }

    const newSession: TelegramSession = {
      chatId: key,
      username: context?.username,
      firstName: context?.firstName,
      phase: "INITIAL",
      messagesCount: 0,
      leadDraft: {
        name: context?.firstName
          ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}`
          : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      },
      lastActiveAt: Date.now(),
    };
    this.sessions.set(key, newSession);
    return newSession;
  }

  getSession(chatId: string | number, context?: UserContext): TelegramSession {
    const key = String(chatId);
    const existing = this.sessions.get(key);
    if (existing) {
      if (context?.username && !existing.username) existing.username = context.username;
      if (context?.firstName && !existing.firstName) existing.firstName = context.firstName;
      return existing;
    }

    const newSession: TelegramSession = {
      chatId: key,
      username: context?.username,
      firstName: context?.firstName,
      phase: "INITIAL",
      messagesCount: 0,
      leadDraft: {
        name: context?.firstName
          ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}`
          : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      },
      lastActiveAt: Date.now(),
    };
    this.sessions.set(key, newSession);
    return newSession;
  }

  resetSession(chatId: string | number): void {
    const key = String(chatId);
    this.sessions.delete(key);
    if (this.supabase) {
      void this.resetSessionAsync(key);
    }
  }

  async resetSessionAsync(chatId: string | number): Promise<void> {
    const key = String(chatId);
    this.sessions.delete(key);
    if (this.supabase) {
      try {
        await this.supabase.from("telegram_sessions").delete().eq("chat_id", key);
      } catch {
        // Defensive
      }
    }
  }

  async persistSession(session: TelegramSession, context?: UserContext): Promise<void> {
    const key = session.chatId;
    this.sessions.set(key, session);

    if (this.supabase) {
      try {
        await this.supabase.from("telegram_sessions").upsert(
          {
            chat_id: session.chatId,
            username: session.username ?? null,
            first_name: session.firstName ?? null,
            last_name: context?.lastName ?? null,
            phase: session.phase,
            messages_count: session.messagesCount,
            lead_draft: {
              ...(session.leadDraft ?? {}),
              ...(session.inquiryId ? { inquiryId: session.inquiryId } : {}),
            },
            last_active_at: new Date(session.lastActiveAt).toISOString(),
          },
          { onConflict: "chat_id" }
        );
      } catch (err) {
        // Do not crash the conversation turn on logging/network errors
        console.warn(`[teleflow-agent] Failed to persist session ${key} to Supabase:`, err);
      }
    }
  }

  private extractEmail(text: string): string | undefined {
    const match = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    return match ? match[0].trim() : undefined;
  }

  private extractHandle(text: string): string | undefined {
    const match = text.match(/(?:^|\s)@([a-zA-Z0-9_]{3,32})\b/);
    return match ? `@${match[1]}` : undefined;
  }

  private extractTimeline(text: string): string | undefined {
    const lower = text.toLowerCase();
    if (lower.includes("asap") || lower.includes("immediately") || lower.includes("urgent")) {
      return "ASAP / Immediate priority";
    }
    const weekMatch = text.match(/(\d+)\s*(?:-|to)?\s*(\d*)\s*weeks?/i);
    if (weekMatch) return weekMatch[0].trim();
    const monthMatch = text.match(/(\d+)\s*(?:-|to)?\s*(\d*)\s*months?/i);
    if (monthMatch) return monthMatch[0].trim();
    if (lower.includes("next week")) return "Next week";
    if (lower.includes("this month")) return "This month";
    return undefined;
  }

  private matchService(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("bot") || lower.includes("chat") || lower.includes("assistant") || lower.includes("ai")) {
      return "AI Chatbots & Assistants";
    }
    if (lower.includes("automat") || lower.includes("sync") || lower.includes("crm") || lower.includes("workflow")) {
      return "Workflow & Business Automation";
    }
    if (
      lower.includes("website") ||
      lower.includes("landing page") ||
      lower.includes("next.js") ||
      lower.includes("react")
    ) {
      return "Websites & Modern Web Applications";
    }
    if (lower.includes("mvp") || lower.includes("prototype") || lower.includes("idea")) {
      return "Rapid Prototypes & Working MVPs";
    }
    return "Custom System Engineering";
  }

  private queryKnowledge(text: string): string | null {
    const lower = text.toLowerCase().trim();
    let best = null;
    let maxScore = 0;
    for (const item of this.knowledge) {
      let score = 0;
      for (const kw of item.keywords) {
        if (lower.includes(kw)) score += kw.length;
      }
      if (score > maxScore) {
        maxScore = score;
        best = item;
      }
    }
    return best && maxScore >= 4 ? best.answer : null;
  }

  /**
   * Generates interactive inline keyboard buttons for service selection.
   */
  private getServiceKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: "🤖 AI Chatbot / Agent", callback_data: "svc:ai_chatbot" },
          { text: "⚡ Workflow Automation", callback_data: "svc:automation" },
        ],
        [
          { text: "🌐 Modern Web App", callback_data: "svc:webapp" },
          { text: "🚀 Clickable MVP", callback_data: "svc:mvp" },
        ],
      ],
    };
  }

  /**
   * Generates interactive inline keyboard buttons for timeline selection.
   */
  private getTimelineKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: "⚡ Urgent (< 1 Wk)", callback_data: "time:urgent" },
          { text: "⏱️ 2–4 Weeks", callback_data: "time:2_4_weeks" },
        ],
        [
          { text: "🗓️ 1–2 Months", callback_data: "time:1_2_months" },
          { text: "💬 Flexible", callback_data: "time:flexible" },
        ],
      ],
    };
  }

  /**
   * Generates confirmed state actions: Cal.com scheduling CTA + portfolio link.
   */
  private getConfirmedKeyboard(bookingUrl: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: "📅 Book Architecture Call", url: bookingUrl }],
        [
          { text: "🌐 View Live Portfolio", url: "https://sam-codes.vercel.app" },
          { text: "🔄 Start New Brief", callback_data: "action:reset" },
        ],
      ],
    };
  }

  /**
   * Handles interactive button presses from Telegram Callback Queries.
   */
  async executeCallbackQuery(
    chatId: string | number,
    callbackData: string,
    context?: UserContext
  ): Promise<AgentTurnResult> {
    const start = Date.now();
    const session = await this.loadSession(chatId, context);
    session.lastActiveAt = Date.now();

    // 1. Reset Action
    if (callbackData === "action:reset") {
      session.phase = "INITIAL";
      session.leadDraft = {
        name: context?.firstName
          ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}`
          : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      };

      await this.persistSession(session, context);

      const name = session.leadDraft.name || session.firstName || "there";
      return {
        replyText:
          `🔄 Conversation reset!\n\n` +
          `Hey ${name}, what type of system or solution would you like to build?`,
        phase: "DISCOVERY",
        leadDraft: session.leadDraft,
        leadQualified: false,
        replyMarkup: this.getServiceKeyboard(),
        latencyMs: Date.now() - start,
      };
    }

    // 2. Service Selection via Button
    if (callbackData.startsWith("svc:")) {
      const svcKey = callbackData.replace("svc:", "");
      const svcMap: Record<string, string> = {
        ai_chatbot: "AI Chatbots & Intelligent Agents",
        automation: "Workflow & Business Automation",
        webapp: "Websites & Modern Web Applications",
        mvp: "Rapid Prototypes & Working MVPs",
      };

      const matched = svcMap[svcKey] || "Custom System Engineering";
      session.leadDraft.serviceRequested = matched;
      session.leadDraft.problemBrief = `Selected via quick action: ${matched}`;
      session.phase = "QUALIFICATION";

      await this.persistSession(session, context);

      return {
        replyText:
          `🎯 Selected: *${matched}*\n\n` +
          `What is your target launch timeline? Pick an option below or type your desired schedule:`,
        phase: "QUALIFICATION",
        leadDraft: session.leadDraft,
        leadQualified: false,
        replyMarkup: this.getTimelineKeyboard(),
        latencyMs: Date.now() - start,
      };
    }

    // 3. Timeline Selection via Button
    if (callbackData.startsWith("time:")) {
      const timeKey = callbackData.replace("time:", "");
      const timeMap: Record<string, string> = {
        urgent: "Urgent (< 1 week)",
        "2_4_weeks": "2–4 weeks",
        "1_2_months": "1–2 months",
        flexible: "Flexible / Exploring",
      };

      session.leadDraft.timeline = timeMap[timeKey] || "2–4 weeks";

      // Check if we already have handle or email from Telegram user context
      if (session.leadDraft.handleOrEmail) {
        return this.finalizeLead(session, start, context);
      }

      await this.persistSession(session, context);

      // If no handle or email known, prompt the user
      return {
        replyText:
          `⏱️ Timeline noted: *${session.leadDraft.timeline}*.\n\n` +
          `To finalize your brief and deliver architecture specifications, what is your best contact email or Telegram handle?`,
        phase: "QUALIFICATION",
        leadDraft: session.leadDraft,
        leadQualified: false,
        latencyMs: Date.now() - start,
      };
    }

    await this.persistSession(session, context);

    // Fallback for unrecognized callback data
    return {
      replyText: "Got your selection! Let's continue.",
      phase: session.phase,
      leadDraft: session.leadDraft,
      leadQualified: false,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Finalizes qualification and dispatches lead payload.
   */
  private async finalizeLead(
    session: TelegramSession,
    startTime: number,
    context?: UserContext
  ): Promise<AgentTurnResult> {
    session.phase = "CONFIRMED";
    let inquiryId: string | undefined;

    if (this.onInquiryQualified) {
      const res = await this.onInquiryQualified({
        name: session.leadDraft.name || `@${session.username || "client"}`,
        email:
          session.leadDraft.handleOrEmail?.includes("@") &&
          !session.leadDraft.handleOrEmail.startsWith("@")
            ? session.leadDraft.handleOrEmail
            : undefined,
        contactMethod: `Telegram (@${session.username || "client"})${
          session.leadDraft.handleOrEmail ? ` / ${session.leadDraft.handleOrEmail}` : ""
        }`,
        serviceRequested: session.leadDraft.serviceRequested || "Custom System Engineering",
        message: `[LEAD INTAKE]\n• Service: ${session.leadDraft.serviceRequested}\n• Brief: ${
          session.leadDraft.problemBrief || "Direct qualification"
        }\n• Timeline: ${session.leadDraft.timeline}`,
      });
      if (typeof res === "string") {
        inquiryId = res;
        session.inquiryId = res;
      }
    }

    await this.persistSession(session, context);

    const bookingUrl = buildSchedulingUrl({
      name: session.leadDraft.name || session.username,
      email: session.leadDraft.handleOrEmail?.includes("@") && !session.leadDraft.handleOrEmail.startsWith("@")
        ? session.leadDraft.handleOrEmail
        : undefined,
      notes: `Service: ${session.leadDraft.serviceRequested} | Timeline: ${session.leadDraft.timeline}`,
      calBaseUrl: this.calBaseUrl,
    });

    const replyText =
      `✅ *Project brief logged directly into Samarth's Command Center!*\n\n` +
      `• *Target System:* ${session.leadDraft.serviceRequested}\n` +
      `• *Timeline:* ${session.leadDraft.timeline}\n` +
      `• *Contact:* ${session.leadDraft.handleOrEmail || `@${session.username || "Telegram"}`}\n\n` +
      `Samarth personally reviews every specification within 24 hours. You can also book an immediate discovery slot below:`;

    return {
      replyText,
      phase: "CONFIRMED",
      leadDraft: session.leadDraft,
      leadQualified: true,
      inquiryId,
      bookingUrl,
      replyMarkup: this.getConfirmedKeyboard(bookingUrl),
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Executes a conversational turn against the state machine.
   */
  async executeTurn(
    chatId: string | number,
    text: string,
    context?: UserContext
  ): Promise<AgentTurnResult> {
    const start = Date.now();
    const session = await this.loadSession(chatId, context);
    session.messagesCount++;
    session.lastActiveAt = Date.now();

    const raw = text.trim();
    const lower = raw.toLowerCase();

    // Reset command
    if (lower === "/start" || lower === "/reset") {
      session.phase = "INITIAL";
      session.leadDraft = {
        name: context?.firstName
          ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}`
          : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      };
    }

    const email = this.extractEmail(raw);
    const handle = this.extractHandle(raw);
    const timeline = this.extractTimeline(raw);

    if (email) session.leadDraft.handleOrEmail = email;
    else if (
      handle &&
      !session.leadDraft.handleOrEmail?.includes("@") &&
      !session.leadDraft.handleOrEmail?.includes(".")
    ) {
      session.leadDraft.handleOrEmail = handle;
    }
    if (timeline) session.leadDraft.timeline = timeline;

    // Direct FAQ response check
    const faqAnswer = this.queryKnowledge(raw);
    if (faqAnswer && session.messagesCount === 1) {
      session.phase = "DISCOVERY";
      await this.persistSession(session, context);
      return {
        replyText: `${faqAnswer}\n\nAre you looking to build or automate something specific right now? Pick an option or tell me about your project!`,
        phase: session.phase,
        leadDraft: session.leadDraft,
        leadQualified: false,
        replyMarkup: this.getServiceKeyboard(),
        latencyMs: Date.now() - start,
      };
    }

    let replyText = "";
    let leadQualified = false;
    let replyMarkup: InlineKeyboardMarkup | undefined;
    let bookingUrl: string | undefined;

    switch (session.phase) {
      case "INITIAL": {
        const name = session.leadDraft.name || session.firstName || "there";
        replyText =
          `👋 Hey ${name}! I'm Samarth's AI Qualifier.\n\n` +
          `Samarth builds custom AI chatbots, workflow automations, and modern web applications.\n\n` +
          `Select a category below or tell me about your project:`;
        session.phase = "DISCOVERY";
        replyMarkup = this.getServiceKeyboard();
        break;
      }

      case "DISCOVERY": {
        session.leadDraft.serviceRequested = this.matchService(raw);
        session.leadDraft.problemBrief = raw;

        if (session.leadDraft.handleOrEmail && session.leadDraft.timeline) {
          return this.finalizeLead(session, start, context);
        } else {
          session.phase = "QUALIFICATION";
          replyText =
            `Understood! For *${session.leadDraft.serviceRequested}*, Samarth focuses on rapid turnaround and reliable production architecture.\n\n` +
            `What is your target launch timeline?`;
          replyMarkup = this.getTimelineKeyboard();
        }
        break;
      }

      case "QUALIFICATION": {
        if (!session.leadDraft.timeline) {
          session.leadDraft.timeline = timeline || raw;
        }

        // If email or handle is present, finalize
        if (session.leadDraft.handleOrEmail || email || handle) {
          return this.finalizeLead(session, start, context);
        }

        replyText =
          `Timeline noted: *${session.leadDraft.timeline}*.\n\n` +
          `What is your best contact email or handle so Samarth can deliver your technical specification?`;
        break;
      }

      case "CONFIRMED": {
        if (faqAnswer) {
          replyText = `${faqAnswer}\n\nYour earlier project brief is already saved in Samarth's queue. Anything else you'd like to attach?`;
        } else {
          replyText = `Got it! I've noted this additional detail for your project brief. Samarth will review it shortly.`;
        }
        break;
      }
    }

    await this.persistSession(session, context);

    return {
      replyText,
      phase: session.phase,
      leadDraft: session.leadDraft,
      leadQualified,
      replyMarkup,
      bookingUrl,
      latencyMs: Date.now() - start,
    };
  }
}
