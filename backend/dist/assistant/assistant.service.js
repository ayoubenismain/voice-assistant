var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AssistantService_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { LlmService } from '../llm/llm.service.js';
import { RagContextBuilderService } from '../rag/rag-context-builder.service.js';
import { RagPromptBuilderService } from '../rag/rag-prompt-builder.service.js';
let AssistantService = AssistantService_1 = class AssistantService {
    configService;
    retrievalService;
    llmService;
    ragContextBuilder;
    ragPromptBuilder;
    logger = new Logger(AssistantService_1.name);
    retrievalTopK;
    constructor(configService, retrievalService, llmService, ragContextBuilder, ragPromptBuilder) {
        this.configService = configService;
        this.retrievalService = retrievalService;
        this.llmService = llmService;
        this.ragContextBuilder = ragContextBuilder;
        this.ragPromptBuilder = ragPromptBuilder;
        this.retrievalTopK = this.configService.get('RAG_RETRIEVAL_TOP_K', 8);
    }
    async ask(dto) {
        const startTime = Date.now();
        let retrievalMs = 0;
        let contextBuildMs = 0;
        let generationMs = 0;
        let resolvedQuery = dto.query.trim();
        if (dto.clarificationContext) {
            resolvedQuery = `Original question: ${dto.clarificationContext.originalQuery}\nClarification answer: ${resolvedQuery}`;
        }
        const retrievalStart = Date.now();
        const retrievalResult = await this.retrievalService.semanticSearch({
            query: resolvedQuery,
            topK: this.retrievalTopK,
            debug: dto.debug,
        });
        retrievalMs = Date.now() - retrievalStart;
        const contextStart = Date.now();
        const ragContextResult = this.ragContextBuilder.buildContext(retrievalResult.results);
        const ragContext = ragContextResult.formattedContext;
        const sourceMap = new Map();
        for (const source of ragContextResult.sources) {
            sourceMap.set(source.sourceId, source);
        }
        contextBuildMs = Date.now() - contextStart;
        if (ragContextResult.sources.length === 0) {
            return {
                type: 'no_verified_info',
                query: dto.query,
                answer: 'Je n\'ai pas trouvé d\'information vérifiée à ce sujet dans les sources ISSATSO disponibles.',
                sources: [],
                timing: { retrievalMs, contextBuildMs, generationMs: 0, totalMs: Date.now() - startTime },
                ...(dto.debug && { debug: { reason: 'no_retrieval_results' } })
            };
        }
        const generationStart = Date.now();
        const messages = this.ragPromptBuilder.buildMessages({
            originalQuery: dto.clarificationContext ? dto.clarificationContext.originalQuery : dto.query,
            clarificationQuestion: dto.clarificationContext?.clarificationQuestion,
            clarificationAnswer: dto.clarificationContext ? dto.query : undefined,
            ragContext,
        });
        const llmResponse = await this.llmService.generateStructuredResponse(messages);
        generationMs = Date.now() - generationStart;
        const validSources = [];
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
            answer = 'Je n\'ai pas trouvé d\'information vérifiée à ce sujet dans les sources ISSATSO disponibles.';
        }
        const response = {
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
        }
        else if (finalType === 'no_verified_info') {
            response.answer = answer || 'Je n\'ai pas trouvé d\'information vérifiée à ce sujet dans les sources ISSATSO disponibles.';
        }
        else if (finalType === 'clarification') {
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
            };
        }
        return response;
    }
};
AssistantService = AssistantService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService,
        RetrievalService,
        LlmService,
        RagContextBuilderService,
        RagPromptBuilderService])
], AssistantService);
export { AssistantService };
//# sourceMappingURL=assistant.service.js.map