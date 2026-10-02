export interface ExtractedPage {
    pageNumber: number;
    rawText: string;
    normalizedText: string;
}
export interface ExtractionResult {
    success: boolean;
    pages: ExtractedPage[];
    pageCount: number;
    error?: string;
    errorCode?: string;
}
export declare class PdfExtractionService {
    private readonly logger;
    private readonly MIN_TEXT_THRESHOLD;
    extractPages(storagePath: string): Promise<ExtractionResult>;
    private normalizeText;
}
