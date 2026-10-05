import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { ScopeClassificationResult } from './scope-guard.types.js';

/**
 * Phase 7 — Lightweight scope classifier.
 *
 * Uses Gemini Flash-Lite only for queries that deterministic rules cannot
 * confidently resolve. Has a strict short timeout (SCOPE_CLASSIFIER_TIMEOUT_MS)
 * to ensure it never blocks the assistant path meaningfully.
 *
 * Returns null on any failure (timeout, malformed response, API error) so the
 * caller (ScopeGuardService) can apply its documented fallback policy.
 */
@Injectable()
export class ScopeClassifierProvider {
  private readonly logger = new Logger(ScopeClassifierProvider.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    this.model = this.configService.get<string>(
      'SCOPE_CLASSIFIER_MODEL',
      'gemini-3.5-flash-lite',
    );
    this.timeoutMs = this.configService.get<number>(
      'SCOPE_CLASSIFIER_TIMEOUT_MS',
      5000,
    );
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Classify a single query as in_scope or out_of_scope.
   * Returns null if the classifier fails or times out — callers must handle.
   */
  async classify(query: string): Promise<ScopeClassificationResult | null> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ text: this.buildPrompt(query) }],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              decision: {
                type: 'STRING',
                enum: ['in_scope', 'out_of_scope'],
              },
              reasonCode: {
                type: 'STRING',
                nullable: true,
              },
            },
            required: ['decision'],
          } as any,
          temperature: 0,
          abortSignal: controller.signal,
          httpOptions: {
            timeout: this.timeoutMs,
            retryOptions: { attempts: 1 }, // no SDK-internal retries
          },
        } as any,
      });

      clearTimeout(timeoutHandle);

      const raw = response.text;
      if (!raw) {
        this.logger.warn('[ScopeClassifier] Empty response from classifier.');
        return null;
      }

      const parsed = JSON.parse(raw) as ScopeClassificationResult;
      if (parsed.decision !== 'in_scope' && parsed.decision !== 'out_of_scope') {
        this.logger.warn(`[ScopeClassifier] Unexpected decision: ${parsed.decision}`);
        return null;
      }

      this.logger.debug(
        `[ScopeClassifier] decision=${parsed.decision} reasonCode=${parsed.reasonCode ?? 'n/a'}`,
      );
      return parsed;
    } catch (error: unknown) {
      clearTimeout(timeoutHandle);
      const msg = (error as any)?.message ?? 'unknown';
      this.logger.warn(`[ScopeClassifier] Classification failed: ${msg}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildPrompt(query: string): string {
    return `You are a scope classifier for As2el Semi, an AI assistant that serves ONLY students of ISSATSO (Institut Supérieur des Sciences Appliquées et de Technologie de Sousse).

Your only job: classify whether the user query is IN_SCOPE or OUT_OF_SCOPE for this ISSATSO-only assistant.

OUTPUT FORMAT — respond only with valid JSON, no explanation:
{"decision": "in_scope"} or {"decision": "out_of_scope"}

MARK IN_SCOPE when the user is asking about:
- ISSATSO registration, enrollment, inscription
- Registration fees or payment (even without mentioning ISSATSO — the assistant is ISSATSO-only)
- Required documents for registration or enrollment
- Registration or exam dates (even just "when is registration?" is in_scope)
- Academic programs: Licence, Master, Prépa, Ingénieur, Doctorat
- Departments, filières, levels (niveau, cycle)
- Exams, rattrapage, schedules (emploi du temps)
- Clubs, student life, activities at ISSATSO
- Internships (stage), PFE (end-of-study project)
- Library (bibliothèque), administrative services
- Any ISSATSO campus, student, or administrative matter

The user does NOT need to write "ISSATSO" explicitly. The assistant is ISSATSO-only, so generic student questions are in_scope.

MARK OUT_OF_SCOPE for:
- General knowledge (capitals, definitions, famous people)
- Weather forecasts
- Sports results or football scores
- Software development, coding tutorials, debugging code
- Entertainment (movies, series, music)
- Medical advice or health questions
- Questions about other universities or institutes (INSAT, ESPRIT, ENIS, ENIT, ISET, SUPCOM, FST, ISI, etc.)
- Comparisons between ISSATSO and other institutions
- Shopping, travel, finance (unrelated to student fees)
- Personal advice unrelated to student life

Supported languages: Tunisian Darija, Arabizi, Arabic, French, English, code-switching. Use the full intent — not just the language or individual tokens.

User query:
"""
${query}
"""`;
  }
}
