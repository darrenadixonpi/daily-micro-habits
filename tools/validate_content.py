#!/usr/bin/env python3
"""Validate Daily Micro-Habits content files against their JSON schemas
plus semantic rules the schemas cannot express.

Usage:
    python3 -I tools/validate_content.py content/*.json

Requires the jsonschema package (pip install jsonschema); versions >= 4.0
validate as draft 2020-12, older versions fall back to draft-07.

Exit code 0 = no errors (warnings allowed); 1 = at least one error.

Format (schema) errors are reported per item; content checks still run on
every other item in the same pass, so one broken item hides nothing else.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

try:  # jsonschema >= 4.0 supports draft 2020-12
    from jsonschema import Draft202012Validator as SchemaValidator
except ImportError:  # older jsonschema: draft-07 covers every keyword these schemas use
    from jsonschema import Draft7Validator as SchemaValidator

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_BY_PREFIX = {
    "a1_": "a1_word.schema.json",
    "a3_": "a3_concept.schema.json",
    "a4_": "a4_phrase.schema.json",
    "a5_": "a5_on_this_day.schema.json",
}
LATIN_SCRIPT_LANGS = {"es", "fr", "de", "it", "pt", "nl", "sv", "no", "da", "pl", "cs", "tr", "id", "vi"}
VOSOTROS_TOKENS = {"vosotros", "vosotras", "vuestro", "vuestra", "vuestros", "vuestras", "os"}
VOSOTROS_ENDING = re.compile(r"\b\w+(áis|éis)\b", re.IGNORECASE)
EXPLAINER_WORDS = (150, 260)


def load_schema(name: str) -> Draft202012Validator:
    with open(ROOT / "schemas" / name, encoding="utf-8") as fh:
        return SchemaValidator(json.load(fh))


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def contains_word(text: str, forms: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(rf"(?<![a-z]){re.escape(f)}(?![a-z])", lowered) for f in forms)


def check_a1(doc, errors, warnings, seen):
    for it in doc["items"]:
        iid = it["id"]
        if it["tier"] != doc["tier"]:
            errors.append(f"{iid}: item tier {it['tier']} != file tier {doc['tier']}")
        if not iid.startswith(f"a1-t{it['tier']}-"):
            errors.append(f"{iid}: id tier prefix does not match tier {it['tier']}")
        if it["headword"] not in it["inflections"]:
            errors.append(f"{iid}: headword '{it['headword']}' missing from inflections")
        if not contains_word(it["example_sentence"], it["inflections"]):
            errors.append(f"{iid}: example_sentence uses none of the inflections")
        key = ("A1", it["headword"])
        if key in seen:
            errors.append(f"{iid}: duplicate headword '{it['headword']}' (also {seen[key]})")
        seen[key] = iid


def check_a3(doc, errors, warnings, seen):
    for it in doc["items"]:
        iid = it["id"]
        if it["domain"] != doc["domain"]:
            errors.append(f"{iid}: item domain {it['domain']} != file domain {doc['domain']}")
        if not iid.startswith(f"a3-{it['domain']}-"):
            errors.append(f"{iid}: id domain prefix does not match domain")
        n = word_count(it["explainer"])
        if not (EXPLAINER_WORDS[0] <= n <= EXPLAINER_WORDS[1]):
            errors.append(f"{iid}: explainer has {n} words (allowed {EXPLAINER_WORDS[0]}-{EXPLAINER_WORDS[1]})")
        q = it["question"]
        ids = [o["id"] for o in q["options"]]
        if sorted(ids) != ["a", "b", "c", "d"]:
            errors.append(f"{iid}: option ids must be exactly a, b, c, d (got {ids})")
        texts = [o["text"].strip().lower() for o in q["options"]]
        if len(set(texts)) != 4:
            errors.append(f"{iid}: duplicate option texts")
        if q["correct_option_id"] not in ids:
            errors.append(f"{iid}: correct_option_id not among options")
        key = ("A3", it["title"].strip().lower())
        if key in seen:
            errors.append(f"{iid}: duplicate title '{it['title']}' (also {seen[key]})")
        seen[key] = iid
    # A guessable answer pattern undermines the recall check.
    keys = [it["question"]["correct_option_id"] for it in doc["items"]]
    if len(keys) >= 8:
        top = max(set(keys), key=keys.count)
        if keys.count(top) / len(keys) > 0.4:
            warnings.append(
                f"answer keys skewed: '{top}' is correct in {keys.count(top)} of {len(keys)} items "
                f"(run tools/balance_answer_keys.py)"
            )


def check_a4(doc, errors, warnings, seen):
    base_lang = doc["language"].split("-")[0]
    for it in doc["items"]:
        iid = it["id"]
        if base_lang in LATIN_SCRIPT_LANGS and it["transliteration"] is not None:
            errors.append(f"{iid}: transliteration must be null for Latin-script language")
        if doc["language"] == "es-419":
            tokens = set(re.findall(r"[a-záéíóúñü]+", it["phrase"].lower()))
            hits = tokens & VOSOTROS_TOKENS
            if hits:
                errors.append(f"{iid}: vosotros form(s) {sorted(hits)} not allowed in es-419")
            if VOSOTROS_ENDING.search(it["phrase"]):
                errors.append(f"{iid}: possible vosotros verb ending in '{it['phrase']}'")
        norm = re.sub(r"[^\wáéíóúñü ]", "", it["phrase"].lower()).strip()
        key = ("A4", doc["language"], norm)
        if key in seen:
            errors.append(f"{iid}: duplicate phrase (also {seen[key]})")
        seen[key] = iid


def check_a5(doc, errors, warnings, seen):
    for entry in doc["items"]:
        dk = entry["date_key"]
        month, day = map(int, dk.split("-"))
        try:
            date(2024, month, day)  # 2024 is a leap year, so 02-29 is valid
        except ValueError:
            errors.append(f"{dk}: not a calendar date")
        key = ("A5", dk)
        if key in seen:
            errors.append(f"{dk}: duplicate date_key")
        seen[key] = dk
        years = [e["year"] for e in entry["events"]]
        if years != sorted(years):
            warnings.append(f"{dk}: events not in chronological order")
        for e in entry["events"]:
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", e["summary"].strip()) if s]
            if not (1 <= len(sentences) <= 3):
                warnings.append(f"{dk} ({e['year']}): summary has {len(sentences)} sentences")


CHECKS = {"A1": check_a1, "A3": check_a3, "A4": check_a4, "A5": check_a5}


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 1
    validators = {p: load_schema(s) for p, s in SCHEMA_BY_PREFIX.items()}
    seen: dict = {}
    seen_ids: dict = {}
    total_errors = 0
    for p in sorted(paths):
        path = Path(p)
        prefix = next((k for k in SCHEMA_BY_PREFIX if path.name.startswith(k)), None)
        errors: list[str] = []
        warnings: list[str] = []
        items: list = []
        if prefix is None:
            errors.append("file name must start with a1_, a3_, a4_ or a5_")
        else:
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                errors.append(f"invalid JSON: {exc}")
                doc = None
            if doc is not None:
                # Sort by path; ints before strings so mixed paths never compare int with str.
                schema_errors = sorted(
                    validators[prefix].iter_errors(doc),
                    key=lambda e: [(0, x) if isinstance(x, int) else (1, str(x)) for x in e.path],
                )
                bad_items: set[int] = set()
                header_ok = True
                for e in schema_errors:
                    p = list(e.path)
                    loc = "/".join(str(x) for x in p) or "<root>"
                    errors.append(f"schema: {loc}: {e.message}")
                    if len(p) >= 2 and p[0] == "items" and isinstance(p[1], int):
                        bad_items.add(p[1])  # error confined to one item
                    else:
                        header_ok = False  # error in the file envelope (module, tier, items array...)
                if isinstance(doc, dict) and isinstance(doc.get("items"), list):
                    items = doc["items"]
                # ID uniqueness across all files covers every item that has a string id.
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    iid = it.get("id") or it.get("date_key")
                    if isinstance(iid, str):
                        if iid in seen_ids:
                            errors.append(f"{iid}: id also used in {seen_ids[iid]}")
                        seen_ids[iid] = path.name
                # Content checks run on every item whose own fields passed the format check.
                good = [it for i, it in enumerate(items) if i not in bad_items]
                if header_ok:
                    CHECKS[doc["module"]]({**doc, "items": good}, errors, warnings, seen)
                    if bad_items:
                        warnings.append(
                            f"content checks ran on {len(good)} of {len(items)} items; "
                            f"{len(bad_items)} skipped because of format errors"
                        )
                else:
                    errors.append("content checks skipped: the file header itself has format errors")
        n_items = len(items)
        status = "OK" if not errors else "FAIL"
        print(f"[{status}] {path.name}: {n_items} items, {len(errors)} errors, {len(warnings)} warnings")
        for e in errors:
            print(f"    ERROR   {e}")
        for w in warnings:
            print(f"    WARN    {w}")
        total_errors += len(errors)
    print(f"\nTotal errors: {total_errors}")
    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
