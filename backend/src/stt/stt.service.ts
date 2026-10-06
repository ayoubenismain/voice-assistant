import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { SttProvider } from './providers/stt-provider.interface.js';
import type { SttInput, SttResult } from './stt.types.js';
import { SUPPORTED_AUDIO_MIME_TYPES } from './stt.types.js';

/** Injection token for the active STT provider. */
export const STT_PROVIDER_TOKEN = 'STT_PROVIDER';

/**
 * SttService — Phase 8A.
 *
 * Responsibilities:
 *   1. Validate basic input (empty audio, unsupported MIME type).
 *   2. Delegate to the active SttProvider.
 *   3. Return the SttResult as-is (transcript is never rewritten here).
 *
 * This service does NOT:
 *   - translate or rewrite the transcript
 *   - call RetrievalService or AssistantService
 *   - apply any NLP on the text
 */
@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);

  constructor(
    @Inject(STT_PROVIDER_TOKEN)
    private readonly sttProvider: SttProvider,
  ) {}

  async transcribe(input: SttInput): Promise<SttResult> {
    // ── 1. Validate audio buffer ────────────────────────────────────────────
    if (!input.audio || input.audio.length === 0) {
      throw new BadRequestException('Audio input is empty.');
    }

    // ── 2. Validate MIME type ───────────────────────────────────────────────
    const normalizedMime = (input.mimeType ?? '').toLowerCase().trim();
    if (!normalizedMime || !SUPPORTED_AUDIO_MIME_TYPES.has(normalizedMime)) {
      const supported = [...SUPPORTED_AUDIO_MIME_TYPES].join(', ');
      this.logger.warn(
        `[STT] unsupported MIME type "${normalizedMime}". Supported: ${supported}`,
      );
      throw new BadRequestException(
        `Unsupported audio format: "${normalizedMime}". ` +
          `Supported formats: ${supported}.`,
      );
    }

    this.logger.debug(
      `[STT] delegating to provider — mime=${normalizedMime} bytes=${input.audio.length}`,
    );

    // ── 3. Delegate to provider ─────────────────────────────────────────────
    return this.sttProvider.transcribe({ ...input, mimeType: normalizedMime });
  }
}
