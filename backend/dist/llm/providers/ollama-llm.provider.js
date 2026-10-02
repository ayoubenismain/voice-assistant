var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OllamaLlmProvider_1;
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
let OllamaLlmProvider = OllamaLlmProvider_1 = class OllamaLlmProvider {
    configService;
    logger = new Logger(OllamaLlmProvider_1.name);
    baseUrl;
    defaultModel;
    defaultTimeoutMs;
    defaultTemperature;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = this.configService.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
        this.defaultModel = this.configService.get('LLM_MODEL', 'qwen3:4b');
        this.defaultTimeoutMs = this.configService.get('LLM_TIMEOUT_MS', 120000);
        this.defaultTemperature = this.configService.get('LLM_TEMPERATURE', 0);
    }
    async generateStructuredResponse(messages, options) {
        const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
        const temperature = options?.temperature ?? this.defaultTemperature;
        const schema = {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['answer', 'clarification', 'no_verified_info'] },
                answer: { type: ['string', 'null'] },
                clarificationQuestion: { type: ['string', 'null'] },
                clarificationOptions: { type: 'array', items: { type: 'string' } },
                usedSourceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'answer', 'clarificationQuestion', 'clarificationOptions', 'usedSourceIds'],
        };
        const requestBody = {
            model: this.defaultModel,
            messages,
            stream: false,
            format: schema,
            options: {
                temperature,
            },
        };
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            clearTimeout(id);
            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            let parsed;
            try {
                parsed = JSON.parse(data.message.content);
            }
            catch (err) {
                this.logger.error('Failed to parse JSON response from Ollama', err);
                throw new Error('Malformed JSON response from LLM');
            }
            return parsed;
        }
        catch (error) {
            this.logger.error(`Failed to generate response from Ollama: ${error.message}`);
            if (error.name === 'AbortError') {
                throw new ServiceUnavailableException('LLM generation timed out');
            }
            throw new ServiceUnavailableException(`LLM Provider Error: ${error.message}`);
        }
    }
};
OllamaLlmProvider = OllamaLlmProvider_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], OllamaLlmProvider);
export { OllamaLlmProvider };
//# sourceMappingURL=ollama-llm.provider.js.map