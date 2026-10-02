var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OpenAiEmbeddingProvider_1;
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
let OpenAiEmbeddingProvider = OpenAiEmbeddingProvider_1 = class OpenAiEmbeddingProvider {
    configService;
    logger = new Logger(OpenAiEmbeddingProvider_1.name);
    openai;
    model;
    dimensions;
    constructor(configService) {
        this.configService = configService;
        const apiKey = this.configService.get('EMBEDDING_API_KEY');
        const provider = this.configService.get('EMBEDDING_PROVIDER');
        if (!apiKey && provider === 'openai') {
            throw new Error('EMBEDDING_API_KEY is required for OpenAiEmbeddingProvider');
        }
        this.openai = new OpenAI({ apiKey: apiKey || 'dummy-key' });
        this.model = this.configService.get('EMBEDDING_MODEL') || 'text-embedding-3-small';
        this.dimensions = this.configService.get('EMBEDDING_DIMENSIONS') || 1536;
    }
    getProviderName() {
        return 'openai';
    }
    getModelName() {
        return this.model;
    }
    getDimensions() {
        return this.dimensions;
    }
    async embedText(text) {
        const result = await this.embedTexts([text]);
        return result[0];
    }
    async embedTexts(texts) {
        if (texts.length === 0)
            return [];
        try {
            const response = await this.openai.embeddings.create({
                model: this.model,
                input: texts,
                dimensions: this.model.includes('text-embedding-3') ? this.dimensions : undefined,
            });
            const embeddings = new Array(texts.length);
            for (const data of response.data) {
                if (!data.embedding || data.embedding.length !== this.dimensions) {
                    throw new InternalServerErrorException(`EMBEDDING_DIMENSION_MISMATCH: Expected ${this.dimensions}, got ${data.embedding?.length}`);
                }
                if (data.embedding.some(val => isNaN(val) || !isFinite(val))) {
                    throw new InternalServerErrorException('EMBEDDING_INVALID_RESPONSE: NaN or Infinity in vector');
                }
                embeddings[data.index] = data.embedding;
            }
            return embeddings;
        }
        catch (error) {
            this.logger.error(`Failed to generate embeddings: ${error.message}`);
            throw new InternalServerErrorException(error.code === 'rate_limit_exceeded'
                ? 'EMBEDDING_RATE_LIMITED'
                : 'EMBEDDING_PROVIDER_ERROR');
        }
    }
};
OpenAiEmbeddingProvider = OpenAiEmbeddingProvider_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], OpenAiEmbeddingProvider);
export { OpenAiEmbeddingProvider };
//# sourceMappingURL=openai.embedding-provider.js.map