var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var LlmService_1;
import { Injectable, Inject, Logger } from '@nestjs/common';
export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER';
let LlmService = LlmService_1 = class LlmService {
    llmProvider;
    logger = new Logger(LlmService_1.name);
    constructor(llmProvider) {
        this.llmProvider = llmProvider;
    }
    async generateStructuredResponse(messages, options) {
        this.logger.debug(`Delegating to LLM provider`);
        return this.llmProvider.generateStructuredResponse(messages, options);
    }
};
LlmService = LlmService_1 = __decorate([
    Injectable(),
    __param(0, Inject(LLM_PROVIDER_TOKEN)),
    __metadata("design:paramtypes", [Object])
], LlmService);
export { LlmService };
//# sourceMappingURL=llm.service.js.map