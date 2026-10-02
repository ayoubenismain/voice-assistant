/**
 * OllamaEmbeddingProvider unit tests
 *
 * These tests do NOT require a running Ollama server.
 * All HTTP calls are intercepted using global fetch mocking via vitest.
 *
 * Run: npm test
 */

import { OllamaEmbeddingProvider } from './providers/ollama.embedding-provider.js';
import { InternalServerErrorException } from '@nestjs/common';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIMS = 1024;

function makeVector(seed = 0.1): number[] {
  const v = new Array(DIMS).fill(0);
  v[0] = seed;
  return v;
}

function makeOllamaResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ model: 'bge-m3', embeddings: vectors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function makeConfigService(overrides: Record<string, any> = {}) {
  const config: Record<string, any> = {
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    EMBEDDING_MODEL: 'bge-m3',
    EMBEDDING_DIMENSIONS: 1024,
    ...overrides,
  };
  return {
    get: <T>(key: string): T => config[key] as T,
  } as any;
}

function makeProvider(configOverrides: Record<string, any> = {}): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(makeConfigService(configOverrides));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OllamaEmbeddingProvider', () => {
  let provider: OllamaEmbeddingProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    provider = makeProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  describe('provider metadata', () => {
    it('getProviderName() returns "ollama"', () => {
      expect(provider.getProviderName()).toBe('ollama');
    });

    it('getModelName() returns "bge-m3"', () => {
      expect(provider.getModelName()).toBe('bge-m3');
    });

    it('getDimensions() returns 1024', () => {
      expect(provider.getDimensions()).toBe(1024);
    });
  });

  // ── Empty input ──────────────────────────────────────────────────────────────

  it('returns [] for empty input without calling Ollama', async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return makeOllamaResponse([]); };
    const result = await provider.embedTexts([]);
    expect(result).toEqual([]);
    expect(fetchCalled).toBe(false);
  });

  // ── Successful single embed ───────────────────────────────────────────────

  it('returns a 1024-dim vector for embedText()', async () => {
    global.fetch = async () => makeOllamaResponse([makeVector(0.5)]);
    const vec = await provider.embedText('Frais inscription Licence');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(1024);
    expect(vec[0]).toBeCloseTo(0.5);
  });

  // ── Batching ─────────────────────────────────────────────────────────────

  it('returns N vectors for N inputs (batching)', async () => {
    const inputs = ['text1', 'text2', 'text3'];
    const vectors = inputs.map((_, i) => makeVector(i + 1));
    global.fetch = async () => makeOllamaResponse(vectors);

    const result = await provider.embedTexts(inputs);
    expect(result.length).toBe(3);
  });

  // ── Input/output ordering ────────────────────────────────────────────────

  it('preserves ordering: vector[i] corresponds to input[i]', async () => {
    const inputs = ['alpha', 'beta', 'gamma'];
    const vectors = inputs.map((_, i) => {
      const v = makeVector(0);
      v[0] = i + 10; // distinct sentinel
      return v;
    });
    global.fetch = async () => makeOllamaResponse(vectors);

    const result = await provider.embedTexts(inputs);
    expect(result[0][0]).toBe(10);
    expect(result[1][0]).toBe(11);
    expect(result[2][0]).toBe(12);
  });

  // ── Dimension validation ─────────────────────────────────────────────────

  it('throws EMBEDDING_DIMENSION_MISMATCH if vector has wrong dimensions', async () => {
    const wrongDimVec = new Array(512).fill(0.1); // 512, not 1024
    global.fetch = async () => makeOllamaResponse([wrongDimVec]);

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_DIMENSION_MISMATCH',
    );
  });

  // ── NaN validation ───────────────────────────────────────────────────────

  it('throws EMBEDDING_INVALID_RESPONSE if vector contains NaN', async () => {
    const nanVec = makeVector(0.1);
    nanVec[5] = NaN;
    global.fetch = async () => makeOllamaResponse([nanVec]);

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_INVALID_RESPONSE',
    );
  });

  // ── Infinity validation ───────────────────────────────────────────────────

  it('throws EMBEDDING_INVALID_RESPONSE if vector contains Infinity', async () => {
    const infVec = makeVector(0.1);
    infVec[3] = Infinity;
    global.fetch = async () => makeOllamaResponse([infVec]);

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_INVALID_RESPONSE',
    );
  });

  // ── Count mismatch ──────────────────────────────────────────────────────────

  it('throws EMBEDDING_RESPONSE_COUNT_MISMATCH if Ollama returns fewer vectors than inputs', async () => {
    const inputs = ['a', 'b', 'c']; // 3 inputs
    const tooFew = [makeVector(1), makeVector(2)]; // only 2 returned
    global.fetch = async () => makeOllamaResponse(tooFew);

    await expect(provider.embedTexts(inputs)).rejects.toThrow(
      'EMBEDDING_RESPONSE_COUNT_MISMATCH',
    );
  });

  it('throws EMBEDDING_RESPONSE_COUNT_MISMATCH if Ollama returns more vectors than inputs', async () => {
    const inputs = ['a']; // 1 input
    const tooMany = [makeVector(1), makeVector(2)]; // 2 returned
    global.fetch = async () => makeOllamaResponse(tooMany);

    await expect(provider.embedTexts(inputs)).rejects.toThrow(
      'EMBEDDING_RESPONSE_COUNT_MISMATCH',
    );
  });

  // ── Connection refused (Ollama not running) ──────────────────────────────

  it('throws OLLAMA_UNAVAILABLE when connection is refused (ECONNREFUSED)', async () => {
    global.fetch = async () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'ECONNREFUSED' };
      throw err;
    };

    await expect(provider.embedText('test')).rejects.toThrow('OLLAMA_UNAVAILABLE');
  });

  it('throws OLLAMA_UNAVAILABLE when fetch fails with generic network error', async () => {
    global.fetch = async () => {
      throw new TypeError('ECONNREFUSED 127.0.0.1:11434');
    };

    await expect(provider.embedText('test')).rejects.toThrow('OLLAMA_UNAVAILABLE');
  });

  // ── Model not installed ──────────────────────────────────────────────────

  it('throws EMBEDDING_MODEL_NOT_AVAILABLE when Ollama returns 404', async () => {
    global.fetch = async () =>
      makeErrorResponse(404, '{"error": "model \'bge-m3\' not found, try pulling it first"}');

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_MODEL_NOT_AVAILABLE',
    );
  });

  it('throws EMBEDDING_MODEL_NOT_AVAILABLE when Ollama body says "not found"', async () => {
    global.fetch = async () =>
      makeErrorResponse(500, '{"error": "model not found"}');

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_MODEL_NOT_AVAILABLE',
    );
  });

  // ── Generic provider error ────────────────────────────────────────────────

  it('throws EMBEDDING_PROVIDER_ERROR for non-404 HTTP errors', async () => {
    global.fetch = async () => makeErrorResponse(503, 'Service Unavailable');

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_PROVIDER_ERROR',
    );
  });

  // ── Invalid JSON response ────────────────────────────────────────────────

  it('throws EMBEDDING_INVALID_RESPONSE if Ollama returns non-JSON', async () => {
    global.fetch = async () =>
      new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });

    await expect(provider.embedText('test')).rejects.toThrow(
      'EMBEDDING_INVALID_RESPONSE',
    );
  });

  // ── Stale detection (provider switch) ───────────────────────────────────

  it('embedTexts sends the model name from config to Ollama', async () => {
    let capturedBody: any;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse((opts?.body as string) ?? '{}');
      return makeOllamaResponse([makeVector()]);
    };

    await provider.embedText('hello');
    expect(capturedBody.model).toBe('bge-m3');
    expect(capturedBody.input).toEqual(['hello']);
  });

  // ── 22-chunk batch (real document shape) ────────────────────────────────

  it('correctly handles a batch of 22 inputs (real document size)', async () => {
    const N = 22;
    const inputs = Array.from({ length: N }, (_, i) => `Chunk content ${i}`);
    const vectors = inputs.map((_, i) => {
      const v = makeVector(0);
      v[0] = i;
      return v;
    });
    global.fetch = async () => makeOllamaResponse(vectors);

    const result = await provider.embedTexts(inputs);
    expect(result.length).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(result[i].length).toBe(1024);
      expect(result[i][0]).toBe(i);
    }
  });
});
