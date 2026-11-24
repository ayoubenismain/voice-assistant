/**
 * TimetableIntentService
 *
 * Deterministic keyword-based detection of timetable queries.
 * Returns a typed intent describing what the user wants (my/class, today/week/next/date).
 *
 * This runs BEFORE the scope guard so timetable queries are never rejected as out_of_scope.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { TimetableIntentResult, TimetableWhen } from './timetable.types.js';

// ── Day-name → weekday-index mapping (Mon=1 … Sun=7) ────────────────────────
const DAY_NAMES: Record<string, number> = {
  // English
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
  // French
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7,
  // Arabic / Darija
  'الاثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6, 'الأحد': 7,
  // Arabizi
  letnin: 1, tletha: 2, larb3a: 3, lkhmis: 4, ljom3a: 5,
};

// ── Timetable signal patterns ────────────────────────────────────────────────
const TIMETABLE_PATTERNS: RegExp[] = [
  // English
  /\b(timetable|schedule|class(?:es)?|lesson|lecture|course|session|slot)\b/i,
  /\bwhat\s+(?:do|does)\s+.*?\s+have\b/i,
  /\bwhat\s+(?:do\s+)?(?:i|we)\s+have\b/i,
  /\bwhat(?:'s|is)\s+(?:on|for)\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bwho\s+teaches?\b/i,
  /\bnext\s+(?:class|lesson|course|lecture|session)\b/i,
  /\bmy\s+(?:next|today|tomorrow)\b/i,
  // French
  /\b(emploi\s+du\s+temps|cours|séance|matière|horaire)\b/i,
  /\bqu(?:'est-ce\s+qu|e\s+)?\s*(?:j'ai|on\s+a|nous\s+avons)\b/i,
  /\b(?:quel|quels?)\s+cours\b/i,
  /\bprochain\s+cours\b/i,
  // Darija / Arabizi
  /\b(ch(?:nou|enu|no)\s*(?:3andna|3andi|3and[ei]|andna|andi)|andi\s+cours|3andi\s+cours)\b/i,
  /\b(wa9tech|wa9t\s+el|emta)\s+(?:el\s*)?(?:cours|class|dars)\b/i,
  /\b(dars|drous|cours)\s*(mta3|mte3|ntaa?3)\b/i,
  // Arabic
  /\b(جدول|حصة|حصص|درس|دروس|محاضرة)\b/,
  /\bماذا\s+عندي\b/,
  /\bشنو\s+عندي\b/,
];

// ── Class-code pattern (e.g. LSI-A3-02) ──────────────────────────────────────
const CLASS_CODE_RE = /\b([A-Za-z]{2,5}-[A-Za-z0-9]+-\d{2})\b/i;

@Injectable()
export class TimetableIntentService {
  private readonly logger = new Logger(TimetableIntentService.name);

  /**
   * Africa/Tunis timezone used for resolving "Monday", "next Tuesday", etc.
   */
  private readonly tz = 'Africa/Tunis';

  detect(query: string): TimetableIntentResult {
    const lower = query.toLowerCase();

    // Does the query match any timetable pattern?
    const matched = TIMETABLE_PATTERNS.some((p) => p.test(lower));
    if (!matched) {
      return { isTimetable: false };
    }

    this.logger.debug(`[TimetableIntent] timetable signal detected in: "${query.substring(0, 80)}"`);

    // ── Target: my or another class ─────────────────────────────────────────
    const classMatch = CLASS_CODE_RE.exec(query);
    const target = classMatch ? 'class' : 'my';
    const classCode = classMatch?.[1]?.toUpperCase();

    // ── When ─────────────────────────────────────────────────────────────────
    const when = this.resolveWhen(lower);

    // ── Date resolution ──────────────────────────────────────────────────────
    let date: string | undefined;
    if (when === 'date') {
      date = this.resolveDateFromQuery(lower);
    }

    return {
      isTimetable: true,
      target: target as 'my' | 'class',
      when,
      classCode,
      date,
    };
  }

  /** Determine when: today / tomorrow / week / next / date */
  private resolveWhen(lower: string): TimetableWhen {
    if (/\b(today|aujourd'hui|lyom|اليوم)\b/i.test(lower)) return 'today';
    if (/\b(tomorrow|demain|ghodwa|ghoudwa|غدا)\b/i.test(lower)) return 'tomorrow';
    if (/\b(week|semaine|jom3a|أسبوع|this\s+week|cette\s+semaine)\b/i.test(lower)) return 'week';
    if (/\b(next\s+(?:class|lesson|course|lecture|session)|prochain\s+cours|prochaine?\s+séance)\b/i.test(lower)) return 'next';

    // Named day → resolve to date
    for (const [dayName] of Object.entries(DAY_NAMES)) {
      if (lower.includes(dayName)) return 'date';
    }

    // Default: "what do I have" with no qualifier → today
    return 'today';
  }

  /** Resolve a named day ("Monday", "next Tuesday") to YYYY-MM-DD in Africa/Tunis */
  private resolveDateFromQuery(lower: string): string | undefined {
    const isNext = /\bnext\b/.test(lower) || /\bprochain[e]?\b/.test(lower) || /\bji\b/.test(lower);

    for (const [dayName, dayIndex] of Object.entries(DAY_NAMES)) {
      if (!lower.includes(dayName)) continue;

      // Current date in Africa/Tunis
      const now = new Date(
        new Date().toLocaleString('en-US', { timeZone: this.tz }),
      );
      const currentDay = now.getDay(); // 0=Sun
      // Convert JS getDay (0=Sun) to our index (1=Mon)
      const currentDayIdx = currentDay === 0 ? 7 : currentDay;

      let daysAhead = dayIndex - currentDayIdx;
      if (daysAhead <= 0) daysAhead += 7;
      if (isNext && daysAhead <= 7) daysAhead += 7;

      const target = new Date(now);
      target.setDate(now.getDate() + daysAhead);

      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, '0');
      const dd = String(target.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    return undefined;
  }

  /** Current date/time string for the system prompt */
  currentDatetime(): string {
    return new Date().toLocaleString('en-GB', {
      timeZone: this.tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
