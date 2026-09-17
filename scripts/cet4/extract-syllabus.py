"""Extract source locations, not teaching content, from the pinned CET syllabus PDF.

Usage: python -X utf8 scripts/cet4/extract-syllabus.py PATH_TO_PDF
Requires pdfplumber. Outputs an auditable source ledger under authoring/cet4.
"""
import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "authoring/cet4"
PDF_SHA256 = "9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1"
SOURCE_ID = "neea-cet-syllabus-2016"
HEADERS = ["source_entry_id", "source_id", "pdf_page", "printed_page", "row", "column", "x", "baseline_y", "raw_text", "normalized_text", "homograph_number", "entry_role", "head_entry_id", "head_text", "head_is_cet6", "level_basis"]
SPELLING_REPAIRS = {
    "accordingto": "according to",
    "babyboom": "baby boom",
    "babyboomer": "baby boomer",
    "owingto": "owing to",
    "coup(d'état)": "coup (d'état)",
}


def normalized(text):
    # These are glyph-encoding repairs specific to this hash-pinned PDF.
    text = text.replace("Ｇ", "-").replace("\U001001b3", "'")
    text = unicodedata.normalize("NFKC", text).replace("★", "")
    text = re.sub(r"[123]", "", text).strip()
    return SPELLING_REPAIRS.get(text, text)


def extract(pdf_path):
    assert hashlib.sha256(pdf_path.read_bytes()).hexdigest() == PDF_SHA256, "Source PDF hash changed; inspect the new source before extracting."
    entries = []
    audit = []
    with pdfplumber.open(pdf_path) as pdf:
        assert len(pdf.pages) == 215
        for number in range(21, 150):
            page = pdf.pages[number - 1]
            rows = defaultdict(list)
            for char in page.chars:
                if not 70 < char["top"] < 680:
                    continue
                text = char["text"]
                if text in ("词", "表", "\u3000"):
                    continue
                # The table has 42 equally spaced baselines. Superscript sense
                # numbers are 4.5pt above their word, so belong to that same row.
                index = round((668.79 - char["matrix"][5]) / 14.17)
                if not 0 <= index < 42:
                    continue
                rows[index + 1].append(char)
            row_count = 0
            for row, chars in sorted(rows.items()):
                chars.sort(key=lambda c: c["x0"])
                if not any(c["text"].isascii() and c["text"].isalpha() for c in chars):
                    continue  # The printed totals on PDF page 149 are not words.
                row_count += 1
                cells = []
                for char in chars:
                    if not cells or (char["x0"] >= 160 and char["x0"] - cells[-1][-1]["x0"] > 10 and cells[-1][-1]["text"] != "★"):
                        cells.append([])
                    cells[-1].append(char)
                head_raw = "".join(c["text"] for c in cells[0])
                head_id = f"cet2016-p{number:03d}-r{row:02d}-c1"
                cet6 = "★" in head_raw
                for column, cell in enumerate(cells, 1):
                    raw = "".join(c["text"] for c in cell)
                    assert not (column > 1 and "★" in raw), "Unexpected individual level marker"
                    homograph = "".join(unicodedata.normalize("NFKC", c["text"]) for c in cell if unicodedata.normalize("NFKC", c["text"]).isdigit())
                    value = normalized(raw)
                    assert re.fullmatch(r"[A-Za-zé'()./ -]+", value), (number, row, raw)
                    entries.append(dict(zip(HEADERS, [
                        f"cet2016-p{number:03d}-r{row:02d}-c{column}", SOURCE_ID,
                        number, number - 5, row, column, round(cell[0]["x0"], 3),
                        round(668.79 - (row - 1) * 14.17, 3), raw, value, homograph,
                        "headword" if column == 1 else "listed_related",
                        head_id, normalized(head_raw), str(cet6).lower(),
                        "printed_head_star" if column == 1 else "inherited_from_head_row",
                    ])))
                audit.append({"pdf_page": number, "row": row, "entries": len(cells), "cet6_head": cet6, "character_count": len(chars)})
            assert row_count == (1 if number == 149 else 42), (number, row_count)
            page.close()
    return entries, audit


def main():
    args = argparse.ArgumentParser()
    args.add_argument("pdf", type=Path)
    source = args.parse_args().pdf
    entries, audit = extract(source)
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "source_entries.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(entries)
    counts = Counter((e["entry_role"], e["head_is_cet6"]) for e in entries)
    pages = []
    for number in range(21, 150):
        page_rows = [row for row in audit if row["pdf_page"] == number]
        pages.append({"pdf_page": number, "printed_page": number - 5, "headword_rows": len(page_rows), "listed_related_entries": sum(row["entries"] - 1 for row in page_rows), "cet6_head_rows": sum(row["cet6_head"] for row in page_rows), "character_count": sum(row["character_count"] for row in page_rows)})
    report = {
        "sourceSha256": PDF_SHA256,
        "pdfPageRange": [21, 149], "printedPageRange": [16, 144],
        "visibleHeadwordRows": sum(v for (role, _), v in counts.items() if role == "headword"),
        "visibleListedRelatedEntries": sum(v for (role, _), v in counts.items() if role == "listed_related"),
        "cet4HeadRows": counts[("headword", "false")],
        "cet6HeadRows": counts[("headword", "true")],
        "cet4ListedRelatedEntries": counts[("listed_related", "false")],
        "cet6ListedRelatedEntries": counts[("listed_related", "true")],
        "printedTotals": {"headwords": 5418, "listedRelated": 2551},
        "pages": pages,
    }
    (OUT / "extraction_audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "pages"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
