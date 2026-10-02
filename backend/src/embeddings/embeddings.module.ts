import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service.js';
import { OllamaEmbeddingProvider } from './providers/ollama.embedding-provider.js';
import { MockEmbeddingProvider } from './providers/mock.embedding-provider.js';
import { DocumentEmbeddingService } from './document-embedding.service.js';

/**
 * EmbeddingsModule
 *
 * Active provider is determined at startup by EMBEDDING_PROVIDER env var.
 *
 *   EMBEDDING_PROVIDER=ollama   → OllamaEmbeddingProvider (default, no API key required)
 *   EMBEDDING_PROVIDER=mock     → MockEmbeddingProvider (unit tests only)
 *
 * Required env for Ollama:
 *   EMBEDDING_MODEL=bge-m3
 *   EMBEDDING_DIMENSIONS=1024
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434
 *
 * OpenAI is NOT a supported runtime provider. The openai npm package may
 * still be installed (for future use) but is not wired here.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    OllamaEmbeddingProvider,
    MockEmbeddingProvider,
    {
      provide: 'EMBEDDING_PROVIDER',
      useFactory: (
        configService: ConfigService,
        ollamaProvider: OllamaEmbeddingProvider,
        mockProvider: MockEmbeddingProvider,
      ) => {
        const moduleLogger = new Logger('EmbeddingsModule');
        const providerName = configService.get<string>('EMBEDDING_PROVIDER') ?? 'ollama';

        if (providerName === 'mock') {
          moduleLogger.warn(
            'Using MockEmbeddingProvider — NOT suitable for production.',
          );
          return mockProvider;
        }

        if (providerName === 'ollama') {
          const model = configService.get<string>('EMBEDDING_MODEL');
          const dimensions = configService.get<string>('EMBEDDING_DIMENSIONS');
          const baseUrl = configService.get<string>('OLLAMA_BASE_URL');

          if (!model) {
            throw new Error(
              'CONFIG_ERROR: EMBEDDING_MODEL must be set when EMBEDDING_PROVIDER=ollama (expected: bge-m3)',
            );
          }
          if (!dimensions) {
            throw new Error(
              'CONFIG_ERROR: EMBEDDING_DIMENSIONS must be set when EMBEDDING_PROVIDER=ollama (expected: 1024)',
            );
          }
          if (!baseUrl) {
            throw new Error(
              'CONFIG_ERROR: OLLAMA_BASE_URL must be set when EMBEDDING_PROVIDER=ollama (expected: http://127.0.0.1:11434)',
            );
          }

          moduleLogger.log(
            `Embedding provider: ollama | model: ${model} | dims: ${dimensions} | url: ${baseUrl}`,
          );
          return ollamaProvider;
        }

        throw new Error(
          `UNSUPPORTED_EMBEDDING_PROVIDER: "${providerName}". ` +
            `Supported providers: ollama, mock`,
        );
      },
      inject: [ConfigService, OllamaEmbeddingProvider, MockEmbeddingProvider],
    },
    EmbeddingService,
    DocumentEmbeddingService,
  ],
  exports: [EmbeddingService, DocumentEmbeddingService],
})
export class EmbeddingsModule {}
