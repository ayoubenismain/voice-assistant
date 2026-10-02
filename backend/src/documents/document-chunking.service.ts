import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
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

@Injectable()
export class DocumentChunkingService {
  private readonly logger = new Logger(DocumentChunkingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunker: SemanticChunkerService,
  ) {}

  // ── POST /documents/:id/chunk ────────────────────────────────────────────

  async chunkDocument(documentId: string): Promise<ChunkingResult> {
    // 1. Load and validate document
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

    // 2. Load extracted pages
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

    // 3. Generate chunks using the semantic chunker
    let chunkDrafts;
    try {
      chunkDrafts = this.chunker.chunk(
        pages.map((p) => ({ pageNumber: p.pageNumber, text: p.normalizedText })),
      );
    } catch (err: any) {
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

    this.logger.log(
      `Generated ${chunkDrafts.length} chunk(s) for document ${documentId} from ${pages.length} page(s)`,
    );

    // 4. Persist atomically — safe idempotent replacement
    //    Strategy: generate all chunks in memory FIRST, then in a single
    //    transaction delete old → insert new → done.
    //    If insert fails, the transaction rolls back (no partial state).
    try {
      await this.prisma.$transaction(async (tx) => {
        // Delete any previous chunks for this document
        await tx.documentChunk.deleteMany({ where: { documentId } });

        // Insert the full new chunk set
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
    } catch (err: any) {
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

  // ── GET /documents/:id/chunks ────────────────────────────────────────────

  async getDocumentChunks(documentId: string): Promise<ChunksResponse> {
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
}
