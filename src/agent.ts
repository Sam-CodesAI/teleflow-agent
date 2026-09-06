/**
 * Agentic Reasoning & Qualification Engine
 * 4-Phase Deterministic State Machine for Telegram Client Ingestion
 */

import {
  ConversationPhase,
  TelegramSession,
  AgentTurnResult,
  UserContext,
  KnowledgeItem,
  InquiryPayload,
} from "./types.js";

export const DEFAULT_KNOWLEDGE_BASE: KnowledgeItem[] = [
  {
    id: "services",
    question: "What does Samarth build?",
    keywords: ["build", "services", "offer", "capabilities", "skills"],
    answer: "Samarth builds production-ready digital systems: custom AI chatbots, multi-app workflow automations, modern Next.js web applications, and fast clickable MVPs.",
  },
  {
    id: "philosophy",
    question: "Who is Samarth?",
    keywords: ["who", "sam", "samarth", "about", "bio"],
    answer: "Samarth Nimangre (Sam) is a 17-year-old student and builder based in Karnataka, India. He builds with curiosity, velocity, and craftsmanship — turning ideas into working digital systems.",
  },
  {
    id: "contact",
    question: "How to work with Samarth?",
    keywords: ["hire", "work", "contact", "collaborate", "email"],
    answer: "You can reach out via Telegram (@Samarth1306), email (samarthknimangre@gmail.com), or submit an inquiry through his portfolio (https://sam-codes.vercel.app).",
  },
];

export interface AgentOptions {
  knowledge?: KnowledgeItem[];
  onInquiryQualified?: (payload: InquiryPayload) => Promise<string | void>;
}

export class LeadQualifierAgent {
  private sessions = new Map<string, TelegramSession>();
  private knowledge: KnowledgeItem[];
  private onInquiryQualified?: (payload: InquiryPayload) => Promise<string | void>;

  constructor(options?: AgentOptions) {
    this.knowledge = options?.knowledge || DEFAULT_KNOWLEDGE_BASE;
    this.onInquiryQualified = options?.onInquiryQualified;
  }

  getSession(chatId: string | number, context?: UserContext): TelegramSession {
    const key = String(chatId);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const newSession: TelegramSession = {
      chatId: key,
      username: context?.username,
      firstName: context?.firstName,
      phase: "INITIAL",
      messagesCount: 0,
      leadDraft: {
        name: context?.firstName ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}` : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      },
      lastActiveAt: Date.now(),
    };
    this.sessions.set(key, newSession);
    return newSession;
  }

  resetSession(chatId: string | number): void {
    this.sessions.delete(String(chatId));
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
    if (lower.includes("website") || lower.includes("landing page") || lower.includes("next.js") || lower.includes("react")) {
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

  async executeTurn(
    chatId: string | number,
    text: string,
    context?: UserContext
  ): Promise<AgentTurnResult> {
    const start = Date.now();
    const session = this.getSession(chatId, context);
    session.messagesCount++;
    session.lastActiveAt = Date.now();

    const raw = text.trim();
    const lower = raw.toLowerCase();

    if (lower === "/start" || lower === "/reset") {
      session.phase = "INITIAL";
      session.leadDraft = {
        name: context?.firstName ? `${context.firstName}${context.lastName ? ` ${context.lastName}` : ""}` : undefined,
        handleOrEmail: context?.username ? `@${context.username}` : undefined,
      };
    }

    const email = this.extractEmail(raw);
    const handle = this.extractHandle(raw);
    const timeline = this.extractTimeline(raw);

    if (email) session.leadDraft.handleOrEmail = email;
    else if (handle && !session.leadDraft.handleOrEmail?.includes("@") && !session.leadDraft.handleOrEmail?.includes(".")) {
      session.leadDraft.handleOrEmail = handle;
    }
    if (timeline) session.leadDraft.timeline = timeline;

    const faqAnswer = this.queryKnowledge(raw);
    if (faqAnswer && session.messagesCount === 1) {
      session.phase = "DISCOVERY";
      return {
        replyText: `${faqAnswer}\n\nAre you looking to build or automate something specific right now? Tell me about your project!`,
        phase: session.phase,
        leadDraft: session.leadDraft,
        leadQualified: false,
        latencyMs: Date.now() - start,
      };
    }

    let replyText = "";
    let leadQualified = false;
    let inquiryId: string | undefined = undefined;

    switch (session.phase) {
      case "INITIAL": {
        const name = session.leadDraft.name || session.firstName || "there";
        replyText =
          `👋 Hey ${name}! I'm Samarth's AI Qualifier.\n\n` +
          `Samarth builds custom AI chatbots, workflow automations, and modern web applications.\n\n` +
          `What kind of system or automation are you looking to build?`;
        session.phase = "DISCOVERY";
        break;
      }

      case "DISCOVERY": {
        session.leadDraft.serviceRequested = this.matchService(raw);
        session.leadDraft.problemBrief = raw;

        if (session.leadDraft.handleOrEmail && session.leadDraft.timeline) {
          leadQualified = true;
          session.phase = "CONFIRMED";
          if (this.onInquiryQualified) {
            const res = await this.onInquiryQualified({
              name: session.leadDraft.name || `@${session.username || "client"}`,
              email: session.leadDraft.handleOrEmail.includes("@") && !session.leadDraft.handleOrEmail.startsWith("@") ? session.leadDraft.handleOrEmail : undefined,
              contactMethod: `Telegram (@${session.username || "client"})${session.leadDraft.handleOrEmail ? ` / ${session.leadDraft.handleOrEmail}` : ""}`,
              serviceRequested: session.leadDraft.serviceRequested,
              message: `[LEAD INTAKE]\n• Service: ${session.leadDraft.serviceRequested}\n• Brief: ${session.leadDraft.problemBrief}\n• Timeline: ${session.leadDraft.timeline}`,
            });
            if (typeof res === "string") inquiryId = res;
          }
          replyText =
            `✅ Project brief logged directly to Samarth's Command Center!\n\n` +
            `• Target: ${session.leadDraft.serviceRequested}\n` +
            `• Timeline: ${session.leadDraft.timeline}\n` +
            `• Contact: ${session.leadDraft.handleOrEmail}\n\n` +
            `Samarth personally inspects every specification and will follow up within 24 hours.`;
        } else {
          session.phase = "QUALIFICATION";
          replyText =
            `Understood! For ${session.leadDraft.serviceRequested}, Samarth focuses on rapid turnaround and reliable production architecture.\n\n` +
            `To finalize your brief:\n` +
            `1. What is your target launch timeline (e.g. 2 weeks, ASAP, end of month)?\n` +
            `2. What is your best contact email or handle for detailed blueprints?`;
        }
        break;
      }

      case "QUALIFICATION": {
        if (!session.leadDraft.timeline) session.leadDraft.timeline = timeline || raw;
        leadQualified = true;
        session.phase = "CONFIRMED";

        if (this.onInquiryQualified) {
          const res = await this.onInquiryQualified({
            name: session.leadDraft.name || `@${session.username || "client"}`,
            email: session.leadDraft.handleOrEmail?.includes("@") && !session.leadDraft.handleOrEmail.startsWith("@") ? session.leadDraft.handleOrEmail : undefined,
            contactMethod: `Telegram (@${session.username || "client"})${session.leadDraft.handleOrEmail ? ` / ${session.leadDraft.handleOrEmail}` : ""}`,
            serviceRequested: session.leadDraft.serviceRequested || "Custom System Engineering",
            message: `[LEAD INTAKE]\n• Service: ${session.leadDraft.serviceRequested}\n• Brief: ${session.leadDraft.problemBrief}\n• Timeline: ${session.leadDraft.timeline}`,
          });
          if (typeof res === "string") inquiryId = res;
        }

        replyText =
          `✅ Your project brief has been logged directly into Samarth's Command Center!\n\n` +
          `• System: ${session.leadDraft.serviceRequested}\n` +
          `• Timeline: ${session.leadDraft.timeline}\n\n` +
          `Samarth personally reviews all specifications and will follow up with you within 24 hours.`;
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

    return {
      replyText,
      phase: session.phase,
      leadDraft: session.leadDraft,
      leadQualified,
      inquiryId,
      latencyMs: Date.now() - start,
    };
  }
}
