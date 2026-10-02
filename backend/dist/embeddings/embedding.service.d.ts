import type { EmbeddingProvider } from './embedding-provider.interface.js';
export declare class EmbeddingService {
    private readonly provider;
    constructor(provider: EmbeddingProvider);
    embedText(text: string): Promise<number[]>;
    embedTexts(texts: string[]): Promise<number[][]>;
    getProviderName(): string;
    getModelName(): string;
    getDimensions(): number;
}
