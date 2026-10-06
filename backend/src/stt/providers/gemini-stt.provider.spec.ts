import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GeminiSttProvider } from './gemini-stt.provider.js';

// ---------------------------------------------------------------------------
// Mock @google/genai — GoogleGenAI must be newable
// ---------------------------------------------------------------------------

const mockInteractionsCreate = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    interactions = { create: mockInteractionsCreate };
    constructor(_opts: unknown) {}
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
  };
});

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Record<string, unknown> = {
  GEMINI_API_KEY: 'test-api-key',
  STT_MODEL: 'gemini-3.5-transcribe',
  STT_TIMEOUT_MS: 15000,
  STT_CUSTOM_VOCABULARY:
    'ISSATSO,PFE,rattrapage,Licence,Master,cycle préparatoire,cycle ingénieur,inscription,Sousse,stage,CIVP',
};

function buildConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...DEFAULT_CONFIG, ...overrides };
  return {
    get: vi.fn().mockImplementation(<T>(key: string, def?: T): T =>
      (key in values ? values[key] : def) as T,
    ),
  } as unknown as ConfigService;
}

async function buildProvider(
  configOverrides: Record<string, unknown> = {},
): Promise<GeminiSttProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GeminiSttProvider,
      { provide: ConfigService, useValue: buildConfigService(configOverrides) },
    ],
  }).compile();

  const p = module.get<GeminiSttProvider>(GeminiSttProvider);
  return p;
}

// ---------------------------------------------------------------------------
// Audio factories
// ---------------------------------------------------------------------------

function wavBuffer(): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]); // "RIFF\0\0"
}

function webmBuffer(): Buffer {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // WebM EBML header
}

// Error factories
const make400 = () =>
  new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"invalid audio"}}');
const make401 = () =>
  new Error('{"error":{"code":401,"status":"UNAUTHENTICATED","message":"API_KEY is invalid"}}');
const make403 = () =>
  new Error('{"error":{"code":403,"status":"PERMISSION_DENIED","message":"permission denied"}}');
const make429 = () =>
  new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota exceeded"}}');
const make503 = () =>
  new Error('{"error":{"code":503,"message":"High demand","status":"UNAVAILABLE"}}');
const makeNetwork = () => new Error('fetch failed: ECONNREFUSED');

/** A promise that never resolves (hung SDK call). Pre-attach .catch() to avoid
 *  Vitest unhandled-rejection false positives when the deadline abandons it. */
const makeHangingCall = () => {
  const p: Promise<never> = new Promise(() => {});
  (p as Promise<unknown>).catch(() => {});
  return p;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeminiSttProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Model name ─────────────────────────────────────────────────────────────

  it('1. Gemini request uses model=gemini-3.5-transcribe', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'wa9tech inscription?' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.5-transcribe');
  });

  // ── Automatic language detection ──────────────────────────────────────────

  it('2. automatic language detection: languageCodes is empty array (not a list of codes)', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(tConfig).toBeDefined();
    // Empty language_codes = auto-detect per SDK docs
    expect(tConfig.language_codes).toEqual([]);
  });

  // ── Verbatim mode ─────────────────────────────────────────────────────────

  it('3. verbatim mode is configured ({ type: "verbatim" })', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(tConfig.mode).toEqual({ type: 'verbatim' });
  });

  // ── Custom vocabulary ─────────────────────────────────────────────────────

  it('4. custom vocabulary is included in transcription_config', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'ISSATSO inscription' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(Array.isArray(tConfig.custom_vocabulary)).toBe(true);
    expect(tConfig.custom_vocabulary).toContain('ISSATSO');
    expect(tConfig.custom_vocabulary).toContain('PFE');
    expect(tConfig.custom_vocabulary).toContain('rattrapage');
    expect(tConfig.custom_vocabulary).toContain('Licence');
  });

  it('4b. empty STT_CUSTOM_VOCABULARY → custom_vocabulary is undefined', async () => {
    const p = await buildProvider({ STT_CUSTOM_VOCABULARY: '' });
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(tConfig.custom_vocabulary).toBeUndefined();
  });

  // ── Diarization NOT enabled ───────────────────────────────────────────────

  it('5. diarization is NOT enabled', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(tConfig.diarization_mode).toBeUndefined();
  });

  // ── Word timestamps NOT enabled ───────────────────────────────────────────

  it('6. word timestamps are NOT enabled', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const tConfig = call.generation_config.transcription_config;
    expect(tConfig.timestamp_granularities).toBeUndefined();
  });

  // ── Audio passed as inline data ───────────────────────────────────────────

  it('7. audio is passed inline via input.data', async () => {
    const p = await buildProvider();
    const testBuffer = Buffer.from('test-audio-bytes');
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: testBuffer, mimeType: 'audio/wav' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    const input = call.input;
    expect(input.type).toBe('audio');
    expect(input.mime_type).toBe('audio/wav');
    expect(input.data).toBe(testBuffer.toString('base64'));
    expect(input.uri).toBeUndefined();
  });

  // ── AbortSignal is passed to SDK ──────────────────────────────────────────

  it('8. abortSignal is passed to SDK call via fetchOptions', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const options = mockInteractionsCreate.mock.calls[0][1];
    expect(options.fetchOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  // ── SDK internal retry is disabled ────────────────────────────────────────

  it('9. SDK internal retry is disabled (maxRetries=0)', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'hello' });

    await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    const options = mockInteractionsCreate.mock.calls[0][1];
    expect(options.maxRetries).toBe(0);
  });

  // ── Successful transcription returns correct result ────────────────────────

  it('10. successful transcription: returns SttResult with correct fields', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: '  wa9tech inscription?  ' });

    const result = await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    expect(result.text).toBe('wa9tech inscription?'); // trimmed
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.5-transcribe');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('11. 400 error → BadRequestException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(make400());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('12. 401 error → UnauthorizedException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(make401());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('13. 403 error → UnauthorizedException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(make403());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('14. 429 rate limit → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(make429());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('15. 503 → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(make503());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('16. network failure → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockRejectedValueOnce(makeNetwork());

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  // ── Timeout: hanging SDK call cannot exceed STT_TIMEOUT_MS ───────────────

  it('17. hanging SDK call → ServiceUnavailableException at STT_TIMEOUT_MS', async () => {
    const TIMEOUT_MS = 400;
    const p = await buildProvider({ STT_TIMEOUT_MS: TIMEOUT_MS });
    mockInteractionsCreate.mockImplementation(makeHangingCall);

    const resultPromise = p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });

    // Attach rejection handler BEFORE advancing timers (prevents unhandled rejection).
    const assertion = expect(resultPromise).rejects.toThrow(ServiceUnavailableException);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 50);

    await assertion;
  });

  it('18. timeout message is safe (does not expose API key)', async () => {
    const TIMEOUT_MS = 300;
    const p = await buildProvider({ STT_TIMEOUT_MS: TIMEOUT_MS });
    mockInteractionsCreate.mockImplementation(makeHangingCall);

    const resultPromise = p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });
    const assertion = expect(resultPromise).rejects.toThrow(/timed out|unavailable/i);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 50);
    await assertion;
  });

  // ── API key never appears in thrown error ──────────────────────────────────

  it('19. API key never appears in thrown public error messages', async () => {
    const p = await buildProvider({ GEMINI_API_KEY: 'super-secret-key-12345' });
    mockInteractionsCreate.mockRejectedValueOnce(make401());

    let thrownMessage = '';
    try {
      await p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' });
    } catch (e: unknown) {
      const err = e as { message?: string };
      thrownMessage = err?.message ?? '';
    }

    expect(thrownMessage).not.toContain('super-secret-key-12345');
    expect(thrownMessage).not.toContain('test-api-key');
  });

  // ── Empty response from provider → ServiceUnavailableException ────────────

  it('20. empty text response → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: '' });

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('21. whitespace-only text response → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: '   ' });

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('22. null text response → ServiceUnavailableException', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: null });

    await expect(
      p.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  // ── WebM input ────────────────────────────────────────────────────────────

  it('23. WebM buffer is passed with correct mimeType', async () => {
    const p = await buildProvider();
    mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'bonjour ISSATSO' });

    await p.transcribe({ audio: webmBuffer(), mimeType: 'audio/webm' });

    const call = mockInteractionsCreate.mock.calls[0][0];
    expect(call.input.mime_type).toBe('audio/webm');
  });
});
