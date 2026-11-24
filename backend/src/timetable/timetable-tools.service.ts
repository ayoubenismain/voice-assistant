/**
 * TimetableToolsService
 *
 * Orchestrates timetable queries:
 *  1. Calls the TimetableClient
 *  2. Formats the API data as compact context for the LLM
 *  3. Builds a timetable-specific LLM prompt so Gemini can generate a natural-language answer
 *  4. Returns the final response via the existing LlmService
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TimetableClient, isApiError, CompactLesson } from './timetable.client.js';
import { TimetableIntentService } from './timetable-intent.service.js';
import type { TimetableIntent } from './timetable.types.js';
import { LlmService } from '../llm/llm.service.js';
import type { LlmMessage, StructuredLlmResponse } from '../llm/types/llm.types.js';

@Injectable()
export class TimetableToolsService implements OnModuleInit {
  private readonly logger = new Logger(TimetableToolsService.name);
  private timetableAvailable = false;
  private readonly studentClass: string;
  private readonly studentSubgroup: string;

  constructor(
    private readonly client: TimetableClient,
    private readonly intentService: TimetableIntentService,
    private readonly llmService: LlmService,
    private readonly config: ConfigService,
  ) {
    this.studentClass = this.config.get<string>('STUDENT_CLASS', '');
    this.studentSubgroup = this.config.get<string>('STUDENT_SUBGROUP', '');
  }

  // ── Startup health check ──────────────────────────────────────────────────

  async onModuleInit() {
    try {
      const result = await this.client.healthCheck();
      if (isApiError(result)) {
        this.logger.warn(`[Timetable] API health check failed: ${result.message} — timetable features disabled`);
        this.timetableAvailable = false;
      } else {
        this.timetableAvailable = true;
        this.logger.log(`[Timetable] API is healthy ✓`);
      }
    } catch (e) {
      this.logger.warn(`[Timetable] API unreachable on startup — timetable features disabled`);
      this.timetableAvailable = false;
    }
  }

  get isAvailable(): boolean {
    return this.timetableAvailable;
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Handle a timetable query end-to-end:
   *   intent → API call → compact context → LLM natural-language answer
   *
   * Returns a StructuredLlmResponse with type='answer' and the spoken text in `answer`.
   */
  async handle(intent: TimetableIntent, originalQuery: string): Promise<StructuredLlmResponse> {
    // If API is down, return a canned unavailable message
    if (!this.timetableAvailable) {
      return {
        type: 'answer',
        answer: 'The timetable service is currently unavailable. Please try again later.',
        clarificationQuestion: null,
        clarificationOptions: [],
        usedSourceIds: [],
      };
    }

    // ── Call the API ──────────────────────────────────────────────────────
    let apiResult: unknown;

    if (intent.target === 'my') {
      if (intent.when === 'date' && intent.date) {
        // For the student's own class by specific date, use class endpoint
        const cls = this.studentClass;
        if (!cls) {
          return this.noClassConfigured();
        }
        apiResult = await this.client.getClassTimetable(cls, 'date', {
          date: intent.date,
          subgroup: this.studentSubgroup || undefined,
        });
      } else {
        // Map 'date' without an actual date to 'today' as fallback
        const when = (intent.when === 'date') ? 'today' : intent.when;
        // 'tomorrow' is only on getMyTimetable, not getClassTimetable
        apiResult = await this.client.getMyTimetable(when as 'today' | 'tomorrow' | 'week' | 'next');
      }
    } else {
      if (!intent.classCode) {
        return {
          type: 'answer',
          answer: 'I need a class code (like LSI-A3-02) to look up another class\'s timetable.',
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: [],
        };
      }
      const classWhen = intent.when === 'tomorrow' ? 'today' : (intent.when === 'date' ? 'date' : intent.when);
      apiResult = await this.client.getClassTimetable(
        intent.classCode,
        classWhen as 'today' | 'week' | 'next' | 'date',
        { date: intent.date, subgroup: intent.subgroup },
      );
    }

    // ── Handle API error ──────────────────────────────────────────────────
    if (isApiError(apiResult)) {
      if (apiResult.code === 404) {
        return {
          type: 'answer',
          answer: `I couldn't find that class. Please double-check the class code.`,
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: [],
        };
      }
      return {
        type: 'answer',
        answer: `The timetable service returned an error: ${apiResult.message}`,
        clarificationQuestion: null,
        clarificationOptions: [],
        usedSourceIds: [],
      };
    }

    // ── Format context & ask LLM ─────────────────────────────────────────
    const context = this.formatApiResult(apiResult as Record<string, unknown>);
    const messages = this.buildTimetablePrompt(context, originalQuery);

    try {
      return await this.llmService.generateStructuredResponse(messages);
    } catch (e) {
      this.logger.error(`[Timetable] LLM formatting failed: ${(e as Error).message}`);
      // Fall back to raw data description
      return {
        type: 'answer',
        answer: context,
        clarificationQuestion: null,
        clarificationOptions: [],
        usedSourceIds: [],
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Format the API response as a compact text block for the LLM */
  private formatApiResult(data: Record<string, unknown>): string {
    const lines: string[] = [];

    // Synchronized check
    if (data.synchronized === false) {
      lines.push('⚠ TIMETABLE NOT LOADED: The timetable data has not been synchronised yet.');
      return lines.join('\n');
    }

    // Last synced staleness warning
    if (data.last_synced_at) {
      const synced = new Date(data.last_synced_at as string);
      const daysSince = (Date.now() - synced.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 10) {
        lines.push(`⚠ WARNING: Timetable was last updated ${Math.round(daysSince)} days ago — it may be outdated.`);
      }
    }

    // "next" response shape
    if ('found' in data) {
      if (data.found === false) {
        lines.push('No upcoming lessons found.');
        return lines.join('\n');
      }
      lines.push(`Next lesson: ${data.weekday} ${data.date} at ${data.start_time}`);
      this.formatLessons(data.lessons as any[], lines);
      return lines.join('\n');
    }

    // "week" response shape
    if (Array.isArray(data.days)) {
      if (data.class_code) lines.push(`Class: ${data.class_code}`);
      for (const day of data.days as any[]) {
        lines.push(`\n${day.weekday} (${day.lesson_count} lessons):`);
        this.formatLessons(day.lessons ?? [], lines);
      }
      return lines.join('\n');
    }

    // "today" / "tomorrow" / date response shape
    const lessonCount = data.lesson_count as number ?? 0;
    if (data.weekday) lines.push(`${data.weekday} ${data.date ?? ''}`);
    if (data.class_code) lines.push(`Class: ${data.class_code}`);

    if (lessonCount === 0) {
      lines.push('No classes scheduled.');
      return lines.join('\n');
    }

    lines.push(`${lessonCount} lesson(s):`);
    this.formatLessons(data.lessons as any[], lines);
    return lines.join('\n');
  }

  private formatLessons(lessons: any[], lines: string[]) {
    if (!lessons?.length) return;

    for (const l of lessons) {
      const compact = this.client.compactLesson(l);
      const parts: string[] = [];

      // Strip leading course code from subject for speech
      let subject = compact.subject ?? 'Unknown';
      subject = subject.replace(/^[A-Z]{2,5}\d{2,4}\s*[-–—]\s*/i, '');
      parts.push(subject);

      parts.push(`${compact.start_time}–${compact.end_time}`);
      parts.push(`(${compact.teaching_type})`);
      if (compact.teacher) parts.push(`with ${compact.teacher}`);
      if (compact.room) parts.push(`in ${compact.room}`);
      if (compact.regime) parts.push(`[${compact.regime}]`);
      if (compact.subgroup_code) parts.push(`(${compact.subgroup_code})`);

      lines.push(`  • ${parts.join(' · ')}`);
    }
  }

  /** Build the timetable-specific LLM prompt */
  private buildTimetablePrompt(context: string, originalQuery: string): LlmMessage[] {
    const currentDatetime = this.intentService.currentDatetime();

    const systemPrompt = `You are As2el Semi, an ISSATSO university assistant. You can answer timetable questions.
Today's date and time (Africa/Tunis) is ${currentDatetime}.
${this.studentClass ? `The student's class is ${this.studentClass}${this.studentSubgroup ? `, subgroup ${this.studentSubgroup}` : ''}.` : ''}

TIMETABLE RULES — MANDATORY:
- Only report lessons that appear in the TIMETABLE_DATA below. Never guess a room, teacher, or time.
- If the data says "TIMETABLE NOT LOADED", say the timetable has not been loaded yet. Do NOT say "no classes".
- If there are no lessons, say there are no classes for that day.
- When lessons overlap at the same time with different regime values (Z1, Z2, QA, QB, H), mention that there are parallel sessions and read both with their regime. Do not pick just one.
- If a field is null or missing, omit it from the sentence.
- Speak naturally and briefly, reply in the user's language, read times as spoken ("eight thirty" not "08:30").
- Strip leading course codes from subject names for speech.
- If the data says the timetable may be outdated, include a brief warning.
- Never call or mention sync/admin endpoints.

RESPONSE FORMAT: return JSON matching the schema (type must be "answer", put the spoken text in "answer").`;

    const userPrompt = `<TIMETABLE_DATA>
${context}
</TIMETABLE_DATA>

User question: ${originalQuery}

Based ONLY on the timetable data above, answer the user's question naturally. Return JSON matching the schema.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  private noClassConfigured(): StructuredLlmResponse {
    return {
      type: 'answer',
      answer: 'Your class is not configured yet. Please set STUDENT_CLASS in the environment.',
      clarificationQuestion: null,
      clarificationOptions: [],
      usedSourceIds: [],
    };
  }
}
