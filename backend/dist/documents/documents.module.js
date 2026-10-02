var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { PdfExtractionService } from './pdf-extraction.service.js';
import { DocumentChunkingService } from './document-chunking.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
import { StorageModule } from '../storage/storage.module.js';
let DocumentsModule = class DocumentsModule {
};
DocumentsModule = __decorate([
    Module({
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
], DocumentsModule);
export { DocumentsModule };
//# sourceMappingURL=documents.module.js.map