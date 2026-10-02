import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { PdfExtractionService } from './pdf-extraction.service.js';
import { DocumentChunkingService } from './document-chunking.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentProcessingService,
    PdfExtractionService,
    DocumentChunkingService,
    SemanticChunkerService,
  ],
})
export class DocumentsModule {}
