# FY2024 Budget Request TOC — Raw Text Source Span to PDF Source Token Mapping P3

## Research position

This is a development source-mapping study, not held-out evaluation. It studies only the correspondence between Raw Text source spans and PDF-native text items. It does not evaluate row/region relations or semantic ownership and does not assemble TOC items.

P2's frozen result remains unchanged: 50 candidates, 15 PDFs / 17 physical pages, 100 source fragments, 185 text segments, 72 unique, 113 multiple, 0 unmatched, 0/50 candidates with all fragments uniquely mapped, and geometry collected for 0/50. The documented reconstruction reproduced aggregate counts only; identity with the unavailable original scratch script and segment-level byte-equivalence remain unverified.

## Frozen population selection

Select five `KNOWN_POSITIVE` rows from the P2 candidate inventory after ascending lexical sort by original candidate ID. Include all three `PRIOR_REVIEW_DISAGREEMENT` rows and all four `PRIOR_REVIEW_AGREEMENT_CONTROL` rows. This yields 12 candidates and is expected to yield 24 source fragments. Selection is fixed before matching and will not depend on geometry or matching results.

The labelled `development-inventory.json` is the crosswalk. The separate `blinded-mapping-input.jsonl` uses opaque P3 candidate and fragment IDs and excludes prior ownership, review, control-family, and group fields. Mapping runs consume only the blinded packet.

## Inputs and provenance

Frozen inputs are the P2 candidate inventory and manifest, the P2 freeze document, Raw Text manifest, structure inventory, P1 independent-review source, selected source PDFs, and corresponding Plain Text files. The population generator checks the five P2 artifact hashes and the P1 independent-review source hash against fixed identifiers, verifies the P2 manifest's Raw Text and structure hashes, checks the selected P1 review counts, recomputes each selected PDF hash, Plain Text file hash, and form-feed-delimited page hash, and verifies every UTF-16 span against the exact fragment. PDFs and Plain Text are read-only. Because `data/` is ignored and is not materialized in a fresh Git worktree, the generator accepts separate `--pdf-root` (repository root containing the `data/download/...` paths) and `--raw-text-root` (the Plain Text year directory) paths. The worktree's frozen source artifacts are not modified.

Each selected P2 row supplies page-local Raw Text line indexes and UTF-16 source ranges. The source line is recovered from the `physical_page`-th form-feed-delimited text chunk, then indexed by line. The UTF-16 slice must equal the frozen exact fragment byte-for-byte after UTF-8 decoding. The P3 packet stores the exact full source line and the fragment span.

## M0 / M1 contract

Matching is run only after the population and this contract are frozen.

### Shared normalization

- Remove Unicode whitespace from comparison strings.
- Map U+2011 NON-BREAKING HYPHEN to U+002D HYPHEN-MINUS.
- Do not apply NFKC or any other semantic correction.
- Preserve original strings and a per-normalized-code-point map to original code-point and UTF-16 offsets.

### PDF stream construction

Use pdf.js `getTextContent({ disableNormalization: true })` through the existing `extractPageTokens` helper. Preserve the resulting text-item order and item indexes. Construct the comparison stream by concatenating each item's original text in item order with **no inserted separator**; normalize the concatenated characters with the shared rule. This is a fixed comparison serialization, not an assumption that content-stream order equals visual reading order. Preserve per-character item index, item-local code-point offset, and UTF-16 offset. Keep bbox and transform as metadata only; never use them to rank or select matches. The expected pdf.js version is 5.4.296.

### M0 — text-only baseline

Split each exact source fragment on runs of two or more Unicode whitespace characters. Keep every non-empty segment with its original span. Enumerate every occurrence of each normalized segment in the normalized PDF stream for the same source PDF and physical page.

- One occurrence: `UNIQUE_TEXT_OCCURRENCE`
- Two or more: `MULTIPLE_TEXT_OCCURRENCES`
- Zero: `NO_TEXT_OCCURRENCE`

Overlapping occurrences are retained. No tie is broken.

### M1 — same-line context anchoring

For each segment, derive up to 12 non-whitespace Unicode code points before and after its span from the same full Raw Text physical line only. Do not use other lines. Normalize the context with the shared rule. For every M0 occurrence, require the available preceding context to match the stream immediately before the occurrence and the available following context to match immediately after it. Require both sides when both exist; require the sole available side when only one exists. If neither exists, retain the M0 occurrence set unchanged.

- One surviving occurrence: `UNIQUE_CONTEXT_OCCURRENCE`
- Two or more: `MULTIPLE_CONTEXT_OCCURRENCES`
- Zero: `CONTEXT_NOT_MATCHED`

The context length is fixed at 12 code points and will not be adjusted after observing results.

### Token attribution and abstention

Each normalized stream character maps to the source pdf.js item and item-local offset from which it came. Record the item-index range and within-item offsets for every candidate occurrence. Do not treat an item bbox as a character bbox. If the mapping cannot be traced to source items, use `TOKEN_ATTRIBUTION_UNRESOLVED`. Multiple occurrences, no match, context mismatch, normalization/source mismatch, or ambiguous token attribution are retained as unresolved; no semantic or geometric fallback is permitted.

M0/M1 text uniqueness is not proof of source correspondence. Source correspondence and semantic ownership are separate outcomes.

## Independent source verification

After mapping outputs are frozen, a separate Orca reviewer checks every unique fragment against the PDF-native text evidence and corresponding Raw Text. For each non-unique, context-not-matched, or token-attribution-unresolved status, review up to five fragments in ascending opaque candidate ID order. Reviewers do not receive prior ownership labels and must not use item ownership, visual proximity to other fragments, or semantic plausibility to choose a repeated occurrence.

Allowed review results: `SOURCE_CORRESPONDENCE_CONFIRMED`, `SOURCE_CORRESPONDENCE_REJECTED`, `AMBIGUOUS`, `UNDETERMINABLE`. This is development evidence, not held-out GT. Reviewer observations remain separate from deterministic matcher output.

## Failure families

Classify observed issues as FI-1 Repeated Text, FI-2 Insufficient Local Context, FI-3 Stream Order Difference, FI-4 Token Boundary Difference, FI-5 Normalization Difference, FI-6 Unique Text but Invalid Correspondence, FI-7 Token Attribution Unresolved, or FI-8 Insufficient Evidence / Other. Multiple causes may be recorded with primary and secondary labels.

## Validation and non-goals

Re-run mechanical output twice and compare segment, fragment, candidate, summary, and output hashes. Preserve all occurrences and unresolved outcomes. Do not change P2 inputs, parser code, fixtures, GT, source PDFs, or Plain Text. Do not implement row/region relations, ownership, assembly, production integration, or final CSV generation. This experiment is exploratory and not held-out evaluation.
