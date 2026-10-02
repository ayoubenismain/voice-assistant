var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service.js';
import { OllamaEmbeddingProvider } from './providers/ollama.embedding-provider.js';
import { MockEmbeddingProvider } from './providers/mock.embedding-provider.js';
import { DocumentEmbeddingService } from './document-embedding.service.js';
let EmbeddingsModule = class EmbeddingsModule {
};
EmbeddingsModule = __decorate([
    Global(),
    Module({
        imports: [ConfigModule],
        providers: [
            OllamaEmbeddingProvider,
            MockEmbeddingProvider,
            {
                provide: 'EMBEDDING_PROVIDER',
                useFactory: (configService, ollamaProvider, mockProvider) => {
                    const moduleLogger = new Logger('EmbeddingsModule');
                    const providerName = configService.get('EMBEDDING_PROVIDER') ?? 'ollama';
                    if (providerName === 'mock') {
                        moduleLogger.warn('Using MockEmbeddingProvider — NOT suitable for production.');
                        return mockProvider;
                    }
                    if (providerName === 'ollama') {
                        const model = configService.get('EMBEDDING_MODEL');
                        const dimensions = configService.get('EMBEDDING_DIMENSIONS');
                        const baseUrl = configService.get('OLLAMA_BASE_URL');
                        if (!model) {
                            throw new Error('CONFIG_ERROR: EMBEDDING_MODEL must be set when EMBEDDING_PROVIDER=ollama (expected: bge-m3)');
                        }
                        if (!dimensions) {
                            throw new Error('CONFIG_ERROR: EMBEDDING_DIMENSIONS must be set when EMBEDDING_PROVIDER=ollama (expected: 1024)');
                        }
                        if (!baseUrl) {
                            throw new Error('CONFIG_ERROR: OLLAMA_BASE_URL must be set when EMBEDDING_PROVIDER=ollama (expected: http://127.0.0.1:11434)');
                        }
                        moduleLogger.log(`Embedding provider: ollama | model: ${model} | dims: ${dimensions} | url: ${baseUrl}`);
                        return ollamaProvider;
                    }
                    throw new Error(`UNSUPPORTED_EMBEDDING_PROVIDER: "${providerName}". ` +
                        `Supported providers: ollama, mock`);
                },
                inject: [ConfigService, OllamaEmbeddingProvider, MockEmbeddingProvider],
            },
            EmbeddingService,
            DocumentEmbeddingService,
        ],
        exports: [EmbeddingService, DocumentEmbeddingService],
    })
], EmbeddingsModule);
export { EmbeddingsModule };
//# sourceMappingURL=embeddings.module.js.map