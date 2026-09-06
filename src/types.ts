/**
 * Teleflow Agent — Type Definitions
 * Strict TypeScript schemas for autonomous Telegram agent, inline buttons,
 * callback queries, CRM routing, and appointment scheduling.
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

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface LeadDraft {
  name?: string;
  handleOrEmail?: string;
  serviceRequested?: string;
  problemBrief?: string;
  timeline?: string;
  estimatedScope?: string;
  budgetRange?: string;
  confidenceScore?: number;
  sourceChannel?: string;
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
  replyMarkup?: InlineKeyboardMarkup;
  bookingUrl?: string;
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
  metadata?: Record<string, unknown>;
}

export interface KnowledgeItem {
  id: string;
  question: string;
  keywords: string[];
  answer: string;
}

export interface SchedulingOptions {
  name?: string;
  email?: string;
  notes?: string;
  calBaseUrl?: string;
}

export interface CRMDispatchResult {
  sink: string;
  success: boolean;
  error?: string;
  recordId?: string;
}
