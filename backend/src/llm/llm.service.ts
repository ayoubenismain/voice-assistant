import { Injectable } from '@nestjs/common';
import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from './types/llm.types.js';

@Injectable()
export class LlmService {
  constructor(private readonly llmProvider: OllamaLlmProvider) {}

  async generateStructuredResponse(
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<StructuredLlmResponse> {
    return this.llmProvider.generateStructuredResponse(messages, options);
  }
}
