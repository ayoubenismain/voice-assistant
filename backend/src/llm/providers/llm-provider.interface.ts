import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from '../types/llm.types.js';

export interface LlmProvider {
  generateStructuredResponse(
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<StructuredLlmResponse>;
}
