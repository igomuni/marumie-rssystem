#!/usr/bin/env python3
"""Create source-only observations from frozen P3 outputs; never remap tokens."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def read_jsonl(data: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in data.decode("utf-8").splitlines() if line]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def norm_context(value: str) -> str:
    return "".join("-" if ch == "\u2011" else ch for ch in value if not ch.isspace())


def mismatch(expected: str, actual: str, side: str) -> dict[str, Any]:
    if not expected:
        status = f"{side}_ABSENT"
    elif expected == actual:
        status = f"{side}_MATCH"
    else:
        status = f"{side}_MISMATCH"
    common = 0
    for a, b in zip(expected, actual):
        if a != b:
            break
        common += 1
    common_suffix = 0
    for a, b in zip(expected[::-1], actual[::-1]):
        if a != b:
            break
        common_suffix += 1
    return {
        "status": status,
        "expected": expected,
        "actual": actual,
        "firstDifferenceIndex": common if status.endswith("MISMATCH") else None,
        "commonPrefixLength": common,
        "commonSuffixLength": common_suffix,
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--p3-zip", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    inventory_bytes = args.inventory.read_bytes()
    inventory = json.loads(inventory_bytes)
    expected_zip = inventory["p3ZipSha256"]
    zip_bytes = args.p3_zip.read_bytes()
    if sha(zip_bytes) != expected_zip:
        raise SystemExit("P3 ZIP hash differs from frozen inventory")

    with zipfile.ZipFile(args.p3_zip) as archive:
        if archive.testzip() is not None:
            raise SystemExit("P3 ZIP CRC failure")
        names = archive.namelist()

        def entry(suffix: str) -> bytes:
            found = [name for name in names if name.endswith("/" + suffix)]
            if len(found) != 1:
                raise SystemExit(f"expected one {suffix}, found {len(found)}")
            return archive.read(found[0])

        token_manifest_bytes = entry("source-token-manifest.json")
        m0_bytes = entry("m0-segment-matches.jsonl")
        m1_bytes = entry("m1-segment-matches.jsonl")

    pages = json.loads(token_manifest_bytes)["pages"]
    page_by_key = {(p["sourcePdf"], p["physicalPage"]): p for p in pages}
    m0_rows = {r["segmentId"]: r for r in read_jsonl(m0_bytes)}
    m1_rows = {r["segmentId"]: r for r in read_jsonl(m1_bytes)}
    frozen_rows = inventory["segments"]
    if set(m0_rows) != set(m1_rows) or set(m0_rows) != {r["segmentId"] for r in frozen_rows}:
        raise SystemExit("P3 result IDs do not match frozen 43-segment population")

    raw_rows: list[dict[str, Any]] = []
    stream_rows: list[dict[str, Any]] = []
    diff_rows: list[dict[str, Any]] = []
    order_rows: list[dict[str, Any]] = []
    summary: dict[str, Any] = {"segmentCount": 0, "occurrenceCount": 0, "transitionCounts": {}}

    for frozen in sorted(frozen_rows, key=lambda r: r["segmentId"]):
        sid = frozen["segmentId"]
        m0, m1 = m0_rows[sid], m1_rows[sid]
        if m0["m0Status"] != frozen["m0Status"] or m1["m1Status"] != frozen["m1Status"]:
            raise SystemExit(f"P3 frozen status mismatch: {sid}")
        if m0["occurrenceCount"] != frozen["m0OccurrenceCount"] or m1["occurrenceCount"] != frozen["m1OccurrenceCount"]:
            raise SystemExit(f"P3 frozen count mismatch: {sid}")

        line = frozen["exactFullRawLine"]
        start, end = frozen["sourceSpanUtf16"]
        encoded = line.encode("utf-16-le")
        segment = encoded[start * 2:end * 2].decode("utf-16-le")
        if segment != frozen["exactSourceSegment"]:
            raise SystemExit(f"frozen span mismatch: {sid}")
        py_start = len(encoded[:start * 2].decode("utf-16-le"))
        py_end = len(encoded[:end * 2].decode("utf-16-le"))
        expected_before = norm_context(line[:py_start])[-12:]
        expected_after = norm_context(line[py_end:])[:12]
        if expected_before != m0["contextBefore"] or expected_after != m0["contextAfter"]:
            raise SystemExit(f"frozen context mismatch: {sid}")

        page = page_by_key[(frozen["sourcePdf"], frozen["physicalPage"])]
        stream = page["normalizedStream"]
        if sha(stream.encode("utf-8")) != page["normalizedStreamSha256"]:
            raise SystemExit(f"P3 normalized stream hash mismatch: {sid}")
        tokens = page["tokens"]
        m1_positions = {(o["start"], o["end"]) for o in m1["occurrences"]}
        m0_positions = {(o["start"], o["end"]) for o in m0["occurrences"]}
        if not m1_positions.issubset(m0_positions):
            raise SystemExit(f"P3 M1 occurrence is absent from frozen M0 occurrences: {sid}")
        for accepted_start, accepted_end in m1_positions:
            if expected_before and stream[accepted_start-len(expected_before):accepted_start] != expected_before:
                raise SystemExit(f"P3 M1 BEFORE status does not reproduce: {sid}")
            if expected_after and stream[accepted_end:accepted_end+len(expected_after)] != expected_after:
                raise SystemExit(f"P3 M1 AFTER status does not reproduce: {sid}")
        raw_rows.append({
            "segmentId": sid, "fragmentId": frozen["fragmentId"], "candidateId": frozen["mappingCandidateId"],
            "sourcePdf": frozen["sourcePdf"], "physicalPage": frozen["physicalPage"],
            "rawLineIndexPageLocal": frozen["rawLineIndexPageLocal"], "sourceSpanUtf16": json.dumps([start, end]),
            "exactSourceSegment": segment, "exactFullRawLine": line,
            "rawBeforeNonWhitespace": norm_context(line[:py_start]), "rawAfterNonWhitespace": norm_context(line[py_end:]),
            "p3ContextBefore": expected_before, "p3ContextAfter": expected_after,
            "m0Status": m0["m0Status"], "m0OccurrenceCount": len(m0["occurrences"]),
            "m1Status": m1["m1Status"], "m1OccurrenceCount": len(m1["occurrences"]),
            "normalizedStreamSha256": page["normalizedStreamSha256"],
        })
        transition = f"{'U' if m0['m0Status']=='UNIQUE_TEXT_OCCURRENCE' else 'M'}->{'U' if m1['m1Status']=='UNIQUE_CONTEXT_OCCURRENCE' else ('M' if m1['m1Status']=='MULTIPLE_CONTEXT_OCCURRENCES' else 'N')}"
        summary["transitionCounts"][transition] = summary["transitionCounts"].get(transition, 0) + 1
        summary["segmentCount"] += 1

        for occurrence_index, occ in enumerate(m0["occurrences"]):
            start_stream, end_stream = occ["start"], occ["end"]
            actual_before = stream[max(0, start_stream - len(expected_before)):start_stream]
            actual_after = stream[end_stream:end_stream + len(expected_after)]
            before_check = mismatch(expected_before, actual_before, "BEFORE")
            after_check = mismatch(expected_after, actual_after, "AFTER")
            item_indices = occ.get("itemIndexRange") or []
            item_index_set = {span["itemIndex"] for span in occ.get("tokenSpans", [])}
            token_records = [tokens[i] for i in sorted(item_index_set) if 0 <= i < len(tokens)]
            first_item = min(item_index_set) if item_index_set else None
            last_item = max(item_index_set) if item_index_set else None
            stream_neighbors = []
            for neighbor_index in ([first_item - 1] if first_item is not None else []) + ([last_item + 1] if last_item is not None else []):
                if 0 <= neighbor_index < len(tokens):
                    t = tokens[neighbor_index]
                    stream_neighbors.append({
                        "relation": "previous_item" if neighbor_index < first_item else "next_item",
                        "itemIndex": t["itemIndex"], "originalText": t["originalText"],
                        "normalizedText": t["normalizedText"], "bbox": t["bbox"], "transform": t["transform"],
                    })
            row = {
                "segmentId": sid, "fragmentId": frozen["fragmentId"], "candidateId": frozen["mappingCandidateId"],
                "sourcePdf": frozen["sourcePdf"], "physicalPage": frozen["physicalPage"],
                "occurrenceIndex": occurrence_index, "streamStart": start_stream, "streamEnd": end_stream,
                "matchedText": stream[start_stream:end_stream], "itemIndexRange": item_indices,
                "tokenAttributionStatus": occ.get("tokenAttributionStatus"),
                "isFrozenM1Occurrence": (start_stream, end_stream) in m1_positions,
                "tokenSpans": occ.get("tokenSpans", []), "characterOrigins": occ.get("characterOrigins", []),
                "expectedBefore": expected_before, "actualBefore": actual_before,
                "beforeStatus": before_check["status"], "beforeFirstDifferenceIndex": before_check["firstDifferenceIndex"],
                "beforeCommonPrefixLength": before_check["commonPrefixLength"],
                "beforeCommonSuffixLength": before_check["commonSuffixLength"],
                "expectedAfter": expected_after, "actualAfter": actual_after,
                "afterStatus": after_check["status"], "afterFirstDifferenceIndex": after_check["firstDifferenceIndex"],
                "afterCommonPrefixLength": after_check["commonPrefixLength"],
                "afterCommonSuffixLength": after_check["commonSuffixLength"],
                "streamBeforeWindow": stream[max(0, start_stream - 24):start_stream],
                "streamAfterWindow": stream[end_stream:end_stream + 24],
                "itemEvidence": [{"itemIndex": t["itemIndex"], "originalText": t["originalText"],
                                  "normalizedText": t["normalizedText"], "normalizedStreamStart": t["normalizedStreamStart"],
                                  "normalizedStreamEnd": t["normalizedStreamEnd"], "bbox": t["bbox"], "transform": t["transform"]}
                                 for t in token_records],
                "streamNeighborItems": stream_neighbors,
            }
            stream_rows.append(row)
            summary["occurrenceCount"] += 1
            for check in (before_check, after_check):
                if check["status"].endswith("MISMATCH"):
                    diff_rows.append({
                        "segmentId": sid, "occurrenceIndex": occurrence_index, "sourcePdf": frozen["sourcePdf"],
                        "physicalPage": frozen["physicalPage"], "side": check["status"].split("_")[0],
                        "expectedContext": check["expected"], "actualPdfStreamContext": check["actual"],
                        "firstDifferenceIndex": check["firstDifferenceIndex"],
                        "commonPrefixLength": check["commonPrefixLength"],
                        "neighborItemIndexes": json.dumps([t["itemIndex"] for t in token_records]),
                    })

    if summary["segmentCount"] != 43:
        raise SystemExit("expected 43 observations")
    # A purely mechanical order comparison for adjacent Raw Text segments whose
    # frozen P3 M0 result already contains exactly one occurrence. Multiple
    # candidates are never selected for this comparison.
    unique_positions: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    for frozen in frozen_rows:
        if frozen["m0Status"] != "UNIQUE_TEXT_OCCURRENCE" or frozen["m0OccurrenceCount"] != 1:
            continue
        occurrence = m0_rows[frozen["segmentId"]]["occurrences"][0]
        unique_positions[frozen["fragmentId"]].append(
            (frozen["sourceSpanUtf16"][0], occurrence["start"], frozen["segmentId"])
        )
    for fragment_id, positions in sorted(unique_positions.items()):
        positions.sort()
        for left, right in zip(positions, positions[1:]):
            order_rows.append({
                "fragmentId": fragment_id,
                "earlierRawSpanSegmentId": left[2],
                "earlierRawSpanStartUtf16": left[0],
                "earlierM0UniqueStreamStart": left[1],
                "laterRawSpanSegmentId": right[2],
                "laterRawSpanStartUtf16": right[0],
                "laterM0UniqueStreamStart": right[1],
                "candidateStreamOrder": "INVERTED" if left[1] > right[1] else "NON_INVERTED",
                "caveat": "conditional on frozen M0 unique text occurrences; not independent source-correspondence validation",
            })
    summary["m0StatusCounts"] = dict(Counter(r["m0Status"] for r in frozen_rows))
    summary["m1StatusCounts"] = dict(Counter(r["m1Status"] for r in frozen_rows))
    summary["occurrenceContextChecks"] = {
        "before": dict(Counter(r["beforeStatus"] for r in stream_rows)),
        "after": dict(Counter(r["afterStatus"] for r in stream_rows)),
        "frozenM1OccurrencesPresentAmongM0": sum(bool(r["isFrozenM1Occurrence"]) for r in stream_rows),
    }
    summary["uniqueM0IntraFragmentAdjacentOrderComparisons"] = len(order_rows)
    summary["uniqueM0IntraFragmentOrderInversions"] = sum(r["candidateStreamOrder"] == "INVERTED" for r in order_rows)
    summary["p3ZipSha256"] = expected_zip
    summary["p3M0Sha256"] = sha(m0_bytes)
    summary["p3M1Sha256"] = sha(m1_bytes)
    summary["sourceTokenManifestSha256"] = sha(token_manifest_bytes)
    write_csv(args.output_dir / "raw-text-context-observations.csv", raw_rows)
    (args.output_dir / "pdf-stream-occurrence-observations.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in stream_rows), encoding="utf-8")
    write_csv(args.output_dir / "context-difference-observations.csv", diff_rows)
    write_csv(args.output_dir / "within-fragment-stream-order-observations.csv", order_rows)
    (args.output_dir / "machine-observation-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
