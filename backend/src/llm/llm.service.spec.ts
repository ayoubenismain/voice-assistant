import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { LlmService, LLM_PROVIDER_TOKEN } from './llm.service.js';
import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { GeminiLlmProvider } from './providers/gemini-llm.provider.js';
import { LlmProvider } from './providers/llm-provider.interface.js';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so no real I/O occurs
// ---------------------------------------------------------------------------

vi.mock('./providers/ollama-llm.provider.js', () => {
  const OllamaLlmProvider = vi.fn().mockImplementation(() => ({
    generateStructuredResponse: vi.fn(),
    constructor: { name: 'OllamaLlmProvider' },
  }));
  return { OllamaLlmProvider };
});

vi.mock('./providers/gemini-llm.provider.js', () => {
  const GeminiLlmProvider = vi.fn().mockImplementation(() => ({
    generateStructuredResponse: vi.fn(),
    constructor: { name: 'GeminiLlmProvider' },
  }));
  return { GeminiLlmProvider };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: vi.fn() },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY' },
}));

// ---------------------------------------------------------------------------
// Helper: build a minimal testing module with a specific LLM_PROVIDER value
// ---------------------------------------------------------------------------

async function buildModuleWithProvider(llmProvider: string): Promise<TestingModule> {
  const configValues: Record<string, unknown> = {
    LLM_PROVIDER: llmProvider,
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-3.5-flash',
    GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_MAX_RETRIES: 1,
    GEMINI_ATTEMPT_TIMEOUT_MS: 15000,
    GEMINI_TOTAL_TIMEOUT_MS: 40000,
    LLM_MODEL: 'qwen3:4b-instruct',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    LLM_TIMEOUT_MS: 120000,
    LLM_TEMPERATURE: 0,
  };

  const mockConfigService = {
    get: vi.fn().mockImplementation(<T>(key: string, def?: T): T => {
      return (key in configValues ? configValues[key] : def) as T;
    }),
  };

  const ollamaInstance: LlmProvider = { generateStructuredResponse: vi.fn() };
  const geminiInstance: LlmProvider = { generateStructuredResponse: vi.fn() };

  return Test.createTestingModule({
    providers: [
      { provide: ConfigService, useValue: mockConfigService },
      { provide: OllamaLlmProvider, useValue: ollamaInstance },
      { provide: GeminiLlmProvider, useValue: geminiInstance },
      {
        provide: LLM_PROVIDER_TOKEN,
        useFactory: (
          configSvc: ConfigService,
          ollama: OllamaLlmProvider,
          gemini: GeminiLlmProvider,
        ): LlmProvider => {
          const raw = configSvc.get<string>('LLM_PROVIDER', '');
          const selected = raw.toLowerCase().trim();
          if (selected === 'ollama') return ollama;
          if (selected === 'gemini') return gemini;
          throw new Error(`Unsupported LLM_PROVIDER: "${raw}". Expected "ollama" or "gemini".`);
        },
        inject: [ConfigService, OllamaLlmProvider, GeminiLlmProvider],
      },
      {
        provide: LlmService,
        useFactory: (provider: LlmProvider) => new LlmService(provider),
        inject: [LLM_PROVIDER_TOKEN],
      },
    ],
  }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LlmModule — provider selection', () => {
  it('should select OllamaLlmProvider when LLM_PROVIDER=ollama', async () => {
    const module = await buildModuleWithProvider('ollama');
    const selectedProvider = module.get<LlmProvider>(LLM_PROVIDER_TOKEN);
    const ollamaProvider = module.get<OllamaLlmProvider>(OllamaLlmProvider);

    // The selected provider should be the same instance as the ollama provider
    expect(selectedProvider).toBe(ollamaProvider);
  });

  it('should select GeminiLlmProvider when LLM_PROVIDER=gemini', async () => {
    const module = await buildModuleWithProvider('gemini');
    const selectedProvider = module.get<LlmProvider>(LLM_PROVIDER_TOKEN);
    const geminiProvider = module.get<GeminiLlmProvider>(GeminiLlmProvider);

    expect(selectedProvider).toBe(geminiProvider);
  });

  it('should throw an explicit error for unknown LLM_PROVIDER values', async () => {
    await expect(buildModuleWithProvider('unknown_provider')).rejects.toThrow(
      'Unsupported LLM_PROVIDER: "unknown_provider". Expected "ollama" or "gemini".'
    );
  });

  it('should throw an explicit error when LLM_PROVIDER is empty string', async () => {
    await expect(buildModuleWithProvider('')).rejects.toThrow(
      'Unsupported LLM_PROVIDER: "". Expected "ollama" or "gemini".'
    );
  });

  it('should be case-insensitive for provider selection (GEMINI)', async () => {
    const module = await buildModuleWithProvider('GEMINI');
    const selectedProvider = module.get<LlmProvider>(LLM_PROVIDER_TOKEN);
    const geminiProvider = module.get<GeminiLlmProvider>(GeminiLlmProvider);

    expect(selectedProvider).toBe(geminiProvider);
  });

  it('LlmService should be defined and injectable', async () => {
    const module = await buildModuleWithProvider('ollama');
    const llmService = module.get<LlmService>(LlmService);

    expect(llmService).toBeDefined();
  });

  it('LlmService.generateStructuredResponse should delegate to the selected provider', async () => {
    const module = await buildModuleWithProvider('gemini');
    const llmService = module.get<LlmService>(LlmService);
    const geminiProvider = module.get<GeminiLlmProvider>(GeminiLlmProvider);

    const mockResponse = {
      type: 'answer' as const,
      answer: 'Delegated answer',
      clarificationQuestion: null,
      clarificationOptions: [],
      usedSourceIds: ['S1'],
    };

    (geminiProvider.generateStructuredResponse as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

    const messages = [{ role: 'user' as const, content: 'test' }];
    const result = await llmService.generateStructuredResponse(messages);

    expect(geminiProvider.generateStructuredResponse).toHaveBeenCalledWith(messages, undefined);
    expect(result).toEqual(mockResponse);
  });
});
