import { DocumentEmbeddingService } from './document-embedding.service.js';
import { EmbeddingService } from './embedding.service.js';
import { MockEmbeddingProvider } from './providers/mock.embedding-provider.js';
import { NotFoundException } from '@nestjs/common';

// ── Stub PrismaService ────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<any> = {}, index = 0) {
  return {
    id: `chunk-${index}`,
    chunkIndex: index,
    content: `Content of chunk ${index}`,
    contentHash: `hash-${index}`,
    sectionTitle: `Section ${index}`,
    pageStart: 1,
    pageEnd: 1,
    embeddingModel: null,
    embeddingProvider: null,
    embeddedContentHash: null,
    embeddedAt: null,
    ...overrides,
  };
}

function makeDocument(chunks: any[] = []) {
  return {
    id: 'doc-001',
    title: 'ISSATSO Inscription 2026-2027',
    category: 'Inscription',
    academicYear: '2026-2027',
    department: null,
    source: 'ISSATSO',
    chunks,
  };
}

class MockPrismaService {
  private _document: any;

  setDocument(doc: any) { this._document = doc; }

  document = {
    findUnique: async ({ include }: any) => this._document,
  };

  capturedUpdates: Array<{ id: string; args: any }> = [];
  
  async $transaction(fn: (tx: any) => Promise<any>) {
    const fakeTx = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
        // Extract the chunk ID from the values
        const id = values[values.length - 1];
        this.capturedUpdates.push({ id, args: values });
        return 1;
      }
    };
    return fn(fakeTx);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DocumentEmbeddingService', () => {
  let service: DocumentEmbeddingService;
  let prisma: MockPrismaService;
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    prisma = new MockPrismaService();
    const mockProvider = new MockEmbeddingProvider();
    embeddingService = new EmbeddingService(mockProvider as any);
    service = new DocumentEmbeddingService(prisma as any, embeddingService);
  });

  // ── buildEmbeddingText ──────────────────────────────────────────────────────

  describe('buildEmbeddingText', () => {
    it('should include document title', () => {
      const text = service.buildEmbeddingText(
        { content: 'test content', sectionTitle: null },
        { title: 'ISSATSO Inscription', category: null, academicYear: null }
      );
      expect(text).toContain('ISSATSO Inscription');
    });

    it('should include section title when present', () => {
      const text = service.buildEmbeddingText(
        { content: 'frais : 70 DT', sectionTitle: 'Licence' },
        { title: 'Doc', category: 'Inscription', academicYear: '2026-2027' }
      );
      expect(text).toContain('Section: Licence');
      expect(text).toContain('frais : 70 DT');
    });

    it('should include category and academic year', () => {
      const text = service.buildEmbeddingText(
        { content: 'content', sectionTitle: null },
        { title: 'Doc', category: 'Inscription', academicYear: '2026-2027' }
      );
      expect(text).toContain('Category: Inscription');
      expect(text).toContain('Academic Year: 2026-2027');
    });

    it('should be deterministic', () => {
      const chunk = { content: 'same content', sectionTitle: 'Same Section' };
      const doc = { title: 'Same Doc', category: 'Cat', academicYear: '2026' };
      const text1 = service.buildEmbeddingText(chunk, doc);
      const text2 = service.buildEmbeddingText(chunk, doc);
      expect(text1).toBe(text2);
    });

    it('should NOT include UUID, timestamps, hash values, or file paths', () => {
      const text = service.buildEmbeddingText(
        { content: 'content', sectionTitle: 'Section A', id: 'some-uuid', contentHash: 'abc123', createdAt: new Date() },
        { title: 'Doc', category: 'Cat', academicYear: '2026', storagePath: '/local/path/file.pdf' }
      );
      expect(text).not.toContain('some-uuid');
      expect(text).not.toContain('abc123');
      expect(text).not.toContain('/local/path');
    });
  });

  // ── embedDocument ───────────────────────────────────────────────────────────

  describe('embedDocument', () => {
    it('should throw NotFoundException for missing document', async () => {
      prisma.setDocument(null);
      await expect(service.embedDocument('missing-id')).rejects.toThrow('not found');
    });

    it('should throw DOCUMENT_HAS_NO_CHUNKS for empty document', async () => {
      prisma.setDocument(makeDocument([]));
      await expect(service.embedDocument('doc-001')).rejects.toThrow('DOCUMENT_HAS_NO_CHUNKS');
    });

    it('should embed all chunks on first run (missing embeddings)', async () => {
      const chunks = [makeChunk({}, 0), makeChunk({}, 1), makeChunk({}, 2)];
      prisma.setDocument(makeDocument(chunks));

      const result = await service.embedDocument('doc-001');
      expect(result.embedded).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.totalChunks).toBe(3);
    });

    it('should skip all chunks on second run (unchanged hashes, same provider+model)', async () => {
      const model = embeddingService.getModelName();
      const provider = embeddingService.getProviderName();
      const chunks = [
        makeChunk({ embeddingModel: model, embeddingProvider: provider, embeddedContentHash: 'hash-0' }, 0),
        makeChunk({ embeddingModel: model, embeddingProvider: provider, embeddedContentHash: 'hash-1' }, 1),
      ];
      prisma.setDocument(makeDocument(chunks));

      const result = await service.embedDocument('doc-001');
      expect(result.embedded).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('should re-embed when contentHash changed (stale embedding)', async () => {
      const model = embeddingService.getModelName();
      const provider = embeddingService.getProviderName();
      const chunks = [
        // Stale: embeddedContentHash differs from current contentHash
        makeChunk({
          embeddingModel: model,
          embeddingProvider: provider,
          embeddedContentHash: 'OLD-hash',
          contentHash: 'hash-0',
        }, 0),
      ];
      prisma.setDocument(makeDocument(chunks));

      const result = await service.embedDocument('doc-001');
      expect(result.embedded).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should re-embed when model changed (e.g., mock → bge-m3)', async () => {
      const provider = embeddingService.getProviderName();
      const chunks = [
        makeChunk({
          embeddingModel: 'old-model',
          embeddingProvider: provider,
          embeddedContentHash: 'hash-0',
        }, 0),
      ];
      prisma.setDocument(makeDocument(chunks));

      const result = await service.embedDocument('doc-001');
      expect(result.embedded).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should re-embed when provider changed (e.g., openai → ollama)', async () => {
      const model = embeddingService.getModelName();
      const chunks = [
        makeChunk({
          embeddingModel: model,
          embeddingProvider: 'openai',          // old provider
          embeddedContentHash: 'hash-0',
        }, 0),
      ];
      prisma.setDocument(makeDocument(chunks));

      const result = await service.embedDocument('doc-001');
      expect(result.embedded).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should return correct provider/model/dimensions in result (mock mirrors BGE-M3 shape)', async () => {
      prisma.setDocument(makeDocument([makeChunk({}, 0)]));
      const result = await service.embedDocument('doc-001');
      expect(result.provider).toBe('mock');
      expect(result.model).toBe('mock-bge-m3-1024');
      expect(result.dimensions).toBe(1024);
    });

    it('should return dimensions=1024 in result (BGE-M3 shape)', async () => {
      prisma.setDocument(makeDocument([makeChunk({}, 0)]));
      const result = await service.embedDocument('doc-001');
      expect(result.dimensions).toBe(1024);
    });
  });

  // ── getEmbeddingStatus ──────────────────────────────────────────────────────

  describe('getEmbeddingStatus', () => {
    it('should throw NotFoundException for missing document', async () => {
      prisma.setDocument(null);
      await expect(service.getEmbeddingStatus('missing')).rejects.toThrow('not found');
    });

    it('should report all missing when none embedded', async () => {
      const chunks = [makeChunk({}, 0), makeChunk({}, 1)];
      prisma.setDocument(makeDocument(chunks));

      const status = await service.getEmbeddingStatus('doc-001');
      expect(status.totalChunks).toBe(2);
      expect(status.missingEmbeddings).toBe(2);
      expect(status.embeddedChunks).toBe(0);
      expect(status.staleEmbeddings).toBe(0);
    });

    it('should report all embedded when all current', async () => {
      const model = embeddingService.getModelName();
      const prov = embeddingService.getProviderName();
      const chunks = [
        makeChunk({ embeddingModel: model, embeddingProvider: prov, embeddedContentHash: 'hash-0' }, 0),
        makeChunk({ embeddingModel: model, embeddingProvider: prov, embeddedContentHash: 'hash-1' }, 1),
      ];
      prisma.setDocument(makeDocument(chunks));

      const status = await service.getEmbeddingStatus('doc-001');
      expect(status.embeddedChunks).toBe(2);
      expect(status.missingEmbeddings).toBe(0);
      expect(status.staleEmbeddings).toBe(0);
    });

    it('should detect stale embeddings', async () => {
      const model = embeddingService.getModelName();
      const prov = embeddingService.getProviderName();
      const chunks = [
        // Current
        makeChunk({ embeddingModel: model, embeddingProvider: prov, embeddedContentHash: 'hash-0' }, 0),
        // Stale (hash changed)
        makeChunk({ embeddingModel: model, embeddingProvider: prov, embeddedContentHash: 'OLD-hash', contentHash: 'hash-1' }, 1),
      ];
      prisma.setDocument(makeDocument(chunks));

      const status = await service.getEmbeddingStatus('doc-001');
      expect(status.embeddedChunks).toBe(1);
      expect(status.staleEmbeddings).toBe(1);
      expect(status.missingEmbeddings).toBe(0);
    });

    it('should report dimensions=1024', async () => {
      prisma.setDocument(makeDocument([makeChunk({}, 0)]));
      const status = await service.getEmbeddingStatus('doc-001');
      expect(status.dimensions).toBe(1024);
    });
  });
});
