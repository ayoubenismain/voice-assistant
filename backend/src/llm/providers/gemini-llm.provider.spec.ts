import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { GeminiLlmProvider } from './gemini-llm.provider.js';
import { LlmMessage } from '../types/llm.types.js';

// ---------------------------------------------------------------------------
// Mock @google/genai — GoogleGenAI must be newable.
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
    constructor(_opts: unknown) {}
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY' },
  };
});

// ---------------------------------------------------------------------------
// Config / provider helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Record<string, unknown> = {
  GEMINI_API_KEY: 'test-api-key',
  GEMINI_MODEL: 'gemini-3.5-flash',
  GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_MAX_RETRIES: 0,
  GEMINI_ATTEMPT_TIMEOUT_MS: 15000,
  GEMINI_TOTAL_TIMEOUT_MS: 40000,
  LLM_TEMPERATURE: 0,
};

function buildConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  // Undefined values mean "use the provider's hardcoded default"
  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  );
  const values = { ...DEFAULT_CONFIG, ...filtered };
  return {
    get: vi.fn().mockImplementation(<T>(key: string, def?: T): T =>
      (key in values ? values[key] : def) as T,
    ),
  } as unknown as ConfigService;
}

async function buildProvider(configOverrides: Record<string, unknown> = {}): Promise<GeminiLlmProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GeminiLlmProvider,
      { provide: ConfigService, useValue: buildConfigService(configOverrides) },
    ],
  }).compile();

  const p = module.get<GeminiLlmProvider>(GeminiLlmProvider);
  // Suppress real backoff waits
  vi.spyOn(p as any, 'sleep').mockResolvedValue(undefined);
  return p;
}

// ---------------------------------------------------------------------------
// Payload factories
// ---------------------------------------------------------------------------

function answerPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'answer',
    answer: 'Registration costs 70 DT.',
    clarificationQuestion: null,
    clarificationOptions: [],
    usedSourceIds: ['S1'],
    ...overrides,
  };
}

const testMessages: LlmMessage[] = [
  { role: 'system', content: 'You are a helpful ISSATSO assistant.' },
  { role: 'user', content: '9adech n5alles lel licence?' },
];

// Error factories
const make503 = () =>
  new Error('{"error":{"code":503,"message":"High demand","status":"UNAVAILABLE"}}');
const make429 = () =>
  new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota exceeded"}}');
const make401 = () =>
  new Error('{"error":{"code":401,"status":"UNAUTHENTICATED","message":"API_KEY is invalid"}}');
const make400 = () =>
  new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"status\":\"invalid_argument\""}}');
const makeAbort = () => {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
};
/** A promise that never resolves — simulates a truly hung SDK call.
 * The internal .catch(() => {}) prevents Vitest's unhandled-rejection detector
 * from firing when the outer total-deadline abandons these promises.
 */
const makeHangingCall = () => {
  const p: Promise<never> = new Promise(() => {});
  (p as Promise<unknown>).catch(() => {});
  return p;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeminiLlmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Config defaults ───────────────────────────────────────────────────────

  it('default fallback model is gemini-3.5-flash-lite', async () => {
    const p = await buildProvider({ GEMINI_FALLBACK_MODEL: undefined });
    expect((p as any).fallbackModel).toBe('gemini-3.5-flash-lite');
  });

  it('default max retries is 0', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: undefined });
    expect((p as any).maxRetries).toBe(0);
  });

  it('default attempt timeout is 15000ms', async () => {
    const p = await buildProvider({ GEMINI_ATTEMPT_TIMEOUT_MS: undefined });
    expect((p as any).attemptTimeoutMs).toBe(15000);
  });

  it('default total timeout is 40000ms', async () => {
    const p = await buildProvider({ GEMINI_TOTAL_TIMEOUT_MS: undefined });
    expect((p as any).totalTimeoutMs).toBe(40000);
  });

  it('default model is gemini-3.5-flash', async () => {
    const p = await buildProvider({ GEMINI_MODEL: undefined });
    expect((p as any).defaultModel).toBe('gemini-3.5-flash');
  });

  // ── G. Normal success (no retry needed) ──────────────────────────────────

  it('G: succeeds on first attempt without retry', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('answer');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect((p as any).sleep).not.toHaveBeenCalled();
  });

  it('G: returns parsed structured response', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(answerPayload({ answer: 'Test.', usedSourceIds: ['S1', 'S2'] })),
    });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.answer).toBe('Test.');
    expect(result.usedSourceIds).toEqual(['S1', 'S2']);
    expect(result.clarificationOptions).toEqual([]);
  });

  it('G: abortSignal passed to SDK per call', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig.abortSignal).toBeDefined();
    expect(callConfig.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('G: httpOptions.retryOptions.attempts=1 disables SDK internal retry', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig.httpOptions?.retryOptions?.attempts).toBe(1);
  });

  it('G: httpOptions.timeout is set on every call', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(typeof callConfig.httpOptions?.timeout).toBe('number');
    expect(callConfig.httpOptions.timeout).toBeGreaterThan(0);
  });

  it('G: system instruction extracted and non-system contents passed', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.systemInstruction).toBe('You are a helpful ISSATSO assistant.');
    expect(call.contents.every((c: { role: string }) => c.role !== 'system')).toBe(true);
  });

  it('G: works correctly with no system message', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse([{ role: 'user', content: 'Hello?' }]);

    expect(mockGenerateContent.mock.calls[0][0].config.systemInstruction).toBeUndefined();
  });

  it('G: passes custom temperature option', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages, { temperature: 0.7 });

    expect(mockGenerateContent.mock.calls[0][0].config.temperature).toBe(0.7);
  });

  // ── Default flow: primary → fallback (MAX_RETRIES=0) ─────────────────────

  it('default flow: primary 503 → fallback succeeds immediately (no sleep, no retry)', async () => {
    const p = await buildProvider(); // GEMINI_MAX_RETRIES=0
    mockGenerateContent
      .mockRejectedValueOnce(make503())  // primary fails
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload({ answer: 'Fallback answer.' })) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.answer).toBe('Fallback answer.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[1][0].model).toBe('gemini-3.5-flash-lite');
    // No retry sleep — goes directly from primary failure to fallback
    expect((p as any).sleep).not.toHaveBeenCalled();
  });

  // ── H. 503 retry behavior (configurable, non-default) ────────────────────

  it('H: retries once after 503 when MAX_RETRIES=1 (configurable retry path)', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('answer');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect((p as any).sleep).toHaveBeenCalledTimes(1);
  });

  it('H: retries once after 429 when MAX_RETRIES=1 (configurable retry path)', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(make429())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('answer');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect((p as any).sleep).toHaveBeenCalledTimes(1);
  });

  it('H: exhausted primary retries → falls back, fallback succeeds', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())    // attempt 1
      .mockRejectedValueOnce(make503())    // attempt 2 (retry)
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload({ answer: 'Fallback!' })) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.answer).toBe('Fallback!');
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(mockGenerateContent.mock.calls[2][0].model).toBe('gemini-3.5-flash-lite');
  });

  it('H: fallback also disables SDK internal retry', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const fallbackConfig = mockGenerateContent.mock.calls[1][0].config;
    expect(fallbackConfig.httpOptions?.retryOptions?.attempts).toBe(1);
  });

  // ── I. 400/401/403 never retry ────────────────────────────────────────────

  it('I: throws UnauthorizedException on 401 — no retry', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockRejectedValueOnce(make401());

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(UnauthorizedException);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect((p as any).sleep).not.toHaveBeenCalled();
  });

  it('I: throws immediately on API_KEY error — no retry', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockRejectedValueOnce(new Error('API_KEY is invalid or missing permission'));

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(UnauthorizedException);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('I: throws ServiceUnavailableException on 400 — no retry', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockRejectedValueOnce(make400());

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(ServiceUnavailableException);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect((p as any).sleep).not.toHaveBeenCalled();
  });

  it('I: throws on malformed JSON — no retry (non-transient error)', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent.mockResolvedValue({ text: '{invalid-json' });

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(ServiceUnavailableException);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('I: throws on empty response — no retry', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent.mockResolvedValue({ text: '' });

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(ServiceUnavailableException);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  // ── A. SDK call hangs — outer total deadline resolves it ──────────────────

  it('A: SDK call hangs forever → provider resolves at total timeout', async () => {
    const TOTAL_MS = 500; // small for test speed
    const p = await buildProvider({
      GEMINI_TOTAL_TIMEOUT_MS: TOTAL_MS,
      GEMINI_ATTEMPT_TIMEOUT_MS: 10000,
      GEMINI_MAX_RETRIES: 0,
    });

    mockGenerateContent.mockImplementation(makeHangingCall);

    const start = Date.now();
    const resultPromise = p.generateStructuredResponse(testMessages);

    // Attach the rejection handler BEFORE advancing timers so Node never sees
    // the promise as temporarily unhandled.
    const assertion = expect(resultPromise).rejects.toThrow(ServiceUnavailableException);

    // Advance fake timers past the total timeout
    await vi.advanceTimersByTimeAsync(TOTAL_MS + 50);

    await assertion;
    // Must have returned within a reasonable margin of the configured total timeout
    const duration = Date.now() - start;
    // Loose bound: should complete within total+500ms (fake timers make this fast)
    expect(duration).toBeLessThan(TOTAL_MS + 1000);
  });

  // ── B. Primary hangs → per-attempt timeout moves to retry ─────────────────

  it('B: AbortError (per-attempt timeout) is transient → retried', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(makeAbort())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('answer');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  // ── C. Retry hangs → fallback uses remaining budget ───────────────────────

  it('C: primary 503 → retry AbortError → fallback succeeds', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockRejectedValueOnce(makeAbort())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload({ answer: 'Fallback answer.' })) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.answer).toBe('Fallback answer.');
    expect(mockGenerateContent.mock.calls[2][0].model).toBe('gemini-3.5-flash-lite');
  });

  // ── D. Fallback hangs → total deadline ends operation ────────────────────

  it('D: all calls hang → total deadline fires → ServiceUnavailableException', async () => {
    const TOTAL_MS = 300;
    const p = await buildProvider({
      GEMINI_TOTAL_TIMEOUT_MS: TOTAL_MS,
      GEMINI_ATTEMPT_TIMEOUT_MS: 10000,
      GEMINI_MAX_RETRIES: 0,
    });
    mockGenerateContent.mockImplementation(makeHangingCall);

    const resultPromise = p.generateStructuredResponse(testMessages);

    // Attach rejection handlers BEFORE advancing timers.
    const assertion = expect(resultPromise).rejects.toThrow(ServiceUnavailableException);
    const msgAssertion = expect(resultPromise).rejects.toThrow('Generation budget exceeded');

    await vi.advanceTimersByTimeAsync(TOTAL_MS + 100);

    await assertion;
    await msgAssertion;
  });

  // ── E. Total duration bounded ─────────────────────────────────────────────

  it('E: provider rejects at total timeout even with multiple hanging calls', async () => {
    const TOTAL_MS = 200;
    const p = await buildProvider({
      GEMINI_TOTAL_TIMEOUT_MS: TOTAL_MS,
      GEMINI_ATTEMPT_TIMEOUT_MS: 5000,
      GEMINI_MAX_RETRIES: 3,
    });
    mockGenerateContent.mockImplementation(makeHangingCall);

    const resultPromise = p.generateStructuredResponse(testMessages);

    // Attach rejection handler BEFORE advancing timers.
    const assertion = expect(resultPromise).rejects.toThrow(ServiceUnavailableException);

    await vi.advanceTimersByTimeAsync(TOTAL_MS + 100);

    await assertion;
  });

  // ── F. Controllers are cleaned up ────────────────────────────────────────

  it('F: activeController is null after successful response', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    // The field is set to null in the finally block of generateStructuredResponse
    expect((p as any).activeController ?? null).toBeNull();
  });

  it('F: each retry call gets a fresh, separate AbortSignal', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 1 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const signal1 = mockGenerateContent.mock.calls[0][0].config.abortSignal;
    const signal2 = mockGenerateContent.mock.calls[1][0].config.abortSignal;
    expect(signal1).not.toBe(signal2);
  });

  // ── Fallback model name / prompt parity ───────────────────────────────────

  it('I (fallback): fallback model is gemini-3.5-flash-lite by default', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    expect(mockGenerateContent.mock.calls[1][0].model).toBe('gemini-3.5-flash-lite');
  });

  it('J: primary and fallback receive identical contents, schema, systemInstruction', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload()) });

    await p.generateStructuredResponse(testMessages);

    const primary  = mockGenerateContent.mock.calls[0][0];
    const fallback = mockGenerateContent.mock.calls[1][0];

    expect(primary.contents).toEqual(fallback.contents);
    expect(primary.config.responseSchema).toEqual(fallback.config.responseSchema);
    expect(primary.config.systemInstruction).toEqual(fallback.config.systemInstruction);
    expect(primary.config.temperature).toEqual(fallback.config.temperature);
    expect(primary.config.responseMimeType).toEqual(fallback.config.responseMimeType);
    expect(primary.model).toBe('gemini-3.5-flash');
    expect(fallback.model).toBe('gemini-3.5-flash-lite');
    // Each call has its own AbortSignal
    expect(primary.config.abortSignal).not.toBe(fallback.config.abortSignal);
  });

  // ── K. Retry count bounded ────────────────────────────────────────────────

  it('K: total calls = maxRetries+1 primary + 1 fallback when all fail', async () => {
    const maxRetries = 2;
    const p = await buildProvider({ GEMINI_MAX_RETRIES: maxRetries });
    mockGenerateContent.mockRejectedValue(make503());

    await expect(p.generateStructuredResponse(testMessages)).rejects.toThrow(ServiceUnavailableException);

    // 3 primary + 1 fallback = 4
    expect(mockGenerateContent).toHaveBeenCalledTimes(maxRetries + 1 + 1);
    expect((p as any).sleep).toHaveBeenCalledTimes(maxRetries);
  });

  it('K: maxRetries=0 → 1 primary + 1 fallback only', async () => {
    const p = await buildProvider({ GEMINI_MAX_RETRIES: 0 });
    mockGenerateContent
      .mockRejectedValueOnce(make503())
      .mockResolvedValueOnce({ text: JSON.stringify(answerPayload({ answer: 'Fallback.' })) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.answer).toBe('Fallback.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect((p as any).sleep).not.toHaveBeenCalled();
  });

  // ── L. Language-aware structured response passthrough ─────────────────────

  it('L: clarification response passes through correctly', async () => {
    const p = await buildProvider();
    const payload = {
      type: 'clarification',
      answer: null,
      clarificationQuestion: 'Licence ou Master?',
      clarificationOptions: ['Licence', 'Master'],
      usedSourceIds: [],
    };
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(payload) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('clarification');
    expect(result.clarificationQuestion).toBe('Licence ou Master?');
    expect(result.clarificationOptions).toEqual(['Licence', 'Master']);
  });

  it('L: Darija no_verified_info response passes through correctly', async () => {
    const p = await buildProvider();
    const payload = {
      type: 'no_verified_info',
      answer: "Ma l9itech ma3louma vérifiée 3la hedha fil sources ISSATSO elli 3anna.",
      clarificationQuestion: null,
      clarificationOptions: [],
      usedSourceIds: [],
    };
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(payload) });

    const result = await p.generateStructuredResponse(testMessages);

    expect(result.type).toBe('no_verified_info');
    expect(result.answer).toBe("Ma l9itech ma3louma vérifiée 3la hedha fil sources ISSATSO elli 3anna.");
  });

  it('L: normalises missing clarificationOptions to empty array', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ type: 'answer', answer: 'A.', clarificationQuestion: null, usedSourceIds: ['S1'] }),
    });
    const result = await p.generateStructuredResponse(testMessages);
    expect(result.clarificationOptions).toEqual([]);
  });

  it('L: normalises missing usedSourceIds to empty array', async () => {
    const p = await buildProvider();
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ type: 'no_verified_info', answer: 'No info.', clarificationQuestion: null, clarificationOptions: [] }),
    });
    const result = await p.generateStructuredResponse(testMessages);
    expect(result.usedSourceIds).toEqual([]);
  });
});
