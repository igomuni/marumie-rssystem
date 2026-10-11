#!/usr/bin/env python3
"""Freeze the P3 source population and blinded mapping packet; performs no matching."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def utf16_slice(text: str, start: int, end: int) -> str:
    raw = text.encode("utf-16-le")
    return raw[start * 2 : end * 2].decode("utf-16-le")


def json_array(value: str) -> list[Any]:
    return json.loads(value)


def build(args: argparse.Namespace) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    repo_root = args.repo_root.resolve()
    pdf_root = args.pdf_root.resolve()
    text_root = args.raw_text_root.resolve()
    fixture_root = repo_root / "tests/fixtures/budget-request-toc-pdf-row-region-relation/2024"
    inventory_path = fixture_root / "candidate-inventory.csv"
    inventory_manifest_path = fixture_root / "candidate-inventory-manifest.json"
    raw_manifest_path = repo_root / "tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json"
    structure_path = repo_root / "tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json"
    p2_freeze_path = repo_root / "docs/tasks/20261011_Budget_Request_TOC_PDF_Row_Region_Relation_Failure_Isolation_P2.md"
    p1_independent_path = fixture_root / "p1-independent-review-source.csv"
    expected_hashes = {
        "candidateInventory": "0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438",
        "candidateInventoryManifest": "83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed",
        "rawTextManifest": "d58e048b43a38b29d035ff07dbd2d664ad5bea28c50fed4e0c30c61052c3573c",
        "structureInventory": "d2b2311cb6cbcb0974816706be1126d07e2a062614ac5b7cefee62be2b5ebc2d",
        "p2FreezeDocument": "c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb",
        "p1IndependentReviewSource": "70c6df24dea9cae95b620c618187a07af6876e70726ffa7e180a96c1f6b92190",
    }
    input_paths = {
        "candidateInventory": inventory_path,
        "candidateInventoryManifest": inventory_manifest_path,
        "rawTextManifest": raw_manifest_path,
        "structureInventory": structure_path,
        "p2FreezeDocument": p2_freeze_path,
        "p1IndependentReviewSource": p1_independent_path,
    }
    actual_hashes = {name: sha256(path) for name, path in input_paths.items()}
    if actual_hashes != expected_hashes:
        raise ValueError(f"frozen P2 input hash mismatch: {actual_hashes}")
    candidate_manifest = json.loads(inventory_manifest_path.read_text(encoding="utf-8"))
    if candidate_manifest["input"]["rawTextManifestSha256"] != actual_hashes["rawTextManifest"]:
        raise ValueError("P2 manifest Raw Text hash does not match the source manifest")
    if candidate_manifest["input"]["structureInventorySha256"] != actual_hashes["structureInventory"]:
        raise ValueError("P2 manifest structure inventory hash does not match the source inventory")

    source_rows = load_csv(inventory_path)
    positive = sorted(
        (row for row in source_rows if row["source_group"] == "KNOWN_POSITIVE"),
        key=lambda row: row["candidate_id"],
    )[:5]
    selected = positive + [
        row
        for row in source_rows
        if row["source_group"]
        in {"PRIOR_REVIEW_DISAGREEMENT", "PRIOR_REVIEW_AGREEMENT_CONTROL"}
    ]
    selected.sort(key=lambda row: row["candidate_id"])
    if len(positive) != 5 or sum(r["source_group"] == "PRIOR_REVIEW_DISAGREEMENT" for r in selected) != 3:
        raise ValueError("frozen P3 selection does not contain 5 positives and 3 disagreements")
    if sum(r["source_group"] == "PRIOR_REVIEW_AGREEMENT_CONTROL" for r in selected) != 4:
        raise ValueError("frozen P3 selection does not contain 4 agreement controls")
    if len(selected) != 12:
        raise ValueError(f"frozen P3 selection has {len(selected)} candidates, expected 12")

    p1_rows = load_csv(fixture_root / "p1-independent-review-source.csv")
    p1_counts = {
        relation: sum(row["review_relation"] == relation for row in p1_rows)
        for relation in ("DISAGREEMENT", "AGREEMENT")
    }
    if p1_counts != {"DISAGREEMENT": 3, "AGREEMENT": 4}:
        raise ValueError(f"P1 independent review counts changed: {p1_counts}")
    p1_by_pair = {row["pair_id"]: row for row in p1_rows}
    inventory: dict[str, Any] = {
        "schema": "toc-source-token-mapping-p3-development-inventory/v1",
        "researchPosition": "exploratory development; not held-out evaluation or gold labels",
        "selection": {
            "sourceInventory": "tests/fixtures/budget-request-toc-pdf-row-region-relation/2024/candidate-inventory.csv",
            "sourceInventorySha256": actual_hashes["candidateInventory"],
            "rule": "first five KNOWN_POSITIVE by ascending original candidate_id; all PRIOR_REVIEW_DISAGREEMENT; all PRIOR_REVIEW_AGREEMENT_CONTROL",
            "candidateCount": len(selected),
            "expectedFragmentCount": sum(len(json_array(r["raw_fragments"])) for r in selected),
            "groups": {
                "KNOWN_POSITIVE": 5,
                "PRIOR_REVIEW_DISAGREEMENT": 3,
                "PRIOR_REVIEW_AGREEMENT_CONTROL": 4,
            },
        },
        "inputArtifactHashes": {
            **actual_hashes,
        },
        "sourceRoots": {
            "pdfRoot": "external read-only repository root containing data/download; supplied at generation time",
            "rawTextRoot": "external read-only data/work/budget-request-plain-text/2024 root; supplied at generation time",
        },
        "candidates": [],
    }
    blind_packet: list[dict[str, Any]] = []
    fragment_counter = 0
    for candidate_number, row in enumerate(selected, start=1):
        candidate_alias = f"p3-candidate-{candidate_number:02d}"
        group = row["source_group"]
        if group == "KNOWN_POSITIVE":
            reason = "first_five_known_positive_ascending_candidate_id"
        elif group == "PRIOR_REVIEW_DISAGREEMENT":
            reason = "all_prior_review_disagreements"
        else:
            reason = "all_prior_independent_agreement_controls"
        pdf_path = pdf_root / row["source_pdf"]
        text_path = text_root / row["raw_text_file"].removeprefix("data/work/budget-request-plain-text/2024/")
        if not pdf_path.is_file() or not text_path.is_file():
            raise FileNotFoundError(f"missing source for {row['candidate_id']}: {pdf_path} / {text_path}")
        pdf_hash = sha256(pdf_path)
        text_hash = sha256(text_path)
        if pdf_hash != row["source_pdf_sha256"]:
            raise ValueError(f"PDF hash mismatch for {row['candidate_id']}")
        if text_hash != row["raw_text_file_sha256"]:
            raise ValueError(f"Raw Text hash mismatch for {row['candidate_id']}")
        page_number = int(row["physical_page"])
        chunks = text_path.read_text(encoding="utf-8").split("\f")
        if page_number > len(chunks):
            raise ValueError(f"physical page {page_number} is unavailable in {text_path}")
        page_text = chunks[page_number - 1]
        page_hash = sha256_bytes(page_text.encode("utf-8"))
        if page_hash != row["raw_text_page_sha256"]:
            raise ValueError(f"Raw Text page hash mismatch for {row['candidate_id']} p{page_number}")
        page_lines = page_text.splitlines()
        raw_line_indexes = json_array(row["raw_line_indexes"])
        source_ranges = json_array(row["source_ranges_utf16"])
        fragments = json_array(row["raw_fragments"])
        primitive_ids = json_array(row["primitive_ids"])
        primitive_kinds = json_array(row["primitive_kinds"])
        primitive_sides = json_array(row["primitive_sides"])
        if not (len(raw_line_indexes) == len(source_ranges) == len(fragments) == len(primitive_ids) == 2):
            raise ValueError(f"candidate does not contain exactly two provenance-linked fragments: {row['candidate_id']}")
        p1 = p1_by_pair.get(row["candidate_id"], {})
        candidate_record: dict[str, Any] = {
            "p3CandidateId": candidate_alias,
            "originalCandidateId": row["candidate_id"],
            "originalObservationId": row["source_observation_id"],
            "sourcePairId": row["candidate_id"],
            "sourceGroup": group,
            "selectionReason": reason,
            "priorP1CaseId": p1.get("case_id") or None,
            "priorP1PrimaryOwnership": p1.get("primary_ownership") or None,
            "priorP1IndependentOwnership": p1.get("independent_ownership") or None,
            "priorP1ReviewRelation": p1.get("review_relation") or None,
            "sourcePdf": row["source_pdf"],
            "physicalPage": page_number,
            "sourcePdfSha256": pdf_hash,
            "rawTextFile": row["raw_text_file"],
            "rawTextFileSha256": text_hash,
            "rawTextPageSha256": page_hash,
            "sourceFragments": [],
        }
        for i, (line_index, span, fragment) in enumerate(zip(raw_line_indexes, source_ranges, fragments)):
            if line_index >= len(page_lines):
                raise ValueError(f"page-local line index {line_index} is out of range for {row['candidate_id']}")
            full_line = page_lines[line_index]
            if utf16_slice(full_line, int(span[0]), int(span[1])) != fragment:
                raise ValueError(
                    f"UTF-16 span mismatch for {row['candidate_id']} line {line_index}, range {span}"
                )
            fragment_counter += 1
            fragment_id = f"p3-fragment-{fragment_counter:03d}"
            record = {
                "fragmentId": fragment_id,
                "sourcePrimitiveId": primitive_ids[i],
                "primitiveKind": primitive_kinds[i],
                "side": primitive_sides[i],
                "rawLineIndexPageLocal": int(line_index),
                "sourceSpanUtf16": [int(span[0]), int(span[1])],
                "exactSourceFragment": fragment,
                "exactFullRawLine": full_line,
            }
            candidate_record["sourceFragments"].append(record)
            # This packet is the only input to the matching utility; no prior labels or source group.
            blind_packet.append(
                {
                    "mappingCandidateId": candidate_alias,
                    "fragmentId": fragment_id,
                    "sourcePdf": row["source_pdf"],
                    "physicalPage": page_number,
                    "rawLineIndexPageLocal": int(line_index),
                    "sourceSpanUtf16": [int(span[0]), int(span[1])],
                    "exactSourceFragment": fragment,
                    "exactFullRawLine": full_line,
                    "sourcePdfSha256": pdf_hash,
                    "rawTextFile": row["raw_text_file"],
                    "rawTextFileSha256": text_hash,
                }
            )
        inventory["candidates"].append(candidate_record)
    if fragment_counter != 24:
        raise ValueError(f"selection yielded {fragment_counter} fragments, expected 24")
    return inventory, blind_packet


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--pdf-root", type=Path, required=True)
    parser.add_argument("--raw-text-root", type=Path, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("tests/fixtures/budget-request-toc-source-token-mapping/2024"),
    )
    args = parser.parse_args()
    inventory, packet = build(args)
    out = args.output_dir if args.output_dir.is_absolute() else args.repo_root / args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "development-inventory.json", inventory)
    with (out / "blinded-mapping-input.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for item in packet:
            stream.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"candidates": len(inventory["candidates"]), "fragments": len(packet), "outputDir": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
