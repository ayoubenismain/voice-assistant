export interface RagContextSource {
    sourceId: string;
    documentId: string;
    title: string;
    source: string;
    category: string;
    academicYear: string;
    sectionTitle: string;
    pageStart: number;
    pageEnd: number;
    content: string;
}
export interface RagContextResult {
    formattedContext: string;
    sources: RagContextSource[];
}
export interface RagPromptContext {
    originalQuery: string;
    clarificationQuestion?: string;
    clarificationAnswer?: string;
    ragContext: string;
}
