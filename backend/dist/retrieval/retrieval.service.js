var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RetrievalService_1;
import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { DarijaNormalizerService } from './darija/darija-normalizer.service.js';
import { RetrievalIntent } from './darija/darija-normalizer.types.js';
const RRF_K = 60;
const WEIGHT_SEMANTIC = 1.0;
const WEIGHT_NORMALIZED = 1.0;
const WEIGHT_LEXICAL = 0.4;
const BOOST_SECTION_MATCH = 0.003;
const BOOST_POLICY_CONTENT = 0.006;
const BOOST_POLICY_SECTION = 0.003;
const LEXICAL_STOPWORDS = new Set([
    'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'est', 'ce',
    'que', 'qui', 'quoi', 'elle', 'il', 'seule', 'pour', 'par', 'sur',
    'dans', 'en', 'avec', 'et', 'ou', 'ne', 'pas', 'plus', 'si', 'mais',
    'donc', 'or', 'ni', 'car', 'je', 'tu', 'nous', 'vous', 'ils', 'elles',
    'se', 'me', 'te', 'on', 'au', 'aux', 'ai', 'as', 'a', 'y',
    'inscription', 'ligne',
]);
let RetrievalService = RetrievalService_1 = class RetrievalService {
    prisma;
    embeddingService;
    normalizer;
    logger = new Logger(RetrievalService_1.name);
    constructor(prisma, embeddingService, normalizer) {
        this.prisma = prisma;
        this.embeddingService = embeddingService;
        this.normalizer = normalizer;
    }
    async semanticSearch(dto) {
        const totalStartMs = Date.now();
        const query = dto.query?.trim();
        if (!query)
            throw new BadRequestException('QUERY_REQUIRED');
        if (query.length > 1000)
            throw new BadRequestException('QUERY_TOO_LONG');
        const topK = dto.topK || 5;
        const isDebug = !!dto.debug;
        const provider = this.embeddingService.getProviderName();
        const model = this.embeddingService.getModelName();
        const dimensions = this.embeddingService.getDimensions();
        const normalized = this.normalizer.normalize(query);
        const useNormalized = normalized.expansionApplied;
        const embedStartMs = Date.now();
        const textsToEmbed = [query];
        if (useNormalized) {
            textsToEmbed.push(normalized.normalizedQuery);
        }
        let vectors;
        try {
            vectors = await this.embeddingService.embedTexts(textsToEmbed);
        }
        catch (error) {
            this.logger.error(`Query embedding failed: ${error.message}`);
            throw error;
        }
        const embeddingMs = Date.now() - embedStartMs;
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
        const searchStartMs = Date.now();
        const candidateK = Math.max(topK * 4, 20);
        const originalVecStr = `[${originalVector.join(',')}]`;
        const normalizedVecStr = normalizedVector ? `[${normalizedVector.join(',')}]` : null;
        try {
            const originalResults = await this.prisma.$queryRaw `
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
            let normalizedResults = [];
            if (normalizedVecStr) {
                normalizedResults = await this.prisma.$queryRaw `
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
            const tsQueryStr = this.buildLexicalQuery(query, normalized.detectedIntents);
            let lexicalResults = [];
            if (tsQueryStr) {
                lexicalResults = await this.prisma.$queryRaw `
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
            const candidateMap = new Map();
            const addCandidates = (results, rankType, scoreType) => {
                results.forEach((row, index) => {
                    if (!candidateMap.has(row.id)) {
                        candidateMap.set(row.id, { ...row, similarity: 0 });
                    }
                    const candidate = candidateMap.get(row.id);
                    candidate[rankType] = index + 1;
                    candidate[scoreType] = Number(row.similarity);
                    if (rankType === 'originalSemanticRank') {
                        candidate.similarity = Number(row.similarity);
                    }
                    else if (rankType === 'normalizedSemanticRank' && candidate.rawOrigScore === undefined) {
                        candidate.similarity = Number(row.similarity);
                    }
                });
            };
            addCandidates(originalResults, 'originalSemanticRank', 'rawOrigScore');
            addCandidates(normalizedResults, 'normalizedSemanticRank', 'rawNormScore');
            addCandidates(lexicalResults, 'lexicalRank', 'rawLexScore');
            const hasIntent = (_c, intent) => normalized.detectedIntents.includes(intent);
            const finalCandidates = Array.from(candidateMap.values());
            finalCandidates.forEach(c => {
                let rrf = 0;
                if (c.originalSemanticRank)
                    rrf += WEIGHT_SEMANTIC * (1.0 / (RRF_K + c.originalSemanticRank));
                if (c.normalizedSemanticRank)
                    rrf += WEIGHT_NORMALIZED * (1.0 / (RRF_K + c.normalizedSemanticRank));
                if (c.lexicalRank)
                    rrf += WEIGHT_LEXICAL * (1.0 / (RRF_K + c.lexicalRank));
                c.rrfOnly = rrf;
                const lowerSection = (c.sectionTitle || '').toLowerCase();
                const lowerContent = normalizeApostrophes((c.content || '').toLowerCase());
                let boost = 0;
                if (hasIntent(c, RetrievalIntent.FEES) && lowerSection.includes('frais'))
                    boost += BOOST_SECTION_MATCH;
                if (hasIntent(c, RetrievalIntent.DATES) && (lowerSection.includes('calendrier') || lowerSection.includes('date')))
                    boost += BOOST_SECTION_MATCH;
                if (hasIntent(c, RetrievalIntent.DOCUMENTS) && lowerSection.includes('pi\u00e8ces'))
                    boost += BOOST_SECTION_MATCH;
                if (hasIntent(c, RetrievalIntent.WEBSITE) && (lowerSection.includes('f') && lowerSection.includes('rences')))
                    boost += BOOST_SECTION_MATCH;
                if (hasIntent(c, RetrievalIntent.SUFFICIENCY)) {
                    const sufficiencyKeywords = [
                        'sans achever', 'n est pas consid', 'uniquement', 'seul',
                        'suffit', 'suffisant', 'compl', 'proc', 'administrativ',
                    ];
                    const contentHasSufficiencySignal = sufficiencyKeywords.some(kw => lowerContent.includes(kw));
                    const sectionHasSufficiencySignal = lowerSection.includes('remarque') || lowerSection.includes('important');
                    if (contentHasSufficiencySignal)
                        boost += BOOST_POLICY_CONTENT;
                    if (sectionHasSufficiencySignal)
                        boost += BOOST_POLICY_SECTION;
                }
                if (hasIntent(c, RetrievalIntent.FULL_PAYMENT)) {
                    if (lowerContent.includes('totalit') ||
                        lowerContent.includes('un seul') ||
                        lowerContent.includes('int\u00e9gral')) {
                        boost += BOOST_POLICY_CONTENT;
                    }
                    if (lowerSection.includes('disposition'))
                        boost += BOOST_POLICY_SECTION;
                }
                if (hasIntent(c, RetrievalIntent.INSTALLMENTS)) {
                    if (lowerContent.includes('tranche') || lowerContent.includes('versement'))
                        boost += BOOST_POLICY_CONTENT;
                }
                if (hasIntent(c, RetrievalIntent.EXEMPTION)) {
                    if (lowerContent.includes('boursier') ||
                        lowerContent.includes('exon') ||
                        lowerContent.includes('pr\u00eat')) {
                        boost += BOOST_POLICY_CONTENT;
                    }
                }
                if (hasIntent(c, RetrievalIntent.REMOTE_REGISTRATION) && !hasIntent(c, RetrievalIntent.SUFFICIENCY)) {
                    if (lowerContent.includes('distance')) {
                        boost += 0.001;
                    }
                }
                c.intentBoost = boost;
                c.rrfScore = rrf + boost;
            });
            finalCandidates.sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0));
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
                    this.logger.debug(`[${i + 1}] "${c.sectionTitle}" | ` +
                        `semRank=${c.originalSemanticRank ?? '-'} (${semContrib.toFixed(5)}) | ` +
                        `normRank=${c.normalizedSemanticRank ?? '-'} (${normContrib.toFixed(5)}) | ` +
                        `lexRank=${c.lexicalRank ?? '-'} (${lexContrib.toFixed(5)}) | ` +
                        `boost=${(c.intentBoost ?? 0).toFixed(5)} | ` +
                        `final=${(c.rrfScore ?? 0).toFixed(6)}`);
                });
            }
            const topCandidates = finalCandidates.slice(0, topK);
            const searchMs = Date.now() - searchStartMs;
            const totalMs = Date.now() - totalStartMs;
            this.logger.log(`Hybrid search done in ${totalMs}ms (embed: ${embeddingMs}ms, search: ${searchMs}ms) ` +
                `strategy=${useNormalized ? 'hybrid_rrf_normalized' : 'hybrid_rrf_original'} ` +
                `candidates=${finalCandidates.length} query="${query}"`);
            const results = topCandidates.map((row, index) => {
                let displaySim = typeof row.similarity === 'number' ? row.similarity : parseFloat(row.similarity);
                if (isNaN(displaySim) || !isFinite(displaySim))
                    displaySim = 0;
                const resItem = {
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
                    const parseSim = (val) => {
                        if (val === undefined || val === null)
                            return undefined;
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
        }
        catch (error) {
            this.logger.error(`Database search failed: ${error.message}`);
            throw new InternalServerErrorException('DATABASE_VECTOR_SEARCH_FAILED');
        }
    }
    buildLexicalQuery(query, intents) {
        const intentTerms = [];
        if (intents.includes(RetrievalIntent.SUFFICIENCY)) {
            intentTerms.push('achever', 'proc\u00e9dure', 'administratif', 'uniquement', 'suffisant');
        }
        if (intents.includes(RetrievalIntent.FULL_PAYMENT)) {
            intentTerms.push('totalit\u00e9', 'versement', 'paiement');
        }
        if (intents.includes(RetrievalIntent.INSTALLMENTS)) {
            intentTerms.push('tranche', 'versement');
        }
        if (intents.includes(RetrievalIntent.EXEMPTION)) {
            intentTerms.push('boursier', 'exon\u00e9r\u00e9');
        }
        if (intents.includes(RetrievalIntent.FEES)) {
            intentTerms.push('frais', 'montant', 'tarif');
        }
        if (intents.includes(RetrievalIntent.DATES)) {
            intentTerms.push('calendrier', 'date', 'd\u00e9lai');
        }
        if (intents.includes(RetrievalIntent.DOCUMENTS)) {
            intentTerms.push('pi\u00e8ces', 'dossier', 'document');
        }
        if (intents.includes(RetrievalIntent.WEBSITE)) {
            intentTerms.push('site', 'lien', 'adresse', 'r\u00e9f\u00e9rence');
        }
        if (intents.includes(RetrievalIntent.REMOTE_REGISTRATION) &&
            !intents.includes(RetrievalIntent.SUFFICIENCY)) {
            intentTerms.push('distance');
        }
        if (intentTerms.length > 0) {
            const unique = [...new Set(intentTerms)];
            return unique.join(' | ');
        }
        const fallbackTokens = query
            .replace(/[^a-zA-Z0-9\u00C0-\u017E\u0600-\u06FF]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 3 && !LEXICAL_STOPWORDS.has(t.toLowerCase()));
        if (fallbackTokens.length === 0)
            return null;
        return fallbackTokens.join(' | ');
    }
};
RetrievalService = RetrievalService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        EmbeddingService,
        DarijaNormalizerService])
], RetrievalService);
export { RetrievalService };
function normalizeApostrophes(str) {
    return str.replace(/[\u2018\u2019\u201A\u201B\u02BC\u02C8`]/g, "'");
}
//# sourceMappingURL=retrieval.service.js.map