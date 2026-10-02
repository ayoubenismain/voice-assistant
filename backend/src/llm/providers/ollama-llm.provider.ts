import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from './llm-provider.interface.js';
import { LlmMessage, StructuredLlmResponse, LlmGenerationOptions } from '../types/llm.types.js';

@Injectable()
export class OllamaLlmProvider implements LlmProvider {
  private readonly logger = new Logger(OllamaLlmProvider.name);
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultTemperature: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
    this.defaultModel = this.configService.get<string>('LLM_MODEL', 'qwen3:4b');
    this.defaultTimeoutMs = this.configService.get<number>('LLM_TIMEOUT_MS', 120000);
    this.defaultTemperature = this.configService.get<number>('LLM_TEMPERATURE', 0);
  }

  async generateStructuredResponse(
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<StructuredLlmResponse> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const temperature = options?.temperature ?? this.defaultTemperature;

    const schema = {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['answer', 'clarification', 'no_verified_info'] },
        answer: { type: ['string', 'null'] },
        clarificationQuestion: { type: ['string', 'null'] },
        clarificationOptions: { type: 'array', items: { type: 'string' } },
        usedSourceIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'answer', 'clarificationQuestion', 'clarificationOptions', 'usedSourceIds'],
    };

    const requestBody = {
      model: this.defaultModel,
      messages,
      stream: false,
      format: schema,
      options: {
        temperature,
      },
    };

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(id);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      let parsed: StructuredLlmResponse;
      try {
        parsed = JSON.parse(data.message.content);
      } catch (err) {
        this.logger.error('Failed to parse JSON response from Ollama', err);
        throw new Error('Malformed JSON response from LLM');
      }

      return parsed;
    } catch (error: any) {
      this.logger.error(`Failed to generate response from Ollama: ${error.message}`);
      if (error.name === 'AbortError') {
        throw new ServiceUnavailableException('LLM generation timed out');
      }
      throw new ServiceUnavailableException(`LLM Provider Error: ${error.message}`);
    }
  }
}
