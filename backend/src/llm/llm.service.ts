import { Injectable, Inject, Logger } from '@nestjs/common';
import type { LlmProvider } from './providers/llm-provider.interface.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from './types/llm.types.js';

// Injection token for the active LLM provider.
// Resolved at module level based on LLM_PROVIDER env variable.
export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LlmProvider,
  ) {}

  async generateStructuredResponse(
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<StructuredLlmResponse> {
    this.logger.debug(`Delegating to LLM provider`);
    return this.llmProvider.generateStructuredResponse(messages, options);
  }
}
