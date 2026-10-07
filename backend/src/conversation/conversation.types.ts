/**
 * Phase 8G — Conversation Memory types.
 *
 * These are domain types used across ConversationService and
 * ConversationContextService. They are intentionally decoupled from
 * HTTP DTOs so that future auth integration only needs to change the
 * controller layer.
 */

/**
 * Structured state persisted in Conversation.pendingClarification.
 *
 * Stored when the assistant returns type="clarification".
 * Cleared once the user's follow-up is resolved or a new unrelated
 * question is detected.
 */
export interface PendingClarification {
  /** The user's original question that triggered the clarification. */
  originalQuery: string;
  /** The clarification question asked by the assistant. */
  question: string;
  /** The explicit options presented to the user (may be empty array). */
  options: string[];
  /** ISO timestamp when this clarification was created. */
  createdAt: string;
}

/**
 * A single message loaded from the database for context assembly.
 */
export interface ConversationContextMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  responseType?: string | null;
  createdAt: Date;
}

/**
 * The assembled context the ConversationContextService provides
 * to the AssistantService before scope guard / retrieval.
 */
export interface AssembledConversationContext {
  /** The original user message this turn. */
  currentMessage: string;

  /**
   * The effective query to run through Scope Guard and retrieval.
   *
   * When a pending clarification is resolved this will be the
   * combined "originalQuery + clarification answer" form.
   * Otherwise it equals currentMessage.
   */
  effectiveQuery: string;

  /** Active pending clarification, if one was resolved this turn. */
  resolvedClarification: PendingClarification | null;

  /**
   * Whether the current message was recognized as the answer to
   * the pending clarification (true) or treated as a new question (false).
   */
  clarificationResolved: boolean;

  /**
   * Recent messages selected for LLM context window.
   * Always a small bounded set — never the full history.
   */
  recentMessages: ConversationContextMessage[];

  /** The conversation DB id (for persistence calls). */
  conversationId: string;
}
