#!/usr/bin/env python3
"""Check bundled content against outside sources (spec Section 6, verification pass).

  A5  every event listed in tools/a5_verification_keywords.json must appear on its
      Wikipedia date page: a line of the page's wikitext that names the year and at
      least one of the event's keywords.
  A3  every source URL must load (HTTP 200).
  A1  every headword must have an English entry on Wiktionary; IPA that matches none
      of Wiktionary's English transcriptions is listed for review (warning only).

Runs in CI (verify-content-sources.yml), which has internet access; the development
container does not. Exit code 1 when an A5 event or an A3 source fails.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "MicroHabitsContentCheck/1.0 (personal app; github.com/darrenadixonpi/daily-micro-habits)"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def fetch(url: str, attempts: int = 3) -> tuple[int, str]:
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 503) and attempt + 1 < attempts:
                time.sleep(3 * (attempt + 1))
                continue
            return exc.code, ""
        except Exception as exc:  # network errors
            if attempt + 1 < attempts:
                time.sleep(2)
                continue
            return 0, str(exc)
    return 0, ""


def raw_wiki(site: str, title: str) -> tuple[int, str]:
    url = f"https://{site}/w/index.php?" + urllib.parse.urlencode({"title": title, "action": "raw"})
    return fetch(url)


def check_a5(report: list[str]) -> int:
    keywords = json.loads((ROOT / "tools" / "a5_verification_keywords.json").read_text(encoding="utf-8"))
    failures = 0
    report.append("## A5 events vs Wikipedia date pages\n")
    report.append("| Date | Year | Result |\n|---|---|---|")
    for date_key, events in sorted(keywords.items(), key=lambda kv: ((int(kv[0][:2]) - 11) % 12, kv[0])):
        month, day = map(int, date_key.split("-"))
        status, text = raw_wiki("en.wikipedia.org", f"{MONTHS[month - 1]}_{day}")
        lines = text.splitlines()
        for event in events:
            year = event["year"]
            year_pattern = re.compile(rf"(\[\[{abs(year)} BC\]\]|\b{abs(year)} BC\b)" if year < 0 else rf"(\[\[{year}\]\]|^\*+\s*{year}\b|\b{year}\s*[–-])")
            hits = [ln for ln in lines if year_pattern.search(ln)]
            ok = any(any(k.lower() in ln.lower() for k in event["keywords"]) for ln in hits)
            if not ok:
                failures += 1
            detail = "ok" if ok else f"NOT FOUND (HTTP {status}; {len(hits)} line(s) with the year; keywords {event['keywords']})"
            report.append(f"| {date_key} | {year} | {detail} |")
    report.append(f"\nA5: {failures} event(s) not confirmed.\n")
    return failures


def check_a3(report: list[str]) -> int:
    failures = 0
    report.append("## A3 source links\n")
    for path in sorted((ROOT / "content").glob("a3_*.json")):
        for item in json.loads(path.read_text(encoding="utf-8"))["items"]:
            source = item.get("source")
            if not source:
                continue
            status, _ = fetch(source["url"])
            if status != 200:
                failures += 1
                report.append(f"- {item['id']}: HTTP {status} for {source['url']}")
    report.append(f"\nA3: {failures} source link(s) failed.\n")
    return failures


def normalize_ipa(value: str) -> str:
    return re.sub(r"[ˈˌ.()ː/\[\]\s‿]", "", value).replace("ɝ", "ɜɹ").replace("ɚ", "əɹ").replace("r", "ɹ").replace("g", "ɡ")


def check_a1(report: list[str]) -> int:
    missing = 0
    differs: list[str] = []
    report.append("## A1 headwords vs Wiktionary\n")
    for path in sorted((ROOT / "content").glob("a1_*.json")):
        for item in json.loads(path.read_text(encoding="utf-8"))["items"]:
            status, text = raw_wiki("en.wiktionary.org", item["headword"])
            english = text.split("==English==", 1)[1].split("\n==", 1)[0] if "==English==" in text else ""
            if not english:
                missing += 1
                report.append(f"- {item['id']} {item['headword']}: no English Wiktionary entry (HTTP {status})")
                continue
            ipas = [m for tpl in re.findall(r"\{\{IPA\|en\|([^}]*)\}\}", english) for m in tpl.split("|") if m.startswith(("/", "["))]
            if ipas and normalize_ipa(item["ipa"]) not in {normalize_ipa(i) for i in ipas}:
                differs.append(f"- {item['id']} {item['headword']}: ours {item['ipa']}; Wiktionary {', '.join(ipas[:4])}")
            time.sleep(0.2)
    report.append(f"\nA1: {missing} headword(s) without an English entry.\n")
    report.append("### IPA to review (warning only)\n")
    report.extend(differs or ["- none"])
    return missing


def dump_events(date_keys: list[str]) -> int:
    """Print the Events section of Wikipedia date pages, to choose events that the page lists."""
    for date_key in date_keys:
        month, day = map(int, date_key.split("-"))
        _, text = raw_wiki("en.wikipedia.org", f"{MONTHS[month - 1]}_{day}")
        events = text.split("==Events==", 1)[1].split("\n==Births", 1)[0] if "==Events==" in text else text[:20000]
        print(f"===== {date_key} =====")
        for line in events.splitlines():
            if line.startswith("*"):
                print(re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", line)[:300])
    return 0


def main() -> int:
    if len(sys.argv) > 2 and sys.argv[1] == "--dump-events":
        return dump_events(sys.argv[2].split(","))
    report: list[str] = ["# Content source verification\n"]
    failures = check_a5(report) + check_a3(report)
    missing = check_a1(report)
    text = "\n".join(report)
    print(text)
    summary = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if summary:
        summary.write_text(text, encoding="utf-8")
    return 1 if failures or missing else 0


if __name__ == "__main__":
    sys.exit(main())
