import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from '../embedding-provider.interface.js';
import OpenAI from 'openai';

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('EMBEDDING_API_KEY');
    const provider = this.configService.get<string>('EMBEDDING_PROVIDER');
    
    if (!apiKey && provider === 'openai') {
      throw new Error('EMBEDDING_API_KEY is required for OpenAiEmbeddingProvider');
    }
    
    this.openai = new OpenAI({ apiKey: apiKey || 'dummy-key' });
    // Default to text-embedding-3-small as requested, which performs well multilingually 
    // and is highly cost-effective (1536 dims).
    this.model = this.configService.get<string>('EMBEDDING_MODEL') || 'text-embedding-3-small';
    this.dimensions = this.configService.get<number>('EMBEDDING_DIMENSIONS') || 1536;
  }

  getProviderName(): string {
    return 'openai';
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedText(text: string): Promise<number[]> {
    const result = await this.embedTexts([text]);
    return result[0];
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts,
        dimensions: this.model.includes('text-embedding-3') ? this.dimensions : undefined,
      });

      // Ensure ordering matches input
      const embeddings = new Array(texts.length);
      for (const data of response.data) {
        if (!data.embedding || data.embedding.length !== this.dimensions) {
           throw new InternalServerErrorException(
              `EMBEDDING_DIMENSION_MISMATCH: Expected ${this.dimensions}, got ${data.embedding?.length}`
           );
        }
        // Basic validation
        if (data.embedding.some(val => isNaN(val) || !isFinite(val))) {
           throw new InternalServerErrorException('EMBEDDING_INVALID_RESPONSE: NaN or Infinity in vector');
        }
        embeddings[data.index] = data.embedding;
      }

      return embeddings;
    } catch (error: any) {
      this.logger.error(`Failed to generate embeddings: ${error.message}`);
      throw new InternalServerErrorException(
        error.code === 'rate_limit_exceeded' 
          ? 'EMBEDDING_RATE_LIMITED' 
          : 'EMBEDDING_PROVIDER_ERROR'
      );
    }
  }
}
