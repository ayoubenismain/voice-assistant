export interface EmbeddingProvider {
    embedTexts(texts: string[]): Promise<number[][]>;
    embedText(text: string): Promise<number[]>;
    getProviderName(): string;
    getModelName(): string;
    getDimensions(): number;
}
