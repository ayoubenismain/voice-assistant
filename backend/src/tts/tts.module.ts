import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TtsService, TTS_PROVIDER_TOKEN } from './tts.service.js';
import { GeminiTtsProvider } from './providers/gemini-tts.provider.js';
import { TtsProvider } from './providers/tts-provider.interface.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TTS_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TtsProvider => {
        const providerName = configService.get<string>('TTS_PROVIDER', 'gemini');

        if (providerName === 'gemini') {
          return new GeminiTtsProvider(configService);
        }

        throw new Error(`Unknown TTS_PROVIDER: ${providerName}`);
      },
    },
    TtsService,
  ],
  exports: [TtsService],
})
export class TtsModule {}
