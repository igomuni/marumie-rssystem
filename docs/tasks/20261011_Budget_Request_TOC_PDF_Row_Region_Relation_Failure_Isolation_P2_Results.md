# FY2024 Budget Request TOC: PDF Row / Region Relation Failure Isolation P2 — Results

## Status and research position

This is a post-hoc development feasibility and failure-isolation result. It is not a held-out evaluation, accuracy estimate, or new ownership ground-truth set. The study did not produce candidate-level geometry or new ownership judgments because the frozen source-to-PDF matching rule stopped every candidate.

## Preflight

- PR #421 is merged; its merge commit `a1702d58e9e880fd100cc03426f2607a2f43b3ee` is the main/base commit used by this worktree.
- P2 worktree branch: `igomuni/research/toc-pdf-row-region-relation-failure-isolation`.
- P2 freeze commit: `4d050b6cf7e25caa4825e70b726686a8c4091ebd`.
- Tool-feasibility report commit: `dc51059ddd6cf591af805494170e9cb263ee8a95`.
- The frozen 50-candidate inventory, source PDF hashes, raw text manifest, and structure inventory were rechecked. See the run artifact's `validation.json` and `input-output-hashes.json`.
- PR #421's former Orca worktree was removed through Orca management after confirming it was merged, clean, had no active workers, and its saved ZIP matched the recorded SHA-256. The current P2 worktree remains for review.

## Frozen population

The population is unchanged: 31 known H1 positives, 3 prior review disagreements, 4 prior independent-review agreement controls, and 12 stratified controls. Total: 50 candidate observations from 15 PDFs and 17 physical pages. The prior review labels remain immutable and were not re-adjudicated.

## Tool and mapping observations

- All 17 pages have a native text layer; OCR is not needed.
- Source PDF hashes matched the frozen manifest for all 15 PDFs. Poppler layout page text matched the frozen raw text page hashes for all 17 pages.
- The 100 frozen source fragments were reconstructed exactly from Poppler layout text using their frozen UTF-16 ranges.
- Existing `budget-request-pdf-page.ts` uses pinned pdfjs-dist 5.4.296 and exposes text items with bounding boxes and transforms. Poppler 26.09.0 `-bbox-layout` also exposes word boxes. Their sampled token boxes agree within 0.001 pt. Neither source provides character-level boxes; pdf.js `hasEOL` is content-stream metadata, not a semantic row boundary.
- A feasibility audit split the 50 candidates into 185 whitespace-delimited text segments. 72 segments had a unique text match in the pdf.js item stream, 113 had multiple matches, and none were unmatched. The longest segment matched uniquely for 50/50 candidates, but all-fragment uniqueness held for 0/50 candidates.
- Repeated short fragments such as `経費`, `費`, `入`, and repeated page references account for the non-unique matches. The report did not choose the longest fragment as a substitute mapping rule: the frozen contract requires candidate geometry collection to stop when source-to-PDF matching is non-unique.
- Poppler layout line indices and y-coordinate clusters did not map 1:1 in the feasibility audit. No deterministic raw-line-to-PDF-row rule was established.

## Result under the frozen contract

All 50 candidates have `STOP_NON_UNIQUE_TEXT_MAPPING`; candidate-level geometry collection is 0/50. No Layer B row/region relation was recorded and no new Layer C ownership classification was made. Prior P1 ownership observations remain as prior development evidence only.

This means the study cannot answer whether PDF geometry distinguishes H1 ownership or resolves the three reviewer disagreements. The observed bottleneck is source-span-to-PDF-coordinate attribution, not absence of native PDF geometry. It would be circular to use spatial proximity to choose which repeated text instance a fragment refers to and then claim that the resulting geometry explains ownership.

## Existing research primitives inspected

The existing SourceToken layer retains pdf.js item text, page, bbox, transform, width, font size, `hasEOL`, and content-stream index. Existing TableGeometry / LogicalRow code retains token references and visual positions. LogicalRow is explicitly a geometric candidate relation, not a semantic item record. These primitives demonstrate that reproducible geometry can be extracted, but the current P2 candidate spans are not uniquely mapped to those tokens under the frozen protocol. Existing research code was inspected read-only and was not run as an ownership resolver or changed.

## Limits and next decision

The outcome is a feasibility stop for this frozen mapping protocol. To proceed with geometry, a separate reviewed protocol would need to define how a complete raw-text span maps to PDF source tokens when short fragments repeat, while avoiding the use of the ownership relation being studied to select the match. That protocol may use line-level or row-level alignment, but this report does not propose or adopt one. Alternatively, the study can retain all 50 candidates as unresolved under the current protocol.

No parser, assembly rule, regex, fixture, GT, or production pipeline was changed. No final TOC CSV or held-out evaluation was produced.

## Reproducible run artifact

Run artifact: `data/work/exports/20261011_2105_FY2024_TOC_PDF_Row_Region_Relation_Failure_Isolation/`.

It contains the 50-candidate stop inventory, population/tool summary, validation, hashes, and the tool-feasibility report. The ZIP is stored alongside that directory. See its `README.md` and `input-output-hashes.json` for contents and digests.
