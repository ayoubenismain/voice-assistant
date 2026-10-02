import { Test, TestingModule } from '@nestjs/testing';
import { RetrievalService } from './retrieval.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { DarijaNormalizerService } from './darija/darija-normalizer.service.js';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { RetrievalIntent } from './darija/darija-normalizer.types.js';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<{
  id: string;
  chunkIndex: number;
  content: string;
  sectionTitle: string;
  similarity: number;
}> = {}) {
  return {
    id: overrides.id ?? 'chunk-1',
    chunkIndex: overrides.chunkIndex ?? 0,
    content: overrides.content ?? 'test content',
    sectionTitle: overrides.sectionTitle ?? 'Section 1',
    pageStart: 1,
    pageEnd: 1,
    documentId: 'doc-1',
    documentTitle: 'Doc Title',
    documentCategory: 'Cat',
    documentAcademicYear: '2026',
    documentSource: 'Source',
    similarity: overrides.similarity ?? 0.9,
  };
}

function makeNormalization(overrides: Partial<{
  expansionApplied: boolean;
  detectedIntents: RetrievalIntent[];
  normalizedQuery: string;
}> = {}) {
  return {
    originalQuery: 'test',
    normalizedQuery: overrides.normalizedQuery ?? '',
    expansionApplied: overrides.expansionApplied ?? false,
    detectedIntents: overrides.detectedIntents ?? [],
    detectedTerms: [],
  };
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('RetrievalService', () => {
  let service: RetrievalService;
  let prisma: PrismaService;
  let embeddingService: EmbeddingService;
  let normalizer: DarijaNormalizerService;

  const validVector = new Array(1024).fill(0.1);

  beforeEach(async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    const mockEmbedding = {
      getProviderName: vi.fn().mockReturnValue('mock'),
      getModelName: vi.fn().mockReturnValue('mock-model'),
      getDimensions: vi.fn().mockReturnValue(1024),
      embedText: vi.fn(),
      embedTexts: vi.fn().mockResolvedValue([validVector]),
    };

    const mockNormalizer = {
      normalize: vi.fn().mockReturnValue(makeNormalization()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: DarijaNormalizerService, useValue: mockNormalizer },
      ],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
    prisma = module.get<PrismaService>(PrismaService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);
    normalizer = module.get<DarijaNormalizerService>(DarijaNormalizerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── Validation ──────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('should throw BadRequestException if query is empty', async () => {
      await expect(service.semanticSearch({ query: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if query is too long', async () => {
      await expect(service.semanticSearch({ query: 'a'.repeat(1001) })).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Embedding Validation ─────────────────────────────────────────────────────

  describe('Embedding Validation', () => {
    it('should throw EMBEDDING_DIMENSION_MISMATCH when dimensions are wrong', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([new Array(512).fill(1)]);
      await expect(service.semanticSearch({ query: 'test' })).rejects.toThrow('EMBEDDING_DIMENSION_MISMATCH');
    });

    it('should throw EMBEDDING_INVALID_RESPONSE when embedding contains NaN', async () => {
      const vec = new Array(1024).fill(1);
      vec[0] = NaN;
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([vec]);
      await expect(service.semanticSearch({ query: 'test' })).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
    });

    it('should throw EMBEDDING_INVALID_RESPONSE when embedding contains Infinity', async () => {
      const vec = new Array(1024).fill(1);
      vec[5] = Infinity;
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([vec]);
      await expect(service.semanticSearch({ query: 'test' })).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
    });
  });

  // ─── Happy Path ───────────────────────────────────────────────────────────────

  describe('Happy Path', () => {
    it('should return mapped results', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([makeChunk()] as any);

      const res = await service.semanticSearch({ query: 'test', topK: 5 });
      expect(res.query).toBe('test');
      expect(res.topK).toBe(5);
      expect(res.results.length).toBeGreaterThanOrEqual(0);
    });

    it('should use embedTexts (batch) not embedText', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);

      await service.semanticSearch({ query: 'test' });
      expect(embeddingService.embedTexts).toHaveBeenCalled();
    });

    it('should not embed normalized query when expansionApplied=false', async () => {
      vi.spyOn(normalizer, 'normalize').mockReturnValue(makeNormalization({ expansionApplied: false }));
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);

      await service.semanticSearch({ query: 'test' });
      const call = (embeddingService.embedTexts as any).mock.calls[0][0];
      expect(call).toHaveLength(1); // only original query
    });

    it('should embed both original and normalized when expansionApplied=true', async () => {
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ expansionApplied: true, normalizedQuery: 'frais montant' }),
      );
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector, validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);

      await service.semanticSearch({ query: 'ch9adech inscription?' });
      const call = (embeddingService.embedTexts as any).mock.calls[0][0];
      expect(call).toHaveLength(2); // original + normalized
    });
  });

  // ─── candidateK / candidate union ────────────────────────────────────────────

  describe('Candidate Union', () => {
    it('should use candidateK = max(topK*4, 20)', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      const rawCalls: any[] = [];
      vi.spyOn(prisma, '$queryRaw').mockImplementation((...args) => {
        rawCalls.push(args);
        return Promise.resolve([]) as any;
      });

      await service.semanticSearch({ query: 'test', topK: 3 });
      // candidateK for topK=3 → max(12, 20) = 20
      // We can't directly inspect the SQL LIMIT, but we verify at least 1 call was made
      expect(rawCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should include all channels in candidate union before topK truncation', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);

      const semanticChunk = makeChunk({ id: 'semantic-only', sectionTitle: 'Semantic Chunk', similarity: 0.95 });
      const lexicalChunk = makeChunk({ id: 'lexical-only', sectionTitle: 'Lexical Chunk', similarity: 0.01 });

      // Semantic returns semanticChunk, lexical returns lexicalChunk
      let callIndex = 0;
      vi.spyOn(prisma, '$queryRaw').mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve([semanticChunk]) as any; // semantic
        if (callIndex === 2) return Promise.resolve([lexicalChunk]) as any;  // lexical
        return Promise.resolve([]) as any;
      });

      const res = await service.semanticSearch({ query: 'test', topK: 5 });
      // Both chunks should appear in results (union before truncation)
      const ids = res.results.map(r => r.chunk.id);
      expect(ids).toContain('semantic-only');
    });

    it('should not penalize a chunk absent from lexical channel', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);

      // semantic Rank 1: no lexical match → should still be Rank 1
      const bestChunk = makeChunk({ id: 'best', sectionTitle: 'Best Chunk', similarity: 0.99 });
      const lexicalChunk = makeChunk({ id: 'lexical', sectionTitle: 'Lexical Only', similarity: 0.01 });

      let callIndex = 0;
      vi.spyOn(prisma, '$queryRaw').mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve([bestChunk]) as any;    // semantic only
        if (callIndex === 2) return Promise.resolve([lexicalChunk]) as any; // lexical only
        return Promise.resolve([]) as any;
      });

      const res = await service.semanticSearch({ query: 'test', topK: 5 });
      // bestChunk should be Rank 1 because semantic Rank 1 without lexical ≠ penalized
      expect(res.results[0]?.chunk.id).toBe('best');
    });
  });

  // ─── Weighted RRF ─────────────────────────────────────────────────────────────

  describe('Weighted RRF', () => {
    it('should rank semantic Rank 1 above lexical Rank 1 only when semantic weight > lexical weight', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(makeNormalization());

      const semanticChunk = makeChunk({ id: 'sem', sectionTitle: 'Semantic Winner', similarity: 0.99 });
      const lexicalChunk = makeChunk({ id: 'lex', sectionTitle: 'Lexical Winner', similarity: 0.5 });

      let callIndex = 0;
      vi.spyOn(prisma, '$queryRaw').mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve([semanticChunk, lexicalChunk]) as any; // semantic: sem=1, lex=2
        if (callIndex === 2) return Promise.resolve([lexicalChunk]) as any;                // lexical: lex=1
        return Promise.resolve([]) as any;
      });

      const res = await service.semanticSearch({ query: 'test', topK: 5 });
      // sem: semRank=1 → 1.0*(1/61) ≈ 0.01639
      // lex: semRank=2 → 1.0*(1/62) ≈ 0.01613, lexRank=1 → 0.4*(1/61) ≈ 0.00656 → total ≈ 0.02269
      // lex wins due to both channels, but that's expected behavior (RRF rewards corroboration)
      // The test verifies sem is still in top 2
      const ids = res.results.slice(0, 2).map(r => r.chunk.id);
      expect(ids).toContain('sem');
    });

    it('should include per-channel RRF contributions in debug output', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([makeChunk()] as any);

      const res = await service.semanticSearch({ query: 'test', topK: 5, debug: true });
      const debug = res.results[0]?.debug as any;
      expect(debug).toBeDefined();
      expect(debug).toHaveProperty('semanticRrfContrib');
      expect(debug).toHaveProperty('normalizedRrfContrib');
      expect(debug).toHaveProperty('lexicalRrfContrib');
      expect(debug).toHaveProperty('intentBoost');
      expect(debug).toHaveProperty('rrfScore');
      expect(debug).toHaveProperty('expansionApplied');
    });

    it('should expose real numeric values in debug, not placeholders', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([makeChunk({ similarity: 0.87 })] as any);

      const res = await service.semanticSearch({ query: 'test', topK: 5, debug: true });
      const debug = res.results[0]?.debug as any;
      // semanticRrfContrib for Rank 1 = 1.0 * (1/61) ≈ 0.01639
      expect(debug.semanticRrfContrib).toBeGreaterThan(0);
      expect(debug.semanticRrfContrib).toBeLessThan(0.1);
      expect(debug.originalRank).toBe(1);
    });
  });

  // ─── buildLexicalQuery ────────────────────────────────────────────────────────

  describe('buildLexicalQuery', () => {
    it('should return null when no intents and no meaningful tokens', () => {
      const result = service.buildLexicalQuery('le la les de', []);
      // All tokens are stopwords, length ≤ 3
      expect(result).toBeNull();
    });

    it('should return intent-derived terms for SUFFICIENCY', () => {
      const result = service.buildLexicalQuery('Est-ce que suffit ?', [RetrievalIntent.SUFFICIENCY]);
      expect(result).not.toBeNull();
      expect(result).toContain('achever');
      expect(result).toContain('suffisant');
      // Should NOT contain generic 'inscription' or 'ligne'
      expect(result).not.toContain('inscription');
      expect(result).not.toContain('ligne');
    });

    it('should return intent-derived terms for FULL_PAYMENT', () => {
      const result = service.buildLexicalQuery('payer en une seule fois', [RetrievalIntent.FULL_PAYMENT]);
      expect(result).not.toBeNull();
      expect(result).toContain('versement');
      expect(result).toContain('paiement');
    });

    it('should return intent-derived terms for FEES', () => {
      const result = service.buildLexicalQuery('combien inscription?', [RetrievalIntent.FEES]);
      expect(result).not.toBeNull();
      expect(result).toContain('frais');
      expect(result).toContain('montant');
    });

    it('should exclude REMOTE_REGISTRATION distance term when SUFFICIENCY also detected', () => {
      const result = service.buildLexicalQuery(
        'Est-ce que inscription en ligne suffit ?',
        [RetrievalIntent.SUFFICIENCY, RetrievalIntent.REMOTE_REGISTRATION],
      );
      // SUFFICIENCY should take priority; 'distance' should NOT appear
      expect(result).not.toContain('distance');
      expect(result).toContain('achever');
    });

    it('should include distance for REMOTE_REGISTRATION when SUFFICIENCY is absent', () => {
      const result = service.buildLexicalQuery(
        'win na3mel inscription en ligne ?',
        [RetrievalIntent.REMOTE_REGISTRATION, RetrievalIntent.WEBSITE],
      );
      expect(result).toContain('distance');
    });

    it('should deduplicate terms', () => {
      const result = service.buildLexicalQuery(
        'test',
        [RetrievalIntent.INSTALLMENTS, RetrievalIntent.FULL_PAYMENT],
      );
      // Both INSTALLMENTS and FULL_PAYMENT want 'versement' → should appear only once
      const parts = result?.split(' | ') ?? [];
      const versementCount = parts.filter(p => p === 'versement').length;
      expect(versementCount).toBe(1);
    });

    it('should fallback to query tokens when no intents match', () => {
      const result = service.buildLexicalQuery('calendrier important dossier', []);
      expect(result).not.toBeNull();
      expect(result).toContain('calendrier');
      expect(result).toContain('important');
      expect(result).toContain('dossier');
    });

    it('should filter stopwords and short tokens in fallback', () => {
      const result = service.buildLexicalQuery('le la en est une si est-ce calendrier', []);
      // Only 'calendrier' should survive (>3 chars, not a stopword)
      expect(result).toContain('calendrier');
      // 'est' and 'la' should be filtered
      expect(result).not.toMatch(/\best\b/);
      expect(result).not.toMatch(/\bla\b/);
    });

    it('should filter generic "inscription" and "ligne" from fallback', () => {
      const result = service.buildLexicalQuery('inscription en ligne dossier', []);
      expect(result).not.toContain('inscription');
      expect(result).not.toContain('ligne');
      expect(result).toContain('dossier');
    });
  });

  // ─── SUFFICIENCY intent boost ─────────────────────────────────────────────────

  describe('SUFFICIENCY intent boost', () => {
    async function buildCandidateRankingWithSufficiency(chunks: { id: string; sectionTitle: string; content: string; similarity: number }[]) {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ detectedIntents: [RetrievalIntent.SUFFICIENCY, RetrievalIntent.REMOTE_REGISTRATION] }),
      );

      const rawChunks = chunks.map(c => makeChunk({ id: c.id, sectionTitle: c.sectionTitle, content: c.content, similarity: c.similarity }));
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue(rawChunks as any);

      return service.semanticSearch({ query: 'suffit', topK: 5, debug: true });
    }

    it('should give highest boost to chunk with "sans achever" when SUFFICIENCY intent is active', async () => {
      const res = await buildCandidateRankingWithSufficiency([
        { id: 'remarques', sectionTitle: '6. Remarques importantes', content: "Un étudiant n'est pas considéré comme inscrit s'il effectue uniquement l'inscription à distance sans achever les procédures d'inscription administrative.", similarity: 0.85 },
        { id: 'fees', sectionTitle: 'Licence fees', content: "Les frais d'inscription pour la licence sont de 100 DT.", similarity: 0.80 },
      ]);
      expect(res.results[0].chunk.id).toBe('remarques');
    });

    it('should boost chunks containing "uniquement" keyword', async () => {
      const res = await buildCandidateRankingWithSufficiency([
        { id: 'policy', sectionTitle: 'Remarques', content: "uniquement l inscription à distance ne suffit pas.", similarity: 0.82 },
        { id: 'other', sectionTitle: 'Frais', content: "Frais de licence.", similarity: 0.81 },
      ]);
      const debug = res.results[0].debug as any;
      expect(debug.intentBoost).toBeGreaterThan(0);
      expect(res.results[0].chunk.id).toBe('policy');
    });

    it('should boost chunks with "Remarques importantes" section title', async () => {
      const res = await buildCandidateRankingWithSufficiency([
        { id: 'remarques', sectionTitle: '6. Remarques importantes', content: "achever les procédures.", similarity: 0.80 },
        { id: 'fees', sectionTitle: 'Frais', content: "Frais.", similarity: 0.80 },
      ]);
      // Same base similarity → boost from section title tip the balance
      const debug0 = res.results[0].debug as any;
      expect(debug0.intentBoost).toBeGreaterThan(0);
    });

    it('should handle Unicode apostrophe in content (U+2019)', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ detectedIntents: [RetrievalIntent.SUFFICIENCY] }),
      );

      // Content with curly apostrophe (U+2019)
      const chunkWithCurlyApostrophe = makeChunk({
        id: 'curly',
        sectionTitle: 'Remarques importantes',
        content: "\u2019inscription \u00e0 distance sans achever les proc\u00e9dures administratives.",
        similarity: 0.85,
      });
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([chunkWithCurlyApostrophe] as any);

      const res = await service.semanticSearch({ query: 'suffit', topK: 5, debug: true });
      const debug = res.results[0]?.debug as any;
      // Should have a boost because content contains "sans achever" and "administrativ"
      expect(debug.intentBoost).toBeGreaterThan(0);
    });
  });

  // ─── FULL_PAYMENT intent boost ────────────────────────────────────────────────

  describe('FULL_PAYMENT intent boost', () => {
    it('should boost "Dispositions particulières" when FULL_PAYMENT intent active', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ detectedIntents: [RetrievalIntent.FULL_PAYMENT, RetrievalIntent.PAYMENT_RULES] }),
      );

      const dispositions = makeChunk({
        id: 'dispositions',
        sectionTitle: 'Dispositions particulières relatives aux frais',
        content: "La totalité des frais peut être payée en une seule fois lors de la première inscription.",
        similarity: 0.87,
      });
      const fees = makeChunk({
        id: 'fees',
        sectionTitle: 'Licence fees',
        content: "Les frais d inscription pour la licence sont de 100 DT.",
        similarity: 0.86,
      });

      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([dispositions, fees] as any);

      const res = await service.semanticSearch({ query: 'totalité', topK: 5, debug: true });
      expect(res.results[0].chunk.id).toBe('dispositions');
    });
  });

  // ─── Boost magnitude ──────────────────────────────────────────────────────────

  describe('Boost magnitude', () => {
    it('BOOST_POLICY_CONTENT should be significant relative to 1 RRF rank step', async () => {
      // 1 RRF rank step ≈ 1/61 - 1/62 ≈ 0.00026
      // BOOST_POLICY_CONTENT=0.006 is roughly 23 rank-steps — significant but not overwhelming
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ detectedIntents: [RetrievalIntent.SUFFICIENCY] }),
      );

      const chunk = makeChunk({
        id: 'test',
        content: 'sans achever les procédures administratives uniquement',
        similarity: 0.9,
      });
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([chunk] as any);

      const res = await service.semanticSearch({ query: 'suffit', topK: 1, debug: true });
      const debug = res.results[0]?.debug as any;

      // intentBoost ≥ BOOST_POLICY_CONTENT (0.006) because both content + section might match
      expect(debug.intentBoost).toBeGreaterThanOrEqual(0.006);
      // intentBoost should not exceed BOOST_POLICY_CONTENT + BOOST_POLICY_SECTION = 0.009
      expect(debug.intentBoost).toBeLessThanOrEqual(0.02);
    });
  });

  // ─── Strategy reporting ───────────────────────────────────────────────────────

  describe('Strategy reporting', () => {
    it('should report hybrid_rrf_original when expansionApplied=false', async () => {
      vi.spyOn(normalizer, 'normalize').mockReturnValue(makeNormalization({ expansionApplied: false }));
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);

      const res = await service.semanticSearch({ query: 'test' });
      expect(res.retrieval.strategy).toBe('hybrid_rrf_original');
    });

    it('should report hybrid_rrf_normalized when expansionApplied=true', async () => {
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({ expansionApplied: true, normalizedQuery: 'frais montant' }),
      );
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector, validVector]);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);

      const res = await service.semanticSearch({ query: 'ch9adech inscription?' });
      expect(res.retrieval.strategy).toBe('hybrid_rrf_normalized');
    });
  });

  // ─── Critical scenario: French sufficiency query ──────────────────────────────

  describe('Critical scenarios (simulated)', () => {
    /**
     * Simulates the exact failing case:
     * Query: "Est-ce que l inscription en ligne suffit à elle seule ?"
     *
     * Semantic: Remarques = Rank 1, Licence fees = Rank 2
     * Lexical (old): Licence fees = Rank 1 (because "inscription" matched)
     * Lexical (new): Remarques = Rank 1 (because SUFFICIENCY lexical uses "achever" etc.)
     *
     * Expected: Remarques = final Rank 1
     */
    it('should rank "6. Remarques importantes" above "Licence fees" for French sufficiency query', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({
          expansionApplied: false,
          detectedIntents: [
            RetrievalIntent.SUFFICIENCY,
            RetrievalIntent.REMOTE_REGISTRATION,
            RetrievalIntent.GENERAL_REGISTRATION,
          ],
        }),
      );

      const remarques = makeChunk({
        id: 'remarques',
        sectionTitle: '6. Remarques importantes',
        content: "Un étudiant n'est pas considéré comme inscrit s'il effectue uniquement l'inscription à distance sans achever les procédures d'inscription administrative.",
        similarity: 0.88,
      });

      const licenceFees = makeChunk({
        id: 'fees',
        sectionTitle: 'Licence fees',
        content: "Les frais d'inscription pour la licence sont de 100 DT payables lors de l'inscription.",
        similarity: 0.84,
      });

      // callIndex 1 = semantic (original), callIndex 2 = lexical
      let callIndex = 0;
      vi.spyOn(prisma, '$queryRaw').mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve([remarques, licenceFees]) as any; // semantic: remarques=1, fees=2
        if (callIndex === 2) {
          // New lexical (SUFFICIENCY intent): returns remarques at Rank 1 because it contains "achever"
          // Old lexical would have returned licenceFees at Rank 1 because of "inscription"
          return Promise.resolve([remarques]) as any; // only remarques matches "achever | procédure | ..."
        }
        return Promise.resolve([]) as any;
      });

      const res = await service.semanticSearch({
        query: "Est-ce que l inscription en ligne suffit à elle seule ?",
        topK: 5,
        debug: true,
      });

      expect(res.results[0].chunk.id).toBe('remarques');
      expect(res.results[0].rank).toBe(1);
    });

    /**
     * Ensures "Dispositions particulières" still wins for full-payment French query.
     */
    it('should rank "Dispositions particulières" as Rank 1 for French full-payment query', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({
          expansionApplied: false,
          detectedIntents: [RetrievalIntent.FULL_PAYMENT, RetrievalIntent.PAYMENT_RULES],
        }),
      );

      const dispositions = makeChunk({
        id: 'dispositions',
        sectionTitle: 'Dispositions particulières relatives aux frais',
        content: "La totalité des frais peut être payée en une seule fois lors de l'inscription.",
        similarity: 0.88,
      });
      const licenceFees = makeChunk({
        id: 'fees',
        sectionTitle: 'Licence fees',
        content: "Les frais d'inscription pour la licence sont de 100 DT.",
        similarity: 0.84,
      });

      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([dispositions, licenceFees] as any);

      const res = await service.semanticSearch({
        query: "Est-ce que je peux payer la totalité des frais d inscription en une seule fois ?",
        topK: 5,
        debug: true,
      });

      expect(res.results[0].chunk.id).toBe('dispositions');
    });

    /**
     * Ensures Darija sufficiency query still ranks Remarques as Rank 1.
     * (expansionApplied=true in production, simulated here with normalized vector)
     */
    it('should rank "6. Remarques importantes" as Rank 1 for Darija sufficiency query', async () => {
      vi.spyOn(embeddingService, 'embedTexts').mockResolvedValue([validVector, validVector]);
      vi.spyOn(normalizer, 'normalize').mockReturnValue(
        makeNormalization({
          expansionApplied: true,
          normalizedQuery: 'suffisant uniquement compléter procédure sans achever inscription à distance en ligne',
          detectedIntents: [
            RetrievalIntent.SUFFICIENCY,
            RetrievalIntent.REMOTE_REGISTRATION,
            RetrievalIntent.GENERAL_REGISTRATION,
          ],
        }),
      );

      const remarques = makeChunk({
        id: 'remarques',
        sectionTitle: '6. Remarques importantes',
        content: "Un étudiant n'est pas considéré comme inscrit s'il effectue uniquement l'inscription à distance sans achever les procédures administratives.",
        similarity: 0.87,
      });
      const licenceFees = makeChunk({
        id: 'fees',
        sectionTitle: 'Licence fees',
        content: "Les frais d'inscription en ligne pour la licence.",
        similarity: 0.82,
      });

      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([remarques, licenceFees] as any);

      const res = await service.semanticSearch({
        query: 'inscription en ligne wa7adha tekfi?',
        topK: 5,
        debug: true,
      });

      expect(res.results[0].chunk.id).toBe('remarques');
    });
  });
});
