import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfExtraction: PdfExtractionService,
    private readonly semanticChunker: SemanticChunkerService,
  ) {}

  async processDocument(documentId: string): Promise<ProcessingResult> {
    // 1. Load document from DB — never trust user-supplied paths
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    if (!document.storagePath) {
      throw new BadRequestException(`Document ${documentId} has no storage path`);
    }

    // 2. Mark PROCESSING
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' },
    });

    this.logger.log(`Starting processing of document ${documentId}: ${document.title}`);

    try {
      // 3. Extract pages from PDF
      const result = await this.pdfExtraction.extractPages(document.storagePath);

      if (!result.success) {
        // 4a. Failed extraction — mark FAILED, do NOT get stuck in PROCESSING
        await this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'FAILED' },
        });

        this.logger.warn(
          `Document ${documentId} failed with code: ${result.errorCode} — ${result.error}`,
        );

        return {
          documentId,
          status: 'FAILED',
          pageCount: 0,
          errorCode: result.errorCode,
          message: result.error ?? 'PDF extraction failed',
        };
      }

      // 4b. Persist pages atomically — only mark READY after successful insert
      // We will also generate chunks here
      const pagesForChunking = result.pages.map(p => ({
        pageNumber: p.pageNumber,
        text: p.normalizedText,
      }));
      
      const chunks = this.semanticChunker.chunk(pagesForChunking);

      await this.prisma.$transaction(async (tx) => {
        // Delete any previously extracted pages (idempotent reprocessing)
        await tx.documentPage.deleteMany({
          where: { documentId },
        });

        // Insert all pages
        await tx.documentPage.createMany({
          data: result.pages.map((page) => ({
            documentId,
            pageNumber: page.pageNumber,
            rawText: page.rawText,
            normalizedText: page.normalizedText,
          })),
        });

        // Delete any previously extracted chunks (idempotent reprocessing)
        await tx.documentChunk.deleteMany({
          where: { documentId },
        });

        // Insert all chunks
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

        // Only now mark READY
        await tx.document.update({
          where: { id: documentId },
          data: { status: 'READY' },
        });
      });

      this.logger.log(
        `Document ${documentId} processed successfully — ${result.pageCount} page(s) -> ${chunks.length} chunk(s)`,
      );

      return {
        documentId,
        status: 'READY',
        pageCount: result.pageCount,
        message: `Successfully extracted ${result.pageCount} page(s) and generated ${chunks.length} chunk(s)`,
      };
    } catch (error: any) {
      // 5. Catch unexpected errors — ensure we never stay stuck in PROCESSING
      this.logger.error(`Unexpected error processing document ${documentId}: ${error?.message}`);

      await this.prisma.document
        .update({
          where: { id: documentId },
          data: { status: 'FAILED' },
        })
        .catch(() => {
          // Swallow secondary error so original is surfaced
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

  async getDocumentContent(documentId: string) {
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
}
