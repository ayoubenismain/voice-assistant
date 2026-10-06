import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiTtsProvider } from './gemini-tts.provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid WAV buffer (44-byte header).
 * Bytes 0–3: "RIFF"
 * Bytes 8–11: "WAVE"
 */
function validWavBuffer(): Buffer {
  const buf = Buffer.alloc(44, 0);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36, 4); // chunk size (file length minus 8)
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // subchunk1 size
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(1, 22);  // mono
  buf.writeUInt32LE(24000, 24); // 24 kHz
  buf.writeUInt32LE(48000, 28); // byte rate
  buf.writeUInt16LE(2, 32);  // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(0, 40);  // data chunk size (empty PCM for test)
  return buf;
}

/** Base64-encode a buffer as the API would return it. */
function toBase64(buf: Buffer): string {
  return buf.toString('base64');
}

/** Build a minimal Gemini generateContent response with inline audio. */
function makeGeminiResponse(audioBase64: string) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: audioBase64,
                mimeType: 'audio/wav',
              },
            },
          ],
        },
      },
    ],
  };
}

/** Build a ConfigService stub. */
function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    GEMINI_API_KEY: 'test-api-key',
    TTS_MODEL: 'gemini-3.8-flash-lite-tts',
    TTS_VOICE: 'Kore',
    TTS_STYLE: 'warm, clear, natural',
    TTS_TIMEOUT_MS: 15000,
    TTS_MAX_TEXT_CHARS: 3000,
    ...overrides,
  };
  return {
    get: vi.fn((key: string, defaultVal?: unknown) =>
      key in defaults ? defaults[key] : defaultVal,
    ),
  } as unknown as ConfigService;
}

/**
 * Build a GeminiTtsProvider with callGeminiSynthesize replaced by a spy.
 * This completely prevents any real HTTP call to the Gemini API.
 */
function buildProvider(
  configOverrides: Record<string, unknown> = {},
  callOverride?: (
    text: string,
    voice: string,
    style: string | undefined,
    signal: AbortSignal,
    elapsed: () => number,
  ) => Promise<any>,
): GeminiTtsProvider {
  const cs = makeConfigService(configOverrides);
  const provider = new GeminiTtsProvider(cs);

  if (callOverride) {
    (provider as any).callGeminiSynthesize = callOverride;
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GeminiTtsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Correct model configured ───────────────────────────────────────────

  it('1. uses configured TTS_MODEL (gemini-3.8-flash-lite-tts)', () => {
    const provider = buildProvider(
      { TTS_MODEL: 'gemini-3.8-flash-lite-tts' },
      async () => ({
        audio: validWavBuffer(),
        mimeType: 'audio/wav' as const,
        provider: 'gemini',
        model: 'gemini-3.8-flash-lite-tts',
        voice: 'Kore',
      }),
    );
    // Access private field to verify
    expect((provider as any).model).toBe('gemini-3.8-flash-lite-tts');
  });

  // ── 2. responseModalities includes AUDIO ────────────────────────────────

  it('2. generateContent call includes responseModalities: [AUDIO]', async () => {
    let capturedConfig: any;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedConfig = params.config;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'test' });
    expect(capturedConfig.responseModalities).toEqual(
      expect.arrayContaining(['AUDIO']),
    );
  });

  // ── 3. Text placed in correct content part ───────────────────────────────

  it('3. text is placed in contents[0].parts[0].text', async () => {
    let capturedContents: any;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedContents = params.contents;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'Hello world' });
    expect(capturedContents[0].parts[0].text).toBe('Hello world');
  });

  // ── 4. speechMetadata.style used when style is set ──────────────────────

  it('4. speechMetadata.style is passed when style is configured', async () => {
    let capturedContents: any;
    const cs = makeConfigService({ TTS_STYLE: 'warm, clear' });
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedContents = params.contents;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'test' });
    expect(capturedContents[0].parts[0].speechMetadata).toBeDefined();
    expect(capturedContents[0].parts[0].speechMetadata.style).toBe('warm, clear');
  });

  // ── 5. Style is NOT inserted into spoken text ────────────────────────────

  it('5. style is NOT prepended or appended to the spoken text', async () => {
    let capturedContents: any;
    const cs = makeConfigService({ TTS_STYLE: 'warm, clear' });
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedContents = params.contents;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'معلوم التسجيل' });
    const text: string = capturedContents[0].parts[0].text;
    expect(text).toBe('معلوم التسجيل');
    expect(text).not.toContain('warm');
    expect(text).not.toContain('clear');
  });

  // ── 6. Configured voice used ─────────────────────────────────────────────

  it('6. configured TTS_VOICE is used in result', async () => {
    const provider = buildProvider(
      { TTS_VOICE: 'Kore' },
      async (_text, voice) => ({
        audio: validWavBuffer(),
        mimeType: 'audio/wav' as const,
        provider: 'gemini',
        model: 'gemini-3.8-flash-lite-tts',
        voice,
      }),
    );
    const result = await provider.synthesize({ text: 'test' });
    expect(result.voice).toBe('Kore');
  });

  // ── 7. speechConfig uses prebuiltVoiceConfig (correct SDK shape) ─────────

  it('7. speechConfig uses prebuiltVoiceConfig.voiceName (installed SDK VoiceConfig shape)', async () => {
    let capturedConfig: any;
    const cs = makeConfigService({ TTS_VOICE: 'Kore' });
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedConfig = params.config;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'test' });
    expect(capturedConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  // ── 8. Language is not forcibly fixed ────────────────────────────────────

  it('8. no languageCode is set in speechConfig (automatic language detection)', async () => {
    let capturedConfig: any;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedConfig = params.config;
          return Promise.resolve(
            makeGeminiResponse(toBase64(validWavBuffer())),
          );
        }),
      },
    };

    await provider.synthesize({ text: 'test' });
    expect(capturedConfig.speechConfig.languageCode).toBeUndefined();
  });

  // ── 9–11. Language-specific texts unchanged ───────────────────────────────

  it('9. Arabic text is unchanged when passed to API', async () => {
    let capturedText: string;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedText = params.contents[0].parts[0].text;
          return Promise.resolve(makeGeminiResponse(toBase64(validWavBuffer())));
        }),
      },
    };

    await provider.synthesize({ text: 'معلوم التسجيل هو 70 دينار.' });
    expect(capturedText!).toBe('معلوم التسجيل هو 70 دينار.');
  });

  it('10. French text is unchanged when passed to API', async () => {
    let capturedText: string;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedText = params.contents[0].parts[0].text;
          return Promise.resolve(makeGeminiResponse(toBase64(validWavBuffer())));
        }),
      },
    };

    await provider.synthesize({ text: 'Le montant total est de 70 DT.' });
    expect(capturedText!).toBe('Le montant total est de 70 DT.');
  });

  it('11. mixed-language (Darija/Arabic/French) text is unchanged', async () => {
    let capturedText: string;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedText = params.contents[0].parts[0].text;
          return Promise.resolve(makeGeminiResponse(toBase64(validWavBuffer())));
        }),
      },
    };

    const mixed = 'المجموع متع معلوم الترسيم للـ Licence هو 70 دينار.';
    await provider.synthesize({ text: mixed });
    expect(capturedText!).toBe(mixed);
  });

  // ── 12. Valid base64 audio decoded to Buffer ──────────────────────────────

  it('12. valid base64 audio is decoded to a Buffer', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue(makeGeminiResponse(toBase64(validWavBuffer()))),
      },
    };

    const result = await provider.synthesize({ text: 'test' });
    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
  });

  // ── 13. Result MIME is audio/wav ─────────────────────────────────────────

  it('13. result.mimeType is audio/wav', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue(makeGeminiResponse(toBase64(validWavBuffer()))),
      },
    };

    const result = await provider.synthesize({ text: 'test' });
    expect(result.mimeType).toBe('audio/wav');
  });

  // ── 14. Valid RIFF/WAVE response accepted ────────────────────────────────

  it('14. valid RIFF/WAVE buffer is accepted and returned', async () => {
    const wav = validWavBuffer();
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');

    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue(makeGeminiResponse(toBase64(wav))),
      },
    };

    const result = await provider.synthesize({ text: 'test' });
    expect(result.audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.audio.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  // ── 15–17. Missing candidate / content / inlineData handled ──────────────

  it('15. missing candidates array throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue({ candidates: undefined }),
      },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('16. missing content in candidate throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue({ candidates: [{ content: undefined }] }),
      },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('17. missing inlineData in part throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'wrong' }] } }],
        }),
      },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 18. Empty data handled ────────────────────────────────────────────────

  it('18. empty inlineData.data throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: '', mimeType: 'audio/wav' } }],
              },
            },
          ],
        }),
      },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 19. Invalid/malformed audio handled ──────────────────────────────────

  it('19. malformed audio (not RIFF/WAVE) throws ServiceUnavailableException', async () => {
    const malformed = Buffer.from('THIS IS NOT A WAV FILE AT ALL!!!!');
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValue(makeGeminiResponse(toBase64(malformed))),
      },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 20–24. HTTP error status codes mapped safely ──────────────────────────

  it('20. 400 API error throws BadRequestException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 });

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('21. 401 API error throws UnauthorizedException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(new Error('UNAUTHENTICATED'), { status: 401 });

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('22. 403 API error throws UnauthorizedException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(new Error('PERMISSION_DENIED'), { status: 403 });

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('23. 429 API error throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('24. 503 API error throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(new Error('UNAVAILABLE'), { status: 503 });

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 25. Network error mapped safely ──────────────────────────────────────

  it('25. network error (fetch failed) throws ServiceUnavailableException', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);
    const err = new Error('fetch failed: network unreachable');

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── 26. Timeout enforced ──────────────────────────────────────────────────

  it('26. timeout fires when synthesis takes too long', async () => {
    const cs = makeConfigService({ TTS_TIMEOUT_MS: 50 });
    const provider = new GeminiTtsProvider(cs);

    // Hang the synthesis call — it will never resolve within 50ms
    (provider as any).callGeminiSynthesize = () =>
      new Promise<never>(() => {/* never resolves */});

    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  }, 2000);

  // ── 27. Hanging SDK call cannot escape total timeout ──────────────────────

  it('27. hanging SDK call is resolved by outer Promise.race deadline', async () => {
    const cs = makeConfigService({ TTS_TIMEOUT_MS: 60 });
    const provider = new GeminiTtsProvider(cs);

    // The underlying callGeminiSynthesize hangs forever
    (provider as any).callGeminiSynthesize = () =>
      new Promise<never>(() => {/* never */});

    const start = Date.now();
    await expect(provider.synthesize({ text: 'test' })).rejects.toThrow(
      ServiceUnavailableException,
    );
    // Should resolve close to the timeout, not hang for minutes
    expect(Date.now() - start).toBeLessThan(2000);
  }, 5000);

  // ── 28. AbortController signal wired ─────────────────────────────────────

  it('28. AbortSignal is passed to callGeminiSynthesize', async () => {
    let capturedSignal: AbortSignal | undefined;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).callGeminiSynthesize = async (
      _text: string,
      _voice: string,
      _style: string | undefined,
      signal: AbortSignal,
    ) => {
      capturedSignal = signal;
      return {
        audio: validWavBuffer(),
        mimeType: 'audio/wav' as const,
        provider: 'gemini',
        model: 'gemini-3.8-flash-lite-tts',
        voice: 'Kore',
      };
    };

    await provider.synthesize({ text: 'test' });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  // ── 29. SDK retries disabled ──────────────────────────────────────────────

  it('29. SDK retries are disabled (httpOptions.retryOptions.attempts = 1)', async () => {
    let capturedConfig: any;
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    (provider as any).client = {
      models: {
        generateContent: vi.fn().mockImplementation((params: any) => {
          capturedConfig = params.config;
          return Promise.resolve(makeGeminiResponse(toBase64(validWavBuffer())));
        }),
      },
    };

    await provider.synthesize({ text: 'test' });
    // attempts: 1 means no retries (0 or 1 both disable retry per SDK docs)
    expect(capturedConfig.httpOptions.retryOptions.attempts).toBe(1);
  });

  // ── 30. API key never leaks in errors ────────────────────────────────────

  it('30. API key is never included in thrown exceptions', async () => {
    const apiKey = 'super-secret-test-api-key-12345';
    const cs = makeConfigService({ GEMINI_API_KEY: apiKey });
    const provider = new GeminiTtsProvider(cs);
    const err = Object.assign(
      new Error(`Authorization failed for key ${apiKey}`),
      { status: 401 },
    );

    (provider as any).client = {
      models: { generateContent: vi.fn().mockRejectedValue(err) },
    };

    let caughtError: Error | undefined;
    try {
      await provider.synthesize({ text: 'test' });
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    // The thrown NestJS exception message must not contain the API key
    const message = JSON.stringify(caughtError?.getResponse?.() ?? caughtError?.message ?? '');
    expect(message).not.toContain(apiKey);
  });

  // ── 31. No real Gemini call occurs ───────────────────────────────────────

  it('31. no real Gemini API call occurs during unit tests (client is mocked)', async () => {
    const cs = makeConfigService();
    const provider = new GeminiTtsProvider(cs);

    const mockGenerate = vi
      .fn()
      .mockResolvedValue(makeGeminiResponse(toBase64(validWavBuffer())));

    (provider as any).client = {
      models: { generateContent: mockGenerate },
    };

    await provider.synthesize({ text: 'test' });

    // The mock was called exactly once — proves we never bypassed it to hit real Gemini
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // The mock is a vi.fn() not a real HTTP client — guaranteed no network call
    expect(mockGenerate).not.toHaveBeenCalledWith(
      expect.objectContaining({ _realNetworkRequest: true }),
    );
  });
});
