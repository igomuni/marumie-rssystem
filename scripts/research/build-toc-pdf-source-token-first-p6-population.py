#!/usr/bin/env python3
"""Build the frozen P6 page population from the immutable P2 candidate inventory."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

EXPECTED_INVENTORY_SHA256 = "0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438"
EXPECTED_MANIFEST_SHA256 = "83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed"
EXPECTED_FREEZE_SHA256 = "c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    source_root = args.source_root.resolve()
    output_dir = args.output_dir.resolve()
    frozen_dir = repo_root / "tests/fixtures/budget-request-toc-pdf-row-region-relation/2024"
    inventory_path = frozen_dir / "candidate-inventory.csv"
    manifest_path = frozen_dir / "candidate-inventory-manifest.json"
    freeze_path = repo_root / "docs/tasks/20261011_Budget_Request_TOC_PDF_Row_Region_Relation_Failure_Isolation_P2.md"

    actual_hashes = {
        "candidateInventory": sha256(inventory_path),
        "candidateInventoryManifest": sha256(manifest_path),
        "p2FreezeDocument": sha256(freeze_path),
    }
    expected_hashes = {
        "candidateInventory": EXPECTED_INVENTORY_SHA256,
        "candidateInventoryManifest": EXPECTED_MANIFEST_SHA256,
        "p2FreezeDocument": EXPECTED_FREEZE_SHA256,
    }
    if actual_hashes != expected_hashes:
        raise SystemExit(f"P2 frozen hash mismatch: expected={expected_hashes}, actual={actual_hashes}")

    with inventory_path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 50:
        raise SystemExit(f"expected 50 P2 candidate rows, got {len(rows)}")

    pages: dict[tuple[str, int], dict] = {}
    source_hashes: dict[str, str] = {}
    for row in rows:
        relative_pdf = row["source_pdf"]
        expected_pdf_hash = row["source_pdf_sha256"]
        page_number = int(row["physical_page"])
        previous = source_hashes.setdefault(relative_pdf, expected_pdf_hash)
        if previous != expected_pdf_hash:
            raise SystemExit(f"conflicting frozen PDF hashes for {relative_pdf}")
        pdf_path = source_root / relative_pdf
        if not pdf_path.is_file():
            raise SystemExit(f"source PDF missing: {pdf_path}")
        observed_pdf_hash = sha256(pdf_path)
        if observed_pdf_hash != expected_pdf_hash:
            raise SystemExit(
                f"source PDF hash mismatch for {relative_pdf}: expected={expected_pdf_hash}, actual={observed_pdf_hash}"
            )
        key = (expected_pdf_hash, page_number)
        page = pages.setdefault(
            key,
            {
                "pageId": f"{expected_pdf_hash}:p{page_number}",
                "sourcePdf": relative_pdf,
                "sourcePdfSha256": expected_pdf_hash,
                "physicalPage": page_number,
                "sourceCandidateIds": [],
                "pageDimensions": None,
                "rotation": None,
                "selectionReason": "All distinct (source_pdf_sha256, physical_page) keys in frozen P2 inventory; no extraction or geometry used.",
            },
        )
        if page["sourcePdf"] != relative_pdf:
            raise SystemExit(f"same PDF hash is associated with multiple paths: {page['sourcePdf']} / {relative_pdf}")
        page["sourceCandidateIds"].append(row["candidate_id"])

    page_rows = sorted(pages.values(), key=lambda item: (item["sourcePdfSha256"], item["physicalPage"]))
    pdf_count = len({page["sourcePdfSha256"] for page in page_rows})
    if len(page_rows) != 17 or pdf_count != 15:
        raise SystemExit(f"expected 15 PDFs / 17 pages, got {pdf_count} PDFs / {len(page_rows)} pages")
    for page in page_rows:
        page["sourceCandidateIds"] = sorted(set(page["sourceCandidateIds"]))

    output_dir.mkdir(parents=True, exist_ok=True)
    document = {
        "schema": "budget-request-toc-pdf-source-token-first-p6-population/v1",
        "researchPosition": "post-hoc development feasibility; not held-out evaluation",
        "selectionRule": "Every unique (source_pdf_sha256, physical_page) in the immutable P2 candidate inventory; deduplicate only page extraction and retain all candidate IDs as provenance.",
        "p2CandidateRows": len(rows),
        "uniquePdfs": pdf_count,
        "uniquePhysicalPages": len(page_rows),
        "frozenInputHashes": actual_hashes,
        "pageKey": ["sourcePdfSha256", "physicalPage"],
        "pages": page_rows,
    }
    inventory_output = output_dir / "p6-page-inventory.json"
    packet_output = output_dir / "p6-blinded-observation-packet.jsonl"
    inventory_output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with packet_output.open("w", encoding="utf-8", newline="\n") as stream:
        for page in page_rows:
            packet_row = {
                "pageId": page["pageId"],
                "sourcePdf": page["sourcePdf"],
                "sourcePdfSha256": page["sourcePdfSha256"],
                "physicalPage": page["physicalPage"],
                "selectionRule": "frozen-P2-page-population",
            }
            stream.write(json.dumps(packet_row, ensure_ascii=False, sort_keys=True) + "\n")

    print(
        json.dumps(
            {
                "candidateRows": len(rows),
                "uniquePdfs": pdf_count,
                "physicalPages": len(page_rows),
                "missingPdfs": 0,
                "hashMismatches": 0,
                "inventorySha256": sha256(inventory_output),
                "packetSha256": sha256(packet_output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
