import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from '../embedding-provider.interface.js';
export declare class OpenAiEmbeddingProvider implements EmbeddingProvider {
    private readonly configService;
    private readonly logger;
    private readonly openai;
    private readonly model;
    private readonly dimensions;
    constructor(configService: ConfigService);
    getProviderName(): string;
    getModelName(): string;
    getDimensions(): number;
    embedText(text: string): Promise<number[]>;
    embedTexts(texts: string[]): Promise<number[][]>;
}
