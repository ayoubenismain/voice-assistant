import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PageContent {
  pageNumber: number;
  text: string; // already normalized by PdfExtractionService
}

export interface ChunkDraft {
  content: string;
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
  contentHash: string;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface AnnotatedBlock {
  text: string;
  pageStart: number;
  pageEnd: number;
  headingLevel: 0 | 1 | 2; // 0 = body, 1 = major heading, 2 = sub-heading
}

interface Section {
  title: string | null;
  blocks: AnnotatedBlock[];
  pageStart: number;
  pageEnd: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Target token range for a single chunk.
 * These are soft targets; coherent sections may be smaller.
 * Fee sub-sections (e.g. "Licence : 70 DT") can legitimately be compact;
 * we keep MIN low so they don't get swallowed by unrelated sections.
 */
const TARGET_MAX_TOKENS = 600;
const HARD_MAX_TOKENS = 800;
const MIN_CHUNK_TOKENS = 20;

/**
 * Overlap used only when splitting an oversized section.
 * Applied at paragraph boundaries, not byte offsets.
 */
const OVERLAP_TOKENS = 60;

/**
 * The PDF-extraction artifact for bullet points (Wingdings character).
 * Normalized to ASCII hyphen-dash before chunking.
 */
const PDF_BULLET = '\uf0b7';

/**
 * Level-1 heading: numbered section like "1. Calendrier..."
 */
const MAIN_HEADING_RE = /^\d+\.\s+\S/;

/**
 * Level-2 heading: "Étape 1 -", "Étape 2 -", etc.
 */
const STEP_HEADING_RE = /^Étape\s+\d+\s*[-–]/i;

/**
 * Known sub-heading prefixes for the ISSATSO document family.
 * All conservative and multilingual-safe — just prefix matching.
 */
const SUB_HEADING_PREFIXES: string[] = [
  'Licence',
  'Master',
  'Cycle préparatoire',
  'Cycle de formation',
  'Dispositions particulières',
  'Nouveaux étudiants',
  'Étudiants anciens',
  'Étudiants admis',
  'Étudiants dont',
  'Pour les étudiants',
  // Calendar sub-headings (registration schedule per cycle/year)
  '1re année de licence',
  '2e année de licence',
  '3e année de licence',
  '1re année du cycle préparatoire',
  '2e année du cycle préparatoire',
  '1re année du cycle de formation',
  '2e année du cycle de formation',
  '3e année du cycle de formation',
  '4e année du cycle de formation',
  '5e année du cycle de formation',
  '1re année de licence - nouveaux',
  '1re année de licence - anciens',
  // Short single-year anchors
  '1re année',
  '2e année',
  '3e année',
  '4e année',
  '5e année',
];

// ─── SemanticChunkerService ──────────────────────────────────────────────────

@Injectable()
export class SemanticChunkerService {
  // ── Public entry point ───────────────────────────────────────────────────

  /**
   * Converts extracted pages into semantic chunks.
   *
   * Algorithm overview:
   *  1. Normalize bullets and whitespace per page
   *  2. Split each page into paragraph blocks, tracking page numbers
   *  3. Label each block: heading level 1, 2, or body (0)
   *  4. Group blocks into sections at level-1 heading boundaries
   *  5. Within each section, split further at level-2 boundaries
   *  6. Apply size constraints (split oversized)
   *  7. Extract D-code definitions dynamically
   *  8. Enrich chunks containing D-codes
   *  9. Merge tiny orphan headings forward
   * 10. Assign content hash and token count to every draft chunk
   */
  chunk(pages: PageContent[]): ChunkDraft[] {
    if (pages.length === 0) return [];

    // Step 1 & 2: normalize + split into annotated blocks
    const blocks = this.buildAnnotatedBlocks(pages);

    // Step 3-5: group into sections, handling sub-headings
    const sections = this.groupIntoSections(blocks);

    // Step 6: apply size constraints → produce raw drafts
    const rawDrafts = this.sectionsToRawDrafts(sections);

    // Step 7: Dynamic dictionary for D-codes
    const dictionary = this.extractReferenceCodes(rawDrafts);
    
    // Step 8: Enrich
    this.enrichWithReferenceCodes(rawDrafts, dictionary);

    // Step 9: Clean up tiny orphan heading chunks
    const cleaned = this.mergeTinyHeadings(rawDrafts);

    // Step 10: finalize with hash + token count
    return cleaned.map((d) => this.finalizeDraft(d));
  }

  // ── Step 1 + 2: Annotated block building ────────────────────────────────

  private buildAnnotatedBlocks(pages: PageContent[]): AnnotatedBlock[] {
    const allBlocks: AnnotatedBlock[] = [];

    for (const page of pages) {
      const normalized = this.normalizePage(page.text);

      // First split at blank lines into paragraph groups
      const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);

      for (const para of paragraphs) {
        // Within each paragraph, also split at lines that appear to be headings.
        // This handles PDFs where sub-headings are separated only by \n, not \n\n.
        const subBlocks = this.splitAtEmbeddedHeadings(para);
        for (const sub of subBlocks) {
          const headingLevel = this.detectHeadingLevel(sub);
          allBlocks.push({
            text: sub,
            pageStart: page.pageNumber,
            pageEnd: page.pageNumber,
            headingLevel,
          });
        }
      }
    }

    return allBlocks;
  }

  /**
   * Splits a paragraph at lines that appear to be headings.
   * When a heading line is found mid-paragraph, everything before it
   * becomes one block and the heading starts a new block.
   * This is required for PDFs that use \n instead of \n\n between sections.
   */
  private splitAtEmbeddedHeadings(para: string): string[] {
    const lines = para.split('\n');
    const blocks: string[] = [];
    let currentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        // Preserve empty lines within current block
        if (currentLines.length > 0) currentLines.push(line);
        continue;
      }

      // Check if this line (alone) is a heading
      const isHeading = this.detectHeadingLevel(trimmed) > 0;

      if (isHeading && currentLines.length > 0) {
        // Flush everything accumulated so far as a block
        const flushed = currentLines.join('\n').trim();
        if (flushed) blocks.push(flushed);
        currentLines = [trimmed];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const flushed = currentLines.join('\n').trim();
      if (flushed) blocks.push(flushed);
    }

    return blocks.length > 0 ? blocks : [para];
  }

  /** Conservative, UTF-8-safe page normalization. Never modifies factual content. */
  normalizePage(text: string): string {
    let result = text;

    // Normalize PDF Wingdings bullet artifact → ASCII hyphen
    result = result.replace(/\uf0b7/g, '-');

    // Normalize CRLF → LF
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Collapse 4+ blank lines to 2 (preserve section separation)
    result = result.replace(/\n{4,}/g, '\n\n\n');

    // Normalize multiple spaces within each line only
    result = result
      .split('\n')
      .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
      .join('\n');

    return result.trim();
  }

  /**
   * Detects whether a paragraph is a heading.
   * Deliberately conservative to avoid false positives with multilingual text.
   */
  detectHeadingLevel(text: string): 0 | 1 | 2 {
    const firstLine = text.split('\n')[0].trim();

    // Level 1: numbered heading "1.", "2.", ... "10."
    if (MAIN_HEADING_RE.test(firstLine)) return 1;

    // Level 2: step headings "Étape 1 -..."
    if (STEP_HEADING_RE.test(firstLine)) return 2;

    // Level 2: known short sub-heading prefixes
    if (firstLine.length < 90 && SUB_HEADING_PREFIXES.some((p) => firstLine.startsWith(p))) {
      return 2;
    }

    return 0;
  }

  // ── Step 3-5: Section grouping ───────────────────────────────────────────

  private groupIntoSections(blocks: AnnotatedBlock[]): Section[] {
    const sections: Section[] = [];
    let currentSection: Section | null = null;

    for (const block of blocks) {
      if (block.headingLevel === 1) {
        // Major heading → flush and start new section
        if (currentSection) sections.push(currentSection);
        currentSection = {
          title: this.extractFirstLine(block.text),
          blocks: [block],
          pageStart: block.pageStart,
          pageEnd: block.pageEnd,
        };
      } else {
        // Sub-heading or body → append to current section
        if (!currentSection) {
          // Content before any heading (e.g., document title/intro)
          currentSection = {
            title: null,
            blocks: [],
            pageStart: block.pageStart,
            pageEnd: block.pageEnd,
          };
        }
        currentSection.blocks.push(block);
        currentSection.pageEnd = Math.max(currentSection.pageEnd, block.pageEnd);
      }
    }

    if (currentSection) sections.push(currentSection);
    return sections;
  }

  // ── Step 6: Size-constrained drafts ─────────────────────────────────────

  private sectionsToRawDrafts(
    sections: Section[],
  ): Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] {
    const drafts: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] = [];

    for (const section of sections) {
      const subSectionDrafts = this.sectionToSubSectionDrafts(section);
      drafts.push(...subSectionDrafts);
    }

    return this.mergeOrphanDrafts(drafts);
  }

  /**
   * Splits a single section at level-2 heading boundaries.
   * Each sub-section then gets size-capped if needed.
   */
  private sectionToSubSectionDrafts(
    section: Section,
  ): Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] {
    const result: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] = [];

    // Accumulate sub-sections
    let subTitle: string | null = section.title;
    let subBlocks: AnnotatedBlock[] = [];

    const flushSub = () => {
      if (subBlocks.length === 0) return;
      const content = subBlocks.map((b) => b.text).join('\n\n');
      const pageStart = subBlocks[0].pageStart;
      const pageEnd = subBlocks[subBlocks.length - 1].pageEnd;

      let combinedTitle = subTitle;
      if (section.title && subTitle && section.title !== subTitle) {
        combinedTitle = section.title + ' > ' + subTitle;
      }

      // Apply size splitting
      const sized = this.splitBySize(content, combinedTitle, pageStart, pageEnd);
      result.push(...sized);
      subBlocks = [];
    };

    for (const block of section.blocks) {
      if (block.headingLevel === 2) {
        // Flush previous sub-section
        flushSub();
        subTitle = this.extractFirstLine(block.text);
        // If the heading block contains more than just the heading line, keep remainder as body
        const lines = block.text.split('\n');
        const bodyAfterHeading = lines.slice(1).join('\n').trim();
        if (bodyAfterHeading) {
          subBlocks.push({ ...block, text: bodyAfterHeading, headingLevel: 0 });
        }
      } else {
        subBlocks.push(block);
      }
    }
    flushSub();

    return result;
  }

  /**
   * Splits a text that may be too large into size-bounded chunks at paragraph boundaries.
   * Applies overlap only when a split is actually needed.
   */
  private splitBySize(
    content: string,
    sectionTitle: string | null,
    pageStart: number,
    pageEnd: number,
  ): Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] {
    const tokens = this.estimateTokens(content);

    if (tokens <= HARD_MAX_TOKENS) {
      return [{ content, sectionTitle, pageStart, pageEnd }];
    }

    // Split at paragraph boundaries
    const paragraphs = content.split(/\n{2,}/);
    const chunks: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] = [];
    let current: string[] = [];
    let currentTokens = 0;
    let overlapBuffer = '';

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraTokens = this.estimateTokens(para);

      if (currentTokens + paraTokens > TARGET_MAX_TOKENS && current.length > 0) {
        // Flush current chunk
        const chunkContent = (overlapBuffer ? overlapBuffer + '\n\n' : '') + current.join('\n\n');
        chunks.push({ content: chunkContent, sectionTitle, pageStart, pageEnd });

        // Build overlap from end of flushed chunk
        overlapBuffer = this.buildOverlap(current.join('\n\n'));
        current = [para];
        currentTokens = paraTokens;
      } else {
        current.push(para);
        currentTokens += paraTokens;
      }
    }

    if (current.length > 0) {
      const chunkContent = (overlapBuffer ? overlapBuffer + '\n\n' : '') + current.join('\n\n');
      chunks.push({ content: chunkContent, sectionTitle, pageStart, pageEnd });
    }

    return chunks.length > 0 ? chunks : [{ content, sectionTitle, pageStart, pageEnd }];
  }

  /**
   * Merges tiny orphan drafts (< MIN_CHUNK_TOKENS) into the previous chunk.
   * Never merges chunks that have distinct non-null section titles — preserves
   * semantic boundaries even for naturally compact sections (e.g. fee blocks).
   */
  private mergeOrphanDrafts(
    drafts: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[],
  ): Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] {
    if (drafts.length === 0) return [];

    const result: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] = [drafts[0]];

    for (let i = 1; i < drafts.length; i++) {
      const current = drafts[i];
      const prev = result[result.length - 1];
      const tokens = this.estimateTokens(current.content);

      // Only merge if: (a) below MIN and (b) same section title or current has no distinct title
      const canMerge =
        tokens < MIN_CHUNK_TOKENS &&
        (current.sectionTitle === null || current.sectionTitle === prev.sectionTitle);

      if (canMerge) {
        result[result.length - 1] = {
          content: prev.content + '\n\n' + current.content,
          sectionTitle: prev.sectionTitle,
          pageStart: prev.pageStart,
          pageEnd: Math.max(prev.pageEnd, current.pageEnd),
        };
      } else {
        result.push(current);
      }
    }

    return result;
  }

  /**
   * Merges a tiny chunk (e.g. just a heading text) into the next chunk
   * so it doesn't stand alone as a meaningless 11-token chunk.
   */
  private mergeTinyHeadings(
    drafts: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[],
  ): Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] {
    const result: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[] = [];
    
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      const tokens = this.estimateTokens(draft.content);
      
      const isTinyHeading = tokens < 25 && (!draft.content.includes('\n') || draft.content.trim() === draft.sectionTitle?.trim());
      
      if (isTinyHeading && i + 1 < drafts.length) {
         drafts[i+1].content = draft.content + '\n\n' + drafts[i+1].content;
         drafts[i+1].pageStart = Math.min(drafts[i+1].pageStart, draft.pageStart);
         
         // Combine section titles if next doesn't already have it
         if (draft.sectionTitle && drafts[i+1].sectionTitle !== draft.sectionTitle) {
             if (drafts[i+1].sectionTitle) {
                 if (!drafts[i+1].sectionTitle!.startsWith(draft.sectionTitle + ' > ')) {
                     drafts[i+1].sectionTitle = draft.sectionTitle + ' > ' + drafts[i+1].sectionTitle;
                 }
             } else {
                 drafts[i+1].sectionTitle = draft.sectionTitle;
             }
         }
      } else {
         result.push(draft);
      }
    }
    
    return result;
  }

  /**
   * Extracts D-code definitions dynamically from the text.
   */
  private extractReferenceCodes(
    drafts: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[]
  ): Map<string, string> {
    const dictionary = new Map<string, string>();
    for (const draft of drafts) {
      const regex = /^(D\d+)\s*[-–]\s*(.+)$/gm;
      let match;
      while ((match = regex.exec(draft.content)) !== null) {
        dictionary.set(match[1], match[0].trim());
      }
    }
    return dictionary;
  }

  /**
   * Enriches chunks containing D-codes (but lacking definitions) with the extracted definitions.
   */
  private enrichWithReferenceCodes(
    drafts: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>[],
    dictionary: Map<string, string>
  ) {
    if (dictionary.size === 0) return;

    for (const draft of drafts) {
      const mentionedCodes = new Set<string>();
      const regex = /\b(D\d+)\b/g;
      let match;
      while ((match = regex.exec(draft.content)) !== null) {
        mentionedCodes.add(match[1]);
      }

      if (mentionedCodes.size > 0) {
        let addedCount = 0;
        let enrichment = '\n\nDéfinitions des références :';
        
        // Sort codes to keep them in order (e.g. D1, D2, D3)
        const sortedCodes = Array.from(mentionedCodes).sort((a, b) => {
           const numA = parseInt(a.replace('D', ''), 10);
           const numB = parseInt(b.replace('D', ''), 10);
           return numA - numB;
        });

        for (const code of sortedCodes) {
          const def = dictionary.get(code);
          // Only append if definition isn't already inside the content
          if (def && !draft.content.includes(def)) {
            enrichment += '\n' + def;
            addedCount++;
          }
        }
        if (addedCount > 0) {
          draft.content += enrichment;
        }
      }
    }
  }

  // ── Step 7: Finalization ─────────────────────────────────────────────────

  private finalizeDraft(
    draft: Omit<ChunkDraft, 'contentHash' | 'tokenCount'>,
  ): ChunkDraft {
    return {
      ...draft,
      tokenCount: this.estimateTokens(draft.content),
      contentHash: this.hashContent(draft.content),
    };
  }

  // ── Utility helpers ──────────────────────────────────────────────────────

  /**
   * Token estimation: word count × 1.33.
   *
   * Rationale: A BPE/SentencePiece tokenizer for multilingual models
   * typically produces ~1.1–1.5 tokens per word depending on language.
   * French and Arabic tend toward the higher end due to richer morphology.
   * 1.33 is a documented approximation — NOT a model-specific count.
   */
  estimateTokens(text: string): number {
    const wordCount = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * 1.33);
  }

  /**
   * Takes the last ~OVERLAP_TOKENS worth of text from a flushed chunk.
   * Works at whole-sentence boundaries when possible.
   */
  private buildOverlap(text: string): string {
    const words = text.split(/\s+/);
    const overlapWords = Math.ceil(OVERLAP_TOKENS / 1.33);
    const slice = words.slice(-overlapWords).join(' ');
    return `[...] ${slice}`;
  }

  private extractFirstLine(text: string): string {
    return text.split('\n')[0].trim();
  }

  /** SHA-256 of normalized content — stable across re-chunking runs. */
  hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }
}
