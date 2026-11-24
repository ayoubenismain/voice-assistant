"""EXPERIMENTAL HTML fallback for the per-class endpoint's `html` field.

The real HTML structure has not been inspected yet, so this only extracts a generic cell grid from
every <table>. It is NOT used by the automatic synchronization. Once a sanitized real sample is
available, add a mapper from this grid to ParsedLesson objects and unit-test it against that sample.
"""
from __future__ import annotations

from bs4 import BeautifulSoup


def html_to_grids(html: str) -> list[list[list[str]]]:
    soup = BeautifulSoup(html or "", "html.parser")
    grids = []
    for table in soup.find_all("table"):
        grid = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
                for tr in table.find_all("tr")]
        grids.append([r for r in grid if any(r)])
    return grids
