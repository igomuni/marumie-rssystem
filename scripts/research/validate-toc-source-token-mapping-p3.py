#!/usr/bin/env python3
"""Validate reproducibility and accounting for the P3 source-token mapping run."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any

MECHANICAL_FILES = (
    "blinded-mapping-input.jsonl",
    "source-token-manifest.json",
    "m0-segment-matches.jsonl",
    "m1-segment-matches.jsonl",
    "segment-mapping-status.csv",
    "fragment-mapping-status.csv",
    "candidate-mapping-status.csv",
    "exploratory-summary.json",
)
FORBIDDEN_LABEL_KEYS = {
    "sourceGroup",
    "priorP1PrimaryOwnership",
    "priorP1IndependentOwnership",
    "priorP1ReviewRelation",
    "previousOwnership",
    "ownership",
    "reviewerJudgment",
    "controlFamily",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate(first: Path, second: Path, postcore: Path | None = None) -> dict[str, Any]:
    hashes: dict[str, dict[str, str]] = {}
    for name in MECHANICAL_FILES:
        left, right = first / name, second / name
        require(left.is_file() and right.is_file(), f"Missing mechanical output: {name}")
        hashes[name] = {"first": sha256(left), "rerun": sha256(right)}
        require(hashes[name]["first"] == hashes[name]["rerun"], f"Determinism mismatch: {name}")

    postcore_hashes: dict[str, str] = {}
    if postcore is not None:
        for name in MECHANICAL_FILES:
            candidate = postcore / name
            require(candidate.is_file(), f"Missing post-correction output: {name}")
            postcore_hashes[name] = sha256(candidate)
            require(postcore_hashes[name] == hashes[name]["first"], f"Contract-conformance rerun mismatch: {name}")

    packet = jsonl(first / "blinded-mapping-input.jsonl")
    require(len(packet) == 24, f"Expected 24 blinded fragments, found {len(packet)}")
    for row in packet:
        require(not (FORBIDDEN_LABEL_KEYS & row.keys()), f"Ownership/group leakage in packet row {row.get('fragmentId')}")

    m0, m1 = jsonl(first / "m0-segment-matches.jsonl"), jsonl(first / "m1-segment-matches.jsonl")
    require(len(m0) == len(m1) == 43, f"Expected 43 M0/M1 segments, found {len(m0)}/{len(m1)}")
    m0_ids, m1_ids = [r["segmentId"] for r in m0], [r["segmentId"] for r in m1]
    require(m0_ids == m1_ids, "M0/M1 segment identity/order mismatch")

    for rows, mode in ((m0, "M0"), (m1, "M1")):
        for row in rows:
            for occurrence in row["occurrences"]:
                start, end = occurrence["start"], occurrence["end"]
                require(0 <= start < end, f"Invalid {mode} occurrence span: {row['segmentId']}")
                require(occurrence["tokenAttributionStatus"] == "TOKEN_ATTRIBUTION_MAPPED", f"Unexpected {mode} token attribution status")
                require(occurrence.get("tokenSpans"), f"Missing {mode} item spans: {row['segmentId']}")
                require(occurrence.get("itemIndexRange"), f"Missing {mode} item index range: {row['segmentId']}")

    segment_rows = list(csv.DictReader((first / "segment-mapping-status.csv").open(encoding="utf-8", newline="")))
    fragment_rows = list(csv.DictReader((first / "fragment-mapping-status.csv").open(encoding="utf-8", newline="")))
    candidate_rows = list(csv.DictReader((first / "candidate-mapping-status.csv").open(encoding="utf-8", newline="")))
    summary = json.loads((first / "exploratory-summary.json").read_text(encoding="utf-8"))
    require(len(segment_rows) == 43 and len(fragment_rows) == 24 and len(candidate_rows) == 12, "CSV accounting mismatch")
    require(summary["candidateCount"] == 12 and summary["fragmentCount"] == 24 and summary["segmentCount"] == 43, "Summary population mismatch")
    require(summary["matchingInputsHadOwnershipLabels"] is False, "Matching labels were not blinded")
    require(summary["geometryUsedForSelection"] is False and summary["assemblyPerformed"] is False, "Research boundary violation")
    require(summary["pdfjsVersion"] == "5.4.296", "Unexpected pdf.js version")
    require(sum(summary["m0"].values()) == 43, "M0 accounting does not sum to segment population")
    require(sum(summary["m1"].values()) == 43, "M1 accounting does not sum to segment population")

    token_manifest = json.loads((first / "source-token-manifest.json").read_text(encoding="utf-8"))
    require(len(token_manifest["pages"]) == 8, "Expected eight source PDF pages")
    require(all(page["sourcePdfSha256"] and page["normalizedStreamSha256"] for page in token_manifest["pages"]), "Missing PDF provenance/hash")
    return {
        "schema": "toc-source-token-mapping-p3-validation/v1",
        "status": "PASS",
        "studyType": "exploratory development; not formal held-out evaluation",
        "population": {"candidateCount": len(candidate_rows), "fragmentCount": len(fragment_rows), "segmentCount": len(segment_rows), "pdfPageCount": len(token_manifest["pages"])},
        "matching": {"m0": summary["m0"], "m1": summary["m1"], "geometryUsedForSelection": False, "assemblyPerformed": False},
        "blinding": {"forbiddenLabelKeysPresent": False},
        "tokenAttribution": "all listed occurrence spans map to source item indexes and within-item offsets",
        "deterministicMechanicalOutputs": {"files": hashes, "byteIdentical": True},
        "contractConformanceRerun": {
            "performed": postcore is not None,
            "files": postcore_hashes,
            "byteIdenticalToInitialRun": postcore is not None,
            "correction": "Changed segment delimiter from JavaScript \\s to Unicode White_Space, matching the frozen definition; selected source fragments contain only U+0020 whitespace.",
        },
        "independentSourceReview": "PENDING",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", type=Path, required=True)
    parser.add_argument("--rerun", type=Path, required=True)
    parser.add_argument("--postcore", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = validate(args.first, args.rerun, args.postcore)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
