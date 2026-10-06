import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { SttProvider } from './stt-provider.interface.js';
import type { SttInput, SttResult } from '../stt.types.js';

// ---------------------------------------------------------------------------
// Error classification (preserved from Phase 8A)
// ---------------------------------------------------------------------------

interface ClassifiedSttError {
  type: 'auth' | 'bad_request' | 'transient' | 'unknown';
  safeMessage: string;
}

function classifySttError(error: unknown): ClassifiedSttError {
  const raw = error as Record<string, unknown>;
  const safeMessage =
    typeof raw?.message === 'string' ? raw.message : 'Unknown STT error';
  const lower = safeMessage.toLowerCase();

  // Auth / API key — never retry, expose safe message only
  if (
    lower.includes('api_key') ||
    lower.includes('api key') ||
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('"code":401') ||
    lower.includes('"code":403') ||
    lower.includes('status":"unauthenticated"') ||
    lower.includes('status":"permission_denied"')
  ) {
    return { type: 'auth', safeMessage };
  }

  // Client-side bad request (malformed audio, unsupported format at API level)
  if (
    lower.includes('"code":400') ||
    lower.includes('invalid_argument') ||
    lower.includes('bad request')
  ) {
    return { type: 'bad_request', safeMessage };
  }

  // Transient: rate limit, capacity, network, abort
  const isAbort =
    (raw as any)?.name === 'AbortError' ||
    lower.includes('aborted') ||
    lower.includes('timed out') ||
    lower.includes('abort');
  const isCapacity =
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('overloaded') ||
    lower.includes('high demand');
  const isNetwork =
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed');

  if (isAbort || isCapacity || isNetwork) {
    return { type: 'transient', safeMessage };
  }

  return { type: 'unknown', safeMessage };
}

function getSafeErrorMetadata(error: unknown) {
  const raw = error as any;
  const status = typeof raw?.status === 'number' || typeof raw?.status === 'string' ? raw.status : undefined;
  const code = typeof raw?.code === 'number' || typeof raw?.code === 'string' ? raw.code : undefined;
  const name = typeof raw?.name === 'string' ? raw.name : undefined;
  return { status, code, name };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * GeminiSttProvider — Phase 8B migration.
 *
 * Uses the official @google/genai SDK (v2.27.0) Interactions API:
 *
 *   client.interactions.create({
 *     model: 'gemini-3.5-transcribe',
 *     input: AudioContent with inline base64 data,
 *     generation_config: { transcription_config: { ... } },
 *   })
 *
 * Root cause of Phase 8B failure:
 *   The old implementation used client.models.generateContent() with
 *   audioTranscriptionConfig — this is the LIVE API transcription config
 *   shape, not the Interactions API shape. The Interactions API requires
 *   generation_config.transcription_config and client.interactions.create().
 *   The result is read from interaction.output_text, not response.text.
 *
 * Audio is passed as inline base64 via AudioContent.data — no temp file
 * and no Files API are required. AudioContent supports both:
 *   - data: base64 string (used here for push-to-talk Buffer input)
 *   - uri:  Gemini Files URI (used if we ever migrate to Files API)
 *
 * Transcription configuration (TranscriptionConfig):
 *   - language_codes: []   → automatic language detection (Tunisian Darija)
 *   - custom_vocabulary:   → ISSATSO domain terms
 *   - mode: { type: 'verbatim' } → preserve student phrasing exactly
 *   - diarization_mode:    omitted (incompatible with custom vocabulary)
 *   - timestamp_granularities: omitted (incompatible with custom vocabulary)
 *
 * Timeout: one AbortController covers the single interactions.create call.
 * SDK retries: disabled via maxRetries: 0 in GoogleGenAIRequestOptions.
 */
@Injectable()
export class GeminiSttProvider implements SttProvider {
  private readonly logger = new Logger(GeminiSttProvider.name);

  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly customVocabulary: string[];

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    this.model = this.configService.get<string>(
      'STT_MODEL',
      'gemini-3.5-transcribe',
    );
    this.timeoutMs = Number(this.configService.get<number>('STT_TIMEOUT_MS', 15000));

    // Parse comma-separated custom vocabulary from env.
    // Trims each term; ignores empty entries.
    const vocabRaw = this.configService.get<string>('STT_CUSTOM_VOCABULARY', '');
    this.customVocabulary = vocabRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    this.client = new GoogleGenAI({ apiKey });
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const start = Date.now();
    const elapsed = () => Date.now() - start;

    this.logger.log(
      `[STT] transcription request mime=${input.mimeType} bytes=${input.audio.length}`,
    );

    // ── Hard wall-clock deadline ─────────────────────────────────────────────
    // A single AbortController covers the entire interactions.create call.
    // The total budget STT_TIMEOUT_MS applies to upload+transcribe as one unit
    // because we use inline base64 — there is no separate upload step.
    const controller = new AbortController();

    let deadlineHandle: ReturnType<typeof setTimeout>;
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadlineHandle = setTimeout(() => {
        this.logger.warn(
          `[STT] transcription timeout elapsedMs=${elapsed()} — aborting.`,
        );
        controller.abort();
        reject(
          new ServiceUnavailableException(
            'Speech transcription service timed out. Please try again.',
          ),
        );
      }, this.timeoutMs);
    });
    // Suppress unhandled rejection if the work promise wins the race first.
    deadlinePromise.catch(() => {});

    const workPromise = this.callGeminiTranscribe(input, controller.signal, start);

    try {
      return await Promise.race([workPromise, deadlinePromise]);
    } finally {
      clearTimeout(deadlineHandle!);
      // Suppress unhandled rejection on the losing promise.
      workPromise.catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Protected — overridable / spyable in tests
  // ---------------------------------------------------------------------------

  protected async callGeminiTranscribe(
    input: SttInput,
    signal: AbortSignal,
    start: number,
  ): Promise<SttResult> {
    const elapsed = () => Date.now() - start;

    // ── Encode audio as base64 for inline transmission ───────────────────────
    // AudioContent.data accepts a base64 string.
    // For push-to-talk clips (typically <30 s, <5 MB) inline base64 is the
    // correct approach — it avoids the Files API upload/delete lifecycle and
    // works directly with client.interactions.create().
    const base64Audio = input.audio.toString('base64');

    this.logger.log(`[STT] transcription start model=${this.model}`);

    let interaction: Awaited<
      ReturnType<typeof this.client.interactions.create>
    >;

    try {
      interaction = await this.client.interactions.create(
        {
          model: this.model,

          // ── Audio input via AudioContent (inline base64) ─────────────────
          // InteractionsInput = Content_2 | ... and Content_2 = AudioContent | ...
          // AudioContent: { type: 'audio', data: base64, mime_type: mimeType }
          input: {
            type: 'audio',
            data: base64Audio,
            mime_type: input.mimeType,
          },

          // ── Generation / transcription configuration ─────────────────────
          // GenerationConfig_2 has transcription_config: TranscriptionConfig
          generation_config: {
            transcription_config: {
              // Omitting language_codes (or passing empty array) enables auto
              // language detection — required for Tunisian Darija + French.
              language_codes: [],

              // Domain vocabulary: biases ASR toward ISSATSO-specific terms.
              // Only set if vocabulary list is non-empty.
              custom_vocabulary:
                this.customVocabulary.length > 0
                  ? this.customVocabulary
                  : undefined,

              // Verbatim mode: preserve the student's exact phrasing.
              // VerbatimTranscriptionMode = { type: 'verbatim' }
              // diarization_mode and timestamp_granularities are intentionally
              // omitted — they are incompatible with custom_vocabulary.
              mode: { type: 'verbatim' } as const,
            },
          },
        },
        {
          // ── SDK-level options ─────────────────────────────────────────────
          // AbortSignal wires into the fetch layer so the request is cancelled
          // when our hard deadline fires.
          // maxRetries: 0 disables the SDK's built-in p-retry loop; we control
          // the timeout ourselves via Promise.race — hidden retries would
          // silently extend latency beyond STT_TIMEOUT_MS.
          timeout: this.timeoutMs,
          maxRetries: 0,
          fetchOptions: { signal },
        },
      );
    } catch (error: unknown) {
      const classified = classifySttError(error);
      const meta = getSafeErrorMetadata(error);
      this.logger.error(
        `[STT] transcription error elapsedMs=${elapsed()} type=${classified.type} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
      );

      switch (classified.type) {
        case 'auth':
          throw new UnauthorizedException(
            'Speech transcription authentication failed. Check GEMINI_API_KEY.',
          );
        case 'bad_request':
          throw new BadRequestException(
            'Speech transcription rejected the audio. Check the audio format.',
          );
        case 'transient':
        default:
          throw new ServiceUnavailableException(
            'Speech transcription service is temporarily unavailable. Please try again.',
          );
      }
    }

    // ── Extract transcript from Interactions response ─────────────────────────
    // interaction.output_text is an SDK-added convenience field that
    // concatenates all text from the last model output step.
    // (Documented in the type: "Note: this is added by the SDK.")
    const rawText = (interaction as any).output_text as string | undefined;

    if (!rawText || rawText.trim().length === 0) {
      this.logger.warn(
        `[STT] transcription returned empty text elapsedMs=${elapsed()}`,
      );
      throw new ServiceUnavailableException(
        'Speech transcription returned an empty result. Please try speaking again.',
      );
    }

    const transcript = rawText.trim();
    const durationMs = elapsed();

    this.logger.log(`[STT] transcription completed elapsedMs=${durationMs}`);

    return {
      text: transcript,
      provider: 'gemini',
      model: this.model,
      durationMs,
    };
  }
}
