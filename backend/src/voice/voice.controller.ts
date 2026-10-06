import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { SttService } from '../stt/stt.service.js';
import { VoiceService } from './voice.service.js';
import type {
  TranscribeResponseDto,
  TranscribeDebugResponseDto,
} from './dto/transcribe-response.dto.js';
import { VoiceAskResponseDto } from './dto/voice-ask.dto.js';

/**
 * VoiceController — Phase 8B.
 *
 * Exposes POST /api/voice/transcribe for push-to-talk audio uploads.
 *
 * Responsibilities (thin controller):
 *   1. Accept one multipart audio file (field: "file")
 *   2. Validate the file is present
 *   3. Build SttInput from the Express Multer file
 *   4. Delegate transcription to SttService
 *   5. Return the transcript text
 *
 * Does NOT:
 *   - call AssistantService
 *   - call RetrievalService
 *   - call Gemini directly
 *   - store audio on disk
 *   - perform RAG / answer generation
 */
@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  /** Default 5 MB — overridden by VOICE_MAX_AUDIO_BYTES env var. */
  private readonly maxAudioBytes: number;

  constructor(
    private readonly sttService: SttService,
    private readonly voiceService: VoiceService,
    private readonly configService: ConfigService,
  ) {
    this.maxAudioBytes = this.configService.get<number>(
      'VOICE_MAX_AUDIO_BYTES',
      5_242_880,
    );
  }

  /**
   * POST /api/voice/transcribe
   *
   * Accepts one audio file via multipart/form-data (field name: "file").
   * Returns the transcript as { text: "..." }.
   *
   * Optional query param: ?debug=true
   * Adds safe metadata (provider, model, mimeType, bytes, sttMs) to the
   * response without exposing any sensitive information.
   */
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        // Multer rejects files exceeding this limit before the handler runs.
        // Multer throws a MulterError with code LIMIT_FILE_SIZE, which
        // NestJS maps to a 400 by default; we document that a 413 is
        // semantically more appropriate but do not add a custom filter just
        // for this — the client receives a clean 4xx either way.
        fileSize: undefined, // resolved dynamically via the constructor
      },
    }),
  )
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('debug') debug?: string,
  ): Promise<TranscribeResponseDto | TranscribeDebugResponseDto> {
    // ── 1. File presence guard ─────────────────────────────────────────────
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    // ── 2. Size guard (redundant if Multer limit is set, safety net here) ──
    if (file.size > this.maxAudioBytes) {
      throw new BadRequestException(
        `Audio file too large. Maximum allowed size is ${this.maxAudioBytes} bytes.`,
      );
    }

    this.logger.log(
      `[Voice] transcription request mime=${file.mimetype} bytes=${file.size}`,
    );

    const startMs = Date.now();

    // ── 3. Delegate to SttService ──────────────────────────────────────────
    // SttService validates empty buffer and MIME type — exceptions propagate.
    const result = await this.sttService.transcribe({
      audio: file.buffer,
      mimeType: file.mimetype,
      // originalname is logged by SttService but never used as a path
      fileName: file.originalname,
    });

    const elapsedMs = Date.now() - startMs;

    this.logger.log(`[Voice] transcription success elapsedMs=${elapsedMs}`);

    // ── 4. Build response ──────────────────────────────────────────────────
    const baseResponse: TranscribeResponseDto = { text: result.text };

    if (debug === 'true') {
      const debugResponse: TranscribeDebugResponseDto = {
        ...baseResponse,
        debug: {
          provider: result.provider,
          model: result.model,
          mimeType: file.mimetype,
          bytes: file.size,
          sttMs: result.durationMs,
        },
      };
      return debugResponse;
    }

    return baseResponse;
  }

  /**
   * POST /api/voice/ask
   *
   * Accepts one audio file via multipart/form-data (field name: "file").
   * Processes transcription and passes it to AssistantService.
   */
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: undefined,
      },
    }),
  )
  async ask(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('debug') debug?: string,
  ): Promise<VoiceAskResponseDto> {
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    if (file.size > this.maxAudioBytes) {
      throw new BadRequestException(
        `Audio file too large. Maximum allowed size is ${this.maxAudioBytes} bytes.`,
      );
    }

    this.logger.log(
      `[Voice] ask request mime=${file.mimetype} bytes=${file.size}`,
    );

    return this.voiceService.ask({
      audio: file.buffer,
      mimeType: file.mimetype,
      fileName: file.originalname,
      debug: debug === 'true',
    });
  }
}
