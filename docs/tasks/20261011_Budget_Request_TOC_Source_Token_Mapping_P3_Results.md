# FY2024 Budget Request TOC — Source Token Mapping P3 Results

## Status and boundary

This is a development study of Raw Text source spans to PDF-native text occurrences. It is not held-out evaluation, a gold set, semantic ownership review, row/region relation evaluation, or TOC assembly. No production parser, frozen input, GT, P2 artifact, or source PDF/Plain Text was changed.

The P3 population and M0/M1 contract were frozen before matching in commit `89bea5288ec0f9393c37359ecc18e5e7ee5467ba` on base `9c9ba611a9047480166a92601f94f3034f9ddc7f`. The frozen sample contains 12 candidates (5 prior positives, 3 prior reviewer disagreements, 4 prior agreement controls), 24 fragments, 43 segments, 8 PDFs, and 8 physical PDF pages. Group labels were omitted from the matching packet and joined only after the mechanical outputs were generated and hashed.

## Method

M0 listed every normalized text occurrence in the pdf.js 5.4.296 content-item stream, concatenated in content order without an inserted separator. M1 applied only the frozen same-Raw-Text-line context rule (up to 12 non-whitespace code points on either available side). Both used the preregistered normalization: remove Unicode whitespace and map U+2011 to U+002D; no NFKC or semantic correction. Coordinates were retained as metadata and not used to select occurrences.

The mapping run verified the source PDF and Raw Text file hashes, recomputed selected page hashes, and rechecked every UTF-16 source span before matching. A second run reproduced the eight mechanical files byte-for-byte. During code review, the segment delimiter was tightened from JavaScript `\s` to the frozen Unicode `White_Space` property. The selected source fragments contain only U+0020 whitespace, and a post-correction full rerun reproduced all eight files byte-for-byte; the correction did not change the observed results. An independent Orca reviewer, blinded to source group and ownership, re-extracted the PDF pages with its own script using pdf.js 5.4.296 and re-read every reviewed Raw Text span. The reviewer also rendered one page as a read-only visual spot-check; the remaining review relied on native text-item evidence. This is one reviewer and development evidence, not held-out GT.

## Mechanical results

| Measure | M0 | M1 |
|---|---:|---:|
| Unique occurrences | 17 | 12 |
| Multiple occurrences | 26 | 11 |
| No occurrence / context not matched | 0 | 20 |

M1 changed 8 M0-multiple segments to a unique context occurrence. It also changed 13 M0-unique segments to `CONTEXT_NOT_MATCHED`; 4 M0-unique segments remained unique under M1. Occurrence counts were unchanged for 15 segments. Thus M1 narrowed some repeated-text cases but also rejected same-line contexts around many text occurrences that M0 had found.

All occurrence spans listed by the matcher were attributable to pdf.js item indexes and item-local code-point/UTF-16 offsets. Among enumerated occurrence mappings, 22 M0 and 7 M1 occurrence rows spanned multiple text items; these method-specific counts can refer to the same source text and are not deduplicated. No token-attribution-unresolved occurrence was observed. M0 found at least one exact normalized text occurrence for all 43 segments.

At fragment level, 2 fragments were text-unique under M0 and 3 under M1; all other fragments remained unresolved. No candidate had both source fragments fully text-unique under either method. Text uniqueness remains distinct from source correspondence and semantic ownership.

## Independent source correspondence review

The reviewer completed all 57 preselected review rows:

| Automated result reviewed | Review outcome | Rows |
|---|---|---:|
| M0 unique | `SOURCE_CORRESPONDENCE_CONFIRMED` | 17 |
| M1 unique | `SOURCE_CORRESPONDENCE_CONFIRMED` | 12 |
| M0 multiple (sample) | `AMBIGUOUS` | 12 |
| M1 multiple (sample) | `AMBIGUOUS` | 5 |
| M1 context not matched (sample) | `UNDETERMINABLE` | 11 |

There were 29 confirmed method-level decisions, 17 ambiguous rows, 11 undeterminable rows, and no rejected row. Four segment identities were unique under both methods, so the 29 decisions are not 29 distinct fragments. All 29 unique decisions checked by the reviewer had matching exact text in the cited pdf.js item range. This is evidence for the reviewed occurrence correspondence only; it does not prove a general accuracy rate. The non-unique and context-not-matched reviews followed the fixed candidate sampling cap; they do not cover every such segment.

For the 11 sampled `CONTEXT_NOT_MATCHED` rows, the reviewer independently found the exact segment text elsewhere in the page stream (one to eight occurrences) but found no occurrence with the required local context. The reviewer classified these as undeterminable and did not infer a mapping. This is consistent with a difference between Raw Text line context and PDF content-stream adjacency; it is not evidence that the source text is absent.

## Failure isolation

- **FI-1 Repeated text:** 26 M0 segments had multiple exact text occurrences. The 12 sampled rows remained ambiguous; no occurrence was selected by tie-breaking.
- **FI-2 Insufficient local context:** 11 M1 segments retained multiple context-qualified occurrences. Five sampled rows remained ambiguous.
- **FI-3 Stream-order/local-context mismatch:** 20 M1 segments had no context-qualified occurrence although M0 found text for all segments. Eleven sampled rows were undeterminable after independent review. The observed failure is that same-line context does not reliably align with pdf.js content-stream neighbors.
- **FI-4 Token boundary difference:** Some candidate substrings crossed pdf.js text-item boundaries. Item-level source spans were retained; an item bbox was not treated as a character bbox.
- **FI-5 Normalization difference:** No M0 segment was unmatched under the frozen normalization in this sample.
- **FI-6 Unique text but invalid correspondence:** No rejected correspondence was found among the reviewed unique decisions. The reviewed sample is too small and selected to establish a general false-unique rate.
- **FI-7 Token attribution unresolved:** None observed in this run.
- **FI-8 Insufficient evidence:** Repeated occurrences and context-not-matched rows were retained as ambiguous or undeterminable rather than forced to a single location.

These categories describe source mapping evidence only. No row/region relation or semantic ownership conclusion was drawn.

## Selection-stratum observations

The 43 segments were distributed as follows. These are descriptive counts for the preregistered selection strata, not accuracy by label.

| Selection stratum | Candidates | Segments | M0 unique / multiple | M1 unique / multiple / context-not-matched |
|---|---:|---:|---:|---:|
| Prior `KNOWN_POSITIVE` | 5 | 19 | 7 / 12 | 3 / 5 / 11 |
| Prior reviewer disagreement | 3 | 11 | 5 / 6 | 5 / 2 / 4 |
| Prior reviewer agreement controls | 4 | 13 | 5 / 8 | 4 / 4 / 5 |

The mapping worker did not receive these strata or prior ownership labels. They were joined after the mechanical output files had been generated and hashed.

## Validation and artifacts

- Frozen inventory: 12 candidates / 24 fragments; all source hashes, page hashes, and UTF-16 spans matched.
- Mapping packet: no prior ownership, review, group, or control-family fields.
- Reproducibility: 8/8 mechanical output files were byte-identical across two runs.
- Independent review: 57/57 selected review IDs present exactly once; evidence fields populated; status counts reconcile.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- Focused core tests: `npx vitest run scripts/research/toc-source-token-mapping-p3-core.test.ts` passed (4 tests). Mapping validation: `validate-toc-source-token-mapping-p3.py` passed source/output accounting, deterministic rerun, and post-correction byte-comparison checks.
- `npm run lint` passed with existing application warnings; direct ESLint invocation could not run because ESLint 9 requires `eslint.config.*`, which this repository checkout does not provide. No lint configuration was added or changed.
- Existing v0 parser SHA-256 remained `69d0541281f862c2a063caf9234533395dbacbda25a125ed3940242f599073c3`.
- P2 frozen files, source data, existing research worktrees, main worktree, and old #422/#423 worktrees were not changed.

Machine-readable outputs and the independent review are in `data/work/exports/20261011_2251_FY2024_TOC_Source_Token_Mapping_P3/`; see its README and hash manifest. The first Orca reviewer start resolved `current` to `HelloOrcaWorld`, so it was stopped before writing. The task was retried with the exact P3 worktree selector, completed there, and its terminal was released. No files in the initial workspace were changed.

## Interpretation and next questions

**Observed:** M1 reduced multiple occurrences from 26 to 11, but produced 20 context-not-matched segments and reduced unique occurrences from 17 to 12. Exact text for all reviewed unique locations was independently found at the cited token spans. No candidate had both fragments fully unique.

**Interpretation:** Same-line context can disambiguate some repeated strings, but content-stream adjacency does not consistently reproduce Raw Text line adjacency. Treating M1 uniqueness as a general mapping rule is not supported by this development sample; its abstentions are material.

**Research options, not decisions:** test a separately preregistered Raw Text line ↔ PDF token sequence alignment; preserve PDF source-token identity without requiring full Raw Text alignment; or keep ambiguous mappings unresolved. The user and ChatGPT should choose the next hypothesis. No ownership, row/region, or assembly GO/STOP is made here.
