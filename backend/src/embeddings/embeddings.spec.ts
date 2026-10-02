import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingService } from './embedding.service.js';
import { MockEmbeddingProvider } from './providers/mock.embedding-provider.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

// ── Custom controllable mock provider ────────────────────────────────────────
// Matches the production BGE-M3 shape: 1024 dimensions.

class ControllableMockProvider implements EmbeddingProvider {
  public failWith: Error | null = null;
  public returnWrongCount = false;
  public returnWrongDim = false;
  public returnNaN = false;
  public returnInfinity = false;
  public callCount = 0;

  /** Matches production: Ollama / bge-m3 / 1024 dims */
  getProviderName() { return 'mock'; }
  getModelName() { return 'mock-bge-m3-1024'; }
  getDimensions() { return 1024; }

  async embedText(text: string): Promise<number[]> {
    return (await this.embedTexts([text]))[0];
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    this.callCount++;
    if (this.failWith) throw this.failWith;
    if (this.returnWrongCount) return [[0.1]]; // returns only 1 item regardless
    return texts.map((t, i) => {
      const vec = new Array(this.returnWrongDim ? 512 : 1024).fill(0);
      vec[0] = i + 1;
      if (this.returnNaN) vec[1] = NaN;
      if (this.returnInfinity) vec[2] = Infinity;
      return vec;
    });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let provider: ControllableMockProvider;

  beforeEach(async () => {
    provider = new ControllableMockProvider();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: 'EMBEDDING_PROVIDER', useValue: provider },
        EmbeddingService,
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    provider.callCount = 0;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Provider abstraction ────────────────────────────────────────────────────

  it('should delegate getProviderName to the injected provider', () => {
    expect(service.getProviderName()).toBe('mock');
  });

  it('should delegate getModelName to the injected provider', () => {
    expect(service.getModelName()).toBe('mock-bge-m3-1024');
  });

  it('should delegate getDimensions to the injected provider', () => {
    expect(service.getDimensions()).toBe(1024);
  });

  // ── Single text embedding ───────────────────────────────────────────────────

  it('should embed a single text and return a 1024-dim vector (BGE-M3 shape)', async () => {
    const vec = await service.embedText('Hello world');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(1024);
  });

  // ── Batch embedding ─────────────────────────────────────────────────────────

  it('should embed multiple texts and return correct count', async () => {
    const vecs = await service.embedTexts(['a', 'b', 'c']);
    expect(vecs.length).toBe(3);
  });

  it('should preserve input ordering in output', async () => {
    const vecs = await service.embedTexts(['first', 'second', 'third']);
    // Each vec[0] = index+1 in our mock
    expect(vecs[0][0]).toBe(1);
    expect(vecs[1][0]).toBe(2);
    expect(vecs[2][0]).toBe(3);
  });

  // ── Empty input ─────────────────────────────────────────────────────────────

  it('should return empty array for empty input', async () => {
    const vecs = await service.embedTexts([]);
    expect(vecs).toEqual([]);
  });

  // ── Provider error propagation ──────────────────────────────────────────────

  it('should propagate provider API errors', async () => {
    provider.failWith = new Error('EMBEDDING_PROVIDER_ERROR');
    await expect(service.embedText('test')).rejects.toThrow('EMBEDDING_PROVIDER_ERROR');
  });

  it('should propagate rate limit errors', async () => {
    provider.failWith = new Error('EMBEDDING_RATE_LIMITED');
    await expect(service.embedTexts(['x', 'y'])).rejects.toThrow('EMBEDDING_RATE_LIMITED');
  });
});

// ── MockEmbeddingProvider standalone tests ────────────────────────────────────

describe('MockEmbeddingProvider', () => {
  let mockProvider: MockEmbeddingProvider;

  beforeEach(() => {
    mockProvider = new MockEmbeddingProvider();
  });

  it('should return correct dimensions (1024 — matches BGE-M3)', () => {
    expect(mockProvider.getDimensions()).toBe(1024);
  });

  it('should return vectors of correct length (1024)', async () => {
    const vecs = await mockProvider.embedTexts(['hello', 'world']);
    expect(vecs[0].length).toBe(1024);
    expect(vecs[1].length).toBe(1024);
  });

  it('should return empty array for empty input', async () => {
    const vecs = await mockProvider.embedTexts([]);
    expect(vecs).toEqual([]);
  });

  it('embedText should be consistent with embedTexts', async () => {
    const single = await mockProvider.embedText('hello');
    const batch = await mockProvider.embedTexts(['hello']);
    expect(single).toEqual(batch[0]);
  });
});
