# FY2024 Budget Request TOC Ownership Failure Isolation P0 — Results

## Status and scope

The post-hoc development review classified all 109 `CANDIDATE_UNRESOLVED` observations from Minimal Assembly v0 (#417). The review distinguishes ownership of a printed TOC item from whether the frozen primitive data could encode that ownership. It made no parser, regex, primitive, assembly, existing frozen fixture, GT, or held-out changes. New review artifacts were added for this research iteration.

This is not a held-out evaluation, accuracy estimate, or gold-label set. `SAME_ITEM` records an observed printed relationship and does not mean the current #417 assembly should be automatically resolved.

## Preflight and source validation

- PR #417 is merged into main at merge commit `bb6c72fb2fd412f2939990dfee2dbe382c9f7866`.
- #417 review head: `cf1b3934d534fa7b51b6dfdf3f964fcb1b64e9dc`.
- #417 freeze: `d2ac1e6a8e7fd1da1667633d67af4e7ca784991c`.
- Preserved #417 output ZIP SHA-256: `ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79`.
- Raw Text manifest SHA-256: `d58e048b43a38b29d035ff07dbd2d664ad5bea28c50fed4e0c30c61052c3573c`.
- Frozen candidate inventory SHA-256: `3808c1698e6671589e5edda1292bb49c61fa623d569e8ed11f18a274c629289d`.
- Existing v0 parser SHA-256 remains `69d0541281f862c2a063caf9234533395dbacbda25a125ed3940242f599073c3`.

The 109 rows resolve to 218 distinct source primitive IDs: 31 H1 observations and 78 H2 observations, with no candidate observation ID or source primitive duplicated. Candidate source provenance was checked against 52 PDF hashes, 79 page-text hashes, and 218 exact Raw Text spans using the recorded UTF-16 ranges. All hashes and spans matched the frozen manifest and source files. The 79 pages are the pages represented by these candidates, not the full 82-page corpus.

The old #417 Orca worktree was clean, had no unpushed commits, and its output archive had been preserved and hash-checked before it was removed through Orca's worktree management. This new research worktree remains available for review.

## Ownership results

| Hypothesis | Candidates | SAME_ITEM | DISTINCT_ITEMS | AMBIGUOUS | UNDETERMINABLE |
|---|---:|---:|---:|---:|---:|
| H1 `title_page → title_only_candidate` | 31 | 31 | 0 | 0 | 0 |
| H2 `page_only → title_only_candidate` | 78 | 1 | 77 | 0 | 0 |
| **Total** | **109** | **32** | **77** | **0** | **0** |

Every decision was classified `PDF_VISUAL_REQUIRED` (109/109). The Raw Text fragments and primitive provenance were reviewed first, but the visual row/region relationship was needed to distinguish a continuation or table row from a nearby folio, heading, or header. This finding concerns these reviewed candidates only.

### H1 — title continuation

All 31 H1 candidates were visually observed as successive fragments of the same printed entry in the same TOC column. This includes the CFA p3 `94` entry followed by `必要な経費`, and wrapped entries beginning with `（項）`. The frozen primitives preserve the text, page reference, lines, and spans, but they do not encode an explicit continuation-ownership relation. Primary family: F1, 31 observations.

The initial H1 reviewer marked four continued `（項）` fragments as F2 while also classifying their ownership as `SAME_ITEM`. The coordinator reconciled the family label against the frozen definitions: those fragments continue the same printed row, so F1 describes the observed ownership failure; F2 does not. The original values and reasons remain preserved in the review output and adjudication record.

### H2 — page-only/title-only pairing

Of 78 candidates, 77 paired a physical page folio with a separate document/TOC heading or table header. In the rendered pages, the folio is in the upper margin while the heading/header sits above or inside the TOC grid. These are distinct printed structures and the heading/header is not a page-numbered TOC item. Primary family: F2, 77 observations.

One NDL p2 candidate is different. `国(国)13` is printed in the TOC table's `ページ` column on the same row as `令和６年度概算要求定員表` in the `区分` column. It is `SAME_ITEM`, `PDF_VISUAL_REQUIRED`, and primary family F6 because the primitive pairing does not encode that row relation. Its frozen side remains `unknown` / `NO_PAGE_LOCAL_BOUNDARY`; this study does not resolve the automatic assembly. A second independent rendered-page review and coordinator inspection corrected the first H2-C review, which had conflated the TOC page reference `国(国)13` with the separate physical folio at the top of the page. The first review and correction are both retained.

## Failure family results

| Primary family | Candidate observations | Interpretation |
|---|---:|---|
| F1 — true continuation, ownership missing | 31 | Same printed item; continuation relation is absent from the primitive pair. |
| F2 — independent heading/non-item | 77 | Physical folio was paired with a separate TOC heading/table header. |
| F6 — insufficient primitive relation | 1 | NDL p2 title and printed page reference share a row, but row ownership is not encoded. |
| F3, F4, F5, F7 | 0 primary | F4 is a secondary factor for the NDL candidate because its frozen side is unknown. |

These are descriptive labels from the frozen classification contract. They are not an adopted failure taxonomy for parser evaluation and do not define future extraction rules.

## Evidence and disagreement handling

The primary review covered all 109 candidate observations. The two NDL p2 candidates received an independent second review. The physical-page folio/TOC-heading pairing remained `DISTINCT_ITEMS`; the TOC `国(国)13`/staffing-table row pairing was independently confirmed as `SAME_ITEM`.

No ownership case remains ambiguous or undeterminable after PDF review. This does not imply that the relation can be inferred from Raw Text alone. The distinction between physical folio and printed page reference was material in NDL p2.

The four H1 family-label and 26 H2-A family-label adjustments preserve the reviewers' initial labels and record the taxonomy reason. H2-C's NDL ownership disagreement is preserved with both reviews and the visual evidence that resolves it. No disagreement was resolved by majority vote.

## Interpretation and next research evidence

The observations indicate two different sources of unresolved ownership:

1. H1 continuations are visually clear, but the existing primitive pair does not state that the second fragment continues the first title.
2. Most H2 candidates are not real item pairs at all: they pair physical folios with headings or table headers. NDL p2 is a true title/page row relation whose source-side/row relationship is missing from the primitive output.

The evidence therefore does not support turning all 109 candidates into assemblies. If the next study proceeds, the smallest evidence question is whether a row/region relation can be represented for the NDL-type page-only/title-only case without adding PDF-specific exceptions, while continuing to treat folio/header candidates as non-items. A separate study would be needed to decide whether Raw Text alone can identify H1 continuation ownership. These are research options, not accepted rules or a GO decision.

## Validation and reproducibility

- Candidate accounting: H1 31, H2 78, total 109; all IDs appear exactly once.
- Source references: 218 primitive IDs resolve; all 79 candidate page hashes, 52 candidate PDF hashes, and 218 exact UTF-16 spans match.
- Review coverage: 109/109 rows have ownership, evidence sufficiency, family, provenance, and PDF review status.
- Final classification regeneration was run twice; all 11 generated artifact files matched by SHA-256.
- Complete Orca run bundle: `data/work/exports/20261011_1835_FY2024_TOC_Ownership_Failure_Isolation.zip` (SHA-256 `e7efce3f1c056e67a6c620554fdf74f52de43c048d7ad6969cdb29ff38910214`).
- Parser, frozen fixtures, and source PDFs/Plain Text were not modified.
- No formal held-out evaluation, GT, assembly behavior, final CSV, or production integration was created.

The reproducible validation utility is `scripts/research/build-toc-ownership-failure-isolation.py`. The complete review CSVs, summaries, and hashes are in the ignored run output directory recorded in the PR description.
