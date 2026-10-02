export interface PageContent {
    pageNumber: number;
    text: string;
}
export interface ChunkDraft {
    content: string;
    sectionTitle: string | null;
    pageStart: number;
    pageEnd: number;
    tokenCount: number;
    contentHash: string;
}
export declare class SemanticChunkerService {
    chunk(pages: PageContent[]): ChunkDraft[];
    private buildAnnotatedBlocks;
    private splitAtEmbeddedHeadings;
    normalizePage(text: string): string;
    detectHeadingLevel(text: string): 0 | 1 | 2;
    private groupIntoSections;
    private sectionsToRawDrafts;
    private sectionToSubSectionDrafts;
    private splitBySize;
    private mergeOrphanDrafts;
    private mergeTinyHeadings;
    private extractReferenceCodes;
    private enrichWithReferenceCodes;
    private finalizeDraft;
    estimateTokens(text: string): number;
    private buildOverlap;
    private extractFirstLine;
    hashContent(content: string): string;
}
