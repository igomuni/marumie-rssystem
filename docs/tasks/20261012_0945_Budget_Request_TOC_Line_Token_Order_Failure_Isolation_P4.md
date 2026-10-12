# FY2024 Budget Request TOC — Raw Text Line / PDF Token Sequence Failure Isolation P4

## Status and boundary

This is a post-hoc development failure-isolation study of the 43 segment observations frozen by P3. It is not held-out evaluation, an accuracy study, a new source-mapping result, semantic ownership review, row/region parser, or assembly. P3 matching rules and outputs remain unchanged.

The study asks where same-Raw-Text-line context and PDF content-stream context differ, how Raw Text line boundaries relate to PDF text-item boundaries and rendered page layout, and which differences can be recorded as source observations without ownership labels.

## Preflight provenance

- PR #425 is merged; latest `origin/main` at P4 setup is `8942b9c596646748f1f51ba221e58bc4af9768ba`.
- P3 freeze base: `9c9ba611a9047480166a92601f94f3034f9ddc7f`.
- P3 result ZIP: `20261011_2251_FY2024_TOC_Source_Token_Mapping_P3_FINAL.zip`, SHA-256 `73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c`; ZIP CRC check passed.
- P3 frozen development inventory SHA-256: `c66c671a04fcbd5d34f7f5f31ace35d776e73fd38f6958268df0ff10a6678b56`.
- P3 blinded mapping input SHA-256: `fe06aafaaf989f63090b8714e0df454cf2f09bb6ad488c683a13579661692ef1`.
- P3 prefreeze validation SHA-256: `95ef35a27c7e5d8666c444ad2652401e5bd2a6ef9b636fcba9919b4292a4b21f`; it records matching PDF/TXT hashes, page hashes, and 24/24 source spans at P3 freeze time.
- All eight P3 source PDFs were present in the canonical checkout and matched the hashes recorded in the P3 source inventory.
- The original ignored Plain Text files are not present in the current canonical workspace. P4 uses only the exact full-line snapshots and spans preserved in the frozen P3 development inventory, whose historical P3 validation recorded matching TXT file/page hashes and all UTF-16 spans. P4 does not regenerate or substitute TXT files. This limits current re-verification of the whole TXT files and is retained as a provenance limitation.

P4 worktree was created independently from latest `origin/main`. The main and prior research worktrees, source PDFs, P3 artifacts, and other research files are read-only inputs.

## Frozen population

The population is all 43 P3 segments, without resampling:

| P3 transition | Segments |
|---|---:|
| M0 Unique → M1 Unique | 4 |
| M0 Unique → M1 Context Not Matched | 13 |
| M0 Multiple → M1 Unique | 8 |
| M0 Multiple → M1 Multiple | 11 |
| M0 Multiple → M1 Context Not Matched | 7 |
| **Total** | **43** |

The frozen inventory carries P3 segment/fragment/candidate IDs, PDF and page identity, Raw Text line index, UTF-16 span, exact segment and full-line snapshot, P3 contexts/status/counts, and P3 hashes. The observation packet excludes prior ownership, P1 review, positive/negative, and control-family labels. P3 transition strata are mechanical mapping-status strata, not ownership labels.

The inventory builder verifies the P3 ZIP hash and CRC, selected P3 output hashes, unique IDs, 43-segment accounting, exact UTF-16 span-to-line slices, reconstructed P3 contexts, and the fixed transition counts. It does not perform matching, select occurrences, or inspect coordinates.

## Observation protocol — frozen before P4 observation

### Inputs and immutable P3 results

Use the frozen P3 development inventory and the P3 result ZIP outputs `source-token-manifest.json`, `m0-segment-matches.jsonl`, `m1-segment-matches.jsonl`, and `segment-mapping-status.csv`. Verify each file against P3's `input-output-hashes.json` before reading it. Do not rerun M0/M1 or alter their results.

For every segment, retain P3 IDs, full line, span, exact segment, M0/M1 states, counts, and hashes. Use the exact source span to reconstruct the P3 same-line contexts: up to 12 non-whitespace Unicode code points per available side, with U+2011 mapped to U+002D as in P3. This is a check of the frozen P3 record, not a new matching rule.

### PDF stream observation

For every segment, enumerate all M0 occurrences from the frozen P3 output. Do not select one occurrence. For each occurrence, record stream start/end, exact matched text, item-index range, item-local offsets, surrounding PDF normalized-stream text, and the relevant PDF item IDs/text. Compare P3 `contextBefore` and `contextAfter` independently as `BEFORE_MATCH`, `BEFORE_MISMATCH`, `BEFORE_ABSENT` and corresponding `AFTER_*` values.

For mismatches, record expected context, actual stream context, first differing position, common-prefix/suffix length as applicable, and surrounding item IDs. Distinguish stream order, item boundaries, and text normalization. A text-item boundary alone is not a failure.

P4 may inspect P3's captured PDF-native item stream and metadata. It does not construct a resolver, reselect a match, change P3 status, or use geometry to rank or choose occurrences.

### Geometry and visual observation

Observe the raw bbox/transform values and item index exactly as present in the P3 source-token manifest. Do not derive same-row groups using an unfrozen tolerance. Render and inspect all eight source PDF physical pages. Record descriptive observations: visible line arrangement, apparent column/region, whether a stream-neighbor item is visually elsewhere, and whether the Raw Text physical line corresponds to one or several visible lines. Keep native text-layer observations separate from rendered-page observations.

Visual proximity or same-row appearance may describe Layer A source evidence only. It must not choose a mapping occurrence or determine ownership.

### Failure families

Apply non-exclusive labels with primary and secondary factors:

- **F1 Stream Order Difference:** direct evidence that Raw Text order and PDF content-stream order differ; non-contiguity alone is insufficient.
- **F2 Interleaved Text From Another Region:** another stream item is interleaved and its distinct page region is observable; no semantic item judgment.
- **F3 Raw Line / Visual Line Boundary Difference:** Raw Text physical line and visible line boundaries differ; otherwise mark ambiguous.
- **F4 Token Boundary / Extraction Segmentation:** an item boundary or extraction split demonstrably contributes to the context difference; crossing a boundary alone is insufficient.
- **F5 Text / Normalization Difference:** an exact code-point difference remains under P3's fixed normalization; record code points and offsets without changing normalization.
- **F6 Insufficient Evidence / Mixed / Other:** no single supported cause, mixed causes, or insufficient source evidence.

Apply the same observation frame to all 23 M1 context-matched segments. If no context failure is observed, use `NO_CONTEXT_FAILURE_OBSERVED`.

### Independent review

After all 43 primary observations are complete, a separate Orca Worker reviews exactly 28 fixed segments without seeing primary classifications:

- all 20 M1 `CONTEXT_NOT_MATCHED` segments;
- first four P3 segment IDs among M1 unique (ascending ID);
- first four P3 segment IDs among M1 multiple (ascending ID).

Review outcomes: `SOURCE_OBSERVATION_CONFIRMED`, `SOURCE_OBSERVATION_DISAGREEMENT`, `AMBIGUOUS`, or `UNDETERMINABLE`. Record evidence agreement separately from failure-family agreement. Do not use ownership or P1 labels, resolve differences by majority, or describe the remaining 15 segments as independently reviewed.

## Post-freeze work and acceptance accounting

1. Observe all 43 segments and every M0 occurrence, including all 26 M0-multiple segments.
2. Render and inspect the eight source PDF pages; preserve rendering command/settings and image hashes.
3. Complete the independent review of the fixed 28 segments after primary review.
4. Reconcile all IDs, occurrence counts, spans, and status counts to P3 without changing P3 files.
5. Regenerate machine-generated observation tables and summaries twice and compare bytes. Keep human visual judgments separate from deterministic output.
6. Save unresolved and contradictory evidence rather than choosing an occurrence or forcing one cause.

P4 performs no new source mapping, alignment, ownership, Row/Region relation, or assembly decisions. Results are development observations only. Any next research hypothesis is reported for user/ChatGPT decision.

## Freeze identifiers

- Base main: `8942b9c596646748f1f51ba221e58bc4af9768ba`.
- P3 ZIP and fixture hashes: listed above and in the frozen P4 inventory.
- P4 population inventory SHA-256: `9f2bba50946b4b5cff756e2161dc13dfd65b466a32e56307c350df6ba23bc8b4`.
- P4 blinded observation packet SHA-256: `f29a183366a4e065d8f6c46cf1260309151acd38a28f425a555c6d858c9ed624`.
- The independent pre-freeze review found no substantive contract or population blocker. Its initial report noted that the freeze commit was not yet present; the reviewer confirmed on follow-up that this was the intended pre-commit sequence and that no substantive blocker remained.
- Protocol SHA-256 and the resulting freeze commit are recorded in `p4-freeze-record.json` before P4 source observation begins.
