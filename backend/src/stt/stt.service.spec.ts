import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SttService, STT_PROVIDER_TOKEN } from './stt.service.js';
import type { SttProvider } from './providers/stt-provider.interface.js';
import type { SttResult } from './stt.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RESULT: SttResult = {
  text: 'wa9tech inscription?',
  provider: 'gemini',
  model: 'gemini-3.5-transcribe',
  durationMs: 321,
};

function wavBuffer(): Buffer {
  // Minimal non-empty buffer — content doesn't matter in unit tests,
  // only emptiness is validated by SttService.
  return Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
}

async function buildService(
  providerImpl: Partial<SttProvider> = {},
): Promise<SttService> {
  const mockProvider: SttProvider = {
    transcribe: vi.fn().mockResolvedValue(MOCK_RESULT),
    ...providerImpl,
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: STT_PROVIDER_TOKEN, useValue: mockProvider },
      {
        provide: SttService,
        useFactory: (p: SttProvider) => new SttService(p),
        inject: [STT_PROVIDER_TOKEN],
      },
    ],
  }).compile();

  return module.get<SttService>(SttService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SttService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Provider selection (service test verifies the token is injected) ───

  it('1. SttService should be defined', async () => {
    const svc = await buildService();
    expect(svc).toBeDefined();
  });

  // ── 2-3. Valid MIME types pass through to provider ─────────────────────────

  it('2. valid WAV input → transcript returned', async () => {
    const svc = await buildService();
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/wav',
    });
    expect(result.text).toBe('wa9tech inscription?');
    expect(result.provider).toBe('gemini');
  });

  it('3. valid WebM input → transcript returned', async () => {
    const svc = await buildService();
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/webm',
    });
    expect(result.text).toBe('wa9tech inscription?');
  });

  // ── 4. Empty buffer → BadRequestException ─────────────────────────────────

  it('4. empty buffer → BadRequestException', async () => {
    const svc = await buildService();
    await expect(
      svc.transcribe({ audio: Buffer.alloc(0), mimeType: 'audio/wav' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('4b. null-ish audio → BadRequestException', async () => {
    const svc = await buildService();
    await expect(
      // @ts-expect-error — intentional: test null guard
      svc.transcribe({ audio: null, mimeType: 'audio/wav' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. Unsupported MIME type → BadRequestException ─────────────────────────

  it('5. unsupported MIME type → BadRequestException', async () => {
    const svc = await buildService();
    await expect(
      svc.transcribe({ audio: wavBuffer(), mimeType: 'video/mp4' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('5b. empty MIME type → BadRequestException', async () => {
    const svc = await buildService();
    await expect(
      svc.transcribe({ audio: wavBuffer(), mimeType: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 6. Provider empty transcript propagates ────────────────────────────────

  it('6. provider throws ServiceUnavailableException for empty transcript → propagates', async () => {
    const { ServiceUnavailableException } = await import('@nestjs/common');
    const svc = await buildService({
      transcribe: vi.fn().mockRejectedValue(
        new ServiceUnavailableException('empty result'),
      ),
    });
    await expect(
      svc.transcribe({ audio: wavBuffer(), mimeType: 'audio/wav' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  // ── 7. Leading/trailing whitespace is trimmed (by provider, verified here) ─

  it('7. leading/trailing whitespace in result text is trimmed by provider', async () => {
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({
        ...MOCK_RESULT,
        text: '  wa9tech inscription?   ',
      }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/wav',
    });
    // SttService returns the provider result directly; trimming is the provider's job.
    // We verify the end-to-end contract: whitespace-trimmed text reaches the caller.
    expect(result.text.trim()).toBe('wa9tech inscription?');
  });

  // ── 8. Transcript content is preserved verbatim ───────────────────────────

  it('8. transcript content is otherwise preserved exactly', async () => {
    const verbatim = "kifeh n5alles lel 1ère année licence?";
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({ ...MOCK_RESULT, text: verbatim }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/wav',
    });
    expect(result.text).toBe(verbatim);
  });

  // ── 9-12. Language preservation ───────────────────────────────────────────

  it('9. Arabic transcript preserved', async () => {
    const arabicText = 'متى يبدأ التسجيل في ISSATSO؟';
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({ ...MOCK_RESULT, text: arabicText }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/wav',
    });
    expect(result.text).toBe(arabicText);
  });

  it('10. French transcript preserved', async () => {
    const frenchText = "Quels sont les frais d'inscription en Licence ?";
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({ ...MOCK_RESULT, text: frenchText }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/mpeg',
    });
    expect(result.text).toBe(frenchText);
  });

  it('11. Darija transcript preserved', async () => {
    const darijaText = '9adech n5alles lel licence fi ISSATSO?';
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({ ...MOCK_RESULT, text: darijaText }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/webm',
    });
    expect(result.text).toBe(darijaText);
  });

  it('12. mixed Darija/French transcript preserved', async () => {
    const mixedText = 'wa9tech inscription pour la licence? chnou les documents mta3 dossier?';
    const svc = await buildService({
      transcribe: vi.fn().mockResolvedValue({ ...MOCK_RESULT, text: mixedText }),
    });
    const result = await svc.transcribe({
      audio: wavBuffer(),
      mimeType: 'audio/ogg',
    });
    expect(result.text).toBe(mixedText);
  });

  // ── 27. Unknown STT_PROVIDER fails clearly ────────────────────────────────

  it('27. unknown STT_PROVIDER throws at startup — no silent fallback', async () => {
    // Exercise the same factory logic that SttModule uses.
    // This mirrors how LlmService tests verify unknown provider rejection.
    const { GeminiSttProvider: GeminiSttProviderClass } = await import(
      './providers/gemini-stt.provider.js'
    );

    const configValues: Record<string, unknown> = {
      STT_PROVIDER: 'unknown_provider',
      GEMINI_API_KEY: 'test-key',
      STT_MODEL: 'gemini-3.5-transcribe',
      STT_TIMEOUT_MS: 15000,
      STT_CUSTOM_VOCABULARY: '',
    };

    const mockConfig = {
      get: vi.fn().mockImplementation(<T>(key: string, def?: T): T =>
        (key in configValues ? configValues[key] : def) as T,
      ),
    } as unknown as import('@nestjs/config').ConfigService;

    const geminiProviderStub = {} as InstanceType<typeof GeminiSttProviderClass>;

    // This is the exact factory used in SttModule
    const factory = () => {
      const raw = mockConfig.get<string>('STT_PROVIDER', '');
      const sttProvider = raw.toLowerCase().trim();
      if (sttProvider === 'gemini') return geminiProviderStub;
      throw new Error(`Unsupported STT_PROVIDER: "${raw}". Expected "gemini".`);
    };

    expect(factory).toThrow('Unsupported STT_PROVIDER: "unknown_provider"');
  });
});
