#!/usr/bin/env python3
"""Build the frozen P4 population from the immutable P3 artifacts.

This utility joins P3 segment results to the exact full-line snapshots already
frozen and validated for P3. It does not re-run M0/M1 matching, select PDF
occurrences, use ownership labels, or inspect PDF geometry.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Any


EXPECTED_P3_ZIP_SHA256 = (
    "73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c"
)
EXPECTED_INVENTORY_SHA256 = (
    "c66c671a04fcbd5d34f7f5f31ace35d776e73fd38f6958268df0ff10a6678b56"
)
EXPECTED_M0_OUTPUT_SHA256 = (
    "50ce8337e473ba6b004d35774895dd08336ad16eda0c15c4e46aa0b656c98b2f"
)
EXPECTED_M1_OUTPUT_SHA256 = (
    "8f88e4b4c174e7c24f686bc7761b4c845df04076c02cdc8a06cc921ede95739f"
)
EXPECTED_SEGMENT_STATUS_SHA256 = (
    "6ec1a690f66414434e48fde1e171ae1b15c20d4cd4f7b0f95df8e13f685f6d4b"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utf16_slice(text: str, start: int, end: int) -> str:
    encoded = text.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


def utf16_offset_to_python(text: str, offset: int) -> int:
    units = 0
    for index, char in enumerate(text):
        if units == offset:
            return index
        units += 2 if ord(char) > 0xFFFF else 1
    if units == offset:
        return len(text)
    raise ValueError(f"UTF-16 offset {offset} splits a code point")


def p3_contexts(line: str, span: tuple[int, int]) -> tuple[str, str]:
    start = utf16_offset_to_python(line, span[0])
    end = utf16_offset_to_python(line, span[1])
    before = "".join(
        "-" if char == "\u2011" else char
        for char in line[:start]
        if not char.isspace()
    )[-12:]
    after = "".join(
        "-" if char == "\u2011" else char
        for char in line[end:]
        if not char.isspace()
    )[:12]
    return before, after


def read_jsonl(data: bytes) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for raw_line in data.decode("utf-8").splitlines():
        row = json.loads(raw_line)
        key = row["segmentId"]
        if key in rows:
            raise ValueError(f"duplicate segment ID: {key}")
        rows[key] = row
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--p3-zip", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    inventory_path = (
        repo_root
        / "tests/fixtures/budget-request-toc-source-token-mapping/2024/development-inventory.json"
    )
    inventory_bytes = inventory_path.read_bytes()
    if sha256(inventory_bytes) != EXPECTED_INVENTORY_SHA256:
        raise ValueError("P3 development inventory hash mismatch")
    inventory = json.loads(inventory_bytes)

    zip_bytes = args.p3_zip.read_bytes()
    if sha256(zip_bytes) != EXPECTED_P3_ZIP_SHA256:
        raise ValueError("P3 result ZIP hash mismatch")

    with zipfile.ZipFile(args.p3_zip) as archive:
        if archive.testzip() is not None:
            raise ValueError("P3 result ZIP CRC check failed")
        names = archive.namelist()

        def get_entry(name: str) -> bytes:
            matches = [entry for entry in names if entry.endswith("/" + name)]
            if len(matches) != 1:
                raise ValueError(f"expected exactly one {name} in P3 ZIP")
            return archive.read(matches[0])

        hashes = json.loads(get_entry("input-output-hashes.json"))
        expected_outputs = hashes["mechanicalOutputsPostConformanceFix"]
        m0_bytes = get_entry("m0-segment-matches.jsonl")
        m1_bytes = get_entry("m1-segment-matches.jsonl")
        status_bytes = get_entry("segment-mapping-status.csv")
        if sha256(m0_bytes) != EXPECTED_M0_OUTPUT_SHA256:
            raise ValueError("P3 M0 output hash mismatch")
        if sha256(m1_bytes) != EXPECTED_M1_OUTPUT_SHA256:
            raise ValueError("P3 M1 output hash mismatch")
        if sha256(status_bytes) != EXPECTED_SEGMENT_STATUS_SHA256:
            raise ValueError("P3 segment status hash mismatch")
        for filename, data in (
            ("m0-segment-matches.jsonl", m0_bytes),
            ("m1-segment-matches.jsonl", m1_bytes),
            ("segment-mapping-status.csv", status_bytes),
        ):
            if sha256(data) != expected_outputs[filename]:
                raise ValueError(f"P3 output manifest mismatch: {filename}")

    fragments: dict[str, dict[str, Any]] = {}
    candidates: dict[str, dict[str, Any]] = {}
    for candidate in inventory["candidates"]:
        candidate_id = candidate["p3CandidateId"]
        if candidate_id in candidates:
            raise ValueError(f"duplicate P3 candidate ID: {candidate_id}")
        candidates[candidate_id] = candidate
        for fragment in candidate["sourceFragments"]:
            fragment_id = fragment["fragmentId"]
            if fragment_id in fragments:
                raise ValueError(f"duplicate P3 fragment ID: {fragment_id}")
            fragments[fragment_id] = {**fragment, "candidate": candidate}

    m0_rows = read_jsonl(m0_bytes)
    m1_rows = read_jsonl(m1_bytes)
    segment_rows: list[dict[str, Any]] = []
    import io

    for row in csv.DictReader(io.StringIO(status_bytes.decode("utf-8-sig"))):
        span = tuple(json.loads(row["sourceSpanUtf16"]))
        fragment_id = row["fragmentId"]
        if fragment_id not in fragments:
            raise ValueError(f"unknown P3 fragment: {fragment_id}")
        fragment = fragments[fragment_id]
        candidate = fragment["candidate"]
        line = fragment["exactFullRawLine"]
        segment = row["rawSegment"]
        if utf16_slice(line, *span) != segment:
            raise ValueError(f"P3 source span does not match segment: {row}")
        before, after = p3_contexts(line, span)
        segment_id = f"{fragment_id}-segment-{row['segmentNumber']}" if "segmentNumber" in row else None
        if not segment_id:
            matching = [
                key for key, value in m0_rows.items()
                if value["fragmentId"] == fragment_id
                and value["sourceSpanUtf16"] == list(span)
            ]
            if len(matching) != 1:
                raise ValueError(f"cannot uniquely identify P3 segment in {fragment_id}")
            segment_id = matching[0]
        m0 = m0_rows.get(segment_id)
        m1 = m1_rows.get(segment_id)
        if m0 is None or m1 is None:
            raise ValueError(f"missing M0/M1 record: {segment_id}")
        if m0["contextBefore"] != before or m0["contextAfter"] != after:
            raise ValueError(f"P3 context does not reconstruct from frozen line: {segment_id}")
        if m1["contextBefore"] != before or m1["contextAfter"] != after:
            raise ValueError(f"P3 M1 context mismatch: {segment_id}")
        if m0["rawSegment"] != segment or m1["rawSegment"] != segment:
            raise ValueError(f"P3 segment text mismatch: {segment_id}")
        if m0["sourceSpanUtf16"] != list(span) or m1["sourceSpanUtf16"] != list(span):
            raise ValueError(f"P3 source span mismatch: {segment_id}")
        segment_rows.append(
            {
                "segmentId": segment_id,
                "fragmentId": fragment_id,
                "mappingCandidateId": row["mappingCandidateId"],
                "sourcePdf": row["sourcePdf"],
                "sourcePdfSha256": candidate["sourcePdfSha256"],
                "physicalPage": int(row["physicalPage"]),
                "rawTextFile": candidate["rawTextFile"],
                "rawTextFileSha256": candidate["rawTextFileSha256"],
                "rawTextPageSha256": candidate["rawTextPageSha256"],
                "rawLineIndexPageLocal": int(row["sourceLineIndexPageLocal"]),
                "sourceSpanUtf16": list(span),
                "exactSourceSegment": segment,
                "exactFullRawLine": line,
                "contextBefore": before,
                "contextAfter": after,
                "m0Status": row["m0Status"],
                "m0OccurrenceCount": int(row["m0OccurrenceCount"]),
                "m1Status": row["m1Status"],
                "m1OccurrenceCount": int(row["m1OccurrenceCount"]),
                "p3InputHashes": hashes["inputs"],
                "p3OutputHashes": {
                    "m0-segment-matches.jsonl": EXPECTED_M0_OUTPUT_SHA256,
                    "m1-segment-matches.jsonl": EXPECTED_M1_OUTPUT_SHA256,
                    "segment-mapping-status.csv": EXPECTED_SEGMENT_STATUS_SHA256,
                },
            }
        )

    segment_ids = set(m0_rows)
    if len(segment_rows) != 43 or len(segment_rows) != len({r["segmentId"] for r in segment_rows}):
        raise ValueError(f"expected 43 unique P3 segments, found {len(segment_rows)}")
    if segment_ids != {r["segmentId"] for r in segment_rows}:
        raise ValueError("P3 segment status and M0 population differ")
    if set(m0_rows) != set(m1_rows):
        raise ValueError("P3 M0 and M1 populations differ")

    transitions: dict[str, int] = {}
    for row in segment_rows:
        m0 = "U" if row["m0Status"] == "UNIQUE_TEXT_OCCURRENCE" else "M"
        m1 = {
            "UNIQUE_CONTEXT_OCCURRENCE": "U",
            "MULTIPLE_CONTEXT_OCCURRENCES": "M",
            "CONTEXT_NOT_MATCHED": "N",
        }.get(row["m1Status"])
        if m1 is None:
            raise ValueError(f"unexpected P3 M1 status: {row['m1Status']}")
        key = f"{m0}->{m1}"
        transitions[key] = transitions.get(key, 0) + 1
    expected_transitions = {"U->U": 4, "U->N": 13, "M->U": 8, "M->M": 11, "M->N": 7}
    if transitions != expected_transitions:
        raise ValueError(f"P3 transition strata mismatch: {transitions}")

    segment_rows.sort(key=lambda row: row["segmentId"])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    population = {
        "schema": "toc-line-token-order-p4-population/v1",
        "status": "frozen-before-P4-observation",
        "researchPosition": "post-hoc development failure isolation; not held-out or accuracy evaluation",
        "p3ZipSha256": EXPECTED_P3_ZIP_SHA256,
        "p3DevelopmentInventorySha256": EXPECTED_INVENTORY_SHA256,
        "p3OutputHashes": {
            "m0-segment-matches.jsonl": EXPECTED_M0_OUTPUT_SHA256,
            "m1-segment-matches.jsonl": EXPECTED_M1_OUTPUT_SHA256,
            "segment-mapping-status.csv": EXPECTED_SEGMENT_STATUS_SHA256,
        },
        "population": {
            "segmentCount": 43,
            "fragmentCount": 24,
            "candidateCount": 12,
            "pdfCount": 8,
            "physicalPageCount": 8,
            "transitionCounts": transitions,
        },
        "rawTextProvenanceLimitation": (
            "P3 prefreeze validation recorded matching raw-file hashes, page hashes, and all 24 UTF-16 spans. "
            "The original ignored TXT files are not present in the current workspace; P4 uses only the exact full-line "
            "snapshots preserved in the frozen P3 development inventory and records the historical P3 TXT hashes. "
            "No TXT file is regenerated or substituted."
        ),
        "segments": segment_rows,
    }
    population_bytes = (json.dumps(population, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (args.output_dir / "p4-population-inventory.json").write_bytes(population_bytes)

    blinded_rows = [
        {
            key: row[key]
            for key in (
                "segmentId", "fragmentId", "mappingCandidateId", "sourcePdf", "sourcePdfSha256",
                "physicalPage", "rawTextFile", "rawTextFileSha256", "rawTextPageSha256",
                "rawLineIndexPageLocal", "sourceSpanUtf16", "exactSourceSegment", "exactFullRawLine",
                "contextBefore", "contextAfter", "m0Status", "m0OccurrenceCount", "m1Status", "m1OccurrenceCount",
            )
        }
        for row in segment_rows
    ]
    packet = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in blinded_rows)
    (args.output_dir / "blinded-observation-packet.jsonl").write_text(packet, encoding="utf-8")
    print(json.dumps({"segments": len(segment_rows), "transitions": transitions, "inventorySha256": sha256(population_bytes), "blindedPacketSha256": sha256(packet.encode("utf-8"))}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI reports validation failures explicitly.
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
