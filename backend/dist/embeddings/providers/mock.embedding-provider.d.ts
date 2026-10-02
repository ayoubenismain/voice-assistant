import type { EmbeddingProvider } from '../embedding-provider.interface.js';
export declare class MockEmbeddingProvider implements EmbeddingProvider {
    getProviderName(): string;
    getModelName(): string;
    getDimensions(): number;
    embedText(text: string): Promise<number[]>;
    embedTexts(texts: string[]): Promise<number[][]>;
}
