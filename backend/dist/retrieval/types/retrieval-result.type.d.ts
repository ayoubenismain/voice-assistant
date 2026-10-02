export type RawSemanticSearchRow = {
    id: string;
    chunkIndex: number;
    content: string;
    sectionTitle: string | null;
    pageStart: number;
    pageEnd: number;
    documentId: string;
    documentTitle: string;
    documentCategory: string | null;
    documentAcademicYear: string | null;
    documentSource: string | null;
    similarity: number;
};
export type RetrievalResultChunk = {
    id: string;
    chunkIndex: number;
    sectionTitle: string | null;
    content: string;
    pageStart: number;
    pageEnd: number;
};
export type RetrievalResultDocument = {
    id: string;
    title: string;
    category: string | null;
    academicYear: string | null;
    source: string | null;
};
export type RetrievalResultItem = {
    rank: number;
    similarity: number;
    chunk: RetrievalResultChunk;
    document: RetrievalResultDocument;
    debug?: {
        originalSemanticScore: number;
        normalizedSemanticScore: number;
        lexicalScore: number;
        rrfScore: number;
    };
};
export type SemanticSearchResponse = {
    query: string;
    topK: number;
    provider: string;
    model: string;
    dimensions: number;
    timing: {
        embeddingMs: number;
        searchMs: number;
        totalMs: number;
    };
    retrieval: {
        normalizedQuery?: string;
        detectedIntents?: string[];
        strategy: string;
    };
    results: RetrievalResultItem[];
};
