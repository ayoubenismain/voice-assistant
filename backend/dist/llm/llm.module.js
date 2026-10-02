var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';
import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { ConfigModule } from '@nestjs/config';
let LlmModule = class LlmModule {
};
LlmModule = __decorate([
    Module({
        imports: [ConfigModule],
        providers: [LlmService, OllamaLlmProvider],
        exports: [LlmService],
    })
], LlmModule);
export { LlmModule };
//# sourceMappingURL=llm.module.js.map