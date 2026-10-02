var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
let RagContextBuilderService = class RagContextBuilderService {
    configService;
    maxChunks;
    maxChars;
    constructor(configService) {
        this.configService = configService;
        this.maxChunks = this.configService.get('RAG_CONTEXT_MAX_CHUNKS', 6);
        this.maxChars = this.configService.get('RAG_CONTEXT_MAX_CHARS', 12000);
    }
    buildContext(retrievedChunks) {
        const sources = [];
        const seenDocumentIds = new Set();
        const uniqueChunks = [];
        const seenChunkIds = new Set();
        for (const chunk of retrievedChunks) {
            if (!seenChunkIds.has(chunk.chunk.id)) {
                seenChunkIds.add(chunk.chunk.id);
                uniqueChunks.push(chunk);
            }
        }
        let currentCharCount = 0;
        let sourceIndex = 1;
        for (const res of uniqueChunks) {
            if (sources.length >= this.maxChunks)
                break;
            const chunkContent = res.chunk.content.trim();
            const contentLen = chunkContent.length;
            if (sources.length > 0 && currentCharCount + contentLen > this.maxChars) {
                continue;
            }
            const sourceId = `S${sourceIndex++}`;
            sources.push({
                sourceId,
                documentId: res.document.id,
                title: res.document.title,
                source: res.document.source || 'N/A',
                category: res.document.category || 'N/A',
                academicYear: res.document.academicYear || 'N/A',
                sectionTitle: res.chunk.sectionTitle || 'N/A',
                pageStart: res.chunk.pageStart,
                pageEnd: res.chunk.pageEnd,
                content: chunkContent,
            });
            currentCharCount += contentLen;
        }
        const formattedContext = sources.map(s => {
            return `[${s.sourceId}]
Document: ${s.title}
Source: ${s.source}
Category: ${s.category}
Academic year: ${s.academicYear}
Section: ${s.sectionTitle}
Pages: ${s.pageStart === s.pageEnd ? s.pageStart : `${s.pageStart}-${s.pageEnd}`}
Content:
${s.content}`;
        }).join('\n\n');
        return {
            formattedContext,
            sources,
        };
    }
};
RagContextBuilderService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], RagContextBuilderService);
export { RagContextBuilderService };
//# sourceMappingURL=rag-context-builder.service.js.map