# FY2024 Budget Request TOC — P5 Source Correspondence Anchor Results

## Status and scope

P5 is a completed development evidence-sufficiency study. It does not implement or evaluate a mapping resolver, alignment algorithm, row/region parser, semantic ownership, or assembly. P2/P3/P4 outputs and frozen artifacts remain unchanged; the P4 ZIP was not restored or recreated. The P3 source archive was verified and retained as an input snapshot inside the P5 export.

## Frozen population and inputs

The frozen P5 population is the complete set of 17 P3 `M0 UNIQUE_TEXT_OCCURRENCE` segments with one occurrence: 4 `M0 Unique → M1 Unique` and 13 `M0 Unique → M1 Context Not Matched`. The rows cover 12 P3 candidates, 13 fragments, 8 PDFs, and 8 physical pages. The population generator checked the P3 archive SHA-256 `73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c`, archive CRC, P3 output hashes, 43-row source results, every selected UTF-16 span against the frozen full-line snapshot, and the 17 / 4 / 13 counts.

The P3 population validation had already checked selected spans against original Plain Text files. Those complete files are not materialized in the current canonical `data/work` directory, so P5 used the hash-bound P3 full-line snapshots and prior validation rather than a fresh full-file TXT hash. All 8 source PDF hashes were freshly checked against the P3 manifest and matched.

## A1 — normalized text occurrence

All 17 frozen P3 occurrences were rechecked against their stored normalized page stream offsets and pdf.js item spans. The exact Raw Text segment normalizes to the stored P3 normalized segment under the frozen whitespace/U+2011 rule, and each cited stream slice equals that normalized text. A1 therefore confirms a normalized text occurrence in the frozen P3 stream. It does not show that the occurrence is the direct provenance of the Raw Text source span.

## A2 — PDF physical evidence

The 8 source pages were rendered at 150 DPI with Poppler `pdftoppm` 26.09.0 and visually inspected. The P3 pdf.js 5.4.296 item text and page render provide PDF-native item/physical-page evidence for all 17 segments. Recorded position precision is item-level for 17/17; character-level bounding boxes are unavailable for 17/17. P3 item bboxes were not treated as per-character locations.

Three segment strings (`エ 4`, `エ 4`, and `エ 9`) normalize to adjacent characters in the P3 content-order stream, while their component pdf.js items have visibly separate page positions. This is an A2 observation about item positions and whitespace-removing stream serialization. It is not assigned as an A3 mapping rejection or an extractor-order cause because direct Raw Text-span-to-item provenance is absent.

## A3 — Raw Text source correspondence

| Outcome | Count |
|---|---:|
| `SOURCE_CORRESPONDENCE_CONFIRMED` | 0 |
| `SOURCE_CORRESPONDENCE_REJECTED` | 0 |
| `AMBIGUOUS` | 0 |
| `UNDETERMINABLE` | 17 |

The Raw Text manifest records Poppler `pdftotext -layout -enc UTF-8`, version 26.09.0, and form-feed page splitting. The current Raw Text producer and `PageRawText` schema preserve page text, hashes, line strings, and indexes, but no PDF item/glyph IDs or per-character source map. The manifest names the generator but does not pin its source hash; its recorded base commit predates the generator's addition. Thus exact historical generator code identity is not established by the manifest.

P3's separate pdf.js token manifest has per-page item indexes, text, item-local offsets, transforms, and item-level bboxes. No retained trace maps a specific Raw Text UTF-16 line offset through the actual Poppler line-layout transformation to a stable PDF token/glyph identity. A1 and A2 therefore do not meet the preregistered A3 confirmation threshold. All 17 remain undeterminable; none is claimed rejected.

## Independent review

An independent Orca reviewer, blinded to the primary A3 outcomes and P1/P4 labels, inspected all 17 segments and all 8 renders. Primary/independent record agreement was 17/17 for A1, 17/17 for A2 status and item-level granularity, and 17/17 for A3 `UNDETERMINABLE`. This is agreement between records in this fixed development sample, not independent proof that the shared A3 classification is objectively true. The primary review records the three spatially separate item cases in more detail; the independent record confirms item-level/page-row evidence but does not make that finer coordinate note. Both records are preserved.

I1 was performed as independent review. I2 is limited to the documented Poppler Raw Text producer and pdf.js P3 token evidence; no separate P5 Poppler `-bbox-layout` extraction was run. I3 direct offset-to-source-token provenance was not found.

## Failure isolation

- Primary family AF-3 (missing extraction provenance): 17/17.
- Secondary overlapping family AF-2 (physical position granularity insufficient for character-level provenance): 17/17.
- AF-4 was not assigned as a cause. The three physically separate item-position observations remain descriptive; source correspondence is not proven.
- AF-1, AF-5, and AF-6 were not assigned as primary causes.

The central evidence gap is the absent reproducible link from a Raw Text UTF-16 offset to a stable PDF source token or glyph identity. The study does not claim that the content is absent, that a mapping is false, or that a particular assembly is correct.

## Validation

- P3 ZIP SHA-256 and CRC: PASS.
- P3 frozen output and input hashes: PASS.
- Population: 17 unique IDs, 4 / 13 strata, 12 candidates, 13 fragments, no missing or duplicate segment IDs: PASS.
- PDF hashes: 8/8 PASS. Original full TXT files were unavailable for a new full-file check; P3 frozen line snapshots and prior span-validation records were used.
- A1/A2 machine capture regenerated byte-identically: 3/3 files PASS.
- PDF render repeatability: 8/8 PNG hashes PASS.
- Independent review: 17/17 rows, no ID duplicates or omissions; worker settled and released.
- Python syntax compilation, `git diff --check`, blinded-packet forbidden-label scan: PASS.
- Full application test suite: not run; this change is research documentation and read-only evidence tooling. No production code was changed.

## Environment note

P5 worktree base was latest `origin/main` `5192a32d71cd03cc3016159c5c3d6bf372aa9817`. Orca's `worktree create` returned a `localBaseRefRefresh` that fast-forwarded the separate main worktree from `8942b9c596646748f1f51ba221e58bc4af9768ba` to that origin commit. The worktree's files were clean before and after; no untracked work was removed. This was an Orca CLI side effect while creating the required isolated worktree and is recorded as an environment deviation.

## Research interpretation

**Fact:** A1's normalized text occurrences and A2's PDF item/visual evidence are available for 17/17. **Fact:** A3's direct provenance trace is absent from the available producer output/schema and P3 artifacts. **Interpretation:** Text uniqueness and visible item location identify observations on each side, but do not establish the transformation link between a particular Raw Text offset and a PDF source identity. **Next hypotheses:** a new study could investigate whether the original extraction pipeline can emit stable per-character provenance, whether a source-token-identity-first representation is useful, or whether such cases should remain unresolved. P5 selects none of these options.

The P5 evidence package and verification manifest are preserved in the P5 worktree and copied to the durable canonical export path `/Users/igomuni/MyGitHub/marumie-rssystem/data/work/exports/20261012_1042_FY2024_TOC_Source_Correspondence_Anchor_P5/`, with a matching ZIP at `/Users/igomuni/MyGitHub/marumie-rssystem/data/work/exports/20261012_1042_FY2024_TOC_Source_Correspondence_Anchor_P5.zip`. The copy and archive are SHA-256 and CRC verified. No formal held-out evaluation was performed. The P5 worktree is retained for review.
