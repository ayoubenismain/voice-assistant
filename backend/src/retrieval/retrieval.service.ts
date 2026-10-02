import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { SemanticSearchDto } from './dto/semantic-search.dto.js';
import { RawSemanticSearchRow, SemanticSearchResponse } from './types/retrieval-result.type.js';
import { DarijaNormalizerService } from './darija/darija-normalizer.service.js';
import { RetrievalIntent } from './darija/darija-normalizer.types.js';

// ─── Weighted RRF constants ───────────────────────────────────────────────────
// Semantic channel is the PRIMARY signal; lexical is SUPPORTING.
// k=60 is the standard RRF parameter (Cormack & Croft, 2009).
const RRF_K = 60;
const WEIGHT_SEMANTIC = 1.0;
const WEIGHT_NORMALIZED = 1.0;
const WEIGHT_LEXICAL = 0.4; // Lexical is a supporting signal — intentionally < semantic

// ─── Intent boost magnitudes ──────────────────────────────────────────────────
// Calibrated relative to a typical per-rank RRF contribution ≈ 0.016 (= 1/(60+1)).
// Boosts are additive AFTER fusion and must not overwhelm semantic ordering.
const BOOST_SECTION_MATCH = 0.003;      // generic section-keyword match
const BOOST_POLICY_CONTENT = 0.006;     // policy intent matches content keywords
const BOOST_POLICY_SECTION = 0.003;     // policy intent matches section title

// ─── Stopwords for lexical query construction ─────────────────────────────────
// These produce false positive matches that pollute BM25/ts_rank results.
const LEXICAL_STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'est', 'ce',
  'que', 'qui', 'quoi', 'elle', 'il', 'seule', 'pour', 'par', 'sur',
  'dans', 'en', 'avec', 'et', 'ou', 'ne', 'pas', 'plus', 'si', 'mais',
  'donc', 'or', 'ni', 'car', 'je', 'tu', 'nous', 'vous', 'ils', 'elles',
  'se', 'me', 'te', 'on', 'au', 'aux', 'ai', 'as', 'a', 'y',
  // Generic registration/online terms — too common to be discriminative for nuanced intent queries
  'inscription', 'ligne',
]);

type SearchCandidate = RawSemanticSearchRow & {
  originalSemanticRank?: number;
  normalizedSemanticRank?: number;
  lexicalRank?: number;
  rrfScore?: number;
  rawOrigScore?: number;
  rawNormScore?: number;
  rawLexScore?: number;
  intentBoost?: number;
  rrfOnly?: number;
};

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly normalizer: DarijaNormalizerService,
  ) {}

  async semanticSearch(dto: SemanticSearchDto): Promise<SemanticSearchResponse> {
    const totalStartMs = Date.now();

    // 1. Validation & Normalization
    const query = dto.query?.trim();
    if (!query) throw new BadRequestException('QUERY_REQUIRED');
    if (query.length > 1000) throw new BadRequestException('QUERY_TOO_LONG');

    const topK = dto.topK || 5;
    const isDebug = !!dto.debug;

    const provider = this.embeddingService.getProviderName();
    const model = this.embeddingService.getModelName();
    const dimensions = this.embeddingService.getDimensions();

    const normalized = this.normalizer.normalize(query);
    const useNormalized = normalized.expansionApplied;

    // 2. Query Embedding — only embed normalized when expansion adds meaningful signal
    const embedStartMs = Date.now();
    const textsToEmbed = [query];
    if (useNormalized) {
      textsToEmbed.push(normalized.normalizedQuery);
    }

    let vectors: number[][];
    try {
      vectors = await this.embeddingService.embedTexts(textsToEmbed);
    } catch (error: any) {
      this.logger.error(`Query embedding failed: ${error.message}`);
      throw error;
    }
    const embeddingMs = Date.now() - embedStartMs;

    // Validate generated vectors
    for (const vec of vectors) {
      if (!Array.isArray(vec) || vec.length !== dimensions) {
        throw new InternalServerErrorException('EMBEDDING_DIMENSION_MISMATCH');
      }
      for (const v of vec) {
        if (typeof v !== 'number' || !isFinite(v) || isNaN(v)) {
          throw new InternalServerErrorException('EMBEDDING_INVALID_RESPONSE');
        }
      }
    }

    const originalVector = vectors[0];
    const normalizedVector = useNormalized ? vectors[1] : null;

    // 3. PostgreSQL Database Searches
    const searchStartMs = Date.now();
    // candidateK: retrieve enough candidates so the expected answer is always in the union.
    // With 22 chunks total, candidateK=20 is safe and still leaves room as corpus grows.
    const candidateK = Math.max(topK * 4, 20);

    const originalVecStr = `[${originalVector.join(',')}]`;
    const normalizedVecStr = normalizedVector ? `[${normalizedVector.join(',')}]` : null;

    try {
      // 3A. Semantic Search (Original)
      const originalResults = await this.prisma.$queryRaw<RawSemanticSearchRow[]>`
        SELECT
          c.id, c."chunkIndex", c.content, c."sectionTitle", c."pageStart", c."pageEnd",
          d.id AS "documentId", d.title AS "documentTitle", d.category AS "documentCategory",
          d."academicYear" AS "documentAcademicYear", d.source AS "documentSource",
          (1 - (c.embedding <=> ${originalVecStr}::vector)) AS similarity
        FROM document_chunks c
        JOIN documents d ON c."documentId" = d.id
        WHERE c.embedding IS NOT NULL
          AND c."embeddingProvider" = ${provider}
          AND c."embeddingModel" = ${model}
          AND c."embeddedContentHash" = c."contentHash"
          AND d.status = 'READY'
        ORDER BY c.embedding <=> ${originalVecStr}::vector
        LIMIT ${candidateK};
      `;

      // 3B. Semantic Search (Normalized) — only when Darija/Arabic expansion applied
      let normalizedResults: RawSemanticSearchRow[] = [];
      if (normalizedVecStr) {
        normalizedResults = await this.prisma.$queryRaw<RawSemanticSearchRow[]>`
          SELECT
            c.id, c."chunkIndex", c.content, c."sectionTitle", c."pageStart", c."pageEnd",
            d.id AS "documentId", d.title AS "documentTitle", d.category AS "documentCategory",
            d."academicYear" AS "documentAcademicYear", d.source AS "documentSource",
            (1 - (c.embedding <=> ${normalizedVecStr}::vector)) AS similarity
          FROM document_chunks c
          JOIN documents d ON c."documentId" = d.id
          WHERE c.embedding IS NOT NULL
            AND c."embeddingProvider" = ${provider}
            AND c."embeddingModel" = ${model}
            AND c."embeddedContentHash" = c."contentHash"
            AND d.status = 'READY'
          ORDER BY c.embedding <=> ${normalizedVecStr}::vector
          LIMIT ${candidateK};
        `;
      }

      // 3C. Lexical Search — uses INTENT-AWARE concept terms, NOT normalized query tokens.
      //
      // Key design principle:
      //  - Semantic query = original natural-language query (handled by BGE-M3)
      //  - Lexical query  = deterministic intent-derived concept keywords
      //
      // This separation prevents generic words like "inscription" and "ligne" from
      // flooding the lexical channel and letting unrelated chunks (e.g. "Licence fees")
      // rank high just because they mention registration often.
      const tsQueryStr = this.buildLexicalQuery(query, normalized.detectedIntents);

      let lexicalResults: RawSemanticSearchRow[] = [];
      if (tsQueryStr) {
        lexicalResults = await this.prisma.$queryRaw<RawSemanticSearchRow[]>`
          SELECT
            c.id, c."chunkIndex", c.content, c."sectionTitle", c."pageStart", c."pageEnd",
            d.id AS "documentId", d.title AS "documentTitle", d.category AS "documentCategory",
            d."academicYear" AS "documentAcademicYear", d.source AS "documentSource",
            ts_rank(
              setweight(to_tsvector('french', coalesce(c."sectionTitle", '')), 'A') ||
              setweight(to_tsvector('french', c.content), 'B'),
              to_tsquery('french', ${tsQueryStr})
            ) AS similarity
          FROM document_chunks c
          JOIN documents d ON c."documentId" = d.id
          WHERE d.status = 'READY'
            AND (
              setweight(to_tsvector('french', coalesce(c."sectionTitle", '')), 'A') ||
              setweight(to_tsvector('french', c.content), 'B')
            ) @@ to_tsquery('french', ${tsQueryStr})
          ORDER BY similarity DESC
          LIMIT ${candidateK};
        `;
      }

      // 4. Candidate Union
      //
      // ALL candidates from ALL channels are merged BEFORE any truncation.
      // A chunk absent from one channel receives zero contribution from that channel.
      // It is NEVER penalized for being absent.
      const candidateMap = new Map<string, SearchCandidate>();

      const addCandidates = (
        results: RawSemanticSearchRow[],
        rankType: 'originalSemanticRank' | 'normalizedSemanticRank' | 'lexicalRank',
        scoreType: 'rawOrigScore' | 'rawNormScore' | 'rawLexScore',
      ) => {
        results.forEach((row, index) => {
          if (!candidateMap.has(row.id)) {
            candidateMap.set(row.id, { ...row, similarity: 0 });
          }
          const candidate = candidateMap.get(row.id)!;
          candidate[rankType] = index + 1;
          candidate[scoreType] = Number(row.similarity);

          // Use semantic similarity as the display score (best signal)
          if (rankType === 'originalSemanticRank') {
            candidate.similarity = Number(row.similarity);
          } else if (rankType === 'normalizedSemanticRank' && candidate.rawOrigScore === undefined) {
            candidate.similarity = Number(row.similarity);
          }
        });
      };

      addCandidates(originalResults, 'originalSemanticRank', 'rawOrigScore');
      addCandidates(normalizedResults, 'normalizedSemanticRank', 'rawNormScore');
      addCandidates(lexicalResults, 'lexicalRank', 'rawLexScore');

      // 5. Weighted RRF Fusion + Intent Boosts
      //
      // RRF formula (per channel):  weight * 1 / (k + rank)
      // A missing channel contributes 0 — NOT a penalty.
      // Boosts are additive and calibrated relative to typical RRF score ranges.
      const hasIntent = (_c: SearchCandidate, intent: RetrievalIntent) =>
        normalized.detectedIntents.includes(intent);

      const finalCandidates = Array.from(candidateMap.values());
      finalCandidates.forEach(c => {
        let rrf = 0;
        if (c.originalSemanticRank) rrf += WEIGHT_SEMANTIC * (1.0 / (RRF_K + c.originalSemanticRank));
        if (c.normalizedSemanticRank) rrf += WEIGHT_NORMALIZED * (1.0 / (RRF_K + c.normalizedSemanticRank));
        if (c.lexicalRank) rrf += WEIGHT_LEXICAL * (1.0 / (RRF_K + c.lexicalRank));
        c.rrfOnly = rrf;

        const lowerSection = (c.sectionTitle || '').toLowerCase();
        const lowerContent = normalizeApostrophes((c.content || '').toLowerCase());

        let boost = 0;

        // ── Generic section-intent matching ──────────────────────────────
        if (hasIntent(c, RetrievalIntent.FEES) && lowerSection.includes('frais')) boost += BOOST_SECTION_MATCH;
        if (hasIntent(c, RetrievalIntent.DATES) && (lowerSection.includes('calendrier') || lowerSection.includes('date'))) boost += BOOST_SECTION_MATCH;
        if (hasIntent(c, RetrievalIntent.DOCUMENTS) && lowerSection.includes('pi\u00e8ces')) boost += BOOST_SECTION_MATCH;
        if (hasIntent(c, RetrievalIntent.WEBSITE) && (lowerSection.includes('f') && lowerSection.includes('rences'))) boost += BOOST_SECTION_MATCH;

        // ── SUFFICIENCY: reward chunks that discuss incomplete procedures ─
        // Concept: "online registration alone is NOT enough without completing admin steps"
        // Uses normalizeApostrophes to handle Unicode quote variants.
        if (hasIntent(c, RetrievalIntent.SUFFICIENCY)) {
          const sufficiencyKeywords = [
            'sans achever', 'n est pas consid', 'uniquement', 'seul',
            'suffit', 'suffisant', 'compl', 'proc', 'administrativ',
          ];
          const contentHasSufficiencySignal = sufficiencyKeywords.some(kw => lowerContent.includes(kw));
          const sectionHasSufficiencySignal =
            lowerSection.includes('remarque') || lowerSection.includes('important');
          if (contentHasSufficiencySignal) boost += BOOST_POLICY_CONTENT;
          if (sectionHasSufficiencySignal) boost += BOOST_POLICY_SECTION;
        }

        // ── FULL_PAYMENT: reward chunks discussing single-payment options ─
        if (hasIntent(c, RetrievalIntent.FULL_PAYMENT)) {
          if (
            lowerContent.includes('totalit') ||
            lowerContent.includes('un seul') ||
            lowerContent.includes('int\u00e9gral')
          ) {
            boost += BOOST_POLICY_CONTENT;
          }
          if (lowerSection.includes('disposition')) boost += BOOST_POLICY_SECTION;
        }

        // ── INSTALLMENTS ─────────────────────────────────────────────────
        if (hasIntent(c, RetrievalIntent.INSTALLMENTS)) {
          if (lowerContent.includes('tranche') || lowerContent.includes('versement')) boost += BOOST_POLICY_CONTENT;
        }

        // ── EXEMPTION ─────────────────────────────────────────────────────
        if (hasIntent(c, RetrievalIntent.EXEMPTION)) {
          if (
            lowerContent.includes('boursier') ||
            lowerContent.includes('exon') ||
            lowerContent.includes('pr\u00eat')
          ) {
            boost += BOOST_POLICY_CONTENT;
          }
        }

        // ── REMOTE_REGISTRATION ───────────────────────────────────────────
        // Only a tiny boost, and ONLY when SUFFICIENCY is NOT also detected,
        // to avoid conflating "where is the online registration site?" with
        // "does online registration alone suffice?"
        if (hasIntent(c, RetrievalIntent.REMOTE_REGISTRATION) && !hasIntent(c, RetrievalIntent.SUFFICIENCY)) {
          if (lowerContent.includes('distance')) {
            boost += 0.001;
          }
        }

        c.intentBoost = boost;
        c.rrfScore = rrf + boost;
      });

      // 6. Sort by final fused score, then slice topK
      finalCandidates.sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0));

      // ── Debug logging for sufficiency queries and debug mode ──────────────
      if (isDebug || query.toLowerCase().includes('suffit')) {
        this.logger.debug('=== FUSION DEBUG ===');
        finalCandidates.slice(0, 8).forEach((c, i) => {
          const semContrib = c.originalSemanticRank
            ? WEIGHT_SEMANTIC * (1.0 / (RRF_K + c.originalSemanticRank))
            : 0;
          const normContrib = c.normalizedSemanticRank
            ? WEIGHT_NORMALIZED * (1.0 / (RRF_K + c.normalizedSemanticRank))
            : 0;
          const lexContrib = c.lexicalRank
            ? WEIGHT_LEXICAL * (1.0 / (RRF_K + c.lexicalRank))
            : 0;
          this.logger.debug(
            `[${i + 1}] "${c.sectionTitle}" | ` +
              `semRank=${c.originalSemanticRank ?? '-'} (${semContrib.toFixed(5)}) | ` +
              `normRank=${c.normalizedSemanticRank ?? '-'} (${normContrib.toFixed(5)}) | ` +
              `lexRank=${c.lexicalRank ?? '-'} (${lexContrib.toFixed(5)}) | ` +
              `boost=${(c.intentBoost ?? 0).toFixed(5)} | ` +
              `final=${(c.rrfScore ?? 0).toFixed(6)}`,
          );
        });
      }

      const topCandidates = finalCandidates.slice(0, topK);

      const searchMs = Date.now() - searchStartMs;
      const totalMs = Date.now() - totalStartMs;

      this.logger.log(
        `Hybrid search done in ${totalMs}ms (embed: ${embeddingMs}ms, search: ${searchMs}ms) ` +
          `strategy=${useNormalized ? 'hybrid_rrf_normalized' : 'hybrid_rrf_original'} ` +
          `candidates=${finalCandidates.length} query="${query}"`,
      );

      // 7. Map to structured response
      const results = topCandidates.map((row, index) => {
        let displaySim =
          typeof row.similarity === 'number' ? row.similarity : parseFloat(row.similarity as any);
        if (isNaN(displaySim) || !isFinite(displaySim)) displaySim = 0;

        const resItem: any = {
          rank: index + 1,
          similarity: displaySim,
          chunk: {
            id: row.id,
            chunkIndex: row.chunkIndex,
            sectionTitle: row.sectionTitle,
            content: row.content,
            pageStart: row.pageStart,
            pageEnd: row.pageEnd,
          },
          document: {
            id: row.documentId,
            title: row.documentTitle,
            category: row.documentCategory,
            academicYear: row.documentAcademicYear,
            source: row.documentSource,
          },
        };

        if (isDebug) {
          const parseSim = (val: any): number | undefined => {
            if (val === undefined || val === null) return undefined;
            const parsed = typeof val === 'number' ? val : parseFloat(val);
            return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
          };

          const semContrib = row.originalSemanticRank
            ? WEIGHT_SEMANTIC * (1.0 / (RRF_K + row.originalSemanticRank))
            : 0;
          const normContrib = row.normalizedSemanticRank
            ? WEIGHT_NORMALIZED * (1.0 / (RRF_K + row.normalizedSemanticRank))
            : 0;
          const lexContrib = row.lexicalRank
            ? WEIGHT_LEXICAL * (1.0 / (RRF_K + row.lexicalRank))
            : 0;

          resItem.debug = {
            originalSemanticScore: parseSim(row.rawOrigScore),
            normalizedSemanticScore: parseSim(row.rawNormScore),
            lexicalScore: parseSim(row.rawLexScore),
            originalRank: row.originalSemanticRank,
            normalizedRank: row.normalizedSemanticRank,
            lexicalRank: row.lexicalRank,
            semanticRrfContrib: semContrib,
            normalizedRrfContrib: normContrib,
            lexicalRrfContrib: lexContrib,
            intentBoost: row.intentBoost,
            rrfScore: row.rrfScore,
            expansionApplied: normalized.expansionApplied,
          };
        }

        return resItem;
      });

      return {
        query,
        topK,
        provider,
        model,
        dimensions,
        timing: { embeddingMs, searchMs, totalMs },
        retrieval: {
          normalizedQuery: normalized.normalizedQuery,
          detectedIntents: normalized.detectedIntents,
          strategy: useNormalized ? 'hybrid_rrf_normalized' : 'hybrid_rrf_original',
        },
        results,
      };
    } catch (error: any) {
      this.logger.error(`Database search failed: ${error.message}`);
      throw new InternalServerErrorException('DATABASE_VECTOR_SEARCH_FAILED');
    }
  }

  /**
   * Build a PostgreSQL ts_query string from the query and its detected intents.
   *
   * Design principle: This is the LEXICAL channel — NOT semantic.
   * Use deterministic, intent-derived concept keywords.
   * Do NOT re-use the normalized Darija expansion as the lexical query:
   *   that expansion is designed for embedding, not for BM25/ts_rank.
   *
   * Intent-specific concept terms are chosen because they are discriminative
   * (i.e., they appear in very few chunks that directly answer the intent).
   * Generic terms like "inscription" or "ligne" are filtered out via LEXICAL_STOPWORDS.
   */
  buildLexicalQuery(query: string, intents: RetrievalIntent[]): string | null {
    const intentTerms: string[] = [];

    // SUFFICIENCY: "is online registration alone enough?"
    // Target: chunks about incomplete procedure / admin steps required
    if (intents.includes(RetrievalIntent.SUFFICIENCY)) {
      intentTerms.push('achever', 'proc\u00e9dure', 'administratif', 'uniquement', 'suffisant');
    }

    // FULL_PAYMENT: "can I pay the full amount at once?"
    if (intents.includes(RetrievalIntent.FULL_PAYMENT)) {
      intentTerms.push('totalit\u00e9', 'versement', 'paiement');
    }

    // INSTALLMENTS: installment / tranche
    if (intents.includes(RetrievalIntent.INSTALLMENTS)) {
      intentTerms.push('tranche', 'versement');
    }

    // EXEMPTION: scholarship / exemption
    if (intents.includes(RetrievalIntent.EXEMPTION)) {
      intentTerms.push('boursier', 'exon\u00e9r\u00e9');
    }

    // FEES: fee amounts
    if (intents.includes(RetrievalIntent.FEES)) {
      intentTerms.push('frais', 'montant', 'tarif');
    }

    // DATES: calendar, deadlines
    if (intents.includes(RetrievalIntent.DATES)) {
      intentTerms.push('calendrier', 'date', 'd\u00e9lai');
    }

    // DOCUMENTS: required paperwork
    if (intents.includes(RetrievalIntent.DOCUMENTS)) {
      intentTerms.push('pi\u00e8ces', 'dossier', 'document');
    }

    // WEBSITE: URL / web address
    if (intents.includes(RetrievalIntent.WEBSITE)) {
      intentTerms.push('site', 'lien', 'adresse', 'r\u00e9f\u00e9rence');
    }

    // REMOTE_REGISTRATION: distance registration (only if NOT SUFFICIENCY,
    // because SUFFICIENCY already uses more discriminative terms)
    if (
      intents.includes(RetrievalIntent.REMOTE_REGISTRATION) &&
      !intents.includes(RetrievalIntent.SUFFICIENCY)
    ) {
      intentTerms.push('distance');
    }

    // If we have good intent-derived terms, use them as the primary lexical query.
    if (intentTerms.length > 0) {
      const unique = [...new Set(intentTerms)];
      return unique.join(' | ');
    }

    // Fallback: extract meaningful tokens from the original query.
    const fallbackTokens = query
      .replace(/[^a-zA-Z0-9\u00C0-\u017E\u0600-\u06FF]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 3 && !LEXICAL_STOPWORDS.has(t.toLowerCase()));

    if (fallbackTokens.length === 0) return null;
    return fallbackTokens.join(' | ');
  }
}

/**
 * Normalize apostrophe variants to a plain ASCII apostrophe for reliable
 * string matching against `includes()` checks.
 * Handles: ' (U+2019), ' (U+2018), ` (backtick), etc.
 */
function normalizeApostrophes(str: string): string {
  return str.replace(/[\u2018\u2019\u201A\u201B\u02BC\u02C8`]/g, "'");
}
