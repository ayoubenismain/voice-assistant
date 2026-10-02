import { Injectable, Inject } from '@nestjs/common';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

@Injectable()
export class EmbeddingService {
  constructor(
    @Inject('EMBEDDING_PROVIDER')
    private readonly provider: EmbeddingProvider,
  ) {}

  async embedText(text: string): Promise<number[]> {
    return this.provider.embedText(text);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return this.provider.embedTexts(texts);
  }

  getProviderName(): string {
    return this.provider.getProviderName();
  }

  getModelName(): string {
    return this.provider.getModelName();
  }

  getDimensions(): number {
    return this.provider.getDimensions();
  }
}
