var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Post, Get, Delete, Param, UseInterceptors, UploadedFile, Body, } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { DocumentChunkingService } from './document-chunking.service.js';
import { DocumentEmbeddingService } from '../embeddings/document-embedding.service.js';
let DocumentsController = class DocumentsController {
    documentsService;
    documentProcessingService;
    documentChunkingService;
    documentEmbeddingService;
    constructor(documentsService, documentProcessingService, documentChunkingService, documentEmbeddingService) {
        this.documentsService = documentsService;
        this.documentProcessingService = documentProcessingService;
        this.documentChunkingService = documentChunkingService;
        this.documentEmbeddingService = documentEmbeddingService;
    }
    async uploadDocument(file, body) {
        return this.documentsService.uploadDocument(file, body);
    }
    async getDocuments() {
        return this.documentsService.getAllDocuments();
    }
    async getDocumentById(id) {
        return this.documentsService.getDocumentById(id);
    }
    async deleteDocument(id) {
        return this.documentsService.deleteDocument(id);
    }
    async processDocument(id) {
        return this.documentProcessingService.processDocument(id);
    }
    async getDocumentContent(id) {
        return this.documentProcessingService.getDocumentContent(id);
    }
    async chunkDocument(id) {
        return this.documentChunkingService.chunkDocument(id);
    }
    async getDocumentChunks(id) {
        return this.documentChunkingService.getDocumentChunks(id);
    }
    async embedDocument(id) {
        return this.documentEmbeddingService.embedDocument(id);
    }
    async getEmbeddingStatus(id) {
        return this.documentEmbeddingService.getEmbeddingStatus(id);
    }
};
__decorate([
    Post('upload'),
    UseInterceptors(FileInterceptor('file')),
    __param(0, UploadedFile()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "uploadDocument", null);
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocuments", null);
__decorate([
    Get(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentById", null);
__decorate([
    Delete(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "deleteDocument", null);
__decorate([
    Post(':id/process'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "processDocument", null);
__decorate([
    Get(':id/content'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentContent", null);
__decorate([
    Post(':id/chunk'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "chunkDocument", null);
__decorate([
    Get(':id/chunks'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentChunks", null);
__decorate([
    Post(':id/embed'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "embedDocument", null);
__decorate([
    Get(':id/embedding-status'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getEmbeddingStatus", null);
DocumentsController = __decorate([
    Controller('documents'),
    __metadata("design:paramtypes", [DocumentsService,
        DocumentProcessingService,
        DocumentChunkingService,
        DocumentEmbeddingService])
], DocumentsController);
export { DocumentsController };
//# sourceMappingURL=documents.controller.js.map