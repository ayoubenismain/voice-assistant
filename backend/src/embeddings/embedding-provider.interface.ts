/**
 * EmbeddingProvider interface
 *
 * Implemented by:
 *   - OllamaEmbeddingProvider  (production — bge-m3, 1024 dims, local)
 *   - MockEmbeddingProvider    (unit tests only)
 *
 * Adding a new provider:
 *   1. Implement this interface in providers/<name>.embedding-provider.ts
 *   2. Register it in EmbeddingsModule and add a selector branch.
 */
export interface EmbeddingProvider {
  /**
   * Generates embeddings for an array of texts.
   * Returns a 2D array where the outer array matches the order of the input texts.
   * Ordering is guaranteed to be preserved positionally.
   */
  embedTexts(texts: string[]): Promise<number[][]>;

  /**
   * Convenience method — generates a single embedding for a given text.
   */
  embedText(text: string): Promise<number[]>;

  /**
   * The name of the provider (e.g., 'ollama')
   */
  getProviderName(): string;

  /**
   * The model currently configured (e.g., 'bge-m3')
   */
  getModelName(): string;

  /**
   * The dimensionality of the vectors produced by this model.
   * BGE-M3 via Ollama: 1024
   */
  getDimensions(): number;
}
