var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DocumentProcessingService_1;
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PdfExtractionService } from './pdf-extraction.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
let DocumentProcessingService = DocumentProcessingService_1 = class DocumentProcessingService {
    prisma;
    pdfExtraction;
    semanticChunker;
    logger = new Logger(DocumentProcessingService_1.name);
    constructor(prisma, pdfExtraction, semanticChunker) {
        this.prisma = prisma;
        this.pdfExtraction = pdfExtraction;
        this.semanticChunker = semanticChunker;
    }
    async processDocument(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }
        if (!document.storagePath) {
            throw new BadRequestException(`Document ${documentId} has no storage path`);
        }
        await this.prisma.document.update({
            where: { id: documentId },
            data: { status: 'PROCESSING' },
        });
        this.logger.log(`Starting processing of document ${documentId}: ${document.title}`);
        try {
            const result = await this.pdfExtraction.extractPages(document.storagePath);
            if (!result.success) {
                await this.prisma.document.update({
                    where: { id: documentId },
                    data: { status: 'FAILED' },
                });
                this.logger.warn(`Document ${documentId} failed with code: ${result.errorCode} — ${result.error}`);
                return {
                    documentId,
                    status: 'FAILED',
                    pageCount: 0,
                    errorCode: result.errorCode,
                    message: result.error ?? 'PDF extraction failed',
                };
            }
            const pagesForChunking = result.pages.map(p => ({
                pageNumber: p.pageNumber,
                text: p.normalizedText,
            }));
            const chunks = this.semanticChunker.chunk(pagesForChunking);
            await this.prisma.$transaction(async (tx) => {
                await tx.documentPage.deleteMany({
                    where: { documentId },
                });
                await tx.documentPage.createMany({
                    data: result.pages.map((page) => ({
                        documentId,
                        pageNumber: page.pageNumber,
                        rawText: page.rawText,
                        normalizedText: page.normalizedText,
                    })),
                });
                await tx.documentChunk.deleteMany({
                    where: { documentId },
                });
                if (chunks.length > 0) {
                    await tx.documentChunk.createMany({
                        data: chunks.map((chunk, index) => ({
                            documentId,
                            chunkIndex: index,
                            content: chunk.content,
                            contentHash: chunk.contentHash,
                            sectionTitle: chunk.sectionTitle,
                            pageStart: chunk.pageStart,
                            pageEnd: chunk.pageEnd,
                            tokenCount: chunk.tokenCount,
                        })),
                    });
                }
                await tx.document.update({
                    where: { id: documentId },
                    data: { status: 'READY' },
                });
            });
            this.logger.log(`Document ${documentId} processed successfully — ${result.pageCount} page(s) -> ${chunks.length} chunk(s)`);
            return {
                documentId,
                status: 'READY',
                pageCount: result.pageCount,
                message: `Successfully extracted ${result.pageCount} page(s) and generated ${chunks.length} chunk(s)`,
            };
        }
        catch (error) {
            this.logger.error(`Unexpected error processing document ${documentId}: ${error?.message}`);
            await this.prisma.document
                .update({
                where: { id: documentId },
                data: { status: 'FAILED' },
            })
                .catch(() => {
            });
            return {
                documentId,
                status: 'FAILED',
                pageCount: 0,
                errorCode: 'PDF_EXTRACTION_FAILED',
                message: error?.message ?? 'Unexpected processing failure',
            };
        }
    }
    async getDocumentContent(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
            select: {
                id: true,
                title: true,
                status: true,
                mimeType: true,
                category: true,
                academicYear: true,
                department: true,
                source: true,
                pages: {
                    orderBy: { pageNumber: 'asc' },
                    select: {
                        pageNumber: true,
                        normalizedText: true,
                    },
                },
            },
        });
        if (!document) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }
        return {
            documentId: document.id,
            title: document.title,
            status: document.status,
            pageCount: document.pages.length,
            pages: document.pages.map((p) => ({
                pageNumber: p.pageNumber,
                text: p.normalizedText,
            })),
        };
    }
};
DocumentProcessingService = DocumentProcessingService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        PdfExtractionService,
        SemanticChunkerService])
], DocumentProcessingService);
export { DocumentProcessingService };
//# sourceMappingURL=document-processing.service.js.map