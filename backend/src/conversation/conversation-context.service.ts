import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from './conversation.service.js';
import { ConversationFollowupResolverService } from './conversation-followup-resolver.service.js';
import type {
  PendingClarification,
  AssembledConversationContext,
  ConversationContextMessage,
} from './conversation.types.js';

// ---------------------------------------------------------------------------
// Clarification option normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy clarification matching.
 * - Lowercased
 * - Accents stripped
 * - Apostrophes/hyphens → space
 * - Collapsed whitespace
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
    .replace(/['''\-]/g, ' ')          // apostrophes / hyphens → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Known informal aliases for clarification options.
 * Maps normalized alias → normalized canonical option fragment.
 * Keep narrow — only well-known short forms used by Tunisian students.
 */
const OPTION_ALIASES: Record<string, string> = {
  'prepa':       'preparatoire',
  'prépa':       'preparatoire',
  'ingenieurs':  'ingenieur',
  'ingenieur':   'ingenieur',
  'ingénieurs':  'ingenieur',
  'ingénieur':   'ingenieur',
  'ing':         'ingenieur',
  'prep':        'preparatoire',
  'préparatoire scientifique': 'preparatoire',
  'preparatoire scientifique': 'preparatoire',
  'preparatoire integre': 'preparatoire',
  'licence':     'licence',
  'master':      'master',
};

/**
 * Check whether `userInput` matches one of the pending clarification options.
 *
 * Matching rules:
 * 1. Exact normalized match against any option text
 * 2. Alias lookup → normalized option contains alias target
 * 3. User input is contained in a normalized option (substring)
 * 4. A normalized option is contained in user input (option is short, input elaborates)
 *
 * Returns the matching option string or null.
 *
 * IMPORTANT: this function is ONLY called when a pending clarification exists.
 * It does NOT globally classify user intent.
 */
function matchClarificationOption(
  userInput: string,
  options: string[],
): string | null {
  const normInput = normalizeForMatch(userInput);

  // Check alias first
  const aliasTarget = OPTION_ALIASES[normInput];
  if (aliasTarget) {
    // Find option that contains the alias target
    for (const opt of options) {
      if (normalizeForMatch(opt).includes(aliasTarget)) {
        return opt;
      }
    }
  }

  for (const opt of options) {
    const normOpt = normalizeForMatch(opt);

    // 1. Exact match
    if (normInput === normOpt) return opt;

    // 2. Alias via lookup on option
    for (const [alias, target] of Object.entries(OPTION_ALIASES)) {
      if (normInput === normalizeForMatch(alias) && normOpt.includes(target)) {
        return opt;
      }
    }

    // 3. User input is a substring of option
    if (normInput.length >= 3 && normOpt.includes(normInput)) return opt;

    // 4. Option text is a substring of user input (e.g. user typed more)
    if (normOpt.length >= 4 && normInput.includes(normOpt)) return opt;
  }

  return null;
}

// ---------------------------------------------------------------------------
// ConversationContextService
// ---------------------------------------------------------------------------

/**
 * Phase 8G — ConversationContextService
 *
 * Assembles a small, bounded conversational context for each request.
 *
 * Key responsibilities:
 *   1. Detect whether the current message answers a pending clarification
 *   2. Build the effective query (resolved or original)
 *   3. Select only a limited window of recent messages for LLM context
 *   4. Enforce CONVERSATION_RECENT_MESSAGE_LIMIT and CONVERSATION_CONTEXT_MAX_CHARS
 *
 * DOES NOT:
 *   - Summarize conversations with an LLM
 *   - Do semantic similarity search over history
 *   - Treat conversation history as factual authority
 */
@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);

  /** Maximum number of recent messages to load for context. */
  private readonly recentMessageLimit: number;

  /** Maximum characters of conversation context to pass to the LLM. */
  private readonly contextMaxChars: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    private readonly followupResolver: ConversationFollowupResolverService,
  ) {
    this.recentMessageLimit = Number(
      this.configService.get<string>('CONVERSATION_RECENT_MESSAGE_LIMIT', '6'),
    );
    this.contextMaxChars = Number(
      this.configService.get<string>('CONVERSATION_CONTEXT_MAX_CHARS', '4000'),
    );
  }

  /**
   * Build the assembled context for a given user message.
   *
   * Algorithm:
   * 1. Load conversation (get or create)
   * 2. Load pending clarification
   * 3. Load recent messages (bounded by limit)
   * 4. If pending clarification exists AND user message matches one of its
   *    options → resolve: build effectiveQuery from originalQuery + answer
   * 5. If pending clarification exists but message does NOT match any option
   *    → treat as a new question; ignore the stale pending clarification
   * 6. Apply char budget to recent messages
   */
  async assembleContext(
    userId: string,
    currentMessage: string,
  ): Promise<AssembledConversationContext> {
    // Step 1: Ensure conversation exists
    const conv = await this.conversationService.getOrCreateConversation(userId);
    const conversationId = conv.id;

    // Step 2: Load pending clarification
    const pending = await this.conversationService.getPendingClarification(conversationId);

    // Step 3: Load recent messages (bounded)
    const rawMessages = await this.conversationService.loadRecentContextMessages(
      conversationId,
      this.recentMessageLimit,
    );

    // Step 4/5: Clarification resolution
    let effectiveQuery = currentMessage;
    let resolvedClarification: PendingClarification | null = null;
    let clarificationResolved = false;
    let followupResolved = false;

    if (pending) {
      const matchedOption = pending.options.length > 0
        ? matchClarificationOption(currentMessage, pending.options)
        : null;

      if (matchedOption !== null) {
        // The user answered the clarification
        effectiveQuery = `${pending.originalQuery} ${matchedOption}`.trim();
        resolvedClarification = pending;
        clarificationResolved = true;

        this.logger.log(
          `[ContextService] clarification resolved: option="${matchedOption}" effectiveQuery length=${effectiveQuery.length}`,
        );
      } else {
        // User's message does NOT match any clarification option → new question
        // The stale pending clarification will be cleared by AssistantService
        this.logger.debug(
          `[ContextService] pending clarification not matched → treating as new question`,
        );
      }
    }

    // Step 5b: Follow-up resolution (if not clarification)
    if (!clarificationResolved) {
      const followupResult = this.followupResolver.resolveFollowup(currentMessage, rawMessages);
      if (followupResult.wasResolvedAsFollowup) {
        effectiveQuery = followupResult.effectiveQuery;
        followupResolved = true;
      }
    }

    // Step 6: Apply char budget to recent messages
    const boundedMessages = this.applyCharBudget(rawMessages);

    return {
      currentMessage,
      effectiveQuery,
      resolvedClarification,
      clarificationResolved,
      followupResolved,
      recentMessages: boundedMessages,
      conversationId,
    };
  }

  /**
   * Trim the recent message list to fit within CONVERSATION_CONTEXT_MAX_CHARS.
   * Removes oldest messages first (keep the most recent ones).
   */
  private applyCharBudget(
    messages: ConversationContextMessage[],
  ): ConversationContextMessage[] {
    if (messages.length === 0) return [];

    let total = 0;
    const kept: ConversationContextMessage[] = [];

    // Walk from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const charCount = messages[i].content.length;
      if (total + charCount > this.contextMaxChars) break;
      total += charCount;
      kept.unshift(messages[i]);
    }

    if (kept.length < messages.length) {
      this.logger.debug(
        `[ContextService] char budget trimmed ${messages.length - kept.length} message(s) ` +
        `(budget=${this.contextMaxChars}, used=${total})`,
      );
    }

    return kept;
  }

  // Expose for testing
  get recentMessageLimitValue(): number { return this.recentMessageLimit; }
  get contextMaxCharsValue(): number { return this.contextMaxChars; }
}

// Re-export for testing
export { matchClarificationOption };
