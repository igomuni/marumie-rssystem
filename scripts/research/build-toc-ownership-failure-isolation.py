#!/usr/bin/env python3
"""Validate the frozen 109-candidate inventory and build review artifacts.

This is an evidence aggregation/validation utility. It does not run or modify
the #416/#417 parser and does not infer ownership. Coordinator adjudications
are explicit, pinned records in the corresponding fixture JSON.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


OWNERSHIP = {"SAME_ITEM", "DISTINCT_ITEMS", "AMBIGUOUS", "UNDETERMINABLE"}
EVIDENCE = {
    "RAW_TEXT_SUFFICIENT",
    "RAW_TEXT_INSUFFICIENT",
    "PDF_VISUAL_REQUIRED",
    "STILL_UNDETERMINABLE",
}
FAMILIES = {f"F{i}_{name}" for i, name in [
    (1, "TRUE_CONTINUATION_OWNERSHIP_MISSING"),
    (2, "INDEPENDENT_HEADING_NON_ITEM"),
    (3, "SEPARATE_ITEM_ADJACENCY"),
    (4, "COLUMN_ATTRIBUTION_FAILURE"),
    (5, "TEXT_ORDERING_FAILURE"),
    (6, "INSUFFICIENT_PRIMITIVE_RELATION"),
    (7, "OTHER_UNDETERMINED"),
]}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: json.dumps(row.get(k), ensure_ascii=False) if isinstance(row.get(k), (list, dict)) else row.get(k, "") for k in fields})


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def utf16_slice(text: str, start: int, end: int) -> str:
    raw = text.encode("utf-16-le")
    return raw[start * 2 : end * 2].decode("utf-16-le")


def check_source_inputs(
    candidates: list[dict[str, str]], data_root: Path, manifest_path: Path
) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    docs = {d["localPdfPath"]: d for d in manifest["documents"]}
    pdf_hashes: dict[str, str] = {}
    page_hashes: dict[str, str] = {}
    checked_fragments = 0
    errors: list[str] = []
    for c in candidates:
        pdf_key = c["source_pdf"]
        doc = docs.get(pdf_key)
        if doc is None:
            errors.append(f"manifest document missing: {pdf_key}")
            continue
        pdf_rel = pdf_key.removeprefix("data/download/")
        pdf_path = data_root / "download" / pdf_rel
        if pdf_key not in pdf_hashes:
            if not pdf_path.is_file():
                errors.append(f"PDF missing: {pdf_path}")
                continue
            pdf_hashes[pdf_key] = sha256(pdf_path)
            if pdf_hashes[pdf_key] != doc["pdfSha256"]:
                errors.append(f"PDF hash mismatch: {pdf_key}")
        slug = pdf_rel.removesuffix(".pdf").replace("/", "__") + ".txt"
        txt_path = data_root / "work" / "budget-request-plain-text" / "2024" / slug
        if not txt_path.is_file():
            errors.append(f"TXT missing: {txt_path}")
            continue
        pages = txt_path.read_bytes().decode("utf-8").split("\f")
        if pages and pages[-1] == "":
            pages.pop()
        if len(pages) != doc["pageCount"]:
            errors.append(f"TXT page count mismatch: {pdf_key} got={len(pages)} expected={doc['pageCount']}")
            continue
        page_no = int(c["physical_page"])
        key = f"{pdf_key}#{page_no}"
        if key not in page_hashes:
            page_hashes[key] = hashlib.sha256(pages[page_no - 1].encode("utf-8")).hexdigest()
            if page_hashes[key] != doc["pageTextSha256"][page_no - 1]:
                errors.append(f"Raw Text page hash mismatch: {key}")
        lines = pages[page_no - 1].splitlines()
        indexes = json.loads(c["source_line_indexes"])
        ranges = json.loads(c["source_ranges_utf16"])
        fragments = json.loads(c["source_raw_text_fragments"])
        if not (len(indexes) == len(ranges) == len(fragments)):
            errors.append(f"source arrays differ in length: {c['observation_id']}")
            continue
        for i, span, fragment in zip(indexes, ranges, fragments):
            i = int(i)
            if i >= len(lines):
                errors.append(f"source line out of range: {c['observation_id']} line={i}")
                continue
            start, end = map(int, span)
            try:
                actual = utf16_slice(lines[i], start, end)
            except UnicodeDecodeError:
                errors.append(f"invalid UTF-16 span: {c['observation_id']} line={i} span={span}")
                continue
            checked_fragments += 1
            if actual != fragment:
                errors.append(f"source fragment mismatch: {c['observation_id']} line={i} span={span}")
    if errors:
        raise SystemExit("Input validation failed:\n- " + "\n- ".join(errors[:30]))
    return {
        "rawManifestSha256": sha256(manifest_path),
        "candidateSourcePdfCount": len(pdf_hashes),
        "candidatePhysicalPageCount": len(page_hashes),
        "sourcePdfHashes": dict(sorted(pdf_hashes.items())),
        "sourcePageTextHashes": dict(sorted(page_hashes.items())),
        "sourceRawFragmentsChecked": checked_fragments,
        "allPdfHashesMatchManifest": True,
        "allPageTextHashesMatchManifest": True,
        "allSourceFragmentsMatchUtf16Spans": True,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", type=Path, required=True, help="data directory containing download/ and work/")
    ap.add_argument("--raw-manifest", type=Path, required=True)
    ap.add_argument("--candidate-inventory", type=Path, required=True)
    ap.add_argument("--reviews-dir", type=Path, required=True)
    ap.add_argument("--second-review", type=Path, required=True)
    ap.add_argument("--adjudications", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    args = ap.parse_args()

    candidates = read_csv(args.candidate_inventory)
    if len(candidates) != 109:
        raise SystemExit(f"expected 109 candidate observations, got {len(candidates)}")
    ids = [r["observation_id"] for r in candidates]
    if len(set(ids)) != 109:
        raise SystemExit("candidate observation IDs are not unique")
    counts = Counter(r["hypothesis"] for r in candidates)
    if counts != Counter({"H1": 31, "H2": 78}):
        raise SystemExit(f"candidate hypothesis counts mismatch: {counts}")

    review_files = {
        "review-h1-results.csv": {r["observation_id"] for r in candidates if r["hypothesis"] == "H1"},
        "review-h2-a-results.csv": set(),
        "review-h2-b-results.csv": set(),
        "review-h2-c-results.csv": set(),
    }
    batch_files = {
        "review-h2-a-results.csv": "review-h2-a.csv",
        "review-h2-b-results.csv": "review-h2-b.csv",
        "review-h2-c-results.csv": "review-h2-c.csv",
    }
    for result_file, batch_file in batch_files.items():
        review_files[result_file] = {r["observation_id"] for r in read_csv(args.reviews_dir / batch_file)}
    review_rows: dict[str, dict[str, str]] = {}
    review_input_hashes: dict[str, str] = {}
    for filename, expected_ids in review_files.items():
        path = args.reviews_dir / filename
        rows = read_csv(path)
        got = [r.get("observation_id", "") for r in rows]
        if len(got) != len(expected_ids) or set(got) != expected_ids or len(set(got)) != len(got):
            raise SystemExit(f"review ID/count mismatch for {filename}: rows={len(got)} expected={len(expected_ids)}")
        review_input_hashes[str(path)] = sha256(path)
        for r in rows:
            oid = r["observation_id"]
            if oid in review_rows:
                raise SystemExit(f"duplicate review observation ID across files: {oid}")
            review_rows[oid] = r
    if set(review_rows) != set(ids):
        raise SystemExit("review outputs do not cover the frozen candidate inventory exactly")

    second_rows = read_csv(args.second_review)
    second_by_id = {r["observation_id"]: r for r in second_rows}
    if set(second_by_id) != {"asm-1eb71c98aa77c7bd0cc4", "asm-7219c5e91aea9e2e4c97"}:
        raise SystemExit("NDL second review does not contain exactly the two frozen NDL observations")
    adjudication_doc = json.loads(args.adjudications.read_text(encoding="utf-8"))
    adjudications = {a["observationId"]: a for a in adjudication_doc["adjudications"]}
    candidate_by_id = {r["observation_id"]: r for r in candidates}

    source_validation = check_source_inputs(candidates, args.data_root, args.raw_manifest)
    classification_rows: list[dict[str, object]] = []
    evidence_rows: list[dict[str, object]] = []
    for oid in ids:
        c = candidate_by_id[oid]
        r = review_rows[oid]
        if r["ownership"] not in OWNERSHIP or r["evidence_sufficiency"] not in EVIDENCE or r["primary_family"] not in FAMILIES:
            raise SystemExit(f"invalid review label for {oid}")
        a = adjudications.get(oid)
        ownership_final = a["finalValue"].split(" / ")[0] if a and a.get("field") == "ownership_and_primary_family" else r["ownership"]
        family_final = a["finalValue"].split(" / ")[-1] if a and a.get("field") == "ownership_and_primary_family" else (a["finalValue"] if a and a.get("field") == "primary_family" else r["primary_family"])
        if ownership_final not in OWNERSHIP or family_final not in FAMILIES:
            raise SystemExit(f"invalid adjudicated label for {oid}")
        secondary = a.get("secondaryFactors", []) if a and a.get("field") == "ownership_and_primary_family" else [x for x in r.get("secondary_factors", "").split(";") if x]
        second = second_by_id.get(oid, {})
        adjudication_reason = a.get("reason", "") if a else ""
        common = {
            "observation_id": oid,
            "hypothesis": c["hypothesis"],
            "source_pdf": c["source_pdf"],
            "publisher_domain": c["publisher_domain"],
            "physical_page": c["physical_page"],
            "side": c["side"],
            "source_primitive_ids": json.loads(c["source_primitive_ids"]),
            "source_line_indexes": json.loads(c["source_line_indexes"]),
            "source_ranges_utf16": json.loads(c["source_ranges_utf16"]),
            "source_raw_text_fragments": json.loads(c["source_raw_text_fragments"]),
            "title_candidate": c["title_candidate"],
            "page_ref": c["page_ref"],
            "reason_codes": c["reason_codes"],
            "boundary_column_utf16": c["boundary_column_utf16"],
            "boundary_status": c["boundary_status"],
            "barrier_context": json.loads(c["barrier_context"]),
            "ownership": ownership_final,
            "evidence_sufficiency": r["evidence_sufficiency"],
            "primary_family": family_final,
            "secondary_factors": secondary,
            "evidence_types": [x for x in r.get("evidence_types", "").split(";") if x],
            "raw_text_facts": r.get("raw_text_facts", ""),
            "raw_text_sufficiency": r.get("raw_text_sufficiency", ""),
            "pdf_review_status": r.get("pdf_review_status", ""),
            "pdf_visual_observation": second.get("pdf_visual_observation") or r.get("pdf_visual_observation", ""),
            "pdf_region": second.get("pdf_region") or r.get("pdf_region", ""),
            "interpretation": second.get("interpretation") or r.get("interpretation", ""),
            "uncertainty": second.get("uncertainty") or r.get("uncertainty", ""),
            "reasoning_basis": second.get("reasoning_basis") or r.get("reasoning_basis", ""),
            "reviewer": r.get("reviewer", ""),
            "review_method": r.get("review_method", ""),
            "reviewer_ownership_initial": r["ownership"],
            "reviewer_primary_family_initial": r["primary_family"],
            "second_reviewer_ownership": second.get("ownership", ""),
            "second_reviewer_primary_family": second.get("primary_family", ""),
            "adjudication_reason": adjudication_reason,
        }
        classification_rows.append(common)
        evidence_rows.append({k: common[k] for k in [
            "observation_id", "hypothesis", "source_pdf", "physical_page", "side",
            "source_primitive_ids", "source_line_indexes", "source_ranges_utf16",
            "source_raw_text_fragments", "reason_codes", "boundary_status", "barrier_context",
            "raw_text_facts", "raw_text_sufficiency", "pdf_review_status",
            "pdf_visual_observation", "pdf_region", "interpretation", "uncertainty",
            "reasoning_basis", "reviewer", "review_method", "reviewer_ownership_initial",
            "second_reviewer_ownership", "adjudication_reason",
        ]})

    if len(classification_rows) != 109:
        raise SystemExit("classification output count mismatch")
    if any(r["pdf_review_status"] in ("", "NOT_REVIEWED") for r in classification_rows):
        raise SystemExit("one or more candidates lacks PDF review status")

    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    class_fields = list(classification_rows[0].keys())
    evidence_fields = list(evidence_rows[0].keys())
    write_csv(out / "ownership-classification.csv", classification_rows, class_fields)
    write_csv(out / "evidence-review.csv", evidence_rows, evidence_fields)
    unresolved = [r for r in classification_rows if r["ownership"] in {"AMBIGUOUS", "UNDETERMINABLE"} or r["evidence_sufficiency"] in {"RAW_TEXT_INSUFFICIENT", "STILL_UNDETERMINABLE"}]
    write_csv(out / "unresolved-cases.csv", unresolved, class_fields)

    family_groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for r in classification_rows:
        family_groups[str(r["primary_family"])].append(r)
    family_summary = []
    for fam in sorted(FAMILIES):
        group = family_groups[fam]
        family_summary.append({
            "failure_family": fam,
            "candidate_observations": len(group),
            "H1_observations": sum(r["hypothesis"] == "H1" for r in group),
            "H2_observations": sum(r["hypothesis"] == "H2" for r in group),
            "unique_source_pdfs": len({r["source_pdf"] for r in group}),
            "unique_physical_pages": len({(r["source_pdf"], r["physical_page"]) for r in group}),
            "ownership_labels": dict(Counter(str(r["ownership"]) for r in group)),
        })
    write_csv(out / "failure-family-summary.csv", family_summary, [
        "failure_family", "candidate_observations", "H1_observations", "H2_observations",
        "unique_source_pdfs", "unique_physical_pages", "ownership_labels",
    ])

    def summary_for(hyp: str) -> dict[str, object]:
        group = [r for r in classification_rows if r["hypothesis"] == hyp]
        return {
            "hypothesis": hyp,
            "candidate_observations": len(group),
            "ownership": dict(Counter(str(r["ownership"]) for r in group)),
            "evidence_sufficiency": dict(Counter(str(r["evidence_sufficiency"]) for r in group)),
            "primary_failure_family": dict(Counter(str(r["primary_family"]) for r in group)),
            "unique_source_primitives": len({p for r in group for p in r["source_primitive_ids"]}),
            "unique_source_pdfs": len({r["source_pdf"] for r in group}),
            "unique_physical_pages": len({(r["source_pdf"], r["physical_page"]) for r in group}),
        }
    h1, h2 = summary_for("H1"), summary_for("H2")
    write_json(out / "h1-summary.json", h1)
    write_json(out / "h2-summary.json", h2)

    all_owners = Counter(str(r["ownership"]) for r in classification_rows)
    all_evidence = Counter(str(r["evidence_sufficiency"]) for r in classification_rows)
    all_families = Counter(str(r["primary_family"]) for r in classification_rows)
    source_pages = len(source_validation["sourcePageTextHashes"])
    source_pdfs = len(source_validation["sourcePdfHashes"])
    validation = {
        "candidate_rows": len(candidates),
        "candidate_counts_by_hypothesis": dict(counts),
        "classification_rows": len(classification_rows),
        "classification_ids_exactly_match_candidate_inventory": True,
        "ownership_labels_complete": True,
        "evidence_sufficiency_labels_complete": True,
        "all_candidates_have_pdf_review_status": True,
        "source_validation": source_validation,
        "ownership_counts": dict(all_owners),
        "evidence_sufficiency_counts": dict(all_evidence),
        "primary_failure_family_counts": dict(all_families),
        "unresolved_case_count": len(unresolved),
        "unique_source_primitives": len({p for r in candidates for p in json.loads(r["source_primitive_ids"])}),
        "inventory_sha256": sha256(args.candidate_inventory),
        "second_review_sha256": sha256(args.second_review),
        "adjudications_sha256": sha256(args.adjudications),
        "worker_review_sha256": review_input_hashes,
    }
    write_json(out / "validation.json", validation)

    raw_visual = """# Raw Text and PDF visual evidence\n\nAll 109 candidate observations were first inspected against their exact Raw Text fragments and frozen provenance. The reviewers recorded Raw Text alone as insufficient for the ownership decision in every candidate, then inspected the corresponding rendered PDF page. Therefore the evidence sufficiency count is PDF_VISUAL_REQUIRED for all 109 candidates; this is not an accuracy estimate.\n\nThe independent NDL p2 review distinguished the top-margin physical folio `1` from the TOC page reference `国(国)13`. The latter is in the TOC table's ページ column and aligns with `令和６年度概算要求定員表` on the final row, supporting SAME_ITEM. The first H2-C review conflated those two page-number concepts; that initial assessment remains recorded in the classification output.\n\nH1 observations were visually aligned as same-column continued entries. The frozen primitives preserve the fragments, page references, and source spans but do not encode an explicit continuation-ownership relation.\n\nAll visual classifications are post-hoc development observations. No GT was created, and the PDF observations were not converted into parser rules.\n"""
    (out / "raw-vs-visual-evidence-summary.md").write_text(raw_visual, encoding="utf-8")
    reps = [
        "# Representative cases",
        "",
        "## H1: CFA p3, pageRef 94",
        "",
        "The Raw Text line carrying pageRef `94` is followed by a second fragment `必要な経費`. The rendered physical page shows the fragments on successive baselines in the same left TOC column; this is SAME_ITEM with PDF_VISUAL_REQUIRED. No assembly output is produced by this study.",
        "",
        "## H2: NDL p2, `国(国)13` and staffing-table title",
        "",
        "The independent page review shows `国(国)13` in the printed ページ column on the same row as `令和６年度概算要求定員表`. This is SAME_ITEM, while the frozen side remains unknown and the relation is not encoded in the primitive data. The first review's DISTINCT_ITEMS assessment is preserved as a resolved review disagreement.",
        "",
        "## H2: NDL p2, physical folio and TOC heading",
        "",
        "The separate H2 candidate pairing upper-margin folio `1` with the centered TOC heading is DISTINCT_ITEMS: the folio is outside the grid; the heading sits above the grid. It is not the printed page reference `国(国)13`.",
        "",
        "## H2: repeated folio with table header",
        "",
        "Across the reviewed repeated-page cases, the physical folio is outside the grid and the `要求 / 区分 / ページ` text is the table header. These are distinct printed structures; the header is a non-item.",
    ]
    (out / "representative-cases.md").write_text("\n".join(reps) + "\n", encoding="utf-8")
    readme = f"""# FY2024 TOC Ownership Failure Isolation P0\n\nPost-hoc development review of the frozen #417 candidate inventory. This is not a held-out evaluation and creates no gold labels.\n\n- H1: {h1['candidate_observations']} observations\n- H2: {h2['candidate_observations']} observations\n- Ownership: {dict(all_owners)}\n- Evidence sufficiency: {dict(all_evidence)}\n- Failure families: {dict(all_families)}\n- Source coverage verified: {source_pages} physical pages / {source_pdfs} PDFs / {source_validation['sourceRawFragmentsChecked']} exact UTF-16 spans\n\nRun from the repository root:\n\n```sh\npython3 scripts/research/build-toc-ownership-failure-isolation.py \\\n  --data-root /path/to/data \\\n  --raw-manifest tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json \\\n  --candidate-inventory tests/fixtures/budget-request-toc-ownership-failure-isolation/2024/candidate-unresolved-inventory.csv \\\n  --reviews-dir /path/to/ownership-review-exports \\\n  --second-review /path/to/ownership-review-exports/ndl-second-review.csv \\\n  --adjudications tests/fixtures/budget-request-toc-ownership-failure-isolation/2024/coordinator-adjudications.json \\\n  --output-dir /path/to/ownership-review-exports/final\n```\n\nThe review CSVs contain human/AI observations. The script validates row and source coverage, preserves initial reviewer labels, applies only the explicit coordinator adjudications, and aggregates the evidence; it does not infer ownership.\n"""
    (out / "README.md").write_text(readme, encoding="utf-8")

    input_hashes = {
        "candidate_inventory_sha256": sha256(args.candidate_inventory),
        "raw_manifest_sha256": sha256(args.raw_manifest),
        "adjudications_sha256": sha256(args.adjudications),
        "preserved_417_archive_sha256": "ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79",
        "frozen_417_artifact_sha256": {
            "preregistration": "4d01e896e4ae1f6d1f8261252f84e2bf4da89f26a9d32a4cb3cf75c276e971d3",
            "fixture": "69a68e1f6edf8b571af74dcca6cdb0397d2c3be15a24c5e1d59fbcbbef7851ba",
            "expected_results": "cc3cc25032e0d2137b8255f4b68c7d3b58f123119b93b4e229bdb221bc95ac10",
        },
        "review_file_hashes": review_input_hashes,
        "source_pdf_and_text_hashes": source_validation,
    }
    write_json(out / "input-output-hashes.json", input_hashes)
    output_hashes = {p.name: sha256(p) for p in sorted(out.iterdir()) if p.is_file() and p.name != "input-output-hashes.json"}
    input_hashes["generated_output_sha256"] = output_hashes
    write_json(out / "input-output-hashes.json", input_hashes)

    print(json.dumps({
        "rows": len(classification_rows),
        "owners": dict(all_owners),
        "evidence": dict(all_evidence),
        "families": dict(all_families),
        "unresolved": len(unresolved),
        "source_pages": source_pages,
        "source_pdfs": source_pdfs,
        "output_dir": str(out),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
