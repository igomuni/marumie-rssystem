# FY2024 Budget Request TOC: PDF Row / Region Relation Failure Isolation P2

## Research position

This is a post-hoc development failure-isolation study using previously observed FY2024 TOC pages. It is not a held-out evaluation, formal accuracy estimate, or new gold-label set. PR #421's ownership decisions are preserved as prior development observations; the current study may record discrepancies but must not overwrite them.

The study asks whether reproducible geometry observations from the source PDF explain ownership relations that the existing TOC primitives cannot represent. It separates:

1. **PDF source observation (Layer A):** printed text, bounding boxes, baselines, order, page boxes, rotation, and positions measured from the source PDF.
2. **Structural relation hypothesis (Layer B):** same/adjacent row, same column/region, alignment, distances, and possible entry-region relations inferred from Layer A.
3. **Semantic ownership (Layer C):** `SAME_ITEM`, `DISTINCT_ITEMS`, `AMBIGUOUS`, or `UNDETERMINABLE`.

Geometric proximity, shared alignment, or shared region is not itself proof of semantic ownership. H1 positives span multiple printed lines; sharing a baseline is not required. Conversely, same-column proximity alone does not establish a shared item.

## Frozen comparison population

The candidate inventory is frozen before geometry extraction or PDF page rendering. It contains:

- 31 known H1 positives from PR #421, retaining their original observation IDs and `SAME_ITEM` review.
- All 3 PR #421 independent-review disagreement cases, retaining both prior judgments and the integrated unresolved/disagreement state.
- The 4 cases where PR #421's independent reviewers agreed, as prior development controls.
- Up to 12 additional controls selected from the frozen 67 near controls: exclude the 7 cases above, group by the prescribed four `shape_signature` strata, sort each stratum by original `pair_id`, and take the first three remaining IDs. If a stratum has fewer than three eligible cases, record the shortfall and do not replace from another stratum.

The resulting inventory contains 50 candidate observations from 15 PDFs and 17 physical PDF pages. This is a fixed comparison set, not a representative or held-out sample. Candidate identity is observation/pair ID; rows are not merged merely because they share a PDF or page.

`tests/fixtures/budget-request-toc-pdf-row-region-relation/2024/candidate-inventory.csv` is the frozen inventory. `candidate-inventory-manifest.json` records selection inputs, source hashes, population accounting, and file digests. The copied P1 control-source files preserve the exact candidate selection and prior independent-review input used to construct this set.

## Geometry collection contract

Only after the population freeze commit may geometry be collected. First assess existing tools and any existing research code. Do not implement a reusable Row / Region parser. Do not use OCR, image segmentation, layout models, or PDF-specific ownership rules.

For each candidate PDF/page, record whether a native text layer exists and whether the candidate raw fragments can be matched to PDF text uniquely. Record the extraction tool and version, API, coordinate units and origin, media/crop boxes, rotation, character-versus-word granularity, bounding boxes, baseline convention, and every matching failure. Source PDF hashes must match the frozen raw-text manifest.

If source-to-PDF text matching is non-unique, the PDF text materially differs, a scan would require OCR, or coordinate correction cannot be reproduced, stop geometry collection for that candidate and retain it as unresolved. Do not infer missing characters or page references.

For feasible candidates, record only observations: matched text and spans, page coordinates, row/baseline grouping, horizontal/vertical positions and distances, alignment, column/region membership, neighboring visible entries, and separately visible item-start/page-reference cues. Layer B relations and Layer C ownership must be stored in separate fields with evidence and uncertainty.

## Controls and prior review

The frozen set includes all three known disagreement cases and the four previously agreed controls, plus the stratified controls described above. Prior P1 ownership and reviewer findings remain immutable evidence. A new review that differs from a prior assessment is recorded as a discrepancy with both observations; it does not silently replace the earlier classification.

## Analysis questions

- Can a reproducible PDF text/geometry source be matched to the frozen raw-text spans?
- What geometry relations occur among the 31 known positives?
- Do the same relations occur among the controls or the three disagreement cases?
- Can row/column/region observations explain the disagreement cases?
- Does geometry alone distinguish the observed ownership labels, or does semantic interpretation remain necessary?
- Which minimal observable relation fields could be useful in a future research primitive?

Report observed distributions and evidence coverage, not accuracy. If controls are not comparable to positives, state that explicitly. Human visual judgments are not deterministic program output. Do not claim a feature generalizes beyond this development sample.

## Non-goals

Do not change PR #416 Column Segmentation or Primitive Extraction, PR #417 Assembly, regexes, GT, frozen fixtures, production code, or the final TOC CSV. Do not assemble titles, infer ownership automatically, or convert geometry observations into a new parser. No formal held-out evaluation is performed.

## Freeze boundary

The population, selection rule, prior classifications, and evidence-classification contract are frozen in the population-freeze commit before any PDF geometry extraction. Geometry collection and report changes must be in later commits. If the frozen population or classification meaning must change, stop and escalate rather than revising this preregistration after observing geometry.
