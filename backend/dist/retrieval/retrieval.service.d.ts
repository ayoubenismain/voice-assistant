import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { SemanticSearchDto } from './dto/semantic-search.dto.js';
import { SemanticSearchResponse } from './types/retrieval-result.type.js';
import { DarijaNormalizerService } from './darija/darija-normalizer.service.js';
import { RetrievalIntent } from './darija/darija-normalizer.types.js';
export declare class RetrievalService {
    private readonly prisma;
    private readonly embeddingService;
    private readonly normalizer;
    private readonly logger;
    constructor(prisma: PrismaService, embeddingService: EmbeddingService, normalizer: DarijaNormalizerService);
    semanticSearch(dto: SemanticSearchDto): Promise<SemanticSearchResponse>;
    buildLexicalQuery(query: string, intents: RetrievalIntent[]): string | null;
}
