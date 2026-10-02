import { PrismaService } from '../prisma/prisma.service.js';
import { PdfExtractionService } from './pdf-extraction.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
import { DocumentStatus } from '@prisma/client';
export interface ProcessingResult {
    documentId: string;
    status: DocumentStatus;
    pageCount: number;
    errorCode?: string;
    message: string;
}
export declare class DocumentProcessingService {
    private readonly prisma;
    private readonly pdfExtraction;
    private readonly semanticChunker;
    private readonly logger;
    constructor(prisma: PrismaService, pdfExtraction: PdfExtractionService, semanticChunker: SemanticChunkerService);
    processDocument(documentId: string): Promise<ProcessingResult>;
    getDocumentContent(documentId: string): Promise<{
        documentId: string;
        title: string;
        status: import("@prisma/client").$Enums.DocumentStatus;
        pageCount: number;
        pages: {
            pageNumber: number;
            text: string;
        }[];
    }>;
}
