"""Build a deduplicated editorial word registry from the frozen source ledger.

Run with --include-related or --headwords-only after the scope is decided.
Orthographic variants share an ID; distinct words/abbreviations keep separate IDs.
"""
import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "authoring/cet4"
SPELLING_PAIRS = {
    "Biblical/biblical", "Internet/internet", "airplane/aeroplane", "check/cheque",
    "disk/disc", "dispatch/despatch", "esthetic/aesthetic", "esthetics/aesthetics",
    "gray/grey", "inquire/enquire", "inquiry/enquiry", "jail/gaol",
    "maneuver/manoeuvre", "plough/plow", "skeptical/sceptical", "skeptic/sceptic",
    "skepticism/scepticism", "specialty/speciality", "sulfur/sulphur", "tyre/tire",
}
DISTINCT_BRACKETS = {
    "alphabetic(al)", "analytic(al)", "autobiographic(al)", "electric(al)",
    "ironic(al)", "logistic(al)", "symbolic(al)", "symmetric(al)",
    "therapeutic(al)", "auto(mobile)", "dad(dy)", "mom(my)",
    "exam(ination)", "gym(nasium)", "photo(graph)", "amid(st)", "among(st)",
    "steward(ess)",
}
EXCEPTIONS = {
    "connection/-xion": {"groups": [["connection", "connexion"]], "kind": "orthographic", "note": "缩写 -xion 替换 -ction，不能按等长截断。"},
    "math(ematics)/maths": {"groups": [["math", "maths"], ["mathematics"]], "kind": "mixed", "note": "math/maths 作为缩略形式共用词条；mathematics 独立。"},
    "kilogram(me)/kilo": {"groups": [["kilogram", "kilogramme"], ["kilo"]], "kind": "mixed", "note": "kilogram/kilogramme 为拼写变体；缩略词 kilo 独立。"},
    "jewel(l)ery": {"groups": [["jewelry", "jewellery"]], "kind": "source_spelling_repair", "excluded_spellings": ["jewelery"], "note": "保留考纲原记法；按词典核实美式 jewelry、英式 jewellery，不生成非标准 jewelery。", "evidence": ["https://dictionary.cambridge.org/dictionary/english/jewelry", "https://dictionary.cambridge.org/dictionary/english/jewellery"]},
    "Celsius/-cius": {"groups": [["Celsius"]], "kind": "source_spelling_repair", "excluded_spellings": ["Celcius"], "note": "只收核实的 Celsius；原文 -cius 保留在来源台账，不当作标准拼写。", "evidence": ["https://dictionary.cambridge.org/dictionary/english/celsius"]},
    "sober/-re": {"groups": [["sober"]], "kind": "excluded_cet6_anomaly", "excluded_spellings": ["sobre"], "note": "原页确实印为 sober/-re，且标为六级。该出处不进入四级；不猜测改成 somber/sombre。"},
    "coup (d'état)": {"groups": [["coup"], ["coup d'état"]], "kind": "distinct_lexemes", "note": "附加括号为可选短语部分，不是单词内部的可选字母；此出处为六级。"},
}


def expand_brackets(value):
    match = re.search(r"\(([^()]*)\)", value)
    if not match:
        return [value]
    before, inside, after = value[:match.start()], match[1], value[match.end():]
    return expand_brackets(before + after) + expand_brackets(before + inside + after)


def notation(value):
    if value in EXCEPTIONS:
        return EXCEPTIONS[value]
    if "/-" in value:
        left, suffix = value.split("/-")
        groups = [[left, left[:-len(suffix)] + suffix]]
        kind = "orthographic"
    elif "/" in value:
        values = value.split("/")
        groups = [values] if value in SPELLING_PAIRS else [[v] for v in values]
        kind = "orthographic" if value in SPELLING_PAIRS else "distinct_lexemes"
    elif "(" in value:
        values = expand_brackets(value)
        groups = [[v] for v in values] if value in DISTINCT_BRACKETS else [values]
        kind = "distinct_lexemes" if value in DISTINCT_BRACKETS else "orthographic"
    else:
        return {"groups": [[value]], "kind": "literal"}
    return {"groups": groups, "kind": kind, "note": "仅扩展原文明确写出的形式；拼写变体合并，独立词、缩略词和非纯拼写的形态差别分开。"}


def write_csv(name, rows, fields):
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def build(include_related):
    decision_path = OUT / "scope_decision.json"
    decision = json.loads(decision_path.read_text(encoding="utf-8")) if decision_path.exists() else None
    if decision:
        assert decision["confirmed"] and include_related == decision["includeListedRelated"], "The frozen CET4 scope differs from the requested mode. Do not overwrite the approved wordlist."
    with (OUT / "source_entries.csv").open(encoding="utf-8", newline="") as f:
        source = list(csv.DictReader(f))
    forms = {r["normalized_text"]: notation(r["normalized_text"]) for r in source}
    parents = {}

    def find(x):
        parents.setdefault(x, x)
        if parents[x] != x:
            parents[x] = find(parents[x])
        return parents[x]

    def union(a, b):
        parents[find(b)] = find(a)

    candidates = defaultdict(list)
    # Resolve spelling identities over the complete source before filtering the
    # scope, so a main word keeps its ID when listed related entries are added.
    for index, row in enumerate(source):
        for group in forms[row["normalized_text"]]["groups"]:
            first = group[0].casefold()
            for value in group:
                assert re.fullmatch(r"[A-Za-zé]+(?:[ .'-][A-Za-zé]+)*\.?", value), value
                union(first, value.casefold())
            candidates[first].append((row["entry_role"] != "headword", index, group[0]))
    choices = defaultdict(list)
    for key, values in candidates.items():
        choices[find(key)].extend(values)
    canonical = {key: min(values)[2] for key, values in choices.items()}
    mappings = []
    excluded = []
    variants = defaultdict(set)
    registry = defaultdict(list)
    for row in source:
        reason = "cet6_head_row" if row["head_is_cet6"] == "true" else ("related_not_selected" if row["entry_role"] != "headword" and not include_related else "")
        if reason:
            excluded.append({"source_entry_id": row["source_entry_id"], "normalized_text": row["normalized_text"], "reason": reason})
            continue
        for group in forms[row["normalized_text"]]["groups"]:
            spelling = canonical[find(group[0].casefold())]
            word_id = "cet4-w-" + hashlib.sha256(("cyword:cet4:" + spelling.casefold()).encode()).hexdigest()[:20]
            for value in group:
                variants[word_id].add(value)
            registry[word_id].append(row)
            mappings.append({"word_id": word_id, "canonical_spelling": spelling, "source_entry_id": row["source_entry_id"], "entry_role": row["entry_role"], "source_homograph_number": row["homograph_number"], "normalization_kind": forms[row["normalized_text"]]["kind"]})
    names = {m["word_id"]: m["canonical_spelling"] for m in mappings}
    wordlist = []
    for order, (word_id, spelling) in enumerate(sorted(names.items(), key=lambda x: (x[1].casefold(), x[1])), 1):
        occurrences = registry[word_id]
        wordlist.append({"word_id": word_id, "word_order": order, "canonical_spelling": spelling, "variants_json": json.dumps(sorted(variants[word_id] - {spelling}), ensure_ascii=False), "entry_kind": "phrase" if " " in spelling else "word", "source_roles": "|".join(sorted({r["entry_role"] for r in occurrences})), "source_count": len(occurrences), "first_source_entry_id": occurrences[0]["source_entry_id"], "homograph_sources": sum(bool(r["homograph_number"]) for r in occurrences)})
    if decision:
        assert len(wordlist) == decision["expectedLearningEntries"], "The rebuilt registry differs from the frozen entry count."
    write_csv("wordlist.csv", wordlist, ["word_id", "word_order", "canonical_spelling", "variants_json", "entry_kind", "source_roles", "source_count", "first_source_entry_id", "homograph_sources"])
    write_csv("word_sources.csv", mappings, ["word_id", "canonical_spelling", "source_entry_id", "entry_role", "source_homograph_number", "normalization_kind"])
    write_csv("excluded_entries.csv", excluded, ["source_entry_id", "normalized_text", "reason"])
    (OUT / "normalization_rules.json").write_text(json.dumps({k: v for k, v in sorted(forms.items()) if v["kind"] != "literal"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    progress_path = OUT / "progress.csv"
    old = {}
    if progress_path.exists():
        old = {r["word_id"]: r for r in csv.DictReader(progress_path.open(encoding="utf-8", newline=""))}
    progress = []
    for w in wordlist:
        progress.append(old.get(w["word_id"], {"word_id": w["word_id"], "spelling": w["canonical_spelling"], "base_status": "not_started", "morphology_status": "not_started", "sentences_status": "not_started", "exam_status": "not_started", "batch_id": "", "evidence_refs": "", "issues": "", "updated_at": ""}))
    write_csv("progress.csv", progress, ["word_id", "spelling", "base_status", "morphology_status", "sentences_status", "exam_status", "batch_id", "evidence_refs", "issues", "updated_at"])
    summary = {"bookCode": "cet4", "wordlistVersion": "cet4-2016-v1", "includeListedRelated": include_related, "uniqueLearningEntries": len(wordlist), "headwordBackedEntries": sum("headword" in w["source_roles"] for w in wordlist), "relatedOnlyEntries": sum(w["source_roles"] == "listed_related" for w in wordlist), "sourceLinks": len(mappings), "excludedSourceEntries": len(excluded), "multiSourceEntries": sum(w["source_count"] > 1 for w in wordlist), "phrases": [w["canonical_spelling"] for w in wordlist if w["entry_kind"] == "phrase"], "wordlistSha256": hashlib.sha256((OUT / "wordlist.csv").read_bytes()).hexdigest()}
    (OUT / "wordlist_manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--include-related", action="store_true")
    mode.add_argument("--headwords-only", action="store_true")
    mode.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()
    if args.rules_only:
        rows = list(csv.DictReader((OUT / "source_entries.csv").open(encoding="utf-8", newline="")))
        rules = {r["normalized_text"]: notation(r["normalized_text"]) for r in rows if any(c in r["normalized_text"] for c in "()/")}
        (OUT / "normalization_rules.json").write_text(json.dumps(dict(sorted(rules.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"notationRules": len(rules), "registryWritten": False}))
    else:
        print(json.dumps(build(args.include_related), ensure_ascii=False, indent=2))
