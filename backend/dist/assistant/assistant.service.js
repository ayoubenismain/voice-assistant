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
import { buildNoVerifiedInfoFallback, buildOutOfScopeMessage } from './language-fallback.helper.js';
import { ScopeGuardService } from '../scope-guard/scope-guard.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import { ConversationContextService } from '../conversation/conversation-context.service.js';
let AssistantService = AssistantService_1 = class AssistantService {
    configService;
    retrievalService;
    llmService;
    ragContextBuilder;
    ragPromptBuilder;
    scopeGuard;
    conversationService;
    conversationContextService;
    logger = new Logger(AssistantService_1.name);
    retrievalTopK;
    constructor(configService, retrievalService, llmService, ragContextBuilder, ragPromptBuilder, scopeGuard, conversationService, conversationContextService) {
        this.configService = configService;
        this.retrievalService = retrievalService;
        this.llmService = llmService;
        this.ragContextBuilder = ragContextBuilder;
        this.ragPromptBuilder = ragPromptBuilder;
        this.scopeGuard = scopeGuard;
        this.conversationService = conversationService;
        this.conversationContextService = conversationContextService;
        this.retrievalTopK = this.configService.get('RAG_RETRIEVAL_TOP_K', 8);
    }
    async ask(dto) {
        const startTime = Date.now();
        let retrievalMs = 0;
        let contextBuildMs = 0;
        let generationMs = 0;
        if (dto.userId) {
            return this.askWithConversation(dto, startTime);
        }
        return this.askStateless(dto, startTime, retrievalMs, contextBuildMs, generationMs);
    }
    async askWithConversation(dto, startTime) {
        const userId = dto.userId;
        let retrievalMs = 0;
        let contextBuildMs = 0;
        let generationMs = 0;
        const ctx = await this.conversationContextService.assembleContext(userId, dto.query.trim());
        const { conversationId, effectiveQuery, resolvedClarification, clarificationResolved, recentMessages } = ctx;
        this.logger.log(`[AssistantService] conv userId=…${userId.slice(-6)} ` +
            `clarificationResolved=${clarificationResolved} ` +
            `effectiveQuery length=${effectiveQuery.length}`);
        const scopeDecision = await this.scopeGuard.decide(effectiveQuery);
        if (scopeDecision.decision === 'out_of_scope') {
            this.logger.log(`[AssistantService] out_of_scope: reason=${scopeDecision.reason} method=${scopeDecision.method}`);
            if (resolvedClarification === null && ctx.recentMessages.length >= 0) {
                const pending = await this.conversationService.getPendingClarification(conversationId);
                if (pending) {
                    await this.conversationService.clearPendingClarification(conversationId);
                }
            }
            const outOfScopeAnswer = buildOutOfScopeMessage(dto.query);
            try {
                await this.conversationService.saveExchange(conversationId, dto.query, outOfScopeAnswer, 'out_of_scope');
            }
            catch (e) {
                this.logger.warn(`[AssistantService] non-fatal: failed to persist out_of_scope exchange: ${e.message}`);
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
                    },
                }),
            };
        }
        this.logger.debug(`[AssistantService] in_scope: reason=${scopeDecision.reason} effectiveQuery="${effectiveQuery.substring(0, 60)}…"`);
        const retrievalStart = Date.now();
        const retrievalResult = await this.retrievalService.semanticSearch({
            query: effectiveQuery,
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
            const noInfoAnswer = buildNoVerifiedInfoFallback(dto.query);
            try {
                await this.conversationService.saveExchange(conversationId, dto.query, noInfoAnswer, 'no_verified_info');
                await this.conversationService.clearPendingClarification(conversationId);
            }
            catch (e) {
                this.logger.warn(`[AssistantService] non-fatal: failed to persist no_verified_info exchange: ${e.message}`);
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
        const conversationHistory = recentMessages.map(m => ({
            role: m.role,
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
        let llmResponse;
        try {
            llmResponse = await this.llmService.generateStructuredResponse(messages);
        }
        catch (e) {
            this.logger.error(`[AssistantService] LLM provider failure — conversation state preserved: ${e.message}`);
            throw e;
        }
        generationMs = Date.now() - generationStart;
        const validSources = [];
        if (llmResponse.usedSourceIds) {
            for (const sId of llmResponse.usedSourceIds) {
                const src = sourceMap.get(sId);
                if (src && !validSources.find(v => v.sourceId === src.sourceId)) {
                    validSources.push(src);
                }
            }
        }
        let finalType = llmResponse.type;
        let answer = llmResponse.answer;
        if (finalType === 'answer' && validSources.length === 0) {
            finalType = 'no_verified_info';
            answer = buildNoVerifiedInfoFallback(dto.query);
        }
        const persistContent = this.buildPersistContent(finalType, llmResponse, dto.query);
        try {
            await this.conversationService.saveExchange(conversationId, dto.query, persistContent, finalType);
        }
        catch (e) {
            this.logger.warn(`[AssistantService] non-fatal: failed to persist exchange: ${e.message}`);
        }
        try {
            if (finalType === 'clarification') {
                const pendingState = {
                    originalQuery: dto.query,
                    question: llmResponse.clarificationQuestion || 'Pouvez-vous préciser ?',
                    options: llmResponse.clarificationOptions || [],
                    createdAt: new Date().toISOString(),
                };
                await this.conversationService.setPendingClarification(conversationId, pendingState);
            }
            else {
                await this.conversationService.clearPendingClarification(conversationId);
            }
        }
        catch (e) {
            this.logger.warn(`[AssistantService] non-fatal: failed to update pending clarification: ${e.message}`);
        }
        return this.buildResponse(dto, finalType, answer, llmResponse, validSources, {
            retrievalMs, contextBuildMs, generationMs, totalMs: Date.now() - startTime,
        }, effectiveQuery, retrievalResult, sourceMap, scopeDecision, clarificationResolved);
    }
    async askStateless(dto, startTime, retrievalMs, contextBuildMs, generationMs) {
        const scopeDecision = await this.scopeGuard.decide(dto.query);
        if (scopeDecision.decision === 'out_of_scope') {
            this.logger.log(`[AssistantService] out_of_scope: reason=${scopeDecision.reason} method=${scopeDecision.method}`);
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
        this.logger.debug(`[AssistantService] in_scope: reason=${scopeDecision.reason} — proceeding to retrieval.`);
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
                answer: buildNoVerifiedInfoFallback(dto.query),
                sources: [],
                timing: { retrievalMs, contextBuildMs, generationMs: 0, totalMs: Date.now() - startTime },
                ...(dto.debug && { debug: { reason: 'no_retrieval_results' } }),
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
            answer = buildNoVerifiedInfoFallback(dto.query);
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
            response.answer = answer || buildNoVerifiedInfoFallback(dto.query);
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
                scopeDecision: scopeDecision.decision,
                scopeMethod: scopeDecision.method,
                scopeReasonCode: scopeDecision.reason,
            };
        }
        return response;
    }
    buildPersistContent(finalType, llmResponse, originalQuery) {
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
    buildResponse(dto, finalType, answer, llmResponse, validSources, timing, effectiveQuery, retrievalResult, sourceMap, scopeDecision, clarificationResolved) {
        const response = {
            type: finalType,
            query: dto.query,
            sources: validSources,
            timing,
        };
        if (finalType === 'answer') {
            response.answer = answer || undefined;
        }
        else if (finalType === 'no_verified_info') {
            response.answer = answer || buildNoVerifiedInfoFallback(dto.query);
        }
        else if (finalType === 'clarification') {
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
};
AssistantService = AssistantService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService,
        RetrievalService,
        LlmService,
        RagContextBuilderService,
        RagPromptBuilderService,
        ScopeGuardService,
        ConversationService,
        ConversationContextService])
], AssistantService);
export { AssistantService };
//# sourceMappingURL=assistant.service.js.map