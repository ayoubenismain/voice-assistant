import { Injectable } from '@nestjs/common';
import type { EmbeddingProvider } from '../embedding-provider.interface.js';

/**
 * MockEmbeddingProvider
 *
 * Used ONLY in automated unit tests — never wired at runtime.
 *
 * Dimensions match the production BGE-M3 model (1024) so that tests
 * exercise the correct vector shape without calling Ollama.
 */
@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  getProviderName(): string {
    return 'mock';
  }

  getModelName(): string {
    return 'mock-bge-m3-1024';
  }

  getDimensions(): number {
    return 1024;
  }

  async embedText(text: string): Promise<number[]> {
    const result = await this.embedTexts([text]);
    return result[0];
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Deterministic fake vectors based on text content (not random).
    return texts.map((text) => {
      const vector = new Array(1024).fill(0);
      // Encode simple signals so ordering/content tests can work:
      vector[0] = text.length / 1000;
      vector[1] = text.includes('Licence') ? 1.0 : 0.0;
      vector[2] = text.includes('inscription') ? 1.0 : 0.0;
      return vector;
    });
  }
}
