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
  ) {
    this.retrievalTopK = this.configService.get<number>('RAG_RETRIEVAL_TOP_K', 8);
  }

  async ask(dto: AskAssistantDto): Promise<AssistantResponse> {
    const startTime = Date.now();
    let retrievalMs = 0;
    let contextBuildMs = 0;
    let generationMs = 0;

    // ── Phase 7: Scope Guard ─────────────────────────────────────────────────
    // Runs BEFORE retrieval, embedding, and generation.
    // Out-of-scope queries are rejected immediately — no BGE-M3, no pgvector,
    // no Gemini RAG generation.
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
        ...(dto.debug && { debug: { reason: 'no_retrieval_results' } })
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
          // Avoid duplicate source references if the model repeats them
          if (!validSources.find(v => v.sourceId === src.sourceId)) {
            validSources.push(src);
          }
        }
      }
    }

    let finalType = llmResponse.type;
    let answer = llmResponse.answer;

    if (finalType === 'answer' && validSources.length === 0) {
      // Model gave an answer but used no verified sources, reject the answer
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
      // Use the model's own answer if provided; fall back to a language-aware message if not.
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
}
