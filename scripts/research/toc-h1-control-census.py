#!/usr/bin/env python3
"""Freeze the mechanical H1 ordered-pair census and near-shape sample.

This script reads the immutable #417 archive and source hashes only. It does not
inspect PDFs visually and makes no ownership or assembly decision.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import pathlib
import zipfile
from collections import Counter, defaultdict

ARCHIVE_SHA256 = "ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79"
RAW_MANIFEST_SHA256 = "d58e048b43a38b29d035ff07dbd2d664ad5bea28c50fed4e0c30c61052c3573c"
INVENTORY_SHA256 = "d2b2311cb6cbcb0974816706be1126d07e2a062614ac5b7cefee62be2b5ebc2d"
POSITIVE_SHA256 = "e07044788a429113b07fada2df5bf98bf6ac0af5c2fb926bd8451cf2541a8a7d"
EXPECTED_PAGES = 82
EXPECTED_PDFS = 55
NEAR_SIGNATURES = (
    "UNKNOWN_SIDE",
    "KNOWN_SIDE_MISMATCH",
    "SAME_SIDE_INTERVENING_BARRIER",
    "SAME_SIDE_INTERVENING_PRIMITIVE",
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: pathlib.Path) -> str:
    return sha(path.read_bytes())


def jsonl_bytes(rows: list[dict], keys: tuple[str, ...]) -> bytes:
    return b"".join(
        (json.dumps({key: row[key] for key in keys}, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        for row in rows
    )


def tuple_bytes(values: tuple[str, ...]) -> tuple[bytes, ...]:
    return tuple(value.encode("utf-8") for value in values)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True, type=pathlib.Path)
    ap.add_argument("--source-data-root", required=True, type=pathlib.Path, help="workspace data root containing download/ and work/")
    ap.add_argument("--archive", required=True, type=pathlib.Path, help="frozen #417 output ZIP")
    ap.add_argument("--out-dir", required=True, type=pathlib.Path)
    args = ap.parse_args()
    root = args.repo_root.resolve()
    data = args.source_data_root.resolve()
    archive = args.archive.resolve()
    out = args.out_dir.resolve()

    archive_digest = file_sha(archive)
    if archive_digest != ARCHIVE_SHA256:
        raise SystemExit(f"STOP: #417 archive SHA mismatch: {archive_digest}")
    raw_manifest = root / "tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json"
    inventory_path = root / "tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json"
    positive_path = root / "tests/fixtures/budget-request-toc-h1-control-analysis/2024/positive-inventory.csv"
    prereg_path = root / "tests/fixtures/budget-request-toc-h1-control-analysis/2024/preregistration.md"
    for path, expected in ((raw_manifest, RAW_MANIFEST_SHA256), (inventory_path, INVENTORY_SHA256), (positive_path, POSITIVE_SHA256)):
        actual = file_sha(path)
        if actual != expected:
            raise SystemExit(f"STOP: frozen input hash mismatch for {path}: {actual}")

    inv = json.loads(inventory_path.read_text(encoding="utf-8"))
    toc_pages = [p for p in inv["pages"] if p["classifierPageType"] == "TOC"]
    page_keys = {(p["localPdfPath"], int(p["physicalPage"])) for p in toc_pages}
    if len(toc_pages) != EXPECTED_PAGES or len(page_keys) != EXPECTED_PAGES:
        raise SystemExit(f"STOP: TOC inventory count/uniqueness mismatch: {len(toc_pages)} rows / {len(page_keys)} keys")
    if len({p["localPdfPath"] for p in toc_pages}) != EXPECTED_PDFS:
        raise SystemExit("STOP: TOC PDF count mismatch")
    source_counts = Counter(p["classifierSource"] for p in toc_pages)
    if source_counts != {"DIRECT": 55, "INHERITED": 27}:
        raise SystemExit(f"STOP: DIRECT/INHERITED mismatch: {source_counts}")
    inv_by_key = {(p["localPdfPath"], int(p["physicalPage"])): p for p in toc_pages}

    prefix = "data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/"
    with zipfile.ZipFile(archive) as zf:
        names = set(zf.namelist())
        required = [prefix + n for n in ("input-hashes.json", "page-status.csv", "primitive-accounting.csv", "assembly-observations.csv")]
        if not set(required).issubset(names):
            raise SystemExit("STOP: frozen #417 archive lacks required census files")
        inputs = json.loads(zf.read(prefix + "input-hashes.json"))
        pages = list(csv.DictReader(zf.read(prefix + "page-status.csv").decode("utf-8-sig").splitlines()))
        units = list(csv.DictReader(zf.read(prefix + "primitive-accounting.csv").decode("utf-8-sig").splitlines()))
        observations = list(csv.DictReader(zf.read(prefix + "assembly-observations.csv").decode("utf-8-sig").splitlines()))

    # Reconcile every page, document hash, and source input before enumeration.
    page_rows = {(p["sourcePdf"], int(p["physicalPage"])): p for p in pages}
    if len(page_rows) != EXPECTED_PAGES or set(page_rows) != page_keys:
        raise SystemExit(f"STOP: #417 page census mismatch: {len(page_rows)} pages")
    pdf_paths = sorted({pdf for pdf, _ in page_keys}, key=lambda x: x.encode("utf-8"))
    input_hash_failures = []
    for pdf in pdf_paths:
        item = inputs.get(pdf)
        if item is None:
            input_hash_failures.append((pdf, "missing #417 input hash record"))
            continue
        pdf_file = data / pdf.removeprefix("data/")
        txt_file = data / "work/budget-request-plain-text/2024" / (pdf.removeprefix("data/download/").removesuffix(".pdf").replace("/", "__") + ".txt")
        if not pdf_file.is_file() or file_sha(pdf_file) != item["pdfSha256"]:
            input_hash_failures.append((pdf, "source PDF missing/hash mismatch"))
        if not txt_file.is_file() or file_sha(txt_file) != item["txtSha256"]:
            input_hash_failures.append((pdf, "source TXT missing/hash mismatch"))
    for key, frozen_page in page_rows.items():
        source_page = inv_by_key[key]
        if frozen_page["inputTextSha256"] != source_page["textSha256"] or frozen_page["classifierSource"] != source_page["classifierSource"]:
            input_hash_failures.append((f"{key[0]}#{key[1]}", "page text hash or source-class mismatch"))
        if inputs.get(key[0], {}).get("pdfSha256") != source_page["pdfSha256"]:
            input_hash_failures.append((f"{key[0]}#{key[1]}", "PDF hash differs between #417 archive and structure inventory"))
    if input_hash_failures:
        raise SystemExit("STOP: source integrity mismatch: " + repr(input_hash_failures[:10]))

    unit_by_page: dict[tuple[str, int], list[dict]] = defaultdict(list)
    unit_by_id = {}
    for row in units:
        key = (row["source_pdf"], int(row["physical_page"]))
        row["line_i"] = int(row["line_index"])
        row["span"] = json.loads(row["source_range_utf16"])
        row["id"] = row["source_primitive_id"]
        unit_by_page[key].append(row)
        unit_by_id[row["id"]] = row
    for rows in unit_by_page.values():
        rows.sort(key=lambda x: (x["line_i"], int(x["span"][0]), x["id"].encode("utf-8")))

    exact_pairs = set()
    for obs in observations:
        if obs["hypothesis"] != "H1" or obs["status"] not in ("CANDIDATE_UNRESOLVED", "AMBIGUOUS"):
            continue
        ids = json.loads(obs["source_primitive_ids"])
        if len(ids) == 2:
            exact_pairs.add((obs["source_pdf"], int(obs["physical_page"]), ids[0], ids[1]))

    census = []
    for (pdf, page), page_units in unit_by_page.items():
        starts = [u for u in page_units if u["primitive_kind"] == "title_page"]
        targets = [u for u in page_units if u["primitive_kind"] == "title_only_candidate"]
        for start in starts:
            for target in targets:
                if target["line_i"] <= start["line_i"]:
                    continue
                pair = (pdf, page, start["id"], target["id"])
                if pair in exact_pairs:
                    signature = "EXACT_H1_SHAPE"
                elif start["side"] == "unknown" or target["side"] == "unknown":
                    signature = "UNKNOWN_SIDE"
                elif start["side"] != target["side"]:
                    signature = "KNOWN_SIDE_MISMATCH"
                else:
                    between = []
                    for unit in page_units:
                        if unit["id"] in (start["id"], target["id"]):
                            continue
                        strictly_between_lines = start["line_i"] < unit["line_i"] < target["line_i"]
                        before_target_on_line = unit["line_i"] == target["line_i"] and int(unit["span"][0]) < int(target["span"][0])
                        if not (strictly_between_lines or before_target_on_line):
                            continue
                        if unit["primitive_kind"] == "BARRIER":
                            between.append(("barrier", unit))
                    if between:
                        signature = "SAME_SIDE_INTERVENING_BARRIER"
                    else:
                        has_intervening = False
                        for unit in page_units:
                            if unit["id"] in (start["id"], target["id"]):
                                continue
                            strictly_between_lines = start["line_i"] < unit["line_i"] < target["line_i"]
                            before_target_on_line = unit["line_i"] == target["line_i"] and int(unit["span"][0]) < int(target["span"][0])
                            if not (strictly_between_lines or before_target_on_line):
                                continue
                            if unit["primitive_kind"] != "BARRIER" and unit["side"] in (start["side"], "unknown"):
                                has_intervening = True
                                break
                        signature = "SAME_SIDE_INTERVENING_PRIMITIVE" if has_intervening else "OUTSIDE_H1_SHAPE"

                fields = {
                    "sourcePdf": pdf,
                    "physicalPage": page,
                    "startPrimitiveId": start["id"],
                    "targetPrimitiveId": target["id"],
                }
                pair_id_payload = b"\x00".join((pdf.encode("utf-8"), str(page).encode("ascii"), start["id"].encode("utf-8"), target["id"].encode("utf-8")))
                pair_id = "h1pair-" + sha(pair_id_payload)
                census.append({
                    "pairId": pair_id,
                    **fields,
                    "shapeSignature": signature,
                    "sourcePdf": pdf,
                    "physicalPage": page,
                    "startPrimitiveId": start["id"],
                    "targetPrimitiveId": target["id"],
                })

    census.sort(key=lambda x: (x["sourcePdf"].encode("utf-8"), x["physicalPage"], x["startPrimitiveId"].encode("utf-8"), x["targetPrimitiveId"].encode("utf-8")))
    exact_from_census = {(x["sourcePdf"], x["physicalPage"], x["startPrimitiveId"], x["targetPrimitiveId"]) for x in census if x["shapeSignature"] == "EXACT_H1_SHAPE"}
    if exact_from_census != exact_pairs:
        missing = sorted(exact_pairs - exact_from_census)
        extra = sorted(exact_from_census - exact_pairs)
        raise SystemExit(f"STOP: exact H1 reconciliation failed; missing={missing[:5]} extra={extra[:5]}")
    if len(exact_from_census) != 31:
        raise SystemExit(f"STOP: expected 31 exact H1 pairs, got {len(exact_from_census)}")

    selected = []
    by_page_sig: dict[tuple[str, int, str], list[dict]] = defaultdict(list)
    for pair in census:
        if pair["shapeSignature"] in NEAR_SIGNATURES:
            by_page_sig[(pair["sourcePdf"], pair["physicalPage"], pair["shapeSignature"])].append(pair)
    for key, rows in by_page_sig.items():
        rows.sort(key=lambda x: (x["pairId"][7:].encode("ascii"), x["sourcePdf"].encode("utf-8"), x["physicalPage"], x["startPrimitiveId"].encode("utf-8"), x["targetPrimitiveId"].encode("utf-8")))
        for rank, row in enumerate(rows[:2], start=1):
            selected.append({**row, "sampleRank": rank})
    selected.sort(key=lambda x: (x["sourcePdf"].encode("utf-8"), x["physicalPage"], x["shapeSignature"].encode("utf-8"), x["sampleRank"], x["pairId"].encode("utf-8")))

    second_count = (len(selected) + 9) // 10 if selected else 0
    second_ranked = sorted(selected, key=lambda x: (sha(x["pairId"].encode("utf-8")).encode("ascii"), x["pairId"].encode("utf-8")))
    second_review = [x["pairId"] for x in second_ranked[:second_count]]

    census_keys = ("pairId", "sourcePdf", "physicalPage", "startPrimitiveId", "targetPrimitiveId", "shapeSignature")
    selected_keys = census_keys + ("sampleRank",)
    census_bytes = jsonl_bytes(census, census_keys)
    selected_bytes = jsonl_bytes(selected, selected_keys)
    second_bytes = ("\n".join(second_review) + ("\n" if second_review else "")).encode("utf-8")
    counts = Counter(x["shapeSignature"] for x in census)
    counts.setdefault("OUTSIDE_H1_SHAPE", 0)
    strata_counts = Counter(x["shapeSignature"] for x in selected)
    second_counts = Counter(next(x["shapeSignature"] for x in selected if x["pairId"] == pair_id) for pair_id in second_review)

    out.mkdir(parents=True, exist_ok=True)
    (out / "ordered-pair-census.jsonl").write_bytes(census_bytes)
    (out / "selected-near-controls.jsonl").write_bytes(selected_bytes)
    (out / "second-review-sample.txt").write_bytes(second_bytes)
    summary = {
        "schema": "toc-h1-control-census/v1",
        "sourceCommit": "9f83a9abbbce49af3e4be8eb3034c00805af602e",
        "archiveSha256": archive_digest,
        "rawTextManifestSha256": file_sha(raw_manifest),
        "structureInventorySha256": file_sha(inventory_path),
        "positiveInventorySha256": file_sha(positive_path),
        "population": {"tocPages": len(toc_pages), "pdfs": len(pdf_paths), "DIRECT": source_counts["DIRECT"], "INHERITED": source_counts["INHERITED"]},
        "orderedPairCount": len(census),
        "shapeCounts": dict(sorted(counts.items())),
        "selectedNearPairCount": len(selected),
        "selectedCountsBySignature": dict(sorted(strata_counts.items())),
        "selectedCountsByPageAndSignature": {";".join((k[0], str(k[1]), k[2])): min(2, len(v)) for k, v in sorted(by_page_sig.items(), key=lambda kv: (kv[0][0].encode("utf-8"), kv[0][1], kv[0][2].encode("utf-8")))},
        "secondReviewCount": len(second_review),
        "secondReviewCountsBySignature": dict(sorted(second_counts.items())),
        "hashes": {"orderedPairCensusSha256": sha(census_bytes), "selectedNearControlsSha256": sha(selected_bytes), "secondReviewSampleSha256": sha(second_bytes)},
        "n1Status": "N1_NOT_OBSERVED_IN_FROZEN_CORPUS",
        "note": "EXACT_H1_SHAPE must equal the fixed #418 H1 positive set; this is definitional and is not negative discrimination evidence.",
    }
    (out / "census-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    validation = {
        "schema": "toc-h1-control-census-validation/v1",
        "inputIntegrity": True,
        "populationAccounting": len(toc_pages) == 82 and len(pdf_paths) == 55 and source_counts == {"DIRECT": 55, "INHERITED": 27},
        "archiveHashMatchesFrozen": archive_digest == ARCHIVE_SHA256,
        "sourcePdfAndTxtHashesMatchFrozenArchive": True,
        "pageHashesAndClassificationMatchInventory": True,
        "pairIdsUnique": len({x["pairId"] for x in census}) == len(census),
        "exactH1ReconcilesWithFixedPositiveSet": exact_from_census == exact_pairs and len(exact_pairs) == 31,
        "selectedPairsUnique": len({x["pairId"] for x in selected}) == len(selected),
        "nearSampleCapRespected": all(v <= 2 for v in Counter((x["sourcePdf"], x["physicalPage"], x["shapeSignature"]) for x in selected).values()),
        "assemblyOrOwnershipDecisionMade": False,
        "files": {name: sha((out / name).read_bytes()) for name in ("ordered-pair-census.jsonl", "selected-near-controls.jsonl", "second-review-sample.txt", "census-summary.json")},
    }
    (out / "census-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(census), "shapeCounts": dict(counts), "selected": len(selected), "selectedCounts": dict(strata_counts), "secondReview": len(second_review), "hashes": summary["hashes"]}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
