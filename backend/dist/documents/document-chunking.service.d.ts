import { PrismaService } from '../prisma/prisma.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
export interface ChunkingResult {
    documentId: string;
    chunksCreated: number;
    pagesProcessed: number;
}
export interface ChunksResponse {
    documentId: string;
    title: string;
    chunkCount: number;
    chunks: ChunkItem[];
}
export interface ChunkItem {
    id: string;
    chunkIndex: number;
    sectionTitle: string | null;
    pageStart: number;
    pageEnd: number;
    tokenCount: number | null;
    content: string;
}
export declare class DocumentChunkingService {
    private readonly prisma;
    private readonly chunker;
    private readonly logger;
    constructor(prisma: PrismaService, chunker: SemanticChunkerService);
    chunkDocument(documentId: string): Promise<ChunkingResult>;
    getDocumentChunks(documentId: string): Promise<ChunksResponse>;
}
