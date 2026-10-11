# FY2024 Budget Request TOC Ownership Failure Isolation P0

## Purpose and status

This document freezes the observational classification contract for the 109 `CANDIDATE_UNRESOLVED` observations emitted by Minimal Assembly v0 (#417). The task asks whether the two source primitives belong to the same printed TOC item, whether Raw Text is enough to decide, and what evidence is missing. It does not define or implement new assembly behavior.

This is post-hoc development evidence over pages already used in prior exploration. It is not a held-out evaluation, accuracy estimate, or gold-label creation exercise. A `SAME_ITEM` observation is not an instruction to make an automatic assembly `RESOLVED`.

## Frozen population

The inventory was mechanically extracted from the preserved #417 run output and pinned before semantic review.

- #417 freeze commit: `d2ac1e6a8e7fd1da1667633d67af4e7ca784991c`
- Preserved output ZIP SHA-256: `ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79`
- Candidate inventory: `candidate-unresolved-inventory.csv`
- Candidate inventory SHA-256: `3808c1698e6671589e5edda1292bb49c61fa623d569e8ed11f18a274c629289d`
- H1 observations: 31
- H2 observations: 78
- Total observations: 109
- Unique observation IDs: 109
- Referenced source primitives: 218

The inventory preserves the original observation ID. H1 and H2 observations are not deduplicated even if they share a source primitive. A separate unique-primitive count must be reported.

## Review sequence and evidence

1. Inspect the exact Raw Text lines, primitive spans, page-local side/boundary state, and barriers first.
2. Record source facts separately from interpretation.
3. If Raw Text does not establish ownership, inspect the corresponding PDF physical page read-only. Record the page and the visible region reviewed.
4. Do not use linguistic plausibility alone to decide ownership. Do not infer missing text, page references, sides, or hierarchy.
5. Do not change #416/#417 code, regexes, schemas, frozen fixtures, or prior results.

Review fields include the candidate observation ID, hypothesis, exact source text, source PDF and physical page, raw line indices and UTF-16 spans, primitive IDs, side and boundary state, barriers, facts observed, interpretation, uncertainty, PDF review method/region, reviewer, and any second-review disagreement.

## Ownership observation classification

Assign exactly one primary label per candidate:

- `SAME_ITEM`: available source evidence shows both primitives belong to one printed TOC item.
- `DISTINCT_ITEMS`: available source evidence shows they belong to different items or one is a separate heading/non-item.
- `AMBIGUOUS`: multiple ownership interpretations remain plausible.
- `UNDETERMINABLE`: the supplied Raw Text/PDF evidence does not permit a defensible decision.

`SAME_ITEM` records an observed relationship only. It does not mean that Raw Text alone supports an automatic rule or that the current assembly should be resolved.

## Evidence sufficiency classification

Assign one label using this precedence:

- `RAW_TEXT_SUFFICIENT`: Raw Text and frozen primitive provenance alone support the ownership decision.
- `PDF_VISUAL_REQUIRED`: Raw Text alone is insufficient, and visual layout on the PDF page provides decisive evidence for the ownership decision.
- `STILL_UNDETERMINABLE`: Raw Text and the reviewed PDF evidence still do not decide ownership.
- `RAW_TEXT_INSUFFICIENT`: Raw Text alone is insufficient, but decisive PDF review was not performed or the relevant page/region could not be inspected.

Record separately whether PDF review occurred, what region was inspected, and whether visual evidence changed or settled the interpretation. This keeps evidence sufficiency distinct from ownership outcome.

## Evidence-type labels

Zero or more observed evidence factors may be recorded. These are descriptive labels, not adopted parser features or assembly rules:

`COLUMN_SIDE`, `RAW_LINE_ORDER`, `HORIZONTAL_POSITION`, `INDENTATION`, `ITEM_START_MARKER`, `PRINTED_PAGE_REFERENCE`, `PDF_GEOMETRY`, `HEADING_STRUCTURE`, `MULTIPLE_COUNTERPARTS`, `UNSAFE_BOUNDARY`, `INSUFFICIENT_EVIDENCE`.

## Failure family

Assign one primary family and any secondary factors:

- `F1_TRUE_CONTINUATION_OWNERSHIP_MISSING`: true same-item title continuation whose ownership is not encoded in the primitives.
- `F2_INDEPENDENT_HEADING_NON_ITEM`: a title-only primitive is a heading or other non-item.
- `F3_SEPARATE_ITEM_ADJACENCY`: nearby primitives belong to distinct printed items.
- `F4_COLUMN_ATTRIBUTION_FAILURE`: column is unknown, mixed, or incorrectly attributed in the frozen primitive evidence.
- `F5_TEXT_ORDERING_FAILURE`: Raw Text sequence does not preserve the relevant printed relationship/order.
- `F6_INSUFFICIENT_PRIMITIVE_RELATION`: primitive data lacks a relation needed to decide continuation/ownership.
- `F7_OTHER_UNDETERMINED`: another cause or insufficient basis to select a family.

Families are descriptive and may overlap via secondary factors. They do not alter the #417 taxonomy or define a future algorithm.

## Disagreement and uncertainty

Reviewers record their own evidence-backed observations. Do not resolve disagreements by majority vote. Preserve both readings and mark the candidate `AMBIGUOUS` or `UNDETERMINABLE` unless source evidence resolves the discrepancy. Keep facts, visual observations, and interpretations in separate fields.

## Validation rules

- The frozen inventory must remain at 31 H1 + 78 H2 = 109 observations.
- Every original observation ID appears exactly once in the classification table.
- Every candidate references the same two source primitive IDs and spans as the frozen inventory.
- Exact fragments and all counts must trace back to the preserved #417 output.
- No primitive is deduplicated across candidate observations in candidate-level counts.
- Report candidate-level and unique-source-primitive counts separately.
- Report all four ownership labels and all four evidence sufficiency labels, including zero counts.
- Unresolved/undeterminable observations remain in the deliverables.

## Scope boundary

No new regex, assembly rule, primitive extraction, column segmentation, GT, fixture, or parser change is permitted. The output is an evidence review and research interpretation only. Any proposed next hypothesis is a recommendation for user/ChatGPT review, not a coordinator decision.
