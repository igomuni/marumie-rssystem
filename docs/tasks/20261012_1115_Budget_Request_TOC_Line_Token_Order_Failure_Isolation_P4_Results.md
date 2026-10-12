# FY2024 Budget Request TOC — P4 Raw Text Line / PDF Token Sequence Failure Isolation Results

## Status

P4 completed as a post-hoc development failure-isolation study. No alignment resolver, source mapping selector, row/region parser, ownership judgment, or assembly was implemented. P3 matching rules and results remain unchanged.

## Frozen population and provenance

The frozen population contains 43 P3 segments, 12 candidates, 24 fragments, and 8 PDFs / 8 physical pages. Transition strata are U→U 4, U→N 13, M→U 8, M→M 11, and M→N 7. P3 segment IDs were preserved. The inventory and blinded packet were frozen before observation under commit `8e1131c233ebe0a014928161cd65172c50f6d9e9`; a separate freeze record was committed at `ab329a46`.

P3 archive SHA-256: `73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c` (CRC passed). P3 M0/M1 output hashes were checked against the archive manifest. Eight source PDF hashes matched the frozen inventory. The canonical main worktree was inspected read-only: all eight source PDF and eight Plain Text file hashes matched frozen P3 inventory, and all 24 exact full-line snapshots matched their physical-page/local-line coordinates. No source was regenerated or modified.

## Observations

The frozen P3 results reproduced unchanged: M0 Unique 17 / Multiple 26; M1 Unique 12 / Multiple 11 / Context Not Matched 20. All 277 M0 occurrences were retained. For the 20 mismatch segments, 13 were M0 Unique→M1 Not Matched and 7 were M0 Multiple→M1 Not Matched.

Across M0 occurrences, before-context observations were MISMATCH 76, ABSENT 191, MATCH 10; after-context observations were MISMATCH 68, ABSENT 197, MATCH 12. These are occurrence-level checks, not segment counts; ABSENT is not itself a failure. The 161 accepted M1 occurrence positions were confirmed to be among the frozen M0 positions, and fixed P3 context checks reproduced. No P3 matching was rerun.

A mechanical comparison of adjacent Raw Text segments with frozen M0-unique positions on both sides yielded four comparisons: three reversed stream starts and one non-reversed. The three inversions correspond to six segment observations. Because M0 uniqueness is not independent proof of source correspondence, these remain conditional stream-order observations and are not promoted to confirmed F1.

All eight physical pages were rendered and inspected. Page-level visual notes record columns, blank regions, and wrapped baselines where visible. No segment-to-row correspondence, geometry-based occurrence selection, row threshold, or semantic ownership was inferred. The evidence does not establish segment-level visual-line boundary differences, distinct-region interleaving as the cause, or item-boundary causality. No residual code-point mismatch after fixed normalization was confirmed.

## Failure families

Under the frozen strict definitions, all 20 M1 context-mismatch segments are primary F6 (insufficient/mixed/other evidence): context mismatch alone does not identify F1–F5. The other 23 segments are recorded as `NO_CONTEXT_FAILURE_OBSERVED`, retaining whether M1 was Unique or Multiple. No confirmed primary F1–F5 assignment was made. Conditional M0 unique-position inversions are separately flagged as secondary observations for six segments.

## Independent review

An independent reviewer, provided the exact P3 archive and blinded review packet, reviewed all 20 M1 context-mismatch segments plus the first four M1 Multiple and first four M1 Unique segments by P3 ID (28 total). All 28 source observations were confirmed. The reviewer recorded the 20 mismatch rows as F6 and eight matched controls as `NO_CONTEXT_FAILURE_OBSERVED`. Failure-family agreement with the primary analysis is not assessable because the independent reviewer did not see primary classifications. The remaining 15 segments were not independently reviewed.

Earlier review attempts are retained in the external audit package but excluded from final family counts: two used labels inconsistent with P4 definitions, and one could not access the archived P3 ZIP. These process failures did not alter frozen P3 outputs.

## Validation and limitations

The machine observation utility was run twice against the same P3 ZIP and frozen P4 inventory; five mechanical output files compared byte-for-byte. Python syntax compilation passed. Source and rendered-page hashes are recorded in the external export. This study is post-hoc development evidence, not held-out evaluation or an accuracy estimate. M0 unique matches remain unverified as source correspondence. The source PDF and TXT hashes and 24 exact full-line coordinates were verified read-only against the canonical main worktree. These limits prevent attributing the 20 context mismatches to a single confirmed mechanism.

External audit outputs are stored under `data/work/exports/20261012_1030_FY2024_TOC_Line_Token_Order_Failure_Isolation_P4/`. P3 source, matching, and ownership artifacts were not modified.

## Interpretation for next research decision

The evidence confirms repeated failures of P3's same-line context test, including 13 M0-unique cases, but does not establish whether stream order, region interleaving, visual-line grouping, item splitting, or normalization is the general cause. Three conditional stream-order inversions are a concrete signal for further investigation, not a validated alignment rule. A Raw Text line ↔ PDF token sequence alignment hypothesis and a visual-line observation model remain possible next studies; this report does not select between them. Maintaining unresolved status remains justified for any source correspondence not independently established.
