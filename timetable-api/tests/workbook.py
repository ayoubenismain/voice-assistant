"""Dependency-light builder for representative ISSATSO workbooks (only needs openpyxl)."""
import io

import openpyxl

from app.services.excel_parser import DEFAULT_COLUMNS

SHEET = "E-02EditionParGroupeS1ouS2"
HEADER = {"Semestre Universitaire": 2, "Texte59": 3, "GroupeTD": 4, "Jour": 5, "Séance": 6, "HorHebd": 7,
          "Texte87": 8, "Texte88": 9, "Matière": 10, "Texte85": 11, "TypeD'enseignement": 12,
          "Salle": 13, "Texte90": 14}


def _row(**kw):
    r = [None] * 15
    for k, v in kw.items():
        r[DEFAULT_COLUMNS["class" if k == "cls" else k]] = v
    return r


def lesson(start, end, subject, teacher="PROF A", type="TP", room="G05", regime="Z1", slot="S1", hours=0.75):
    return _row(slot=slot, hours=hours, start=start, end=end, subject=subject, teacher=teacher,
                type=type, room=room, regime=regime)


def sample_rows(variant: int = 1) -> list[list]:
    """Two parent classes, 3 subgroups. variant=2 adds an extra Friday lesson (different file hash)."""
    header = [None] * 15
    for name, c in HEADER.items():
        header[c] = name
    rows = [[None] * 15, _row(subgroup="Edition des emplois du temps"), [None] * 15, header]
    rows += [
        _row(semester="SU1", subgroup="LSI-A3-02-1", cls="LSI-A3-02"),
        _row(day="1-Lundi"),
        lesson("08:30", "10:00", "1511-ERP et intégration des Systèmes d'information-LSI-SE5", "ZOUARI Wiem", "TP", "G05", "Z1"),
        lesson("08:30", "10:00", "1511-ERP et intégration des Systèmes d'information-LSI-SE5", "ZOUARI Wiem", "TP", "G05", "Z2"),
        lesson(0.4375, 0.5, "1620-Cloud Computing", "BEN ALI Sami", "C", "A12", "H"),  # 10:30-12:00 as Excel fractions
        _row(day="4-Jeudi"),
        lesson("08:30", "10:00", "1511-ERP et intégration des Systèmes d'information-LSI-SE5", "ZOUARI Wiem", "C", "A01", "H"),
        lesson("10:15", "11:45", "1702-Big Data", "TRABELSI Omar", "TD", "B07", "QA"),
        [None] * 15,
        _row(subgroup="LSI-A3-02-2", cls="LSI-A3-02"),
        _row(day="1-Lundi"),
        lesson("08:30", "10:00", "1511-ERP et intégration des Systèmes d'information-LSI-SE5", "ZOUARI Wiem", "TP", "G06", "Z1"),
        _row(day="4-Jeudi"),
        lesson("14:00", "15:30", "1803-Sécurité", "HAMDI Nour", "TP", "G01", "QB"),
        _row(semester="SU1", subgroup="ING-A1-01-1", cls="ING-A1-01"),
        _row(day="5-Vendredi"),
        lesson("08:30", "10:00", "1101-Analyse", "KARRAY Ali", "C", "AMPHI1", "H"),
    ]
    if variant == 2:
        rows += [lesson("10:15", "11:45", "1102-Algèbre", "KARRAY Ali", "TD", "B01", "H")]
    return rows


def build_workbook(rows=None, sheet=SHEET) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    for r in (rows if rows is not None else sample_rows()):
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


