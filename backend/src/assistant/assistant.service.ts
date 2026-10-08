import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AskAssistantDto } from './dto/ask-assistant.dto.js';
import { AssistantResponse, AssistantTiming } from './types/assistant.types.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { LlmService } from '../llm/llm.service.js';
import { RagContextBuilderService } from '../rag/rag-context-builder.service.js';
import { RagPromptBuilderService } from '../rag/rag-prompt-builder.service.js';
import { RagContextSource } from '../rag/rag.types.js';
import { buildNoVerifiedInfoFallback, buildOutOfScopeMessage } from './language-fallback.helper.js';
import { ScopeGuardService } from '../scope-guard/scope-guard.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import { ConversationContextService } from '../conversation/conversation-context.service.js';
import type { PendingClarification } from '../conversation/conversation.types.js';

/**
 * Phase 8G — conversation-aware AssistantService.
 *
 * Pipeline for requests WITH userId:
 *   1. Get/create conversation
 *   2. Load pending clarification + recent context (via ConversationContextService)
 *   3. Resolve effective query if pending clarification is answered
 *   4. Scope Guard (against the EFFECTIVE query — never raw single-word answer)
 *   5. Retrieval using effective query
 *   6. RAG context build
 *   7. LLM prompt (with conversation history section + grounding rule)
 *   8. Validate response
 *   9. Persist completed exchange atomically
 *  10. Update/clear pending clarification state
 *
 * For requests WITHOUT userId: full backward-compatible stateless path.
 *
 * SECURITY INVARIANT: conversation history is NEVER a factual authority.
 * The only authoritative source is the current <ISSATSO_CONTEXT> block.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly retrievalTopK: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly retrievalService: RetrievalService,
    private readonly llmService: LlmService,
    private readonly ragContextBuilder: RagContextBuilderService,
    private readonly ragPromptBuilder: RagPromptBuilderService,
    private readonly scopeGuard: ScopeGuardService,
    private readonly conversationService: ConversationService,
    private readonly conversationContextService: ConversationContextService,
  ) {
    this.retrievalTopK = this.configService.get<number>('RAG_RETRIEVAL_TOP_K', 8);
  }

  async ask(dto: AskAssistantDto): Promise<AssistantResponse> {
    const startTime = Date.now();
    let retrievalMs = 0;
    let contextBuildMs = 0;
    let generationMs = 0;

    // ── Conversation-aware path ───────────────────────────────────────────────
    if (dto.userId) {
      return this.askWithConversation(dto, startTime);
    }

    // ── Stateless backward-compatible path ───────────────────────────────────
    return this.askStateless(dto, startTime, retrievalMs, contextBuildMs, generationMs);
  }

  // ---------------------------------------------------------------------------
  // Conversation-aware path
  // ---------------------------------------------------------------------------

  private async askWithConversation(
    dto: AskAssistantDto,
    startTime: number,
  ): Promise<AssistantResponse> {
    const userId = dto.userId!;
    let retrievalMs = 0;
    let contextBuildMs = 0;
    let generationMs = 0;

    // Step 1–3: Assemble conversational context + resolve pending clarification
    const ctx = await this.conversationContextService.assembleContext(
      userId,
      dto.query.trim(),
    );

    const { conversationId, effectiveQuery, resolvedClarification, clarificationResolved, followupResolved, recentMessages } = ctx;

    this.logger.log(
      `[AssistantService] conv userId=…${userId.slice(-6)} ` +
      `clarificationResolved=${clarificationResolved} ` +
      `effectiveQuery length=${effectiveQuery.length}`,
    );

    // Step 4: Scope Guard — run against EFFECTIVE query (not raw user message)
    const scopeDecision = await this.scopeGuard.decide(effectiveQuery);

    if (scopeDecision.decision === 'out_of_scope') {
      this.logger.log(
        `[AssistantService] out_of_scope: reason=${scopeDecision.reason} method=${scopeDecision.method}`,
      );

      // Clear stale pending clarification — user asked something unrelated
      if (resolvedClarification === null && ctx.recentMessages.length >= 0) {
        // Only clear if there was a pending clarification we decided to ignore
        const pending = await this.conversationService.getPendingClarification(conversationId);
        if (pending) {
          await this.conversationService.clearPendingClarification(conversationId);
        }
      }

      // Persist the out-of-scope exchange (user message only in practice, but
      // we store both to maintain turn continuity)
      const outOfScopeAnswer = buildOutOfScopeMessage(dto.query);
      try {
        await this.conversationService.saveExchange(
          conversationId,
          dto.query,
          outOfScopeAnswer,
          'out_of_scope',
        );
      } catch (e) {
        this.logger.warn(`[AssistantService] non-fatal: failed to persist out_of_scope exchange: ${(e as Error).message}`);
      }

      return {
        type: 'out_of_scope',
        query: dto.query,
        answer: outOfScopeAnswer,
        sources: [],
        timing: {
          retrievalMs: 0,
          contextBuildMs: 0,
          generationMs: 0,
          totalMs: Date.now() - startTime,
        },
        ...(dto.debug && {
          debug: {
            scopeDecision: scopeDecision.decision,
            scopeMethod: scopeDecision.method,
            scopeReasonCode: scopeDecision.reason,
            effectiveQuery,
            clarificationResolved,
            followupResolved,
          },
        }),
      };
    }

    this.logger.debug(
      `[AssistantService] in_scope: reason=${scopeDecision.reason} effectiveQuery="${effectiveQuery.substring(0, 60)}…"`,
    );

    // Step 5: Retrieval using effective query
    const retrievalStart = Date.now();
    const retrievalResult = await this.retrievalService.semanticSearch({
      query: effectiveQuery,
      topK: this.retrievalTopK,
      debug: dto.debug,
    });
    retrievalMs = Date.now() - retrievalStart;

    // Step 6: Context Build
    const contextStart = Date.now();
    const ragContextResult = this.ragContextBuilder.buildContext(retrievalResult.results);
    const ragContext = ragContextResult.formattedContext;
    const sourceMap = new Map<string, RagContextSource>();
    for (const source of ragContextResult.sources) {
      sourceMap.set(source.sourceId, source);
    }
    contextBuildMs = Date.now() - contextStart;

    if (ragContextResult.sources.length === 0) {
      const noInfoAnswer = buildNoVerifiedInfoFallback(dto.query);
      try {
        await this.conversationService.saveExchange(
          conversationId,
          dto.query,
          noInfoAnswer,
          'no_verified_info',
        );
        await this.conversationService.clearPendingClarification(conversationId);
      } catch (e) {
        this.logger.warn(`[AssistantService] non-fatal: failed to persist no_verified_info exchange: ${(e as Error).message}`);
      }

      return {
        type: 'no_verified_info',
        query: dto.query,
        answer: noInfoAnswer,
        sources: [],
        timing: { retrievalMs, contextBuildMs, generationMs: 0, totalMs: Date.now() - startTime },
        ...(dto.debug && { debug: { reason: 'no_retrieval_results', effectiveQuery } }),
      };
    }

    // Step 7: Build LLM prompt with conversation context
    const conversationHistory = recentMessages.map(m => ({
      role: m.role as 'USER' | 'ASSISTANT',
      content: m.content,
    }));

    const generationStart = Date.now();
    const messages = this.ragPromptBuilder.buildMessages({
      originalQuery: resolvedClarification ? resolvedClarification.originalQuery : dto.query,
      clarificationQuestion: resolvedClarification?.question,
      clarificationAnswer: clarificationResolved ? dto.query : undefined,
      ragContext,
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    });

    let llmResponse: Awaited<ReturnType<typeof this.llmService.generateStructuredResponse>>;
    try {
      llmResponse = await this.llmService.generateStructuredResponse(messages);
    } catch (e) {
      // DO NOT corrupt conversation state on provider failure
      this.logger.error(`[AssistantService] LLM provider failure — conversation state preserved: ${(e as Error).message}`);
      throw e;
    }
    generationMs = Date.now() - generationStart;

    // Step 8: Source validation
    const validSources: RagContextSource[] = [];
    if (llmResponse.usedSourceIds) {
      for (const sId of llmResponse.usedSourceIds) {
        const src = sourceMap.get(sId);
        if (src && !validSources.find(v => v.sourceId === src.sourceId)) {
          validSources.push(src);
        }
      }
    }

    this.logger.debug(`[DEBUG] sourceMap keys: ${Array.from(sourceMap.keys()).join(', ')}`);
    this.logger.debug(`[DEBUG] LLM usedSourceIds: ${JSON.stringify(llmResponse.usedSourceIds)}`);
    this.logger.debug(`[DEBUG] validSources length: ${validSources.length}`);
    this.logger.debug(`[DEBUG] LLM type: ${llmResponse.type}`);

    let finalType = llmResponse.type;
    let answer = llmResponse.answer;

    if (finalType === 'answer' && validSources.length === 0) {
      finalType = 'no_verified_info';
      answer = buildNoVerifiedInfoFallback(dto.query);
    }

    // Step 9: Persist completed exchange (only on successful generation)
    const persistContent = this.buildPersistContent(finalType, llmResponse, dto.query);
    try {
      await this.conversationService.saveExchange(
        conversationId,
        dto.query,
        persistContent,
        finalType,
        { effectiveQuery, followupResolved }
      );
    } catch (e) {
      this.logger.warn(`[AssistantService] non-fatal: failed to persist exchange: ${(e as Error).message}`);
    }

    // Step 10: Update/clear pending clarification state
    try {
      if (finalType === 'clarification') {
        const pendingState: PendingClarification = {
          originalQuery: dto.query,
          question: llmResponse.clarificationQuestion || 'Pouvez-vous préciser ?',
          options: llmResponse.clarificationOptions || [],
          createdAt: new Date().toISOString(),
        };
        await this.conversationService.setPendingClarification(conversationId, pendingState);
      } else {
        // answer, no_verified_info, out_of_scope — all clear pending state
        await this.conversationService.clearPendingClarification(conversationId);
      }
    } catch (e) {
      this.logger.warn(`[AssistantService] non-fatal: failed to update pending clarification: ${(e as Error).message}`);
    }

    return this.buildResponse(dto, finalType, answer, llmResponse, validSources, {
      retrievalMs, contextBuildMs, generationMs, totalMs: Date.now() - startTime,
    }, effectiveQuery, retrievalResult, sourceMap, scopeDecision, clarificationResolved, followupResolved);
  }

  // ---------------------------------------------------------------------------
  // Stateless backward-compatible path (no userId)
  // ---------------------------------------------------------------------------

  private async askStateless(
    dto: AskAssistantDto,
    startTime: number,
    retrievalMs: number,
    contextBuildMs: number,
    generationMs: number,
  ): Promise<AssistantResponse> {

    // ── Phase 7: Scope Guard ─────────────────────────────────────────────────
    const scopeDecision = await this.scopeGuard.decide(dto.query);

    if (scopeDecision.decision === 'out_of_scope') {
      this.logger.log(
        `[AssistantService] out_of_scope: reason=${scopeDecision.reason} method=${scopeDecision.method}`,
      );
      return {
        type: 'out_of_scope',
        query: dto.query,
        answer: buildOutOfScopeMessage(dto.query),
        sources: [],
        timing: {
          retrievalMs: 0,
          contextBuildMs: 0,
          generationMs: 0,
          totalMs: Date.now() - startTime,
        },
        ...(dto.debug && {
          debug: {
            scopeDecision: scopeDecision.decision,
            scopeMethod: scopeDecision.method,
            scopeReasonCode: scopeDecision.reason,
          },
        }),
      };
    }

    this.logger.debug(
      `[AssistantService] in_scope: reason=${scopeDecision.reason} — proceeding to retrieval.`,
    );

    // ── Phase 6: existing retrieval + generation path (UNCHANGED) ────────────

    let resolvedQuery = dto.query.trim();
    if (dto.clarificationContext) {
      resolvedQuery = `Original question: ${dto.clarificationContext.originalQuery}\nClarification answer: ${resolvedQuery}`;
    }

    // 1. Retrieval
    const retrievalStart = Date.now();
    const retrievalResult = await this.retrievalService.semanticSearch({
      query: resolvedQuery,
      topK: this.retrievalTopK,
      debug: dto.debug,
    });
    retrievalMs = Date.now() - retrievalStart;

    // 2. Context Build
    const contextStart = Date.now();
    const ragContextResult = this.ragContextBuilder.buildContext(retrievalResult.results);
    const ragContext = ragContextResult.formattedContext;

    // Create source map
    const sourceMap = new Map<string, RagContextSource>();
    for (const source of ragContextResult.sources) {
      sourceMap.set(source.sourceId, source);
    }
    contextBuildMs = Date.now() - contextStart;

    // Fast-fail if no retrieved chunks
    if (ragContextResult.sources.length === 0) {
      return {
        type: 'no_verified_info',
        query: dto.query,
        answer: buildNoVerifiedInfoFallback(dto.query),
        sources: [],
        timing: { retrievalMs, contextBuildMs, generationMs: 0, totalMs: Date.now() - startTime },
        ...(dto.debug && { debug: { reason: 'no_retrieval_results' } }),
      };
    }

    // 3. Generation
    const generationStart = Date.now();
    const messages = this.ragPromptBuilder.buildMessages({
      originalQuery: dto.clarificationContext ? dto.clarificationContext.originalQuery : dto.query,
      clarificationQuestion: dto.clarificationContext?.clarificationQuestion,
      clarificationAnswer: dto.clarificationContext ? dto.query : undefined,
      ragContext,
    });

    const llmResponse = await this.llmService.generateStructuredResponse(messages);
    generationMs = Date.now() - generationStart;

    // 4. Source Mapping & Validation
    const validSources: RagContextSource[] = [];
    if (llmResponse.usedSourceIds) {
      for (const sId of llmResponse.usedSourceIds) {
        const src = sourceMap.get(sId);
        if (src) {
          if (!validSources.find(v => v.sourceId === src.sourceId)) {
            validSources.push(src);
          }
        }
      }
    }

    let finalType = llmResponse.type;
    let answer = llmResponse.answer;

    if (finalType === 'answer' && validSources.length === 0) {
      finalType = 'no_verified_info';
      answer = buildNoVerifiedInfoFallback(dto.query);
    }

    const response: AssistantResponse = {
      type: finalType,
      query: dto.query,
      sources: validSources,
      timing: {
        retrievalMs,
        contextBuildMs,
        generationMs,
        totalMs: Date.now() - startTime,
      },
    };

    if (finalType === 'answer') {
      response.answer = answer || undefined;
    } else if (finalType === 'no_verified_info') {
      response.answer = answer || buildNoVerifiedInfoFallback(dto.query);
    } else if (finalType === 'clarification') {
      response.clarification = {
        question: llmResponse.clarificationQuestion || 'Pouvez-vous préciser ?',
        options: llmResponse.clarificationOptions || [],
        context: {
          originalQuery: dto.clarificationContext ? dto.clarificationContext.originalQuery : dto.query,
        },
      };
    }

    if (dto.debug) {
      response.debug = {
        resolvedQuery,
        retrievedCount: retrievalResult.results.length,
        selectedContextSourceIds: Array.from(sourceMap.keys()),
        detectedIntents: retrievalResult.retrieval.detectedIntents,
        retrievalStrategy: retrievalResult.retrieval.strategy,
        scopeDecision: scopeDecision.decision,
        scopeMethod: scopeDecision.method,
        scopeReasonCode: scopeDecision.reason,
      };
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildPersistContent(
    finalType: string,
    llmResponse: any,
    originalQuery: string,
  ): string {
    if (finalType === 'clarification') {
      const q = llmResponse.clarificationQuestion || 'Pouvez-vous préciser ?';
      const opts = (llmResponse.clarificationOptions || []).join(', ');
      return opts ? `${q} (${opts})` : q;
    }
    if (finalType === 'answer' && llmResponse.answer) {
      return llmResponse.answer;
    }
    return buildNoVerifiedInfoFallback(originalQuery);
  }

  private buildResponse(
    dto: AskAssistantDto,
    finalType: string,
    answer: string | null | undefined,
    llmResponse: any,
    validSources: RagContextSource[],
    timing: AssistantTiming,
    effectiveQuery: string,
    retrievalResult: any,
    sourceMap: Map<string, RagContextSource>,
    scopeDecision: any,
    clarificationResolved: boolean,
    followupResolved?: boolean,
  ): AssistantResponse {
    const response: AssistantResponse = {
      type: finalType as AssistantResponse['type'],
      query: dto.query,
      sources: validSources,
      timing,
    };

    if (finalType === 'answer') {
      response.answer = answer || undefined;
    } else if (finalType === 'no_verified_info') {
      response.answer = answer || buildNoVerifiedInfoFallback(dto.query);
    } else if (finalType === 'clarification') {
      response.clarification = {
        question: llmResponse.clarificationQuestion || 'Pouvez-vous préciser ?',
        options: llmResponse.clarificationOptions || [],
        context: {
          originalQuery: dto.query,
        },
      };
    }

    if (dto.debug) {
      response.debug = {
        effectiveQuery,
        clarificationResolved,
        followupResolved,
        retrievedCount: retrievalResult.results.length,
        selectedContextSourceIds: Array.from(sourceMap.keys()),
        detectedIntents: retrievalResult.retrieval.detectedIntents,
        retrievalStrategy: retrievalResult.retrieval.strategy,
        scopeDecision: scopeDecision.decision,
        scopeMethod: scopeDecision.method,
        scopeReasonCode: scopeDecision.reason,
      };
    }

    return response;
  }
}
