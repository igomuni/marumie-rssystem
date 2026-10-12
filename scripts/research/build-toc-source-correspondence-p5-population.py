#!/usr/bin/env python3
"""Build the fixed P5 M0-unique population from the preserved P3 archive."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path

P3_ROOT = "data/work/exports/20261011_2251_FY2024_TOC_Source_Token_Mapping_P3/"
P3_ZIP_SHA256 = "73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c"
DEVELOPMENT_INVENTORY_SHA256 = "c66c671a04fcbd5d34f7f5f31ace35d776e73fd38f6958268df0ff10a6678b56"
M0_SHA256 = "50ce8337e473ba6b004d35774895dd08336ad16eda0c15c4e46aa0b656c98b2f"
M1_SHA256 = "8f88e4b4c174e7c24f686bc7761b4c845df04076c02cdc8a06cc921ede95739f"
SEGMENT_STATUS_SHA256 = "6ec1a690f66414434e48fde1e171ae1b15c20d4cd4f7b0f95df8e13f685f6d4b"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_jsonl(data: bytes) -> list[dict]:
    return [json.loads(line) for line in data.splitlines() if line.strip()]


def utf16_slice(text: str, start: int, end: int) -> str:
    raw = text.encode("utf-16-le")
    return raw[start * 2 : end * 2].decode("utf-16-le")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--p3-zip", required=True, type=Path)
    parser.add_argument("--development-inventory", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    archive_bytes = args.p3_zip.read_bytes()
    if sha256(archive_bytes) != P3_ZIP_SHA256:
        raise SystemExit("P3 ZIP SHA-256 mismatch")

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        if archive.testzip() is not None:
            raise SystemExit("P3 ZIP CRC failure")
        files = {
            "m0-segment-matches.jsonl": archive.read(P3_ROOT + "m0-segment-matches.jsonl"),
            "m1-segment-matches.jsonl": archive.read(P3_ROOT + "m1-segment-matches.jsonl"),
            "segment-mapping-status.csv": archive.read(P3_ROOT + "segment-mapping-status.csv"),
            "blinded-mapping-input.jsonl": archive.read(P3_ROOT + "blinded-mapping-input.jsonl"),
            "source-token-manifest.json": archive.read(P3_ROOT + "source-token-manifest.json"),
            "input-output-hashes.json": archive.read(P3_ROOT + "input-output-hashes.json"),
        }
    files["development-inventory.json"] = args.development_inventory.read_bytes()

    expected = {
        "development-inventory.json": DEVELOPMENT_INVENTORY_SHA256,
        "m0-segment-matches.jsonl": M0_SHA256,
        "m1-segment-matches.jsonl": M1_SHA256,
        "segment-mapping-status.csv": SEGMENT_STATUS_SHA256,
    }
    for name, digest in expected.items():
        if sha256(files[name]) != digest:
            raise SystemExit(f"P3 artifact SHA-256 mismatch: {name}")

    m0_rows = load_jsonl(files["m0-segment-matches.jsonl"])
    m1_rows = {row["segmentId"]: row for row in load_jsonl(files["m1-segment-matches.jsonl"])}
    source_rows = {row["fragmentId"]: row for row in load_jsonl(files["blinded-mapping-input.jsonl"])}
    if len(m0_rows) != 43 or len(m1_rows) != 43:
        raise SystemExit("P3 population is not 43 segments in all three result files")

    selected = []
    packet = []
    for m0 in m0_rows:
        if m0["m0Status"] != "UNIQUE_TEXT_OCCURRENCE" or m0["occurrenceCount"] != 1:
            continue
        segment_id = m0["segmentId"]
        fragment_id = m0["fragmentId"]
        source = source_rows[fragment_id]
        m1 = m1_rows[segment_id]
        span_start, span_end = m0["sourceSpanUtf16"]
        if utf16_slice(source["exactFullRawLine"], span_start, span_end) != m0["rawSegment"]:
            raise SystemExit(f"Frozen UTF-16 span does not match P3 segment: {segment_id}")
        selected.append(
            {
                "p3SegmentId": segment_id,
                "p3FragmentId": fragment_id,
                "p3CandidateId": m0["mappingCandidateId"],
                "sourcePdf": m0["sourcePdf"],
                "physicalPage": m0["physicalPage"],
                "rawTextFile": source["rawTextFile"],
                "rawLineIndexPageLocal": m0["sourceLineIndexPageLocal"],
                "sourceSpanUtf16": m0["sourceSpanUtf16"],
                "exactSourceSegment": m0["rawSegment"],
                "exactFullRawLineSnapshot": source["exactFullRawLine"],
                "m0Status": m0["m0Status"],
                "m0OccurrenceCount": m0["occurrenceCount"],
                "m0Occurrence": m0["occurrences"][0],
                "m1Status": m1["m1Status"],
                "m1OccurrenceCount": m1["occurrenceCount"],
                "sourcePdfSha256": source["sourcePdfSha256"],
                "rawTextFileSha256": source["rawTextFileSha256"],
                "p3NormalizedPageStreamSha256": m0["pageNormalizedStreamSha256"],
            }
        )
        packet.append(
            {
                "p3SegmentId": segment_id,
                "p3FragmentId": fragment_id,
                "p3CandidateId": m0["mappingCandidateId"],
                "sourcePdf": m0["sourcePdf"],
                "physicalPage": m0["physicalPage"],
                "rawTextFile": source["rawTextFile"],
                "rawLineIndexPageLocal": m0["sourceLineIndexPageLocal"],
                "sourceSpanUtf16": m0["sourceSpanUtf16"],
                "exactSourceSegment": m0["rawSegment"],
                "exactFullRawLineSnapshot": source["exactFullRawLine"],
                "p3M0Status": m0["m0Status"],
                "p3M0OccurrenceCount": m0["occurrenceCount"],
                "p3M0Occurrence": m0["occurrences"][0],
                "p3M1Status": m1["m1Status"],
                "p3M1OccurrenceCount": m1["occurrenceCount"],
                "sourcePdfSha256": source["sourcePdfSha256"],
                "rawTextFileSha256": source["rawTextFileSha256"],
                "p3NormalizedPageStreamSha256": m0["pageNormalizedStreamSha256"],
            }
        )

    if len(selected) != 17:
        raise SystemExit(f"Expected 17 M0 unique segments, found {len(selected)}")
    strata = {"UNIQUE_CONTEXT_OCCURRENCE": 0, "CONTEXT_NOT_MATCHED": 0}
    for row in selected:
        if row["m1Status"] not in strata:
            raise SystemExit(f"Unexpected M1 status for {row['p3SegmentId']}: {row['m1Status']}")
        strata[row["m1Status"]] += 1
    if strata != {"UNIQUE_CONTEXT_OCCURRENCE": 4, "CONTEXT_NOT_MATCHED": 13}:
        raise SystemExit(f"Unexpected P3 M0-unique strata: {strata}")

    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    inventory = {
        "schema": "toc-source-correspondence-anchor-p5-population/v1",
        "researchPosition": "development evidence sufficiency study; not held-out evaluation or gold labels",
        "p3ZipSha256": P3_ZIP_SHA256,
        "p3InputOutputHashesSha256": sha256(files["input-output-hashes.json"]),
        "sourceArtifactHashes": {name: sha256(files[name]) for name in files},
        "selection": {
            "rule": "all P3 segments with frozen M0 status UNIQUE_TEXT_OCCURRENCE and occurrenceCount 1",
            "total": 17,
            "m0UniqueM1Unique": 4,
            "m0UniqueM1ContextNotMatched": 13,
            "p3CandidateCount": len({row["p3CandidateId"] for row in selected}),
            "p3FragmentCount": len({row["p3FragmentId"] for row in selected}),
            "sourcePdfCount": len({row["sourcePdf"] for row in selected}),
            "physicalPdfPageCount": len({(row["sourcePdf"], row["physicalPage"]) for row in selected}),
        },
        "segments": selected,
    }
    (output / "p5-population-inventory.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "blinded-evidence-packet.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in packet),
        encoding="utf-8",
    )
    print(json.dumps({"segments": len(selected), "strata": strata, "pdfs": inventory["selection"]["sourcePdfCount"], "pages": inventory["selection"]["physicalPdfPageCount"]}, indent=2))


if __name__ == "__main__":
    main()
