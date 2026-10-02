import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievalResultItem } from '../retrieval/types/retrieval-result.type.js';
import { RagContextResult, RagContextSource } from './rag.types.js';

@Injectable()
export class RagContextBuilderService {
  private readonly maxChunks: number;
  private readonly maxChars: number;

  constructor(private readonly configService: ConfigService) {
    this.maxChunks = this.configService.get<number>('RAG_CONTEXT_MAX_CHUNKS', 6);
    this.maxChars = this.configService.get<number>('RAG_CONTEXT_MAX_CHARS', 12000);
  }

  buildContext(retrievedChunks: RetrievalResultItem[]): RagContextResult {
    const sources: RagContextSource[] = [];
    const seenDocumentIds = new Set<string>(); // avoid strict duplicates if any, but actually chunks are distinct.
    
    // Deduplicate by chunk id to avoid same chunk twice
    const uniqueChunks = [];
    const seenChunkIds = new Set<string>();
    for (const chunk of retrievedChunks) {
      if (!seenChunkIds.has(chunk.chunk.id)) {
        seenChunkIds.add(chunk.chunk.id);
        uniqueChunks.push(chunk);
      }
    }

    let currentCharCount = 0;
    let sourceIndex = 1;

    for (const res of uniqueChunks) {
      if (sources.length >= this.maxChunks) break;

      const chunkContent = res.chunk.content.trim();
      const contentLen = chunkContent.length;

      // If adding this chunk exceeds max chars and we already have some chunks, skip it.
      // If we have 0 chunks, we take it anyway to at least have something.
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
}
