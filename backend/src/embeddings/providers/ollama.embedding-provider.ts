import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../embedding-provider.interface.js';

/**
 * OllamaEmbeddingProvider
 *
 * Calls the local Ollama HTTP API:  POST {OLLAMA_BASE_URL}/api/embed
 *
 * Model : bge-m3  (1024-dimensional, multilingual)
 *
 * No API key is required – Ollama runs fully locally.
 *
 * Install the model once with:
 *   ollama pull bge-m3
 *
 * Start the service with:
 *   systemctl start ollama   (or the equivalent for your system)
 */
@Injectable()
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OllamaEmbeddingProvider.name);

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;

  /**
   * Request timeout in milliseconds.
   * BGE-M3 on CPU can take ~2-5 minutes for a batch of 22 chunks.
   * Set to 10 minutes to safely accommodate CPU-only environments.
   */
  private readonly timeoutMs = 600_000;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      'http://127.0.0.1:11434';

    this.model =
      this.configService.get<string>('EMBEDDING_MODEL') ?? 'bge-m3';

    // ConfigService returns env values as strings; parseInt ensures numeric comparison works.
    this.dimensions =
      parseInt(String(this.configService.get<number>('EMBEDDING_DIMENSIONS') ?? 1024), 10);
  }

  // ── EmbeddingProvider interface ─────────────────────────────────────────────

  getProviderName(): string {
    return 'ollama';
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedText(text: string): Promise<number[]> {
    const results = await this.embedTexts([text]);
    return results[0];
  }

  /**
   * Embeds multiple texts in a single Ollama /api/embed call.
   *
   * Request:
   *   { "model": "bge-m3", "input": ["text1", "text2", ...] }
   *
   * Response:
   *   { "model": "bge-m3", "embeddings": [[...], [...], ...] }
   *
   * Ordering is preserved positionally.
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/api/embed`;
    const body = JSON.stringify({ model: this.model, input: texts });

    const startMs = Date.now();
    this.logger.log(
      `Embedding ${texts.length} text(s) via Ollama (${this.model}) at ${url}`,
    );

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, body);
    } catch (err: any) {
      // ECONNREFUSED or network error → Ollama is not running
      if (
        err.cause?.code === 'ECONNREFUSED' ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('fetch failed')
      ) {
        const msg = `Ollama is not available at ${this.baseUrl}. Start the Ollama service before generating embeddings.`;
        this.logger.error(msg);
        throw new InternalServerErrorException('OLLAMA_UNAVAILABLE');
      }
      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        this.logger.error(`Ollama request timed out after ${this.timeoutMs}ms`);
        throw new InternalServerErrorException('OLLAMA_REQUEST_TIMEOUT');
      }
      this.logger.error(`Ollama network error: ${err.message}`);
      throw new InternalServerErrorException('EMBEDDING_PROVIDER_UNAVAILABLE');
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(unreadable)');

      // Ollama responds 404 / 500 with a JSON body like { "error": "model 'bge-m3' not found" }
      if (
        response.status === 404 ||
        errorBody.toLowerCase().includes('not found') ||
        errorBody.toLowerCase().includes("model '") ||
        errorBody.toLowerCase().includes('"model"')
      ) {
        this.logger.error(
          `Embedding model '${this.model}' is not installed in Ollama. Run: ollama pull ${this.model}`,
        );
        throw new InternalServerErrorException('EMBEDDING_MODEL_NOT_AVAILABLE');
      }

      this.logger.error(
        `Ollama returned HTTP ${response.status}: ${errorBody}`,
      );
      throw new InternalServerErrorException('EMBEDDING_PROVIDER_ERROR');
    }

    let json: { model: string; embeddings: number[][] };
    try {
      json = (await response.json()) as { model: string; embeddings: number[][] };
    } catch {
      throw new InternalServerErrorException('EMBEDDING_INVALID_RESPONSE');
    }

    const embeddings = json?.embeddings;

    // ── Count validation ───────────────────────────────────────────────────────
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      const got = Array.isArray(embeddings) ? embeddings.length : 'undefined';
      this.logger.error(
        `EMBEDDING_RESPONSE_COUNT_MISMATCH: sent ${texts.length} inputs, got ${got} embeddings`,
      );
      throw new InternalServerErrorException(
        'EMBEDDING_RESPONSE_COUNT_MISMATCH',
      );
    }

    // ── Per-vector validation ─────────────────────────────────────────────────
    for (let i = 0; i < embeddings.length; i++) {
      const vec = embeddings[i];

      if (!Array.isArray(vec)) {
        throw new InternalServerErrorException(
          `EMBEDDING_INVALID_RESPONSE: embedding[${i}] is not an array`,
        );
      }

      if (vec.length !== this.dimensions) {
        this.logger.error(
          `EMBEDDING_DIMENSION_MISMATCH at index ${i}: expected ${this.dimensions}, got ${vec.length}`,
        );
        throw new InternalServerErrorException('EMBEDDING_DIMENSION_MISMATCH');
      }

      for (let j = 0; j < vec.length; j++) {
        const v = vec[j];
        if (typeof v !== 'number' || !isFinite(v) || isNaN(v)) {
          throw new InternalServerErrorException(
            `EMBEDDING_INVALID_RESPONSE: NaN or Infinity at embedding[${i}][${j}]`,
          );
        }
      }
    }

    const elapsed = Date.now() - startMs;
    this.logger.log(
      `Embedded ${texts.length} chunk(s) in ${elapsed}ms ` +
        `(avg ${(elapsed / texts.length).toFixed(0)}ms/chunk) ` +
        `— dims: ${this.dimensions}`,
    );

    return embeddings;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private fetchWithTimeout(url: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }
}
