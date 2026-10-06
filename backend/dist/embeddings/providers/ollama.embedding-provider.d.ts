import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../embedding-provider.interface.js';
export declare class OllamaEmbeddingProvider implements EmbeddingProvider {
    private readonly configService;
    private readonly logger;
    private readonly baseUrl;
    private readonly model;
    private readonly dimensions;
    private readonly keepAlive?;
    private readonly timeoutMs;
    constructor(configService: ConfigService);
    getProviderName(): string;
    getModelName(): string;
    getDimensions(): number;
    embedText(text: string): Promise<number[]>;
    embedTexts(texts: string[]): Promise<number[][]>;
    private fetchWithTimeout;
}
