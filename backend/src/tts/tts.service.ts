import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtsProvider } from './providers/tts-provider.interface.js';
import { TtsInput, TtsResult } from './tts.types.js';

export const TTS_PROVIDER_TOKEN = 'TTS_PROVIDER_TOKEN';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly maxTextChars: number;

  constructor(
    @Inject(TTS_PROVIDER_TOKEN) private readonly ttsProvider: TtsProvider,
    private readonly configService: ConfigService,
  ) {
    this.maxTextChars = this.configService.get<number>('TTS_MAX_TEXT_CHARS', 3000);
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (!input.text) {
      throw new BadRequestException('Text is required for synthesis.');
    }

    const trimmedText = input.text.trim();

    if (trimmedText.length === 0) {
      throw new BadRequestException('Text cannot be only whitespace.');
    }

    if (trimmedText.length > this.maxTextChars) {
      throw new BadRequestException(`Text exceeds the maximum allowed length of ${this.maxTextChars} characters.`);
    }

    const startTime = Date.now();
    this.logger.log(`[TTS] synthesis start provider=gemini model=unknown chars=${trimmedText.length}`);

    try {
      const result = await this.ttsProvider.synthesize({
        ...input,
        text: trimmedText,
      });

      const elapsedMs = Date.now() - startTime;
      this.logger.log(`[TTS] synthesis completed elapsedMs=${elapsedMs} bytes=${result.audio.length}`);

      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      this.logger.error(`[TTS] synthesis timeout elapsedMs=${elapsedMs}`);
      throw error;
    }
  }
}
