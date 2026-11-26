#!/usr/bin/env python3
"""Rotate multiple-choice options in A3 concept files so the correct answers
are spread evenly over a-d (cycling a, b, c, d by item order).

Option texts and explanations are unchanged; only the order of options and
their a-d labels move. The script is idempotent.

Usage:
    python3 -I tools/balance_answer_keys.py content/a3_concepts_*.json
"""
import json
import sys

LETTERS = ["a", "b", "c", "d"]


def rebalance(path: str) -> None:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    for idx, item in enumerate(doc["items"]):
        q = item["question"]
        texts = {o["id"]: o["text"] for o in q["options"]}
        correct_text = texts[q["correct_option_id"]]
        others = [texts[k] for k in LETTERS if k != q["correct_option_id"]]
        target = idx % 4
        ordered = others[:target] + [correct_text] + others[target:]
        q["options"] = [{"id": LETTERS[i], "text": t} for i, t in enumerate(ordered)]
        q["correct_option_id"] = LETTERS[target]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    keys = "".join(i["question"]["correct_option_id"] for i in doc["items"])
    print(f"{path}: answer keys {keys}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        rebalance(p)
