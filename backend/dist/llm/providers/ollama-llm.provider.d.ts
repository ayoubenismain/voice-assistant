import { ConfigService } from '@nestjs/config';
import { LlmProvider } from './llm-provider.interface.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from '../types/llm.types.js';
export declare class OllamaLlmProvider implements LlmProvider {
    private readonly configService;
    private readonly logger;
    private readonly baseUrl;
    private readonly defaultModel;
    private readonly defaultTimeoutMs;
    private readonly defaultTemperature;
    constructor(configService: ConfigService);
    generateStructuredResponse(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<StructuredLlmResponse>;
}
