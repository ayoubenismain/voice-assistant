import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SttService, STT_PROVIDER_TOKEN } from './stt.service.js';
import { GeminiSttProvider } from './providers/gemini-stt.provider.js';
import type { SttProvider } from './providers/stt-provider.interface.js';

/**
 * SttModule wires the active STT provider based on the STT_PROVIDER
 * environment variable.  Supported values:
 *   - "gemini" — uses GeminiSttProvider (Gemini 3.5 Transcribe)
 *
 * Any other value causes an explicit startup error — no silent fallback.
 *
 * Reuses GEMINI_API_KEY from the existing Gemini LLM configuration.
 * A separate STT API key is not required.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    // Register concrete provider(s) for DI resolution
    GeminiSttProvider,

    // Factory: picks the active provider — throws on unrecognised value
    {
      provide: STT_PROVIDER_TOKEN,
      useFactory: (
        configService: ConfigService,
        geminiProvider: GeminiSttProvider,
      ): SttProvider => {
        const raw = configService.get<string>('STT_PROVIDER', '');
        const sttProvider = raw.toLowerCase().trim();

        if (sttProvider === 'gemini') {
          return geminiProvider;
        }

        throw new Error(
          `Unsupported STT_PROVIDER: "${raw}". Expected "gemini".`,
        );
      },
      inject: [ConfigService, GeminiSttProvider],
    },

    // SttService receives the active provider via token injection
    {
      provide: SttService,
      useFactory: (provider: SttProvider) => new SttService(provider),
      inject: [STT_PROVIDER_TOKEN],
    },
  ],
  exports: [SttService],
})
export class SttModule {}
