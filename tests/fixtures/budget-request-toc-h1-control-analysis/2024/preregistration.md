# FY2024 TOC H1 Positive / Negative Control Failure Isolation P1

## Purpose and boundary

This post-hoc development study compares known H1 positive observations with systematically discovered negative and near-miss controls across the frozen FY2024 TOC population (82 physical pages, 55 PDFs). It asks whether the ownership relation in `title_page → title_only_candidate` can be distinguished using observable Raw Text features. It does not estimate accuracy or generalization, create held-out data or GT, or define/implement an automatic assembly rule.

PR #418's 31 H1 `SAME_ITEM` observations are the fixed positive set. They retain their original #417 observation IDs and #418 evidence references. This post-hoc development evidence must not be reused as held-out data. This study searches the full 82-page population; any page or candidate visually reviewed here is exposed to this post-hoc development analysis and must not later be presented as an untouched held-out sample. Existing formal-evaluation results and labels are not consulted or changed.

## Frozen sources and preconditions

- PR #416 column primitives, #417 assembly observations, and #418 ownership review, as merged into main.
- The complete #417 82-page census archive, whose SHA-256 must equal `ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79` before it is read.
- `structure-inventory.json`, `raw-text-manifest.json`, and source Plain Text/PDFs, all read-only.

Before candidate discovery, verify #418 is merged, the population is 82 TOC pages / 55 PDFs / DIRECT 55 / INHERITED 27, all frozen #417 input and output hashes, and the fixed positive inventory. Source TXT/PDF hashes must match the manifest. Do not regenerate or edit frozen parser outputs. If any precondition fails, stop.

## Fixed positive inventory

The positive set is exactly the 31 rows with `hypothesis=H1` and `ownership=SAME_ITEM` in the merged #418 classification. Do not add, remove, deduplicate, or relabel these rows based on this study. Preserve original #417 observation IDs, #418 classification references, primitive IDs, source PDF/page, line indices, UTF-16 spans, raw fragments, side, page reference, boundary/barrier context, and visual evidence provenance. Verify each raw fragment against the manifest-matched Plain Text span. The frozen positive CSV SHA-256 is `e07044788a429113b07fada2df5bf98bf6ac0af5c2fb926bd8451cf2541a8a7d`; the observation-ID list, sorted ascending with one UTF-8 ID per line and a final LF, has SHA-256 `7aeff2bae9289af29a81cb28c05662833c962f3ccbf7d9494d9befac9853d73c`. Commit this inventory and its manifest before negative candidate discovery.

## Negative discovery population and fixed procedure

The search population is all 82 TOC physical pages, ordered by repository-relative PDF path and physical page. It is not restricted to the 13 pages containing positives. The full candidate census and selection list are generated mechanically from frozen #416/#417 outputs before any new negative-control PDF ownership review. A read-only research inventory/sampling script is permitted; it must not alter frozen outputs or implement ownership/assembly decisions.

### Full ordered-pair census

Enumerate every ordered pair on the same PDF and physical page where the first primitive is `title_page`, the later primitive is `title_only_candidate`, and `target.sourceLineIndex > start.sourceLineIndex`. Preserve all pairs, even distant or blocked ones. Do not use title meaning, PDF appearance, or ownership outcomes to include or exclude a pair.

For each pair, use exact primitive IDs and classify its mechanical shape as follows:

1. `EXACT_H1_SHAPE` if the exact source primitive ID pair is present in the frozen #417 output as H1 `CANDIDATE_UNRESOLVED` or `AMBIGUOUS`.
2. Otherwise, assign one mutually exclusive near-shape signature using this precedence:
   - `UNKNOWN_SIDE`: either primitive side is `unknown`.
   - `KNOWN_SIDE_MISMATCH`: both sides are known and differ.
   - `SAME_SIDE_INTERVENING_BARRIER`: both sides are the same known side and a frozen barrier is on a strictly intermediate source line, or occurs earlier on the target source line before the target span.
   - `SAME_SIDE_INTERVENING_PRIMITIVE`: both sides are the same known side and a frozen primitive with the same or `unknown` side occurs on a strictly intermediate source line, or earlier on the target source line before the target span.
3. `OUTSIDE_H1_SHAPE` if none of the preceding definitions applies.

The census is a list of possible structural comparisons, not asserted item matches. `EXACT_H1_SHAPE` must be reconciled against the #418 positive inventory. If its membership is not exactly those same 31 H1 pairs, stop before visual review and explain the discrepancy. Because the fixed exact-shape set is the previously reviewed positive set, a new N1 hard negative is **not observable in this frozen corpus under this exact definition**. Report `N1_NOT_OBSERVED_IN_FROZEN_CORPUS` as a limitation of the frozen exact-shape set, not as evidence that the H1 candidate rule is safe or discriminative. The near-shape controls below are not matched-shape negatives.

### Canonical census and selection bytes

All inventory and sample hashes use SHA-256 over UTF-8 bytes with LF line endings and one final LF. Do not hash CSV bytes for these two hashes. Serialize the full pair census as JSON Lines: one object per pair, no indentation or inter-field whitespace, keys in this exact order `pairId,sourcePdf,physicalPage,startPrimitiveId,targetPrimitiveId,shapeSignature`; JSON string escaping follows ECMAScript `JSON.stringify` (including literal non-ASCII characters and escaped control characters), `physicalPage` is a base-10 integer, and there are no omitted keys. Sort census objects by `sourcePdf` in UTF-8 bytewise ascending order, then `physicalPage` in numeric ascending order, then `startPrimitiveId` and `targetPrimitiveId` in UTF-8 bytewise ascending order before serialization. The census SHA-256 is computed over the resulting bytes including the final LF.

Serialize the selected-pair list with the same JSON Lines rules and key order `pairId,sourcePdf,physicalPage,startPrimitiveId,targetPrimitiveId,shapeSignature,sampleRank`; sort by `sourcePdf` in UTF-8 bytewise ascending order, then `physicalPage` in numeric ascending order, then `shapeSignature` in UTF-8 bytewise ascending order, then `sampleRank` in numeric ascending order, then `pairId` in UTF-8 bytewise ascending order. `sampleRank` is a one-based integer within its page/signature stratum. The selected-list SHA-256 is computed over the resulting bytes including the final LF. Counts are derived from the same serialized row sets. The second-review rank digest is SHA-256 of the UTF-8 bytes of `pairId` with no terminator. These canonicalization rules are fixed before candidate enumeration and visual review.

### Fixed near-shape visual sample

For each pair, set `pairId` to `h1pair-` followed by the lowercase hexadecimal SHA-256 of the exact UTF-8 byte sequence:

`sourcePdf + 0x00 + decimalASCII(physicalPage) + 0x00 + startPrimitiveId + 0x00 + targetPrimitiveId`

For each physical page and each of the four mutually exclusive near-shape signatures, sort pairs by `pairId`'s SHA-256 suffix in lowercase hexadecimal bytewise ascending order, then by the tuple `(sourcePdf, physicalPage, startPrimitiveId, targetPrimitiveId)` in bytewise ascending order. Select at most the first two pairs per page/signature. The selected-pair list, total census counts, per-stratum counts, and selected-list SHA-256 must be committed before PDF ownership review. If one pair meets multiple lower-level tests, precedence above assigns it to exactly one stratum; do not review it twice. Do not replace a selected case.

All `EXACT_H1_SHAPE` pairs reuse their existing #418 reviews; they are not presented as new blind controls. For selected near-shape pairs, reviewers receive the exact pair/source provenance and PDF page but not its mechanical stratum, sample rank, or other reviewer's decision. A fixed 10% of selected near-shape pair IDs (ceiling, minimum one if any are selected), ranked by lowercase hexadecimal SHA-256 of the UTF-8 bytes of `pairId`, with bytewise `pairId` tie-break, is independently reviewed by a second reviewer before classifications are compared. Preserve disagreements; do not use majority vote.

`OUTSIDE_H1_SHAPE` pairs are fully enumerated but not visually sampled by this contract; report their counts and do not infer ownership. Report the selected/reviewed and unreviewed counts separately.

### Post-review control labels

After blind review, apply descriptive labels without changing the mechanical stratum:

- N1: matched-shape hard negative; may apply only to `EXACT_H1_SHAPE`. Given the frozen positive reconciliation above, the expected result is `N1_NOT_OBSERVED_IN_FROZEN_CORPUS`, which provides no negative discrimination evidence.
- N2: near-miss non-continuation (for example, a separate item despite local similarity).
- N3: heading/non-item rather than a continuation item.
- N4: cross-column relation.
- N5: ownership remains ambiguous after evidence review.
- `OTHER`: another observed control type.

N2–N5 are near-shape or other control observations, never matched-shape evidence. Where a case has multiple applicable labels, record one primary label and all secondary labels; do not force categories to be exclusive.

## Ownership and evidence review

Ownership is one of `SAME_ITEM`, `DISTINCT_ITEMS`, `AMBIGUOUS`, or `UNDETERMINABLE`. Evidence sufficiency is independently `RAW_TEXT_SUFFICIENT`, `PDF_VISUAL_REQUIRED`, or `STILL_UNDETERMINABLE`.

For positives, use the frozen #418 evidence and label them as previously reviewed. For selected near-shape controls, inspect exact Raw Text/provenance first, then the corresponding PDF physical page. Record visible region, row/column relationship, observed facts, interpretation, uncertainty, reviewer, method, and disagreement. A visually observed `SAME_ITEM` is not evidence that Raw Text features suffice for automatic assembly. Japanese-language plausibility alone is not ownership evidence. Do not create GT or change prior classifications.

## Fixed descriptive features

For the 31 positives and all selected/reviewed near-shape controls, record:

1. source-line index gap and whether the lines are consecutive;
2. the side pair and whether both sides are known/equal;
3. literal U+0020 leading-space count per source line, plus whether other whitespace occurs before the first non-whitespace character (zero spaces is a measured zero; null means the line/source is unavailable);
4. each primitive's UTF-16 source range and start offset;
5. page-reference string exactly as stored by the primitive;
6. primitive kinds and exact raw fragments (these are fixed by pair selection and are not a discriminating feature);
7. count/kinds of frozen primitive/barrier units strictly between the pair's source spans, ordered by `(lineIndex, startUtf16, stable ID)`, computed from the complete page ledger;
8. whether the target primitive ID occurs in any frozen #417 H2 observation;
9. page-level boundary status/column and pair-interval barrier IDs from the #416/#417 full census, including when the pair has no #417 assembly observation.

Features 2 and 7 are involved in the near-shape strata; feature 6 is constant by definition. Mark these `NOT_APPLICABLE` for positive/negative separability claims and state why. Do not call selection variables evidence of discrimination. Feature 9 must come from the page-level frozen census and full primitive/barrier ledger, never from the absence or presence of a pair-specific #417 observation. Feature 8 is determined only by exact primitive-ID membership in frozen H2 observations. Do not infer semantic item codes, paraphrase title meaning, add regexes, normalize text, convert Raw Text spacing to PDF distance, or treat UTF-16 offsets as PDF coordinates. Missing values stay null/unknown with a reason.

## Comparison and reporting

Report the positive set, exact-shape set, each near-shape stratum, selected/reviewed controls, and unreviewed census pairs separately. For each feature use `SEPARATES_OBSERVED_CASES`, `OVERLAPS_POSITIVE_NEGATIVE`, `INSUFFICIENT_EVIDENCE`, or `NOT_APPLICABLE`, with case IDs and reasons. The required `NOT_APPLICABLE` label includes features fixed by the pair definition or used for sample selection. N2–N5 findings do not establish exact-shape discrimination. A feature that separates this selected development sample does not establish generalization.

Preserve initial assessments and coordinator adjudications separately. Do not change the discovery, sampling, or classification contract after visual outcomes are seen. If the frozen procedure cannot be applied, stop and report the blocker.

## Reproducibility and non-goals

Record source commit, all frozen artifact hashes, full #417 archive hash, source inventory/manifest hashes, positive inventory hash, full ordered-pair census hash, selection list hash, reviewer files, final output hashes, and reviewed/unreviewed counts. Generate the positive inventory, full pair census, and selection list twice and compare their deterministic outputs. Visual judgments are evidence records, not deterministic program output.

No parser/regex/assembly/column segmentation changes, no PDF geometry parser, no final TOC CSV, no production integration, no formal held-out evaluation, no accuracy/generalization claims, and no changes to #416/#417/#418 frozen artifacts are permitted.
