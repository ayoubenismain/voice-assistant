import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { TtsProvider } from './tts-provider.interface.js';
import type { TtsInput, TtsResult } from '../tts.types.js';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

interface ClassifiedTtsError {
  type: 'auth' | 'bad_request' | 'quota' | 'transient' | 'unknown';
  safeMessage: string;
}

function classifyTtsError(error: unknown): ClassifiedTtsError {
  const raw = error as Record<string, unknown>;
  const safeMessage =
    typeof raw?.message === 'string' ? raw.message : 'Unknown TTS error';
  const lower = safeMessage.toLowerCase();
  const status = typeof raw?.status === 'number' ? raw.status : 0;

  // AbortError → timeout
  if (
    (raw as any)?.name === 'AbortError' ||
    lower.includes('abort') ||
    lower.includes('aborted')
  ) {
    return { type: 'transient', safeMessage };
  }

  // Auth / API key
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key') ||
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('permission_denied')
  ) {
    return { type: 'auth', safeMessage };
  }

  // Bad request — client-side problem
  if (
    status === 400 ||
    lower.includes('invalid_argument') ||
    lower.includes('bad request')
  ) {
    return { type: 'bad_request', safeMessage };
  }

  // Rate limit / quota
  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return { type: 'quota', safeMessage };
  }

  // Transient: 5xx, network, capacity
  if (
    status >= 500 ||
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('timed out')
  ) {
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
 * GeminiTtsProvider — Phase 8D
 *
 * Uses the official @google/genai SDK (v2.27.0) models.generateContent API
 * with responseModalities: ['AUDIO'] to produce WAV audio from text.
 *
 * Verified SDK types:
 *   - GenerateContentConfig.abortSignal: AbortSignal (top-level, not in httpOptions)
 *   - GenerateContentConfig.httpOptions.retryOptions.attempts: number (0|1 = no retry)
 *   - GenerateContentConfig.speechConfig: SpeechConfigUnion (SpeechConfig | string)
 *   - SpeechConfig.voiceConfig: VoiceConfig
 *   - VoiceConfig.voice: string  (direct voice name field)
 *   - VoiceConfig.prebuiltVoiceConfig: PrebuiltVoiceConfig (alternative)
 *   - Part.speechMetadata: SpeechMetadata
 *   - SpeechMetadata.style: string
 *
 * Text is passed verbatim — no summarization, translation, or rewriting.
 * Language is detected automatically from input text (Arabic/French/Darija).
 * Style is applied via speechMetadata.style, not by injecting text.
 *
 * Timeout: AbortController + outer Promise.race deadline, both set to
 * TTS_TIMEOUT_MS. The AbortSignal is wired to GenerateContentConfig.abortSignal
 * so the SDK can abort at the fetch layer.
 *
 * Retries: disabled via httpOptions.retryOptions.attempts = 1 (no retries).
 *
 * Audio: Gemini TTS unary requests return complete WAV (RIFF/WAVE).
 * WAV magic bytes [0–3]=RIFF, [8–11]=WAVE are validated before returning.
 */
@Injectable()
export class GeminiTtsProvider implements TtsProvider {
  private readonly logger = new Logger(GeminiTtsProvider.name);

  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly defaultVoice: string;
  private readonly defaultStyle: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined.');
    }

    this.model = this.configService.get<string>(
      'TTS_MODEL',
      'gemini-3.8-flash-lite-tts',
    );
    this.defaultVoice = this.configService.get<string>('TTS_VOICE', 'Kore');
    this.defaultStyle = this.configService.get<string>('TTS_STYLE') || undefined;
    this.timeoutMs = Number(this.configService.get<number>('TTS_TIMEOUT_MS', 15000));

    this.client = new GoogleGenAI({ apiKey });
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const start = Date.now();
    const elapsed = () => Date.now() - start;

    const voice = input.voice ?? this.defaultVoice;
    const style = input.style ?? this.defaultStyle;

    this.logger.log(
      `[TTS] synthesis start provider=gemini model=${this.model} chars=${input.text.length}`,
    );

    // ── Hard wall-clock deadline ──────────────────────────────────────────────
    const controller = new AbortController();

    let deadlineHandle: ReturnType<typeof setTimeout>;
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadlineHandle = setTimeout(() => {
        this.logger.warn(
          `[TTS] synthesis timeout elapsedMs=${elapsed()} — aborting.`,
        );
        controller.abort();
        reject(
          new ServiceUnavailableException(
            'Speech synthesis service is temporarily unavailable.',
          ),
        );
      }, this.timeoutMs);
    });
    // Suppress unhandled rejection if work wins the race first.
    deadlinePromise.catch(() => {});

    const workPromise = this.callGeminiSynthesize(
      input.text,
      voice,
      style,
      controller.signal,
      elapsed,
    );

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

  protected async callGeminiSynthesize(
    text: string,
    voice: string,
    style: string | undefined,
    signal: AbortSignal,
    elapsed: () => number,
  ): Promise<TtsResult> {
    // Build the Part.
    // speechMetadata.style delivers delivery instructions to the model.
    // The spoken text itself is NOT modified — exact-text principle.
    const part: Record<string, unknown> = { text };
    if (style) {
      part.speechMetadata = { style };
    }

    let response: Awaited<ReturnType<typeof this.client.models.generateContent>>;

    try {
      response = await this.client.models.generateContent({
        model: this.model,

        contents: [
          {
            role: 'user',
            parts: [part as any],
          },
        ],

        config: {
          // Request audio output modality.
          responseModalities: ['AUDIO'],

          // Voice configuration.
          // SpeechConfig.voiceConfig.voice is the direct string field in
          // @google/genai v2.27.0 VoiceConfig.
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },

          // AbortSignal is top-level on GenerateContentConfig (not in httpOptions).
          abortSignal: signal,

          // Disable SDK internal retries.
          // HttpRetryOptions.attempts: 0|1 means no retries.
          // One attempt only — we control the timeout ourselves via Promise.race.
          httpOptions: {
            retryOptions: {
              attempts: 1,
            },
          },
        },
      });
    } catch (error: unknown) {
      const classified = classifyTtsError(error);
      const meta = getSafeErrorMetadata(error);
      this.logger.error(
        `[TTS] synthesis error elapsedMs=${elapsed()} type=${classified.type} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
      );

      switch (classified.type) {
        case 'auth':
          throw new UnauthorizedException(
            'Authentication failed with TTS provider.',
          );
        case 'bad_request':
          throw new BadRequestException('Invalid TTS request parameters.');
        case 'quota':
        case 'transient':
        default:
          throw new ServiceUnavailableException(
            'Speech synthesis service is temporarily unavailable.',
          );
      }
    }

    // ── Extract audio from response ────────────────────────────────────────────
    const candidate = response.candidates?.[0];
    const part0 = candidate?.content?.parts?.[0];
    const inlineData = (part0 as any)?.inlineData;

    if (!inlineData?.data) {
      this.logger.error(
        `[TTS] synthesis returned empty audio elapsedMs=${elapsed()}`,
      );
      throw new ServiceUnavailableException(
        'Speech synthesis service is temporarily unavailable.',
      );
    }

    const audioBuffer = Buffer.from(inlineData.data as string, 'base64');

    // ── Minimal WAV validation ──────────────────────────────────────────────────
    // Gemini TTS unary requests return complete WAV (RIFF/WAVE header included).
    // Validate magic bytes before returning to catch API contract violations.
    if (audioBuffer.length < 12) {
      this.logger.error(
        `[TTS] audio buffer too small (${audioBuffer.length} bytes) elapsedMs=${elapsed()}`,
      );
      throw new ServiceUnavailableException(
        'Speech synthesis service is temporarily unavailable.',
      );
    }

    const riff = audioBuffer.subarray(0, 4).toString('ascii');
    const wave = audioBuffer.subarray(8, 12).toString('ascii');

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      this.logger.error(
        `[TTS] received non-WAV audio (riff=${riff} wave=${wave}) elapsedMs=${elapsed()}`,
      );
      throw new ServiceUnavailableException(
        'Speech synthesis service is temporarily unavailable.',
      );
    }

    const elapsedMs = elapsed();
    this.logger.log(
      `[TTS] synthesis completed elapsedMs=${elapsedMs} bytes=${audioBuffer.length}`,
    );

    return {
      audio: audioBuffer,
      mimeType: 'audio/wav',
      provider: 'gemini',
      model: this.model,
      voice,
    };
  }
}
