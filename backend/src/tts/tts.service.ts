import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TtsProvider } from './providers/tts-provider.interface.js';
import type { TtsInput, TtsResult } from './tts.types.js';

export const TTS_PROVIDER_TOKEN = 'TTS_PROVIDER_TOKEN';

/**
 * TtsService — Phase 8D
 *
 * Validates and sanitises text input, then delegates to the configured
 * TtsProvider. This service does NOT modify the semantic content of the text:
 *   - Outer whitespace is trimmed.
 *   - Punctuation, Arabic, French words, numbers are all preserved exactly.
 *   - No translation, summarisation, rewriting, or pronunciation spelling.
 *
 * Guards:
 *   - Null/undefined/empty/whitespace-only text → BadRequestException
 *   - Text longer than TTS_MAX_TEXT_CHARS → BadRequestException
 *
 * Provider errors propagate unchanged — the provider is responsible for
 * mapping Gemini errors to NestJS HTTP exceptions.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly maxTextChars: number;
  private readonly providerName: string;

  constructor(
    @Inject(TTS_PROVIDER_TOKEN) private readonly ttsProvider: TtsProvider,
    private readonly configService: ConfigService,
  ) {
    this.maxTextChars = this.configService.get<number>('TTS_MAX_TEXT_CHARS', 3000);
    this.providerName = this.configService.get<string>('TTS_PROVIDER', 'gemini');
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    // ── Input validation ──────────────────────────────────────────────────────

    if (input.text === null || input.text === undefined) {
      throw new BadRequestException('Text is required for synthesis.');
    }

    // Trim outer whitespace only — internal content is never modified.
    const trimmedText = input.text.trim();

    if (trimmedText.length === 0) {
      throw new BadRequestException('Text cannot be empty or whitespace only.');
    }

    if (trimmedText.length > this.maxTextChars) {
      throw new BadRequestException(
        `Text exceeds the maximum allowed length of ${this.maxTextChars} characters.`,
      );
    }

    // ── Delegate to provider ──────────────────────────────────────────────────

    const startTime = Date.now();
    const model = this.configService.get<string>('TTS_MODEL', 'gemini-3.8-flash-lite-tts');
    this.logger.log(
      `[TTS] synthesis start provider=${this.providerName} model=${model} chars=${trimmedText.length}`,
    );

    try {
      const result = await this.ttsProvider.synthesize({
        ...input,
        text: trimmedText,
      });

      const elapsedMs = Date.now() - startTime;
      this.logger.log(
        `[TTS] synthesis completed elapsedMs=${elapsedMs} bytes=${result.audio.length}`,
      );

      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      this.logger.error(`[TTS] synthesis failed elapsedMs=${elapsedMs}`);
      throw error;
    }
  }
}
