"""Independently compare the PDF text sequence with the source ledger using pypdf.

This checks letters, hyphens and level markers on every vocabulary page. It does
not establish meanings or validate spelling repairs; those require editorial QA.
"""
import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from importlib.metadata import version

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "authoring/cet4"
SOURCE_SHA256 = "9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    pdf = parser.parse_args().pdf
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == SOURCE_SHA256
    rows = defaultdict(list)
    with (OUT / "source_entries.csv").open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows[int(row["pdf_page"])].append(row["raw_text"])
    reader = PdfReader(pdf)
    pattern = re.compile(r"[A-Za-zé★Ｇ]")
    results = []
    for page in range(21, 150):
        pdf_text = "".join(pattern.findall(reader.pages[page - 1].extract_text()))
        ledger_text = "".join(pattern.findall("".join(rows[page])))
        assert pdf_text == ledger_text, f"Letter or level-marker sequence mismatch on PDF page {page}"
        results.append({"pdf_page": page, "sequence_equal": True, "compared_characters": len(pdf_text)})
    report = {"sourceSha256": SOURCE_SHA256, "sourceLedgerSha256": hashlib.sha256((OUT / "source_entries.csv").read_bytes()).hexdigest(), "extractor": "pdfplumber", "extractorVersion": version("pdfplumber"), "independentParser": "pypdf", "independentParserVersion": version("pypdf"), "comparedAlphabet": "ASCII letters, é, printed star and PDF fullwidth-G hyphen glyph", "matchedPages": len(results), "pages": results, "limits": "不证明词义、词源、空格和词形规范化正确；这些由原页视觉复核及规范化规则单独处理。"}
    (OUT / "source_verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"matchedPages": len(results), "comparedCharacters": sum(p["compared_characters"] for p in results), "sequenceMismatches": 0}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
