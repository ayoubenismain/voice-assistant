import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class DocumentEmbeddingService {
  private readonly logger = new Logger(DocumentEmbeddingService.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  buildEmbeddingText(chunk: any, document: any): string {
    let text = `Document: ${document.title}\n`;
    if (document.category) text += `Category: ${document.category}\n`;
    if (document.academicYear) text += `Academic Year: ${document.academicYear}\n`;
    if (chunk.sectionTitle) text += `Section: ${chunk.sectionTitle}\n`;
    text += `Content:\n${chunk.content}`;
    return text;
  }

  async getEmbeddingStatus(documentId: string): Promise<EmbeddingStatus> {
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
      // It's technically missing if the DB says embeddingModel is null
      if (!chunk.embeddingModel) {
        missingEmbeddings++;
      } else {
        const isStale = chunk.embeddedContentHash !== chunk.contentHash 
          || chunk.embeddingModel !== model
          || chunk.embeddingProvider !== provider;
          
        if (isStale) {
          staleEmbeddings++;
        } else {
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

  async embedDocument(documentId: string): Promise<EmbedDocumentResult> {
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
      } else {
        chunksToSkip.push(chunk);
      }
    }

    this.logger.log(`Document ${documentId}: Embedding ${chunksToEmbed.length} chunks, skipping ${chunksToSkip.length} chunks`);

    let embeddedCount = 0;
    let failedCount = 0;

    // Process in batches
    for (let i = 0; i < chunksToEmbed.length; i += this.BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + this.BATCH_SIZE);
      const texts = batch.map(c => this.buildEmbeddingText(c, document));

      try {
        const vectors = await this.embeddingService.embedTexts(texts);
        
        if (vectors.length !== batch.length) {
          throw new Error(`Output count mismatch: expected ${batch.length}, got ${vectors.length}`);
        }

        // Persist batch using raw SQL for pgvector
        await this.prisma.$transaction(async (tx) => {
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const vector = vectors[j];
            
            // Format vector for postgres insertion
            const vectorStr = `[${vector.join(',')}]`;
            
            await tx.$executeRaw`
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
      } catch (error: any) {
        this.logger.error(`Batch embedding failed: ${error.message}`);
        failedCount += batch.length;
        // Depending on requirements, we can throw here to abort, or continue with next batches.
        // We will abort to avoid wasting resources if provider is down.
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
}
