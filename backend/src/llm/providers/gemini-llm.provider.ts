import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { LlmProvider } from './llm-provider.interface.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from '../types/llm.types.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Parameters for a single Gemini SDK call.
 * abortSignal and httpOptions.timeout are set per-attempt.
 * All other fields are constant across retries and fallback.
 */
interface GeminiCallParams {
  model: string;
  contents: { role: string; parts: { text: string }[] }[];
  config: {
    temperature: number;
    responseMimeType: string;
    responseSchema: object;
    systemInstruction?: string;
    /** Native SDK abort: params.config.abortSignal (confirmed @google/genai v2.27.0) */
    abortSignal?: AbortSignal;
    /**
     * httpOptions.timeout — SDK per-attempt HTTP timeout (ms).
     * httpOptions.retryOptions.attempts = 1 disables the SDK's own p-retry loop.
     * Without this, the SDK default is 5 internal retry attempts on 408/429/5xx,
     * each separated by up to 60 s of exponential backoff — invisible to our code.
     */
    httpOptions?: {
      timeout?: number;
      retryOptions?: {
        attempts?: number; // 1 = no retry, SDK docs: "If 0 or 1, it means no retries"
      };
    };
  };
}

interface ClassifiedError {
  isTransient: boolean;
  isAuthError: boolean;
  safeMessage: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function classifyError(error: unknown): ClassifiedError {
  const raw = error as Record<string, unknown>;
  const safeMessage: string =
    typeof raw?.message === 'string' ? raw.message : 'Unknown error';
  const lower = safeMessage.toLowerCase();

  // Hard auth/config — never retry
  if (
    lower.includes('api_key') ||
    lower.includes('api key') ||
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('"status":"unauthenticated"') ||
    lower.includes('"status":"permission_denied"') ||
    lower.includes('status":"invalid_argument"') ||
    lower.includes('"code":401') ||
    lower.includes('"code":403') ||
    lower.includes('"code":400')
  ) {
    return { isTransient: false, isAuthError: true, safeMessage };
  }

  // Abort / timeout — transient
  const isAbort =
    (raw as any)?.name === 'AbortError' ||
    lower.includes('aborted') ||
    lower.includes('timed out') ||
    lower.includes('attempt timeout') ||
    lower.includes('total budget');

  // Capacity / rate-limit — transient
  const isCapacity =
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('overloaded') ||
    lower.includes('high demand');

  // Network errors — transient
  const isNetwork =
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed');

  return {
    isTransient: isAbort || isCapacity || isNetwork,
    isAuthError: false,
    safeMessage,
  };
}

function getSafeErrorMetadata(error: unknown) {
  const raw = error as any;
  const status = typeof raw?.status === 'number' || typeof raw?.status === 'string' ? raw.status : undefined;
  const code = typeof raw?.code === 'number' || typeof raw?.code === 'string' ? raw.code : undefined;
  const name = typeof raw?.name === 'string' ? raw.name : undefined;
  return { status, code, name };
}

/**
 * Exponential backoff with ±25 % jitter.
 * Base 750 ms: fast enough for interactive use while still spreading load.
 *   attempt 1 → ~750 ms ±25 %
 *   attempt 2 → ~1 500 ms ±25 %
 */
function backoffMs(attempt: number): number {
  const base = Math.pow(2, attempt - 1) * 750;
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, base + jitter);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);
  private readonly client: GoogleGenAI;

  private readonly defaultModel: string;
  private readonly fallbackModel: string;
  private readonly maxRetries: number;
  /** Per-attempt ceiling. Each Gemini call is aborted after this many ms. */
  private readonly attemptTimeoutMs: number;
  /**
   * Hard wall-clock budget for the entire generateStructuredResponse() call.
   * primary attempts + backoff + fallback must ALL fit inside this window.
   * An outer Promise.race enforces this even if the SDK hangs.
   */
  private readonly totalTimeoutMs: number;
  private readonly defaultTemperature: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    this.defaultModel     = this.configService.get<string>('GEMINI_MODEL', 'gemini-3.5-flash');
    this.fallbackModel    = this.configService.get<string>('GEMINI_FALLBACK_MODEL', 'gemini-3.5-flash-lite');
    this.maxRetries       = Number(this.configService.get<number>('GEMINI_MAX_RETRIES', 0));
    this.attemptTimeoutMs = Number(this.configService.get<number>('GEMINI_ATTEMPT_TIMEOUT_MS', 15000));
    this.totalTimeoutMs   = Number(this.configService.get<number>('GEMINI_TOTAL_TIMEOUT_MS', 40000));
    this.defaultTemperature = Number(this.configService.get<number>('LLM_TEMPERATURE', 0));

    this.client = new GoogleGenAI({ apiKey });
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  async generateStructuredResponse(
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<StructuredLlmResponse> {
    const generationStart = Date.now();
    const elapsed = () => Date.now() - generationStart;

    this.logger.log(`[Gemini] generation start (budget: ${this.totalTimeoutMs}ms)`);

    // ── Track the currently active request controller so the outer deadline
    //    can abort it even while a call is in flight.
    let activeController: AbortController | null = null;

    // ── Outer hard deadline: fires at totalTimeoutMs regardless of what the
    //    SDK or our loop is doing.  Aborts the active request and rejects.
    let totalDeadlineHandle: ReturnType<typeof setTimeout>;
    const totalDeadlinePromise = new Promise<never>((_resolve, reject) => {
      totalDeadlineHandle = setTimeout(() => {
        this.logger.warn(`[Gemini] total deadline reached after ${elapsed()}ms — aborting.`);
        activeController?.abort();
        reject(
          new ServiceUnavailableException(
            'LLM Provider Error: Generation budget exceeded — please try again.',
          ),
        );
      }, this.totalTimeoutMs);
    });
    // Suppress "unhandled rejection" if the deadline fires after Promise.race already settled.
    // In production this never happens (clearTimeout in finally wins); in fake-timer tests
    // advanceTimersByTime can fire the deadline after the race resolves.
    totalDeadlinePromise.catch(() => {});

    // ── All actual work runs inside this promise, which races against the
    //    outer deadline.
    const workPromise = this.runGeneration(
      messages,
      options,
      generationStart,
      () => activeController,
      (c: AbortController | null) => { activeController = c; },
    );

    try {
      return await Promise.race([workPromise, totalDeadlinePromise]);
    } finally {
      // Always clear the outer deadline timer, whatever happened.
      clearTimeout(totalDeadlineHandle!);
      activeController = null;
      // Suppress "unhandled rejection" if the deadline won the race and workPromise
      // later rejects (e.g. budget check inside the loop fires after fake-timer advancement).
      workPromise.catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: the actual retry/fallback logic
  // ---------------------------------------------------------------------------

  private async runGeneration(
    messages: LlmMessage[],
    options: LlmGenerationOptions | undefined,
    generationStart: number,
    getActiveController: () => AbortController | null,
    setActiveController: (c: AbortController | null) => void,
  ): Promise<StructuredLlmResponse> {
    const elapsed = () => Date.now() - generationStart;
    const totalDeadline = generationStart + this.totalTimeoutMs;

    const temperature = options?.temperature ?? this.defaultTemperature;

    // Split system prompt from conversational messages
    const systemMessage = messages.find((m) => m.role === 'system');
    const userMessages  = messages.filter((m) => m.role !== 'system');

    const contents = userMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Structured output schema — identical for every attempt
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          enum: ['answer', 'clarification', 'no_verified_info'],
        },
        answer: { type: Type.STRING, nullable: true },
        clarificationQuestion: { type: Type.STRING, nullable: true },
        clarificationOptions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        usedSourceIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['type', 'answer', 'clarificationQuestion', 'clarificationOptions', 'usedSourceIds'],
    };

    const baseGenerationConfig = {
      temperature,
      responseMimeType: 'application/json',
      responseSchema,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
    };

    // ── Primary model with retries ──────────────────────────────────────────

    let lastTransientError: unknown = null;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {

      // Budget check before any backoff sleep
      const remainingBeforeSleep = totalDeadline - Date.now();
      if (remainingBeforeSleep <= 0) {
        this.logger.warn(`[Gemini] total budget exhausted before attempt ${attempt} (${elapsed()}ms).`);
        throw new ServiceUnavailableException(
          'LLM Provider Error: Generation budget exceeded — please try again.',
        );
      }

      // Backoff sleep (skip first attempt)
      if (attempt > 1) {
        const wait = Math.min(backoffMs(attempt - 1), remainingBeforeSleep - 1);
        this.logger.warn(
          `[Gemini] retry ${attempt - 1} — waiting ${Math.round(wait)}ms before next attempt…`,
        );
        await this.sleep(wait);

        if (Date.now() >= totalDeadline) {
          this.logger.warn(`[Gemini] total budget exhausted after backoff (${elapsed()}ms).`);
          throw new ServiceUnavailableException(
            'LLM Provider Error: Generation budget exceeded — please try again.',
          );
        }
      }

      // Per-attempt effective timeout
      const remainingForAttempt = totalDeadline - Date.now();
      const effectiveAttemptMs = Math.min(this.attemptTimeoutMs, remainingForAttempt);

      const controller = new AbortController();
      setActiveController(controller);

      // Per-attempt abort timer (belt)
      const attemptTimeoutHandle = setTimeout(() => {
        this.logger.warn(
          `[Gemini] primary attempt ${attempt} timed out after ${effectiveAttemptMs}ms.`,
        );
        controller.abort();
      }, effectiveAttemptMs);

      this.logger.log(
        `[Gemini] primary attempt ${attempt}/${this.maxRetries + 1} start — ` +
        `model=${this.defaultModel} attemptBudget=${effectiveAttemptMs}ms`,
      );

      try {
        const result = await this.callGemini({
          model: this.defaultModel,
          contents,
          config: {
            ...baseGenerationConfig,
            abortSignal: controller.signal,
            httpOptions: {
              timeout: effectiveAttemptMs,
              // Disable SDK's internal p-retry loop — we manage retries ourselves.
              // SDK default is 5 attempts (incl. initial) which can add up to 5×60s.
              retryOptions: { attempts: 1 },
            },
          },
        });
        clearTimeout(attemptTimeoutHandle);
        setActiveController(null);
        this.logger.log(`[Gemini] generation completed after ${elapsed()}ms (attempt ${attempt}).`);
        return result;

      } catch (error: unknown) {
        clearTimeout(attemptTimeoutHandle);
        setActiveController(null);
        const classified = classifyError(error);
        const meta = getSafeErrorMetadata(error);

        // Hard auth/config errors — never retry, never fall back
        if (classified.isAuthError) {
          this.logger.error(
            `[Gemini] auth/config error elapsedMs=${elapsed()} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
          );
          const lower = classified.safeMessage.toLowerCase();
          if (
            lower.includes('api_key') ||
            lower.includes('api key') ||
            lower.includes('unauthorized') ||
            lower.includes('unauthenticated')
          ) {
            throw new UnauthorizedException('Gemini API key is invalid or not configured');
          }
          throw new ServiceUnavailableException(`LLM Provider Error: ${classified.safeMessage}`);
        }

        // Non-transient, non-auth (empty/malformed response) — fail immediately
        if (!classified.isTransient) {
          this.logger.error(
            `[Gemini] non-retryable error elapsedMs=${elapsed()} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
          );
          throw new ServiceUnavailableException(`LLM Provider Error: ${classified.safeMessage}`);
        }

        lastTransientError = error;
        this.logger.warn(
          `[Gemini] transient error on attempt ${attempt} elapsedMs=${elapsed()} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
        );
      }
    }

    // ── Fallback model — single attempt ────────────────────────────────────

    const remainingForFallback = totalDeadline - Date.now();
    if (remainingForFallback <= 0) {
      this.logger.warn(`[Gemini] total budget exhausted before fallback (${elapsed()}ms).`);
      const msg = classifyError(lastTransientError).safeMessage;
      throw new ServiceUnavailableException(`LLM Provider Error: ${msg}`);
    }

    const effectiveFallbackMs = Math.min(this.attemptTimeoutMs, remainingForFallback);

    this.logger.warn(
      `[Gemini] fallback start — model=${this.fallbackModel} ` +
      `remaining=${remainingForFallback}ms fallbackBudget=${effectiveFallbackMs}ms`,
    );

    const fallbackController = new AbortController();
    setActiveController(fallbackController);

    const fallbackTimeoutHandle = setTimeout(() => {
      this.logger.warn(`[Gemini] fallback timed out after ${effectiveFallbackMs}ms.`);
      fallbackController.abort();
    }, effectiveFallbackMs);

    try {
      const result = await this.callGemini({
        model: this.fallbackModel,
        contents,
        config: {
          ...baseGenerationConfig,
          abortSignal: fallbackController.signal,
          httpOptions: {
            timeout: effectiveFallbackMs,
            retryOptions: { attempts: 1 }, // disable SDK internal retry on fallback too
          },
        },
      });
      clearTimeout(fallbackTimeoutHandle);
      setActiveController(null);
      this.logger.log(`[Gemini] fallback succeeded after ${elapsed()}ms.`);
      return result;

    } catch (fallbackError: unknown) {
      clearTimeout(fallbackTimeoutHandle);
      setActiveController(null);
      const classified = classifyError(fallbackError);
      const meta = getSafeErrorMetadata(fallbackError);
      this.logger.error(
        `[Gemini] fallback also failed elapsedMs=${elapsed()} status=${meta.status} code=${meta.code} msg="${classified.safeMessage}"`
      );
      const originalMessage = classifyError(lastTransientError).safeMessage;
      throw new ServiceUnavailableException(`LLM Provider Error: ${originalMessage}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Protected: single SDK call — spied on in tests
  // ---------------------------------------------------------------------------

  protected async callGemini(params: GeminiCallParams): Promise<StructuredLlmResponse> {
    const response = await this.client.models.generateContent({
      model:    params.model,
      contents: params.contents,
      config:   params.config,
    });

    const rawText = response.text;
    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }

    let parsed: StructuredLlmResponse;
    try {
      parsed = JSON.parse(rawText) as StructuredLlmResponse;
    } catch {
      throw new Error('Malformed JSON response from Gemini');
    }

    parsed.clarificationOptions = parsed.clarificationOptions ?? [];
    parsed.usedSourceIds        = parsed.usedSourceIds ?? [];
    return parsed;
  }

  // ---------------------------------------------------------------------------
  // Protected: sleep — overridable in tests via vi.spyOn
  // ---------------------------------------------------------------------------

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
