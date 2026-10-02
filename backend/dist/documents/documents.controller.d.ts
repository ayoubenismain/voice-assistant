import { DocumentsService } from './documents.service.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { DocumentChunkingService } from './document-chunking.service.js';
import { DocumentEmbeddingService } from '../embeddings/document-embedding.service.js';
export declare class DocumentsController {
    private readonly documentsService;
    private readonly documentProcessingService;
    private readonly documentChunkingService;
    private readonly documentEmbeddingService;
    constructor(documentsService: DocumentsService, documentProcessingService: DocumentProcessingService, documentChunkingService: DocumentChunkingService, documentEmbeddingService: DocumentEmbeddingService);
    uploadDocument(file: any, body: any): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getDocuments(): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    getDocumentById(id: string): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }>;
    deleteDocument(id: string): Promise<{
        message: string;
    }>;
    processDocument(id: string): Promise<import("./document-processing.service.js").ProcessingResult>;
    getDocumentContent(id: string): Promise<{
        documentId: string;
        title: string;
        status: import("@prisma/client").$Enums.DocumentStatus;
        pageCount: number;
        pages: {
            pageNumber: number;
            text: string;
        }[];
    }>;
    chunkDocument(id: string): Promise<import("./document-chunking.service.js").ChunkingResult>;
    getDocumentChunks(id: string): Promise<import("./document-chunking.service.js").ChunksResponse>;
    embedDocument(id: string): Promise<import("../embeddings/document-embedding.service.js").EmbedDocumentResult>;
    getEmbeddingStatus(id: string): Promise<import("../embeddings/document-embedding.service.js").EmbeddingStatus>;
}
