var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DocumentEmbeddingService_1;
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from './embedding.service.js';
let DocumentEmbeddingService = DocumentEmbeddingService_1 = class DocumentEmbeddingService {
    prisma;
    embeddingService;
    logger = new Logger(DocumentEmbeddingService_1.name);
    BATCH_SIZE = 50;
    constructor(prisma, embeddingService) {
        this.prisma = prisma;
        this.embeddingService = embeddingService;
    }
    buildEmbeddingText(chunk, document) {
        let text = `Document: ${document.title}\n`;
        if (document.category)
            text += `Category: ${document.category}\n`;
        if (document.academicYear)
            text += `Academic Year: ${document.academicYear}\n`;
        if (chunk.sectionTitle)
            text += `Section: ${chunk.sectionTitle}\n`;
        text += `Content:\n${chunk.content}`;
        return text;
    }
    async getEmbeddingStatus(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
            include: { chunks: true },
        });
        if (!document) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }
        const provider = this.embeddingService.getProviderName();
        const model = this.embeddingService.getModelName();
        const dimensions = this.embeddingService.getDimensions();
        let embeddedChunks = 0;
        let missingEmbeddings = 0;
        let staleEmbeddings = 0;
        for (const chunk of document.chunks) {
            if (!chunk.embeddingModel) {
                missingEmbeddings++;
            }
            else {
                const isStale = chunk.embeddedContentHash !== chunk.contentHash
                    || chunk.embeddingModel !== model
                    || chunk.embeddingProvider !== provider;
                if (isStale) {
                    staleEmbeddings++;
                }
                else {
                    embeddedChunks++;
                }
            }
        }
        return {
            documentId,
            totalChunks: document.chunks.length,
            embeddedChunks,
            missingEmbeddings,
            staleEmbeddings,
            provider,
            model,
            dimensions,
        };
    }
    async embedDocument(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
            include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
        });
        if (!document) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }
        if (document.chunks.length === 0) {
            throw new Error('DOCUMENT_HAS_NO_CHUNKS');
        }
        const provider = this.embeddingService.getProviderName();
        const model = this.embeddingService.getModelName();
        const dimensions = this.embeddingService.getDimensions();
        const chunksToEmbed = [];
        const chunksToSkip = [];
        for (const chunk of document.chunks) {
            const isStale = !chunk.embeddingModel
                || chunk.embeddedContentHash !== chunk.contentHash
                || chunk.embeddingModel !== model
                || chunk.embeddingProvider !== provider;
            if (isStale) {
                chunksToEmbed.push(chunk);
            }
            else {
                chunksToSkip.push(chunk);
            }
        }
        this.logger.log(`Document ${documentId}: Embedding ${chunksToEmbed.length} chunks, skipping ${chunksToSkip.length} chunks`);
        let embeddedCount = 0;
        let failedCount = 0;
        for (let i = 0; i < chunksToEmbed.length; i += this.BATCH_SIZE) {
            const batch = chunksToEmbed.slice(i, i + this.BATCH_SIZE);
            const texts = batch.map(c => this.buildEmbeddingText(c, document));
            try {
                const vectors = await this.embeddingService.embedTexts(texts);
                if (vectors.length !== batch.length) {
                    throw new Error(`Output count mismatch: expected ${batch.length}, got ${vectors.length}`);
                }
                await this.prisma.$transaction(async (tx) => {
                    for (let j = 0; j < batch.length; j++) {
                        const chunk = batch[j];
                        const vector = vectors[j];
                        const vectorStr = `[${vector.join(',')}]`;
                        await tx.$executeRaw `
              UPDATE document_chunks 
              SET 
                embedding = ${vectorStr}::vector,
                "embeddingProvider" = ${provider},
                "embeddingModel" = ${model},
                "embeddedContentHash" = ${chunk.contentHash},
                "embeddedAt" = NOW()
              WHERE id = ${chunk.id}
            `;
                    }
                });
                embeddedCount += batch.length;
            }
            catch (error) {
                this.logger.error(`Batch embedding failed: ${error.message}`);
                failedCount += batch.length;
                throw error;
            }
        }
        return {
            documentId,
            totalChunks: document.chunks.length,
            embedded: embeddedCount,
            skipped: chunksToSkip.length,
            failed: failedCount,
            provider,
            model,
            dimensions,
        };
    }
};
DocumentEmbeddingService = DocumentEmbeddingService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        EmbeddingService])
], DocumentEmbeddingService);
export { DocumentEmbeddingService };
//# sourceMappingURL=document-embedding.service.js.map