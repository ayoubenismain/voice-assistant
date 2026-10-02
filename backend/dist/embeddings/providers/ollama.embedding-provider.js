var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OllamaEmbeddingProvider_1;
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
let OllamaEmbeddingProvider = OllamaEmbeddingProvider_1 = class OllamaEmbeddingProvider {
    configService;
    logger = new Logger(OllamaEmbeddingProvider_1.name);
    baseUrl;
    model;
    dimensions;
    timeoutMs = 600_000;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl =
            this.configService.get('OLLAMA_BASE_URL') ??
                'http://127.0.0.1:11434';
        this.model =
            this.configService.get('EMBEDDING_MODEL') ?? 'bge-m3';
        this.dimensions =
            parseInt(String(this.configService.get('EMBEDDING_DIMENSIONS') ?? 1024), 10);
    }
    getProviderName() {
        return 'ollama';
    }
    getModelName() {
        return this.model;
    }
    getDimensions() {
        return this.dimensions;
    }
    async embedText(text) {
        const results = await this.embedTexts([text]);
        return results[0];
    }
    async embedTexts(texts) {
        if (texts.length === 0)
            return [];
        const url = `${this.baseUrl}/api/embed`;
        const body = JSON.stringify({ model: this.model, input: texts });
        const startMs = Date.now();
        this.logger.log(`Embedding ${texts.length} text(s) via Ollama (${this.model}) at ${url}`);
        let response;
        try {
            response = await this.fetchWithTimeout(url, body);
        }
        catch (err) {
            if (err.cause?.code === 'ECONNREFUSED' ||
                err.message?.includes('ECONNREFUSED') ||
                err.message?.includes('fetch failed')) {
                const msg = `Ollama is not available at ${this.baseUrl}. Start the Ollama service before generating embeddings.`;
                this.logger.error(msg);
                throw new InternalServerErrorException('OLLAMA_UNAVAILABLE');
            }
            if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
                this.logger.error(`Ollama request timed out after ${this.timeoutMs}ms`);
                throw new InternalServerErrorException('OLLAMA_REQUEST_TIMEOUT');
            }
            this.logger.error(`Ollama network error: ${err.message}`);
            throw new InternalServerErrorException('EMBEDDING_PROVIDER_UNAVAILABLE');
        }
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '(unreadable)');
            if (response.status === 404 ||
                errorBody.toLowerCase().includes('not found') ||
                errorBody.toLowerCase().includes("model '") ||
                errorBody.toLowerCase().includes('"model"')) {
                this.logger.error(`Embedding model '${this.model}' is not installed in Ollama. Run: ollama pull ${this.model}`);
                throw new InternalServerErrorException('EMBEDDING_MODEL_NOT_AVAILABLE');
            }
            this.logger.error(`Ollama returned HTTP ${response.status}: ${errorBody}`);
            throw new InternalServerErrorException('EMBEDDING_PROVIDER_ERROR');
        }
        let json;
        try {
            json = (await response.json());
        }
        catch {
            throw new InternalServerErrorException('EMBEDDING_INVALID_RESPONSE');
        }
        const embeddings = json?.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
            const got = Array.isArray(embeddings) ? embeddings.length : 'undefined';
            this.logger.error(`EMBEDDING_RESPONSE_COUNT_MISMATCH: sent ${texts.length} inputs, got ${got} embeddings`);
            throw new InternalServerErrorException('EMBEDDING_RESPONSE_COUNT_MISMATCH');
        }
        for (let i = 0; i < embeddings.length; i++) {
            const vec = embeddings[i];
            if (!Array.isArray(vec)) {
                throw new InternalServerErrorException(`EMBEDDING_INVALID_RESPONSE: embedding[${i}] is not an array`);
            }
            if (vec.length !== this.dimensions) {
                this.logger.error(`EMBEDDING_DIMENSION_MISMATCH at index ${i}: expected ${this.dimensions}, got ${vec.length}`);
                throw new InternalServerErrorException('EMBEDDING_DIMENSION_MISMATCH');
            }
            for (let j = 0; j < vec.length; j++) {
                const v = vec[j];
                if (typeof v !== 'number' || !isFinite(v) || isNaN(v)) {
                    throw new InternalServerErrorException(`EMBEDDING_INVALID_RESPONSE: NaN or Infinity at embedding[${i}][${j}]`);
                }
            }
        }
        const elapsed = Date.now() - startMs;
        this.logger.log(`Embedded ${texts.length} chunk(s) in ${elapsed}ms ` +
            `(avg ${(elapsed / texts.length).toFixed(0)}ms/chunk) ` +
            `— dims: ${this.dimensions}`);
        return embeddings;
    }
    fetchWithTimeout(url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));
    }
};
OllamaEmbeddingProvider = OllamaEmbeddingProvider_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], OllamaEmbeddingProvider);
export { OllamaEmbeddingProvider };
//# sourceMappingURL=ollama.embedding-provider.js.map