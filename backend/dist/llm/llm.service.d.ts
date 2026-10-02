import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from './types/llm.types.js';
export declare class LlmService {
    private readonly llmProvider;
    constructor(llmProvider: OllamaLlmProvider);
    generateStructuredResponse(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<StructuredLlmResponse>;
}
