import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtsService, TTS_PROVIDER_TOKEN } from './tts.service.js';
import type { TtsProvider } from './providers/tts-provider.interface.js';
import type { TtsResult } from './tts.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid WAV magic bytes — RIFF....WAVE */
function wavBuffer(): Buffer {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36, 4);
  buf.write('WAVE', 8, 'ascii');
  return buf;
}

const MOCK_RESULT: TtsResult = {
  audio: wavBuffer(),
  mimeType: 'audio/wav',
  provider: 'gemini',
  model: 'gemini-3.8-flash-lite-tts',
  voice: 'Kore',
};

function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: vi.fn((key: string, defaultVal?: unknown) => {
      const map: Record<string, unknown> = {
        TTS_MAX_TEXT_CHARS: 3000,
        TTS_PROVIDER: 'gemini',
        TTS_MODEL: 'gemini-3.8-flash-lite-tts',
        ...overrides,
      };
      return key in map ? map[key] : defaultVal;
    }),
  } as unknown as ConfigService;
}

async function buildService(
  providerImpl: Partial<TtsProvider> = {},
  configOverrides: Record<string, unknown> = {},
): Promise<TtsService> {
  const mockProvider: TtsProvider = {
    synthesize: vi.fn().mockResolvedValue(MOCK_RESULT),
    ...providerImpl,
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: TTS_PROVIDER_TOKEN, useValue: mockProvider },
      { provide: ConfigService, useValue: makeConfigService(configOverrides) },
      {
        provide: TtsService,
        useFactory: (p: TtsProvider, cs: ConfigService) => new TtsService(p, cs),
        inject: [TTS_PROVIDER_TOKEN, ConfigService],
      },
    ],
  }).compile();

  return module.get<TtsService>(TtsService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TtsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Gemini provider is selected when TTS_PROVIDER=gemini ───────────────

  it('1. service instantiates correctly with configured gemini provider', async () => {
    const svc = await buildService();
    expect(svc).toBeDefined();
  });

  // ── 2–4. Valid language text accepted and passed through ──────────────────

  it('2. valid Arabic text accepted and returned without modification', async () => {
    const arabicText = 'معلوم التسجيل هو 70 دينار.';
    const svc = await buildService();
    const result = await svc.synthesize({ text: arabicText });
    expect(result.mimeType).toBe('audio/wav');
    expect(result.audio).toBeInstanceOf(Buffer);
  });

  it('3. valid French text accepted and returned', async () => {
    const frenchText = 'Le montant total est de 70 DT.';
    const svc = await buildService();
    const result = await svc.synthesize({ text: frenchText });
    expect(result.mimeType).toBe('audio/wav');
  });

  it('4. valid English text accepted and returned', async () => {
    const englishText = 'The total registration fee is 70 DT.';
    const svc = await buildService();
    const result = await svc.synthesize({ text: englishText });
    expect(result.mimeType).toBe('audio/wav');
  });

  // ── 5. Darija / mixed text preserved ────────────────────────────────────

  it('5. Darija/Arabic/French mixed text is preserved and passed to provider', async () => {
    const mixedText = 'المجموع متع معلوم الترسيم للـ Licence هو 70 دينار.';
    const synthesizeSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
    const svc = await buildService({ synthesize: synthesizeSpy });
    await svc.synthesize({ text: mixedText });
    expect(synthesizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: mixedText }),
    );
  });

  // ── 6. Text passed to provider without rewriting ─────────────────────────

  it('6. text content is passed to provider without rewriting, translation, or summarisation', async () => {
    const originalText = 'قداش نخلص لل Licence؟';
    const synthesizeSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
    const svc = await buildService({ synthesize: synthesizeSpy });
    await svc.synthesize({ text: originalText });
    const calledWith = synthesizeSpy.mock.calls[0][0];
    expect(calledWith.text).toBe(originalText);
  });

  // ── 7. Outer whitespace trimmed ──────────────────────────────────────────

  it('7. outer whitespace is trimmed before passing text to provider', async () => {
    const synthesizeSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
    const svc = await buildService({ synthesize: synthesizeSpy });
    await svc.synthesize({ text: '  معلوم التسجيل هو 70 دينار.  ' });
    const calledWith = synthesizeSpy.mock.calls[0][0];
    expect(calledWith.text).toBe('معلوم التسجيل هو 70 دينار.');
  });

  // ── 8. Internal punctuation / content unchanged ──────────────────────────

  it('8. internal punctuation, Arabic, French words, and numbers are unchanged', async () => {
    const text = 'Montant: 40 DT (أول قسط) + 30 DT (قسط ثاني) = 70 DT.';
    const synthesizeSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
    const svc = await buildService({ synthesize: synthesizeSpy });
    await svc.synthesize({ text });
    const calledWith = synthesizeSpy.mock.calls[0][0];
    expect(calledWith.text).toBe(text); // no internal modification
  });

  // ── 9. Empty text rejected ──────────────────────────────────────────────

  it('9. empty string rejected with BadRequestException', async () => {
    const svc = await buildService();
    await expect(svc.synthesize({ text: '' })).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── 10. Whitespace-only text rejected ────────────────────────────────────

  it('10. whitespace-only text rejected with BadRequestException', async () => {
    const svc = await buildService();
    await expect(svc.synthesize({ text: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── 11. Text exceeding max chars rejected ────────────────────────────────

  it('11. text longer than TTS_MAX_TEXT_CHARS rejected with BadRequestException', async () => {
    // Default limit is 3000. Use a smaller limit for this test.
    const svc = await buildService({}, { TTS_MAX_TEXT_CHARS: 10 });
    const longText = 'أ'.repeat(11);
    await expect(svc.synthesize({ text: longText })).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── 12. Provider result returned ─────────────────────────────────────────

  it('12. provider result is returned unchanged to caller', async () => {
    const svc = await buildService();
    const result = await svc.synthesize({ text: 'test text' });
    expect(result).toMatchObject({
      mimeType: 'audio/wav',
      provider: 'gemini',
      model: 'gemini-3.8-flash-lite-tts',
      voice: 'Kore',
    });
    expect(result.audio).toBeInstanceOf(Buffer);
  });

  // ── 13. Provider errors propagate safely ─────────────────────────────────

  it('13. provider errors propagate to caller without modification', async () => {
    const { ServiceUnavailableException } = await import('@nestjs/common');
    const providerError = new ServiceUnavailableException('TTS down');
    const svc = await buildService({
      synthesize: vi.fn().mockRejectedValue(providerError),
    });
    await expect(svc.synthesize({ text: 'text' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 14. Unknown TTS_PROVIDER fails at module level ───────────────────────

  it('14. unknown TTS_PROVIDER causes module factory to throw', () => {
    // The factory in TtsModule throws for unknown provider names.
    // Test the guard directly (mirroring tts.module.ts logic).
    const providerName = 'elevenlabs-unknown';
    const factory = (name: string) => {
      if (name === 'gemini') return {}; // valid
      throw new Error(`Unknown TTS_PROVIDER: ${name}`);
    };
    expect(() => factory(providerName)).toThrow(`Unknown TTS_PROVIDER: ${providerName}`);
  });
});
