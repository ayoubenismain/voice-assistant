import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from './embedding.service.js';
export interface EmbeddingStatus {
    documentId: string;
    totalChunks: number;
    embeddedChunks: number;
    missingEmbeddings: number;
    staleEmbeddings: number;
    provider: string;
    model: string;
    dimensions: number;
}
export interface EmbedDocumentResult {
    documentId: string;
    totalChunks: number;
    embedded: number;
    skipped: number;
    failed: number;
    provider: string;
    model: string;
    dimensions: number;
}
export declare class DocumentEmbeddingService {
    private readonly prisma;
    private readonly embeddingService;
    private readonly logger;
    private readonly BATCH_SIZE;
    constructor(prisma: PrismaService, embeddingService: EmbeddingService);
    buildEmbeddingText(chunk: any, document: any): string;
    getEmbeddingStatus(documentId: string): Promise<EmbeddingStatus>;
    embedDocument(documentId: string): Promise<EmbedDocumentResult>;
}
