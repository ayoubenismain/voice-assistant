import pytest

from app.exceptions import InvalidWorkbookError
from app.services.excel_parser import (extract_subject_code, normalize_time, parse_day, parse_rows,
                                       parse_workbook, read_rows)
from tests.workbook import SHEET, _row, build_workbook, lesson, sample_rows


def test_parse_representative_workbook():
    res = parse_workbook(build_workbook(), SHEET)
    assert res.number_of_classes == 2
    assert res.number_of_subgroups == 3
    assert len(res.lessons) == 8
    assert res.report.malformed_rows == 0


def test_parent_class_extraction():
    res = parse_rows(sample_rows())
    assert set(res.classes) == {"LSI-A3-02", "ING-A1-01"}


def test_subgroup_extraction_and_semester():
    res = parse_rows(sample_rows())
    assert res.classes["LSI-A3-02"] == {"LSI-A3-02-1": "SU1", "LSI-A3-02-2": "SU1"}
    assert list(res.classes["ING-A1-01"]) == ["ING-A1-01-1"]


def test_day_heading_detection_and_not_a_lesson():
    assert parse_day("1-Lundi") == (1, "Monday")
    assert parse_day("4-Jeudi") == (4, "Thursday")
    assert parse_day("6-Samedi") == (6, "Saturday")
    assert parse_day("Mercredi") == (3, "Wednesday")
    assert parse_day("hello world") is None
    res = parse_rows(sample_rows())
    assert all(l.subject for l in res.lessons)           # no lesson without a subject
    assert res.report.heading_rows >= 6                  # subgroup + day headings were skipped, not parsed


def test_lesson_row_extraction():
    res = parse_rows(sample_rows())
    l = next(x for x in res.lessons if x.subgroup_code == "LSI-A3-02-1" and x.regime == "Z1")
    assert (l.class_code, l.weekday, l.weekday_index, l.original_day_label) == ("LSI-A3-02", "Monday", 1, "1-Lundi")
    assert (l.start_time, l.end_time, l.slot, l.weekly_hours) == ("08:30", "10:00", "S1", 0.75)
    assert l.teacher == "ZOUARI Wiem" and l.teaching_type == "TP" and l.room == "G05"
    assert l.subject.startswith("1511-ERP") and l.subject_code == "1511"
    assert l.semester == "SU1"


@pytest.mark.parametrize("raw,expected", [
    ("08:30", "08:30"), ("8:30", "08:30"), ("08h30", "08:30"), ("8h", "08:00"), ("14.15", "14:15"),
    (0.375, "09:00"), (0.4375, "10:30"), ("25:00", None), ("abc", None), (None, None), ("", None),
])
def test_time_normalization(raw, expected):
    assert normalize_time(raw) == expected


def test_duplicate_sessions_different_regimes_are_kept():
    res = parse_rows(sample_rows())
    monday_830 = [l for l in res.lessons if l.subgroup_code == "LSI-A3-02-1" and l.weekday_index == 1
                  and l.start_time == "08:30"]
    assert sorted(l.regime for l in monday_830) == ["Z1", "Z2"]


def test_excel_time_fractions_in_workbook():
    res = parse_workbook(build_workbook(), SHEET)
    cloud = next(l for l in res.lessons if l.subject_code == "1620")
    assert (cloud.start_time, cloud.end_time) == ("10:30", "12:00")


def test_malformed_rows_are_counted_not_fatal():
    rows = sample_rows() + [lesson("11:00", "10:00", "9999-Bad range"), lesson("08:00", "09:00", "")]
    res = parse_rows(rows)
    assert res.report.malformed_rows == 2
    assert res.report.invalid_times == 1
    assert res.report.missing_fields["subject"] == 1
    assert len(res.lessons) == 8


def test_unexpected_day_invalidates_following_lessons():
    rows = [_row(subgroup="ABC-1-1", cls="ABC-1"), _row(day="Funday"), lesson("08:00", "09:00", "1000-X")]
    res = parse_rows(rows)
    assert res.report.unexpected_days["Funday"] == 1
    assert len(res.lessons) == 0 and res.report.malformed_rows == 1


def test_subgroup_naming_differing_from_parent_is_kept():
    # real workbook case: parent "X-01" lists subgroups "X-1" and "X-2"; column E is authoritative
    rows = [_row(subgroup="LGEnerg-A1-IEE-1", cls="LGEnerg-A1-IEE-01"), _row(day="1-Lundi"),
            lesson("08:00", "09:00", "1000-X"),
            _row(subgroup="LGEnerg-A1-IEE-2", cls="LGEnerg-A1-IEE-01"), _row(day="1-Lundi"),
            lesson("09:00", "10:00", "1001-Y")]
    res = parse_rows(rows)
    assert list(res.classes) == ["LGENERG-A1-IEE-01"]
    assert list(res.classes["LGENERG-A1-IEE-01"]) == ["LGENERG-A1-IEE-1", "LGENERG-A1-IEE-2"]
    assert len(res.lessons) == 2 and res.report.malformed_rows == 0
    assert len(res.report.naming_notes) == 2


def test_badly_formatted_heading_is_rejected_and_named():
    rows = [_row(subgroup="BAD/CODE-1", cls="BAD/CODE"), _row(day="1-Lundi"), lesson("08:00", "09:00", "1000-X")]
    res = parse_rows(rows)
    assert res.lessons == [] and res.report.malformed_rows >= 1
    assert "BAD/CODE" in res.report.rejected_headings[0]

def test_wrong_sheet_and_non_excel_rejected():
    with pytest.raises(InvalidWorkbookError):
        read_rows(build_workbook(sheet="Other"), SHEET)
    with pytest.raises(InvalidWorkbookError):
        read_rows(b"<html>not excel</html>", SHEET)


def test_subject_code_extraction():
    assert extract_subject_code("1511-ERP et intégration") == "1511"
    assert extract_subject_code("Cloud Computing") is None
