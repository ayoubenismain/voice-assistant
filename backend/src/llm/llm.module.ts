import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LlmService, LLM_PROVIDER_TOKEN } from './llm.service.js';
import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { GeminiLlmProvider } from './providers/gemini-llm.provider.js';
import { LlmProvider } from './providers/llm-provider.interface.js';

/**
 * LlmModule wires the active generation provider based on the LLM_PROVIDER
 * environment variable.  Supported values:
 *   - "ollama"  — uses OllamaLlmProvider (local development)
 *   - "gemini"  — uses GeminiLlmProvider (cloud / Google AI)
 *
 * Any other value causes an explicit startup error:
 *   Unsupported LLM_PROVIDER: "<value>". Expected "ollama" or "gemini".
 *
 * Both concrete providers are registered so NestJS can resolve their
 * dependencies regardless of which one is selected.  Only the selected
 * provider's actual API/network calls are executed at runtime.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    // Register both concrete providers for DI resolution
    OllamaLlmProvider,
    GeminiLlmProvider,

    // Factory that picks the active provider from config — throws on invalid value
    {
      provide: LLM_PROVIDER_TOKEN,
      useFactory: (
        configService: ConfigService,
        ollamaProvider: OllamaLlmProvider,
        geminiProvider: GeminiLlmProvider,
      ): LlmProvider => {
        const raw = configService.get<string>('LLM_PROVIDER', '');
        const llmProvider = raw.toLowerCase().trim();

        if (llmProvider === 'ollama') {
          return ollamaProvider;
        }

        if (llmProvider === 'gemini') {
          return geminiProvider;
        }

        throw new Error(
          `Unsupported LLM_PROVIDER: "${raw}". Expected "ollama" or "gemini".`,
        );
      },
      inject: [ConfigService, OllamaLlmProvider, GeminiLlmProvider],
    },

    // LlmService receives the active provider via token injection
    {
      provide: LlmService,
      useFactory: (provider: LlmProvider) => new LlmService(provider),
      inject: [LLM_PROVIDER_TOKEN],
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}
