"""Pre-commit validation of a parsed timetable. A failed report must never replace live data."""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.excel_parser import ParseResult


@dataclass
class ValidationReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict:
        return {"ok": self.ok, "errors": self.errors, "warnings": self.warnings, "stats": self.stats}


def validate_parse(result: ParseResult, *, min_classes: int = 1, min_lessons: int = 1,
                   max_malformed_ratio: float = 0.05, previous_lessons: int | None = None,
                   min_ratio_vs_previous: float = 0.5, expected_class: str | None = None) -> ValidationReport:
    rep = result.report
    n_lessons, n_bad = len(result.lessons), rep.malformed_rows
    r = ValidationReport(stats={
        "parent_groups": result.number_of_classes, "subgroups": result.number_of_subgroups,
        "lessons": n_lessons, "skipped_rows": rep.skipped_rows, "malformed_records": n_bad,
        "missing_fields": dict(rep.missing_fields), "unexpected_days": dict(rep.unexpected_days),
        "rejected_headings": list(rep.rejected_headings)})

    if result.number_of_classes < min_classes:
        r.errors.append(f"Only {result.number_of_classes} parent groups found (minimum {min_classes}).")
    if n_lessons < min_lessons:
        r.errors.append(f"Only {n_lessons} lessons found (minimum {min_lessons}).")

    total = n_lessons + n_bad
    if total and n_bad / total > max_malformed_ratio:
        r.errors.append(f"{n_bad}/{total} records malformed ({n_bad / total:.1%} > {max_malformed_ratio:.0%}).")
    elif n_bad:
        r.warnings.append(f"{n_bad} malformed records skipped.")

    if previous_lessons and n_lessons < previous_lessons * min_ratio_vs_previous:
        r.errors.append(f"Suspiciously incomplete: {n_lessons} lessons vs {previous_lessons} in the active "
                        f"snapshot (threshold {min_ratio_vs_previous:.0%}). Existing data kept.")

    for l in result.lessons:
        if not (1 <= l.weekday_index <= 7) or l.start_time >= l.end_time or not l.subject:
            r.errors.append(f"Inconsistent lesson at row {l.source_row}.")
            break

    if rep.rejected_headings:
        r.warnings.append(f"{len(rep.rejected_headings)} group heading(s) rejected, their lessons were skipped: "
                          + "; ".join(rep.rejected_headings[:10]))
    if rep.naming_notes:
        r.warnings.append(f"{len(rep.naming_notes)} subgroup code(s) are not derived from their parent code "
                          "(kept as listed in the workbook), e.g. " + "; ".join(rep.naming_notes[:3]))
    if rep.unexpected_days:
        r.warnings.append(f"Unexpected day values: {dict(rep.unexpected_days)}")
    if any(l.weekday_index == 7 for l in result.lessons):
        r.warnings.append("Lessons found on Sunday.")
    if expected_class and expected_class.upper() not in result.classes:
        r.warnings.append(f"Discovery class {expected_class} not present in workbook.")
    return r
