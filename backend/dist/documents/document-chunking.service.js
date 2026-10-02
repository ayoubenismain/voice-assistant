var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DocumentChunkingService_1;
import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
let DocumentChunkingService = DocumentChunkingService_1 = class DocumentChunkingService {
    prisma;
    chunker;
    logger = new Logger(DocumentChunkingService_1.name);
    constructor(prisma, chunker) {
        this.prisma = prisma;
        this.chunker = chunker;
    }
    async chunkDocument(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document) {
            throw new NotFoundException({
                errorCode: 'DOCUMENT_NOT_FOUND',
                message: `Document ${documentId} not found`,
            });
        }
        if (document.status !== 'READY') {
            throw new BadRequestException({
                errorCode: 'DOCUMENT_NOT_READY',
                message: `Document must have status READY before chunking. Current status: ${document.status}`,
            });
        }
        const pages = await this.prisma.documentPage.findMany({
            where: { documentId },
            orderBy: { pageNumber: 'asc' },
            select: { pageNumber: true, normalizedText: true },
        });
        if (pages.length === 0) {
            throw new BadRequestException({
                errorCode: 'NO_EXTRACTED_CONTENT',
                message: 'Document has no extracted page content. Run /process first.',
            });
        }
        let chunkDrafts;
        try {
            chunkDrafts = this.chunker.chunk(pages.map((p) => ({ pageNumber: p.pageNumber, text: p.normalizedText })));
        }
        catch (err) {
            this.logger.error(`Chunk generation failed for ${documentId}: ${err?.message}`);
            throw new InternalServerErrorException({
                errorCode: 'CHUNK_GENERATION_FAILED',
                message: `Failed to generate chunks: ${err?.message}`,
            });
        }
        if (chunkDrafts.length === 0) {
            throw new InternalServerErrorException({
                errorCode: 'CHUNK_GENERATION_FAILED',
                message: 'Chunker produced 0 chunks — check extracted page content.',
            });
        }
        this.logger.log(`Generated ${chunkDrafts.length} chunk(s) for document ${documentId} from ${pages.length} page(s)`);
        try {
            await this.prisma.$transaction(async (tx) => {
                await tx.documentChunk.deleteMany({ where: { documentId } });
                await tx.documentChunk.createMany({
                    data: chunkDrafts.map((draft, idx) => ({
                        documentId,
                        chunkIndex: idx,
                        content: draft.content,
                        contentHash: draft.contentHash,
                        sectionTitle: draft.sectionTitle,
                        pageStart: draft.pageStart,
                        pageEnd: draft.pageEnd,
                        tokenCount: draft.tokenCount,
                    })),
                });
            });
        }
        catch (err) {
            this.logger.error(`Transaction failed persisting chunks for ${documentId}: ${err?.message}`);
            throw new InternalServerErrorException({
                errorCode: 'CHUNK_GENERATION_FAILED',
                message: 'Failed to persist chunks to database.',
            });
        }
        this.logger.log(`Persisted ${chunkDrafts.length} chunk(s) for document ${documentId}`);
        return {
            documentId,
            chunksCreated: chunkDrafts.length,
            pagesProcessed: pages.length,
        };
    }
    async getDocumentChunks(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
            select: {
                id: true,
                title: true,
                chunks: {
                    orderBy: { chunkIndex: 'asc' },
                    select: {
                        id: true,
                        chunkIndex: true,
                        sectionTitle: true,
                        pageStart: true,
                        pageEnd: true,
                        tokenCount: true,
                        content: true,
                    },
                },
            },
        });
        if (!document) {
            throw new NotFoundException({
                errorCode: 'DOCUMENT_NOT_FOUND',
                message: `Document ${documentId} not found`,
            });
        }
        return {
            documentId: document.id,
            title: document.title,
            chunkCount: document.chunks.length,
            chunks: document.chunks,
        };
    }
};
DocumentChunkingService = DocumentChunkingService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        SemanticChunkerService])
], DocumentChunkingService);
export { DocumentChunkingService };
//# sourceMappingURL=document-chunking.service.js.map