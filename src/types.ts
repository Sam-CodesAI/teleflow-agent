/**
 * Core Type Definitions for Sam CodeAI Telegram Bot
 */

export type ConversationPhase = "INITIAL" | "DISCOVERY" | "QUALIFICATION" | "CONFIRMED";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface LeadDraft {
  name?: string;
  handleOrEmail?: string;
  serviceRequested?: string;
  problemBrief?: string;
  timeline?: string;
  estimatedScope?: string;
}

export interface TelegramSession {
  chatId: string;
  username?: string;
  firstName?: string;
  phase: ConversationPhase;
  messagesCount: number;
  leadDraft: LeadDraft;
  lastActiveAt: number;
  inquiryId?: string;
}

export interface AgentTurnResult {
  replyText: string;
  phase: ConversationPhase;
  leadDraft: LeadDraft;
  leadQualified: boolean;
  inquiryId?: string;
  latencyMs: number;
}

export interface UserContext {
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface InquiryPayload {
  name: string;
  email?: string;
  contactMethod: string;
  serviceRequested: string;
  message: string;
}

export interface KnowledgeItem {
  id: string;
  question: string;
  keywords: string[];
  answer: string;
}
