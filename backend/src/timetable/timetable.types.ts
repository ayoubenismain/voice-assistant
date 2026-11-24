/**
 * Timetable intent detection types.
 */
export type TimetableWhen = 'today' | 'tomorrow' | 'week' | 'next' | 'date';

export interface TimetableIntent {
  /** true if the query is about a timetable */
  isTimetable: true;
  /** 'my' = student's own class, 'class' = another class */
  target: 'my' | 'class';
  when: TimetableWhen;
  /** class code like LSI-A3-02, only when target='class' */
  classCode?: string;
  /** explicit date in YYYY-MM-DD (resolved from "Monday", "next Tuesday", etc.) */
  date?: string;
  /** optional subgroup filter */
  subgroup?: string;
}

export interface NoTimetableIntent {
  isTimetable: false;
}

export type TimetableIntentResult = TimetableIntent | NoTimetableIntent;
