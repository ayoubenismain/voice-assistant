"""Stateful parser for the ISSATSO "E-02 Edition par groupe" workbook.

Layout (columns A..O, 0-based index in parentheses) per the project spec:
  C(2) semester | D(3) subgroup | E(4) parent group | F(5) day | G(6) slot | H(7) weekly hours
  I(8) start | J(9) end | K(10) subject | L(11) teacher | M(12) type | N(13) room | O(14) regime

The sheet is sparse/hierarchical: heading rows set the current parent group / subgroup / semester /
day; lesson rows only carry the lesson fields. Columns are located from the header row when it can
be found, otherwise the default positions above are used.

This module deliberately has no web/database dependencies.
"""
from __future__ import annotations

import datetime as dt
import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from app.exceptions import InvalidWorkbookError

XLS_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
XLSX_MAGIC = b"PK\x03\x04"

DAYS = {
    "lundi": (1, "Monday"), "mardi": (2, "Tuesday"), "mercredi": (3, "Wednesday"),
    "jeudi": (4, "Thursday"), "vendredi": (5, "Friday"), "samedi": (6, "Saturday"),
    "dimanche": (7, "Sunday"),
}
DAY_RE = re.compile(r"^\s*(?:(\d)\s*[-–.]\s*)?([^\W\d_]+)\s*$")
CLASS_RE = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$")
SUBJECT_CODE_RE = re.compile(r"^\s*(\d{2,6})\s*-\s*\S")

DEFAULT_COLUMNS = {"semester": 2, "subgroup": 3, "class": 4, "day": 5, "slot": 6, "hours": 7,
                   "start": 8, "end": 9, "subject": 10, "teacher": 11, "type": 12,
                   "room": 13, "regime": 14}
HEADER_ALIASES = {"semestreuniversitaire": "semester", "texte59": "subgroup", "groupetd": "class",
                  "jour": "day", "seance": "slot", "horhebd": "hours", "texte87": "start",
                  "texte88": "end", "matiere": "subject", "texte85": "teacher",
                  "typedenseignement": "type", "salle": "room", "texte90": "regime"}
REQUIRED_LESSON_FIELDS = ("subject", "start", "end")


# ----------------------------------------------------------------------------- data classes
@dataclass
class ParsedLesson:
    class_code: str
    subgroup_code: str
    semester: str | None
    weekday: str
    weekday_index: int
    original_day_label: str
    slot: str | None
    weekly_hours: float | None
    start_time: str
    end_time: str
    subject: str
    subject_code: str | None
    teacher: str | None
    teaching_type: str | None
    room: str | None
    regime: str | None
    source_row: int = 0


@dataclass
class ParseReport:
    total_rows: int = 0
    skipped_rows: int = 0          # headings, day rows, blank rows, rows above the header
    heading_rows: int = 0
    malformed_rows: int = 0
    missing_fields: Counter = field(default_factory=Counter)
    unexpected_days: Counter = field(default_factory=Counter)
    invalid_times: int = 0
    rejected_headings: list[str] = field(default_factory=list)  # group headings refused (bad format)
    naming_notes: list[str] = field(default_factory=list)       # subgroup code not derived from parent code
    issues: list[str] = field(default_factory=list)  # capped sample for humans

    def issue(self, row: int, msg: str) -> None:
        if len(self.issues) < 50:
            self.issues.append(f"row {row}: {msg}")

    def as_dict(self) -> dict:
        return {"total_rows": self.total_rows, "skipped_rows": self.skipped_rows,
                "heading_rows": self.heading_rows, "malformed_rows": self.malformed_rows,
                "missing_fields": dict(self.missing_fields),
                "unexpected_days": dict(self.unexpected_days),
                "invalid_times": self.invalid_times, "rejected_headings": self.rejected_headings,
                "naming_notes_count": len(self.naming_notes), "naming_notes": self.naming_notes[:20],
                "issues": self.issues}


@dataclass
class ParseResult:
    lessons: list[ParsedLesson]
    classes: dict[str, dict[str, str | None]]  # class_code -> {subgroup_code: semester}
    report: ParseReport

    @property
    def number_of_classes(self) -> int:
        return len(self.classes)

    @property
    def number_of_subgroups(self) -> int:
        return sum(len(s) for s in self.classes.values())


# ----------------------------------------------------------------------------- small helpers
def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _header_key(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", _strip_accents(str(v or "")).lower())


def clean_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def normalize_code(v: str) -> str:
    return re.sub(r"\s+", "", v).upper()


def normalize_time(v: Any) -> str | None:
    """Return zero-padded 'HH:MM' or None. Accepts '8:30', '08h30', '8h', time/datetime, Excel day fractions."""
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.strftime("%H:%M")
    if isinstance(v, dt.time):
        return v.strftime("%H:%M")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 0 <= v < 1:
            minutes = round(v * 24 * 60)
            return f"{minutes // 60 % 24:02d}:{minutes % 60:02d}"
        return None
    m = re.match(r"^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{2})?)\s*(?::\d{2})?\s*$", str(v))
    if not m:
        return None
    hh, mm = int(m.group(1)), int(m.group(2) or 0)
    return f"{hh:02d}:{mm:02d}" if hh < 24 and mm < 60 else None


def parse_weekly_hours(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ".").strip())
    except ValueError:
        return None


def parse_day(label: str) -> tuple[int, str] | None:
    m = DAY_RE.match(label)
    if not m:
        return None
    return DAYS.get(_strip_accents(m.group(2)).lower())


def extract_subject_code(subject: str) -> str | None:
    m = SUBJECT_CODE_RE.match(subject)
    return m.group(1) if m else None


# ----------------------------------------------------------------------------- reading files
def read_rows(data: bytes, sheet_name: str | None = None) -> list[list[Any]]:
    """Read the target worksheet into a list of rows. Format is detected from content, not extension."""
    sheet_name = (sheet_name or "").strip() or None
    if data.startswith(XLS_MAGIC):
        return _read_xls(data, sheet_name)
    if data.startswith(XLSX_MAGIC):
        return _read_xlsx(data, sheet_name)
    raise InvalidWorkbookError("File is not an Excel workbook (unrecognised file signature).")


def _pick_sheet(names: list[str], wanted: str | None) -> str:
    if wanted is None:
        if not names:
            raise InvalidWorkbookError("Workbook contains no worksheets.")
        return names[0]
    for n in names:
        if n.strip() == wanted:
            return n
    raise InvalidWorkbookError(f"Expected worksheet '{wanted}' not found.", details={"sheets": names})


def _read_xls(data: bytes, wanted: str | None) -> list[list[Any]]:
    try:
        import xlrd
    except ImportError as exc:  # pragma: no cover
        raise InvalidWorkbookError("The 'xlrd' package is required to read .xls files.") from exc
    try:
        book = xlrd.open_workbook(file_contents=data)
    except Exception as exc:
        raise InvalidWorkbookError(f"Cannot open .xls workbook ({type(exc).__name__}).") from exc
    sheet = book.sheet_by_name(_pick_sheet(book.sheet_names(), wanted))
    rows: list[list[Any]] = []
    for r in range(sheet.nrows):
        row: list[Any] = []
        for c in range(sheet.ncols):
            cell = sheet.cell(r, c)
            if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK, xlrd.XL_CELL_ERROR):
                row.append(None)
            elif cell.ctype == xlrd.XL_CELL_DATE:
                t = xlrd.xldate_as_tuple(cell.value, book.datemode)
                row.append(dt.time(*t[3:6]) if t[:3] == (0, 0, 0) else dt.datetime(*t))
            else:
                row.append(cell.value)
        rows.append(row)
    return rows


def _read_xlsx(data: bytes, wanted: str | None) -> list[list[Any]]:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise InvalidWorkbookError(f"Cannot open .xlsx workbook ({type(exc).__name__}).") from exc
    try:
        ws = wb[_pick_sheet(wb.sheetnames, wanted)]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


# ----------------------------------------------------------------------------- the parser
def detect_columns(rows: list[list[Any]]) -> tuple[dict[str, int], int | None]:
    """Find the header row (>=4 known column names). Returns (column map, header row index)."""
    for i, row in enumerate(rows[:40]):
        found = {HEADER_ALIASES[k]: c for c, v in enumerate(row)
                 if (k := _header_key(v)) in HEADER_ALIASES}
        if len(found) >= 4:
            return {**DEFAULT_COLUMNS, **found}, i
    return dict(DEFAULT_COLUMNS), None


def parse_rows(rows: list[list[Any]]) -> ParseResult:
    columns, header_idx = detect_columns(rows)
    start = header_idx + 1 if header_idx is not None else 0
    report = ParseReport(total_rows=len(rows), skipped_rows=start)

    lessons: list[ParsedLesson] = []
    classes: dict[str, dict[str, str | None]] = {}

    cur_class: str | None = None
    cur_sub: str | None = None
    cur_sem: str | None = None
    cur_day: tuple[int, str, str] | None = None  # (index, english, original label)

    for idx in range(start, len(rows)):
        row, rownum = rows[idx], idx + 1

        def raw(f: str) -> Any:
            c = columns[f]
            return row[c] if c < len(row) else None

        def txt(f: str) -> str:
            return clean_text(raw(f))

        # ---- state updates from heading information ------------------------------------
        sem, sub, cls = txt("semester"), txt("subgroup"), txt("class")
        if sem:
            cur_sem = sem
        row_had_heading = False
        if cls or sub:
            row_had_heading = True
            parent = normalize_code(cls) if cls else cur_class
            if cls and not sub and parent == cur_class:
                pass  # parent repeated on a lesson row: keep current subgroup
            else:
                subg = normalize_code(sub) if sub else None
                # Column E (parent group) is authoritative: the workbook's own subgroup naming is not
                # always derived from it (e.g. parent "X-01" with subgroups "X-1", "X-2"). Only the
                # code FORMAT is enforced; naming differences are recorded as notes.
                ok = bool(parent) and bool(CLASS_RE.match(parent or "")) and (
                    subg is None or bool(CLASS_RE.match(subg)))
                if not ok:
                    report.rejected_headings.append(f"row {rownum}: class={cls!r} subgroup={sub!r}")
                    report.malformed_rows += 1
                    report.issue(rownum, f"invalid parent/subgroup pair ({cls!r}, {sub!r})")
                    cur_class = cur_sub = None
                    continue
                cur_class, cur_sub = parent, subg or parent
                if subg and subg != parent and not subg.startswith(parent + "-"):
                    report.naming_notes.append(f"row {rownum}: subgroup {subg} listed under {parent}")
                classes.setdefault(cur_class, {})
                if cur_sub != cur_class or not classes[cur_class]:
                    classes[cur_class].setdefault(cur_sub, cur_sem)

        day_label = txt("day")
        if day_label:
            row_had_heading = True
            d = parse_day(day_label)
            if d:
                cur_day = (d[0], d[1], day_label)
            else:
                cur_day = None
                report.unexpected_days[day_label] += 1
                report.issue(rownum, f"unrecognised day {day_label!r}")

        # ---- is this a lesson row? -----------------------------------------------------
        has_lesson_data = any(txt(f) for f in ("subject", "teacher", "type", "room")) or \
            raw("start") not in (None, "") or raw("end") not in (None, "")
        if not has_lesson_data:
            report.skipped_rows += 1
            if row_had_heading:
                report.heading_rows += 1
            continue

        missing = [f for f in REQUIRED_LESSON_FIELDS
                   if (not txt(f) if f == "subject" else raw(f) in (None, ""))]
        if cur_class is None:
            missing.append("class")
        if cur_day is None:
            missing.append("day")
        start_t, end_t = normalize_time(raw("start")), normalize_time(raw("end"))
        if not missing and (start_t is None or end_t is None or start_t >= end_t):
            report.invalid_times += 1
            report.malformed_rows += 1
            report.issue(rownum, f"invalid time range {raw('start')!r}-{raw('end')!r}")
            continue
        if missing:
            report.malformed_rows += 1
            report.missing_fields.update(missing)
            report.issue(rownum, f"missing {', '.join(missing)}")
            continue

        subject = txt("subject")
        lessons.append(ParsedLesson(
            class_code=cur_class, subgroup_code=cur_sub or cur_class, semester=cur_sem,
            weekday=cur_day[1], weekday_index=cur_day[0], original_day_label=cur_day[2],
            slot=txt("slot") or None, weekly_hours=parse_weekly_hours(raw("hours")),
            start_time=start_t, end_time=end_t, subject=subject,
            subject_code=extract_subject_code(subject), teacher=txt("teacher") or None,
            teaching_type=txt("type") or None, room=txt("room") or None,
            regime=txt("regime") or None, source_row=rownum))

    return ParseResult(lessons=lessons, classes=classes, report=report)


def parse_workbook(data: bytes, sheet_name: str | None = None) -> ParseResult:
    return parse_rows(read_rows(data, sheet_name))
