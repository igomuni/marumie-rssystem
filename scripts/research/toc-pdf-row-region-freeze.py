#!/usr/bin/env python3
"""Freeze the P2 comparison population before collecting any PDF geometry."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/budget-request-toc-pdf-row-region-relation/2024"
P1_EXPORT = ROOT / "data/work/exports/20261011_FY2024_TOC_H1_Positive_Negative_Failure_Isolation"
POSITIVE = ROOT / "tests/fixtures/budget-request-toc-h1-control-analysis/2024/positive-inventory.csv"
P1_NEAR = P1_EXPORT / "negative-discovery-inventory.csv"
P1_REVIEW = P1_EXPORT / "negative-ownership-review.csv"
P1_INDEPENDENT = P1_EXPORT / "independent-review-comparison.csv"
RAW_MANIFEST = ROOT / "tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json"
STRUCTURE = ROOT / "tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json"

STRATA = (
    "KNOWN_SIDE_MISMATCH",
    "SAME_SIDE_INTERVENING_PRIMITIVE",
    "SAME_SIDE_INTERVENING_BARRIER",
    "UNKNOWN_SIDE",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        raise ValueError(f"No rows for {path}")
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def utf16_slice(text: str, start: int, end: int) -> str:
    encoded = text.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


def txt_for_pdf(pdf: str) -> Path:
    return ROOT / "data/work/budget-request-plain-text/2024" / (
        pdf.removeprefix("data/download/").replace("/", "__").replace(".pdf", ".txt")
    )


def main() -> None:
    FIXTURE.mkdir(parents=True, exist_ok=True)
    positives = read_csv(POSITIVE)
    near = read_csv(P1_NEAR)
    reviews = read_csv(P1_REVIEW)
    independent = read_csv(P1_INDEPENDENT)
    manifest = json.loads(RAW_MANIFEST.read_text(encoding="utf-8"))
    structure = json.loads(STRUCTURE.read_text(encoding="utf-8"))
    docs = {doc["localPdfPath"]: doc for doc in manifest["documents"]}

    if len(positives) != 31 or any(row["ownership"] != "SAME_ITEM" for row in positives):
        raise ValueError("P1 frozen Positive inventory does not reconcile to 31 SAME_ITEM rows")
    if len(near) != 67 or len(reviews) != 67 or len(independent) != 7:
        raise ValueError("P1 control source population does not reconcile to 67 / 67 / 7")
    if structure["summary"]["tocRouted"] != 82 or structure["summary"]["physicalPdfsWithToc"] != 55:
        raise ValueError("TOC source population is not the frozen 82-page / 55-PDF population")

    review_by_pair = {row["pair_id"]: row for row in reviews}
    independent_by_pair = {row["pair_id"]: row for row in independent}
    disagreements = {row["pair_id"] for row in independent if row["review_relation"] == "DISAGREEMENT"}
    agreements = {row["pair_id"] for row in independent if row["review_relation"] == "AGREEMENT"}
    if len(disagreements) != 3 or len(agreements) != 4:
        raise ValueError("Independent review must contain exactly 3 disagreements and 4 agreements")

    near_by_pair = {row["pair_id"]: row for row in near}
    if len(near_by_pair) != 67 or not (disagreements | agreements) <= near_by_pair.keys():
        raise ValueError("P1 review cases do not map uniquely into the frozen 67 near-control candidates")

    selected_extra: list[tuple[str, dict[str, str]]] = []
    selection_audit: list[dict[str, object]] = []
    reserved = disagreements | agreements
    for stratum in STRATA:
        stratum_rows = sorted(
            (row for row in near if row["shape_signature"] == stratum),
            key=lambda row: row["pair_id"],
        )
        eligible = [row for row in stratum_rows if row["pair_id"] not in reserved]
        chosen = eligible[:3]
        selected_ids = {row["pair_id"] for row in chosen}
        for rank, row in enumerate(stratum_rows, start=1):
            pair_id = row["pair_id"]
            if pair_id in disagreements:
                disposition = "EXCLUDED_DISAGREEMENT_CONTROL"
            elif pair_id in agreements:
                disposition = "ALREADY_INCLUDED_IN_INDEPENDENT_AGREEMENT_CONTROLS"
            elif pair_id in selected_ids:
                disposition = "SELECTED_ADDITIONAL_CONTROL"
            elif row in eligible[:3]:
                disposition = "SELECTED_ADDITIONAL_CONTROL"
            else:
                disposition = "NOT_SELECTED_BY_WITHIN_STRATUM_ID_RANK"
            selection_audit.append(
                {
                    "pair_id": pair_id,
                    "shape_stratum": stratum,
                    "stratum_rank_by_pair_id": rank,
                    "eligible_after_fixed_exclusions": pair_id not in reserved,
                    "disposition": disposition,
                }
            )
        selected_extra.extend((stratum, row) for row in chosen)

    if len(selected_extra) != 12:
        raise ValueError(f"Expected 12 additional controls, selected {len(selected_extra)}")

    candidates: list[dict[str, object]] = []
    source_errors: list[str] = []

    def add_candidate(
        *,
        group: str,
        candidate_id: str,
        pair_id: str,
        row: dict[str, str],
        review: dict[str, str] | None,
        stratum: str,
        kinds: list[str],
        sides: list[str],
        line_indexes: list[int],
        ranges: list[list[int]],
        raw_fragments: list[str],
        page_ref: str,
        previous_ownership: str,
        previous_review_status: str,
        previous_disagreement: str,
        shape: str,
        prior_labels: str,
    ) -> None:
        pdf = row["source_pdf"]
        page = int(row.get("physical_page", row.get("physicalPage", "0")))
        doc = docs.get(pdf)
        pdf_path = ROOT / pdf
        txt_path = txt_for_pdf(pdf)
        if doc is None or not pdf_path.is_file() or not txt_path.is_file():
            source_errors.append(f"missing source file or manifest mapping: {pdf}")
            pdf_sha = txt_sha = page_sha = ""
        else:
            pdf_sha = sha256(pdf_path)
            txt_sha = sha256(txt_path)
            if pdf_sha != doc["pdfSha256"]:
                source_errors.append(f"PDF hash mismatch: {pdf}")
            pages = txt_path.read_text(encoding="utf-8").split("\f")
            if page < 1 or page > len(pages):
                source_errors.append(f"TXT page out of range: {pdf} p{page}")
                page_text = ""
            else:
                page_text = pages[page - 1]
            page_sha = hashlib.sha256(page_text.encode("utf-8")).hexdigest()
            if page_sha != doc["pageTextSha256"][page - 1]:
                source_errors.append(f"Plain Text page hash mismatch: {pdf} p{page}")
            lines = page_text.splitlines()
            for line_index, span, fragment in zip(line_indexes, ranges, raw_fragments):
                if line_index < 0 or line_index >= len(lines):
                    source_errors.append(f"raw line index out of range: {candidate_id} L{line_index}")
                    continue
                recovered = utf16_slice(lines[line_index], span[0], span[1])
                if recovered != fragment:
                    source_errors.append(
                        f"source span mismatch: {candidate_id} L{line_index} {span}: {recovered!r} != {fragment!r}"
                    )

        candidates.append(
            {
                "candidate_id": candidate_id,
                "source_group": group,
                "original_pair_id": pair_id,
                "source_observation_id": row.get("observation_id", ""),
                "hypothesis": row.get("hypothesis", "H1"),
                "shape_stratum": stratum,
                "source_pdf": pdf,
                "publisher_domain": row.get("publisher_domain", ""),
                "physical_page": page,
                "primitive_ids": json.dumps(
                    json.loads(row.get("source_primitive_ids", "[]"))
                    if row.get("source_primitive_ids")
                    else [row.get("start_primitive_id", ""), row.get("target_primitive_id", "")],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "primitive_kinds": json.dumps(kinds, ensure_ascii=False, separators=(",", ":")),
                "primitive_sides": json.dumps(sides, ensure_ascii=False, separators=(",", ":")),
                "raw_line_indexes": json.dumps(line_indexes, separators=(",", ":")),
                "source_ranges_utf16": json.dumps(ranges, separators=(",", ":")),
                "raw_fragments": json.dumps(raw_fragments, ensure_ascii=False, separators=(",", ":")),
                "page_ref": page_ref,
                "previous_ownership": previous_ownership,
                "previous_pdf_review_status": previous_review_status,
                "previous_reviewer_disagreement": previous_disagreement,
                "previous_primary_ownership": (review or {}).get("primary_ownership_initial", previous_ownership),
                "previous_independent_ownership": (review or {}).get("independent_ownership_initial", ""),
                "previous_integrated_ownership": (review or {}).get("ownership_integrated_status", previous_ownership),
                "previous_review_relation": (review or {}).get("ownership_review_relation", ""),
                "previous_control_label": (review or {}).get("primary_control_label", ""),
                "previous_independent_control_label": (review or {}).get("independent_control_label", ""),
                "previous_secondary_labels": (review or {}).get("primary_secondary_labels", ""),
                "previous_shape_signature": shape,
                "boundary_status": row.get("boundary_status", row.get("page_boundary_status", "")),
                "boundary_column_utf16": row.get("boundary_column_utf16", row.get("page_boundary_column_utf16", "")),
                "barrier_context": row.get("barrier_context", row.get("pair_interval_barrier_ids", "")),
                "source_pdf_sha256": pdf_sha,
                "raw_text_file": str(txt_path.relative_to(ROOT)) if txt_path.exists() else "",
                "raw_text_file_sha256": txt_sha,
                "raw_text_page_sha256": page_sha,
                "raw_text_manifest_sha256": sha256(RAW_MANIFEST),
                "structure_inventory_sha256": sha256(STRUCTURE),
            }
        )

    for row in positives:
        ranges = json.loads(row["source_ranges_utf16"])
        line_indexes = json.loads(row["source_line_indexes"])
        fragments = json.loads(row["source_raw_text_fragments"])
        ids = json.loads(row["source_primitive_ids"])
        add_candidate(
            group="KNOWN_POSITIVE",
            candidate_id=row["observation_id"],
            pair_id="",
            row=row,
            review=None,
            stratum="",
            kinds=["title_page", "title_only_candidate"],
            sides=[row["side"], row["side"]],
            line_indexes=line_indexes,
            ranges=ranges,
            raw_fragments=fragments,
            page_ref=row["page_ref"],
            previous_ownership=row["ownership"],
            previous_review_status=row["pdf_review_status"],
            previous_disagreement="",
            shape="EXACT_H1_SHAPE",
            prior_labels=row["primary_family"],
        )

    for group, pair_ids in (("PRIOR_REVIEW_DISAGREEMENT", sorted(disagreements)), ("PRIOR_REVIEW_AGREEMENT_CONTROL", sorted(agreements))):
        for pair_id in pair_ids:
            row = near_by_pair[pair_id]
            review = review_by_pair[pair_id]
            ranges = [json.loads(review["start_source_range_utf16"]), json.loads(review["target_source_range_utf16"])]
            line_indexes = [int(review["start_raw_line_index"]), int(review["target_raw_line_index"])]
            lines = [review["start_raw_line"], review["target_raw_line"]]
            fragments = [utf16_slice(text, span[0], span[1]) for text, span in zip(lines, ranges)]
            prior_status = review["ownership_integrated_status"]
            disagreement = review["ownership_review_relation"]
            add_candidate(
                group=group,
                candidate_id=pair_id,
                pair_id=pair_id,
                row=row,
                review=review,
                stratum=row["shape_signature"],
                kinds=["title_page", "title_only_candidate"],
                sides=[row["start_side"], row["target_side"]],
                line_indexes=line_indexes,
                ranges=ranges,
                raw_fragments=fragments,
                page_ref=row["page_ref_exact"],
                previous_ownership=prior_status,
                previous_review_status=review["primary_pdf_region"],
                previous_disagreement=disagreement,
                shape=row["shape_signature"],
                prior_labels=review["primary_control_label"],
            )

    for stratum, row in selected_extra:
        pair_id = row["pair_id"]
        review = review_by_pair[pair_id]
        ranges = [json.loads(review["start_source_range_utf16"]), json.loads(review["target_source_range_utf16"])]
        line_indexes = [int(review["start_raw_line_index"]), int(review["target_raw_line_index"])]
        fragments = [
            utf16_slice(review[key], span[0], span[1])
            for key, span in zip(("start_raw_line", "target_raw_line"), ranges)
        ]
        add_candidate(
            group="STRATIFIED_ADDITIONAL_CONTROL",
            candidate_id=pair_id,
            pair_id=pair_id,
            row=row,
            review=review,
            stratum=stratum,
            kinds=[row["start_kind"], row["target_kind"]],
            sides=[row["start_side"], row["target_side"]],
            line_indexes=line_indexes,
            ranges=ranges,
            raw_fragments=fragments,
            page_ref=row["page_ref_exact"],
            previous_ownership=review["ownership_integrated_status"],
            previous_review_status=review["primary_pdf_region"],
            previous_disagreement=review["ownership_review_relation"],
            shape=stratum,
            prior_labels=review["primary_control_label"],
        )

    ids = [str(row["candidate_id"]) for row in candidates]
    if len(candidates) != 50 or len(set(ids)) != len(ids):
        raise ValueError(f"Expected 50 unique candidate observations, got {len(candidates)} / {len(set(ids))}")
    if source_errors:
        raise ValueError("Source validation failed:\n" + "\n".join(source_errors[:20]))

    write_csv(FIXTURE / "candidate-inventory.csv", candidates)
    write_csv(FIXTURE / "control-selection-audit.csv", selection_audit)
    # Preserve the P1 selection and independent-review sources as unchanged audit inputs.
    for source, destination in (
        (P1_NEAR, FIXTURE / "p1-near-control-source.csv"),
        (P1_REVIEW, FIXTURE / "p1-ownership-review-source.csv"),
        (P1_INDEPENDENT, FIXTURE / "p1-independent-review-source.csv"),
    ):
        destination.write_bytes(source.read_bytes())

    manifest_out = {
        "schema": "toc-pdf-row-region-relation-study-population/v1",
        "researchPosition": "development failure isolation; not held-out evaluation or gold labels",
        "upstream": {
            "pr": 421,
            "mergedCommit": "a1702d58e9e880fd100cc03426f2607a2f43b3ee",
            "positiveInventorySha256": sha256(POSITIVE),
            "p1NearControlExportSha256": sha256(P1_NEAR),
            "p1IndependentReviewExportSha256": sha256(P1_INDEPENDENT),
            "p1OutputZipSha256": sha256(ROOT / "data/work/exports/20261011_FY2024_TOC_H1_Positive_Negative_Failure_Isolation.zip"),
        },
        "input": {
            "rawTextManifestSha256": sha256(RAW_MANIFEST),
            "rawTextCorpusDigestSha256": manifest["frozenInput"]["corpusDigestSha256"],
            "structureInventorySha256": sha256(STRUCTURE),
            "tocPages": structure["summary"]["tocRouted"],
            "pdfs": structure["summary"]["physicalPdfsWithToc"],
            "directPages": structure["summary"]["tocBySource"]["DIRECT"],
            "inheritedPages": structure["summary"]["tocBySource"]["INHERITED"],
        },
        "population": {
            "positive": 31,
            "priorReviewDisagreement": 3,
            "priorIndependentAgreementControls": 4,
            "additionalControls": 12,
            "totalCandidateObservations": len(candidates),
            "uniquePdfs": len({row["source_pdf"] for row in candidates}),
            "uniquePhysicalPages": len({(row["source_pdf"], row["physical_page"]) for row in candidates}),
            "selectedAdditionalByStratum": {stratum: 3 for stratum in STRATA},
        },
        "frozenFiles": {},
        "selectionRule": "Within each prescribed P1 stratum, sort the 67 P1 near controls by pair ID; remove the three P1 disagreements and four prior independent-review agreements; select the first three remaining IDs. No cross-stratum replacement.",
        "geometryReviewStarted": False,
    }
    for path in sorted(FIXTURE.iterdir()):
        if path.is_file() and path.name != "candidate-inventory-manifest.json":
            manifest_out["frozenFiles"][path.name] = sha256(path)
    (FIXTURE / "candidate-inventory-manifest.json").write_text(
        json.dumps(manifest_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest_out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
