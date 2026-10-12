#!/usr/bin/env python3
"""Capture frozen P3 text-occurrence and token-item evidence for P5; no resolver."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_jsonl(data: bytes) -> list[dict]:
    return [json.loads(line) for line in data.splitlines() if line.strip()]


def p3_normalize(text: str) -> str:
    white_space = set(
        "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680"
        "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
        "\u2028\u2029\u202f\u205f\u3000"
    )
    return "".join("-" if ch == "\u2011" else ch for ch in text if ch not in white_space)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--p3-zip", type=Path, required=True)
    ap.add_argument("--population", type=Path, required=True)
    ap.add_argument("--pdf-root", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    args = ap.parse_args()

    p3_bytes = args.p3_zip.read_bytes()
    population_bytes = args.population.read_bytes()
    if sha(p3_bytes) != "73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c":
        raise SystemExit("P3 archive hash mismatch")
    population = json.loads(population_bytes)
    if len(population["segments"]) != 17:
        raise SystemExit("P5 population size mismatch")

    root = "data/work/exports/20261011_2251_FY2024_TOC_Source_Token_Mapping_P3/"
    with zipfile.ZipFile(args.p3_zip) as z:
        if z.testzip() is not None:
            raise SystemExit("P3 archive CRC failure")
        m0 = {r["segmentId"]: r for r in read_jsonl(z.read(root + "m0-segment-matches.jsonl"))}
        manifest = json.loads(z.read(root + "source-token-manifest.json"))
    pages = {(p["sourcePdf"], p["physicalPage"]): p for p in manifest["pages"]}
    a1_rows, a2_rows = [], []

    for row in population["segments"]:
        segment_id = row["p3SegmentId"]
        match = m0.get(segment_id)
        if not match or match["m0Status"] != "UNIQUE_TEXT_OCCURRENCE" or match["occurrenceCount"] != 1:
            raise SystemExit(f"P3 frozen M0 row mismatch: {segment_id}")
        occurrence = match["occurrences"][0]
        page = pages.get((row["sourcePdf"], row["physicalPage"]))
        if not page:
            raise SystemExit(f"P3 source token page missing: {segment_id}")
        if page["sourcePdfSha256"] != row["sourcePdfSha256"]:
            raise SystemExit(f"PDF source hash disagreement: {segment_id}")
        pdf = args.pdf_root / row["sourcePdf"]
        if not pdf.is_file() or sha(pdf.read_bytes()) != row["sourcePdfSha256"]:
            raise SystemExit(f"PDF file missing or hash mismatch: {pdf}")
        start, end = occurrence["start"], occurrence["end"]
        if page["normalizedStream"][start:end] != match["normalizedSegment"]:
            raise SystemExit(f"P3 occurrence does not reproduce frozen text: {segment_id}")
        if p3_normalize(row["exactSourceSegment"]) != match["normalizedSegment"]:
            raise SystemExit(f"P3 source normalization mismatch: {segment_id}")
        if occurrence["tokenAttributionStatus"] != "TOKEN_ATTRIBUTION_MAPPED":
            raise SystemExit(f"P3 token attribution unresolved: {segment_id}")

        a1_rows.append(
            {
                "p3SegmentId": segment_id,
                "sourcePdf": row["sourcePdf"],
                "physicalPage": row["physicalPage"],
                "sourceLineIndexPageLocal": row["rawLineIndexPageLocal"],
                "sourceSpanUtf16": row["sourceSpanUtf16"],
                "exactSourceSegment": row["exactSourceSegment"],
                "p3NormalizedSegment": match["normalizedSegment"],
                "sourceNormalizationStatus": "MATCHES_FROZEN_P3_RULE",
                "p3M0Status": match["m0Status"],
                "p3M0OccurrenceCount": match["occurrenceCount"],
                "occurrenceStart": start,
                "occurrenceEnd": end,
                "pageNormalizedStreamSha256": page["normalizedStreamSha256"],
                "tokenAttributionStatus": occurrence["tokenAttributionStatus"],
                "itemIndexRange": occurrence["itemIndexRange"],
                "tokenSpans": occurrence["tokenSpans"],
                "sourcePdfSha256": row["sourcePdfSha256"],
                "p3ArchiveSha256": sha(p3_bytes),
            }
        )
        item_indices = sorted({s["itemIndex"] for s in occurrence["tokenSpans"]})
        token_by_index = {t["itemIndex"]: t for t in page["tokens"]}
        if not item_indices or any(i not in token_by_index for i in item_indices):
            raise SystemExit(f"P3 token item range is incomplete: {segment_id}")
        a2_rows.append(
            {
                "p3SegmentId": segment_id,
                "sourcePdf": row["sourcePdf"],
                "physicalPage": row["physicalPage"],
                "normalizedStreamRange": [start, end],
                "normalizedStreamSha256": page["normalizedStreamSha256"],
                "pdfjsVersion": page["pdfjsVersion"],
                "itemIndexes": item_indices,
                "itemEvidence": [token_by_index[i] for i in item_indices],
                "positionGranularityFromMetadata": "ITEM_LEVEL",
                "characterBboxAvailable": False,
                "renderObservation": None,
                "sourcePdfSha256": row["sourcePdfSha256"],
            }
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in [("a1-text-occurrence-evidence.jsonl", a1_rows), ("a2-pdf-token-items.jsonl", a2_rows)]:
        (args.out_dir / name).write_text(
            "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows),
            encoding="utf-8",
        )
    manifest_out = {
        "schema": "toc-source-correspondence-p5-a1-a2-hashes/v1",
        "inputs": {
            "p3ArchiveSha256": sha(p3_bytes),
            "p5PopulationSha256": sha(population_bytes),
            "pdfs": {row["sourcePdf"]: row["sourcePdfSha256"] for row in population["segments"]},
        },
        "outputs": {
            name: sha((args.out_dir / name).read_bytes())
            for name in ["a1-text-occurrence-evidence.jsonl", "a2-pdf-token-items.jsonl"]
        },
        "segmentCount": len(a1_rows),
        "distinctPdfCount": len({r["sourcePdf"] for r in a1_rows}),
        "distinctPhysicalPages": len({(r["sourcePdf"], r["physicalPage"]) for r in a1_rows}),
        "characterBboxCount": 0,
    }
    (args.out_dir / "a1-a2-machine-manifest.json").write_text(
        json.dumps(manifest_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"a1": len(a1_rows), "a2": len(a2_rows), "pdfs": manifest_out["distinctPdfCount"], "pages": manifest_out["distinctPhysicalPages"], "characterBboxCount": 0}, indent=2))


if __name__ == "__main__":
    main()
