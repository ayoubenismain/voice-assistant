import type { LlmProvider } from './providers/llm-provider.interface.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from './types/llm.types.js';
export declare const LLM_PROVIDER_TOKEN = "LLM_PROVIDER";
export declare class LlmService {
    private readonly llmProvider;
    private readonly logger;
    constructor(llmProvider: LlmProvider);
    generateStructuredResponse(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<StructuredLlmResponse>;
}
