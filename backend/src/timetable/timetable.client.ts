/**
 * TimetableClient
 *
 * HTTP client for the local Timetable API (http://127.0.0.1:8000).
 * Uses native fetch (Node 18+) — no extra dependencies required.
 *
 * Retry policy:
 *   - 4xx  → no retry, return ApiError immediately
 *   - 5xx / network error → one quick retry, then return ApiError
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ─── Shared response shapes ───────────────────────────────────────────────────

export interface Lesson {
  class_code: string;
  subgroup_code: string | null;
  semester: string;
  weekday: string;
  slot: number;
  start_time: string;
  end_time: string;
  weekly_hours: number;
  subject: string;
  subject_code: string | null;
  teacher: string | null;
  teaching_type: 'C' | 'TD' | 'TP';
  room: string | null;
  regime: string | null;
}

/** Compact lesson sent to the model (unused fields stripped) */
export interface CompactLesson {
  subject: string;
  start_time: string;
  end_time: string;
  teacher: string | null;
  teaching_type: 'C' | 'TD' | 'TP';
  room: string | null;
  regime: string | null;
  subgroup_code: string | null;
}

export interface DayResponse {
  synchronized: boolean;
  timetable_effective_from: string;
  last_synced_at: string;
  message?: string;
  class_code?: string;
  subgroup?: string;
  date?: string;
  weekday?: string;
  lesson_count: number;
  lessons: Lesson[];
}

export interface WeekDay {
  weekday: string;
  weekday_index: number;
  lesson_count: number;
  lessons: Lesson[];
}

export interface WeekResponse extends Omit<DayResponse, 'lessons'> {
  days: WeekDay[];
}

export interface NextResponse {
  found: boolean;
  date?: string;
  weekday?: string;
  start_time?: string;
  lessons: Lesson[];
}

/** Error wrapper — never throws into the conversation layer */
export interface ApiError {
  isApiError: true;
  code: string | number;
  message: string;
  details?: unknown;
}

export type TimetableResult<T> = T | ApiError;

export function isApiError(v: unknown): v is ApiError {
  return typeof v === 'object' && v !== null && (v as ApiError).isApiError === true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compact(lesson: Lesson): CompactLesson {
  return {
    subject: lesson.subject,
    start_time: lesson.start_time,
    end_time: lesson.end_time,
    teacher: lesson.teacher,
    teaching_type: lesson.teaching_type,
    room: lesson.room,
    regime: lesson.regime,
    subgroup_code: lesson.subgroup_code,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TimetableClient {
  private readonly logger = new Logger(TimetableClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('TIMETABLE_API_BASE_URL', 'http://127.0.0.1:8000')
      .replace(/\/$/, '');
    this.timeoutMs = Number(
      this.config.get<string>('TIMETABLE_API_TIMEOUT_MS', '5000'),
    );
  }

  // ── Low-level fetch with retry ────────────────────────────────────────────

  private async fetchJson<T>(
    path: string,
    params?: Record<string, string | undefined>,
  ): Promise<TimetableResult<T>> {
    const url = this.buildUrl(path, params);

    const attempt = async (): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    // First attempt
    let response: Response;
    try {
      response = await attempt();
    } catch (err) {
      return this.retryOrFail<T>(url, attempt, err);
    }

    if (!response.ok) {
      // 4xx — no retry
      if (response.status >= 400 && response.status < 500) {
        const body = await response.json().catch(() => ({}));
        return {
          isApiError: true,
          code: response.status,
          message: (body as any)?.error?.message ?? response.statusText,
          details: body,
        } satisfies ApiError;
      }
      // 5xx — retry once
      return this.retryOrFail<T>(url, attempt, new Error(`HTTP ${response.status}`));
    }

    return response.json() as Promise<T>;
  }

  private async retryOrFail<T>(
    url: string,
    attempt: () => Promise<Response>,
    originalErr: unknown,
  ): Promise<TimetableResult<T>> {
    this.logger.warn(`[TimetableClient] First attempt failed for ${url}, retrying once…`);
    try {
      const retryResponse = await attempt();
      if (!retryResponse.ok) {
        const body = await retryResponse.json().catch(() => ({}));
        return {
          isApiError: true,
          code: retryResponse.status,
          message: (body as any)?.error?.message ?? retryResponse.statusText,
        } satisfies ApiError;
      }
      return retryResponse.json() as Promise<T>;
    } catch (retryErr) {
      const msg =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      this.logger.error(`[TimetableClient] Retry also failed: ${msg}`);
      return { isApiError: true, code: 'network', message: msg } satisfies ApiError;
    }
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getMyTimetable(
    when: 'today' | 'tomorrow' | 'week' | 'next',
  ): Promise<TimetableResult<DayResponse | WeekResponse | NextResponse>> {
    const paths: Record<string, string> = {
      today: '/api/v1/me/timetable/today',
      tomorrow: '/api/v1/me/timetable/tomorrow',
      week: '/api/v1/me/timetable/week',
      next: '/api/v1/me/timetable/next',
    };
    return this.fetchJson(paths[when]);
  }

  async getClassTimetable(
    classCode: string,
    when: 'today' | 'week' | 'next' | 'date',
    opts?: { date?: string; subgroup?: string },
  ): Promise<TimetableResult<DayResponse | WeekResponse | NextResponse>> {
    const code = classCode.toUpperCase();
    const params: Record<string, string | undefined> = {
      subgroup: opts?.subgroup,
    };

    if (when === 'date') {
      if (!opts?.date) {
        return { isApiError: true, code: 'bad_request', message: 'date param is required for when="date"' };
      }
      return this.fetchJson(`/api/v1/classes/${code}/date/${opts.date}`, params);
    }

    return this.fetchJson(`/api/v1/classes/${code}/${when}`, params);
  }

  async listClasses(): Promise<TimetableResult<unknown>> {
    return this.fetchJson('/api/v1/classes');
  }

  async healthCheck(): Promise<TimetableResult<{ status: string }>> {
    return this.fetchJson('/health');
  }

  /** Strip fields the model doesn't need */
  compactLesson = compact;
}
