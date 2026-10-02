import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { DocumentChunkingService } from './document-chunking.service.js';
import { DocumentEmbeddingService } from '../embeddings/document-embedding.service.js';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly documentProcessingService: DocumentProcessingService,
    private readonly documentChunkingService: DocumentChunkingService,
    private readonly documentEmbeddingService: DocumentEmbeddingService,
  ) {}

  // ─── Upload / CRUD ────────────────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(@UploadedFile() file: any, @Body() body: any) {
    return this.documentsService.uploadDocument(file, body);
  }

  @Get()
  async getDocuments() {
    return this.documentsService.getAllDocuments();
  }

  @Get(':id')
  async getDocumentById(@Param('id') id: string) {
    return this.documentsService.getDocumentById(id);
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    return this.documentsService.deleteDocument(id);
  }

  // ─── Processing (Phase 2) ─────────────────────────────────────────────────

  @Post(':id/process')
  async processDocument(@Param('id') id: string) {
    return this.documentProcessingService.processDocument(id);
  }

  @Get(':id/content')
  async getDocumentContent(@Param('id') id: string) {
    return this.documentProcessingService.getDocumentContent(id);
  }

  // ─── Chunking (Phase 3) ───────────────────────────────────────────────────

  @Post(':id/chunk')
  async chunkDocument(@Param('id') id: string) {
    return this.documentChunkingService.chunkDocument(id);
  }

  @Get(':id/chunks')
  async getDocumentChunks(@Param('id') id: string) {
    return this.documentChunkingService.getDocumentChunks(id);
  }

  // ─── Embeddings (Phase 4) ─────────────────────────────────────────────────

  @Post(':id/embed')
  async embedDocument(@Param('id') id: string) {
    return this.documentEmbeddingService.embedDocument(id);
  }

  @Get(':id/embedding-status')
  async getEmbeddingStatus(@Param('id') id: string) {
    return this.documentEmbeddingService.getEmbeddingStatus(id);
  }
}
