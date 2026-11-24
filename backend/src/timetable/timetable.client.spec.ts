/**
 * TimetableClient unit tests
 * HTTP layer is mocked via vi.spyOn(globalThis, 'fetch').
 * No real API calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TimetableClient, isApiError } from './timetable.client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLesson(overrides: Record<string, unknown> = {}) {
  return {
    class_code: 'LSI-A3-02',
    subgroup_code: null,
    semester: 'S1',
    weekday: 'Monday',
    slot: 1,
    start_time: '08:30',
    end_time: '10:00',
    weekly_hours: 1.5,
    subject: 'INF101 - Introduction to Algorithms',
    subject_code: 'INF101',
    teacher: 'Dr. Ben Ali',
    teaching_type: 'C',
    room: 'A101',
    regime: null,
    ...overrides,
  };
}

function makeDayResponse(overrides: Record<string, unknown> = {}) {
  return {
    synchronized: true,
    timetable_effective_from: '2026-09-01',
    last_synced_at: new Date().toISOString(),
    class_code: 'LSI-A3-02',
    subgroup: null,
    date: '2026-11-24',
    weekday: 'Monday',
    lesson_count: 2,
    lessons: [makeLesson(), makeLesson({ slot: 2, start_time: '10:15', end_time: '11:45' })],
    ...overrides,
  };
}

/** Returns a mock fetch Response */
function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function mockFetchError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─── Shared module builder ────────────────────────────────────────────────────

async function buildClient(
  envOverrides: Record<string, string> = {},
): Promise<TimetableClient> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TimetableClient,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback: string) =>
            ({ TIMETABLE_API_BASE_URL: 'http://127.0.0.1:8000', TIMETABLE_API_TIMEOUT_MS: '5000', ...envOverrides }[key] ?? fallback),
        },
      },
    ],
  }).compile();

  return module.get(TimetableClient);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TimetableClient', () => {
  let client: TimetableClient;

  beforeEach(async () => {
    client = await buildClient();
    vi.restoreAllMocks();
  });

  // 1. Today with lessons ─────────────────────────────────────────────────────
  it('today – returns lessons on a normal day', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch(makeDayResponse()));
    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(false);
    const day = result as any;
    expect(day.lesson_count).toBe(2);
    expect(day.lessons[0].subject).toContain('Algorithms');
  });

  // 2. Empty day ──────────────────────────────────────────────────────────────
  it('empty day – lesson_count is 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch(makeDayResponse({ lesson_count: 0, lessons: [] })),
    );
    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(false);
    expect((result as any).lesson_count).toBe(0);
  });

  // 3. synchronized = false ───────────────────────────────────────────────────
  it('synchronized false – flag is preserved in response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch(makeDayResponse({ synchronized: false, lesson_count: 0, lessons: [] })),
    );
    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(false);
    expect((result as any).synchronized).toBe(false);
  });

  // 4. Parallel regimes ───────────────────────────────────────────────────────
  it('parallel regimes – both lessons returned with regime field', async () => {
    const lessons = [
      makeLesson({ start_time: '08:30', regime: 'Z1' }),
      makeLesson({ start_time: '08:30', regime: 'Z2' }),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch(makeDayResponse({ lesson_count: 2, lessons })),
    );
    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(false);
    const day = result as any;
    expect(day.lessons[0].regime).toBe('Z1');
    expect(day.lessons[1].regime).toBe('Z2');
  });

  // 5. Null room ──────────────────────────────────────────────────────────────
  it('null room – compactLesson preserves null', async () => {
    const lesson = makeLesson({ room: null });
    const compact = client.compactLesson(lesson as any);
    expect(compact.room).toBeNull();
  });

  // 6. 404 unknown class ──────────────────────────────────────────────────────
  it('404 unknown class – returns ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch({ error: { code: 404, message: 'Class not found' } }, 404),
    );
    const result = await client.getClassTimetable('UNKNOWN-X', 'today');
    expect(isApiError(result)).toBe(true);
    expect((result as any).code).toBe(404);
    expect((result as any).message).toContain('Class not found');
  });

  // 7. Network timeout – retries once, second call succeeds ───────────────────
  it('network error – retries once and succeeds on second attempt', async () => {
    const payload = makeDayResponse({ lesson_count: 1, lessons: [makeLesson()] });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockImplementationOnce(mockFetch(payload));

    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((result as any).lesson_count).toBe(1);
  });

  // 8. API down – both attempts fail ──────────────────────────────────────────
  it('API down – both attempts fail, returns ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await client.getMyTimetable('today');
    expect(isApiError(result)).toBe(true);
    expect((result as any).code).toBe('network');
    expect((result as any).message).toContain('ECONNREFUSED');
  });

  // 9. health check ───────────────────────────────────────────────────────────
  it('healthCheck – returns status ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch({ status: 'ok' }));
    const result = await client.healthCheck();
    expect(isApiError(result)).toBe(false);
    expect((result as any).status).toBe('ok');
  });

  // 10. class timetable by date ───────────────────────────────────────────────
  it('getClassTimetable date – missing date returns ApiError', async () => {
    const result = await client.getClassTimetable('LSI-A3-02', 'date');
    expect(isApiError(result)).toBe(true);
    expect((result as any).message).toContain('date param is required');
  });
});
