# FY2024 Budget Request Plain Text → Cover / TOC CSV v0

## Status

Development implementation for Draft PR #415. This is not a held-out or formal accuracy evaluation. The existing Plain Text producer and the frozen source artifacts are unchanged.

## Input and execution

Run from the repository root:

```sh
npx tsx scripts/pipeline-v2/build-budget-request-plain-text-csv.ts
```

The runner reads the existing UTF-8 TXT files directly. It verifies each selected PDF against `raw-text-manifest.json`, checks Form Feed/page count, and compares each selected TXT page hash with the frozen page hash. It selects all 69 Cover pages from `structure-inventory.json` and the fixed six `NEW_DEVELOPMENT` TOC pages from `development-sample.json` (Environment Ministry p.3, National Personnel Authority p.3, MHLW p.7, MLIT p.6/p.7, Reconstruction Agency p.3).

Outputs go to the ignored directory `data/work/budget-request-csv/2024/`.

## Cover CSVs

`cover.csv` has exactly these columns:

```csv
source_pdf,physical_page,header_code,header_name,year_raw,document_title_raw
```

One row represents one Cover physical page. The header code and name are read from the first printed header line; two- and four-digit codes are accepted without deriving accounting type or office from metadata. `year_raw` retains the printed year substring, while `document_title_raw` retains the remaining title text. A missing or ambiguous field stays empty and is written to the audit file.

`cover_entries.csv` has exactly these columns:

```csv
source_pdf,physical_page,entry_order,区分,ページ
```

Each numbered contents reference and recognized organization/account/section/item marker is a separate row. Printed ordinal text such as `1.` remains in `区分`. Page references remain strings. A directly adjacent short non-entry line is retained as a continuation candidate only when it follows a recognized entry; the source line and role remain in `record-provenance.csv`.

## TOC CSVs

Each selected TOC page produces a separate `toc-<pdf-slug>-p<physical-page>.csv` with exactly three columns:

```csv
要求番号,区分,ページ
```

Recognized independent rows include R1 request starts, `（項）`/organization/account/jurisdiction markers, numbered table references, and three-digit standalone items. R1/I1 are not the only accepted item starts. A printed request number is kept in `要求番号`; rows without one leave it blank. No missing values are inferred.

The page header supplies the observed separator between column regions. Rows are emitted physical-page by physical-page, left column top-to-bottom, then right column top-to-bottom. Text continuations attach only to an existing same-side row under the observed layout. An unresolved fragment is retained in the audit file rather than silently emitted as a complete row.

## Audit and provenance

- `audit.csv` records excluded header/title/blank lines and unresolved source fragments with PDF, physical page, zero-based raw line index, JSON-escaped raw text, and reason.
- `record-provenance.csv` maps output data-row numbers to source line indexes and, for TOC, left/right side. Cover header/title fields and Cover entry lines have separate record types.
- `csv_record_index` is a 1-based data-row number in the corresponding integrated CSV (`cover.csv` or `cover_entries.csv`); it does not restart on each Cover page. TOC indexes refer to the page-specific TOC CSV.
- `development-validation.json` records per-page row, side, audit, and unresolved counts. Counts are descriptive for these already explored development pages.

## Current development validation

The runner targets 69 Cover pages and six TOC pages. In the current run it emitted 69 Cover rows, 275 Cover entry rows, and 346 TOC rows. The Cover entry rows comprise 163 numbered references and 112 marker entries. The six TOC outputs currently have no unresolved fragments; page/title/header exclusions are still listed in `audit.csv`. The exact per-page counts are in the generated validation JSON. Counts are not an accuracy score.

The CAO PDF `data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf` yields 11 separate Cover rows for physical pages 1, 6, 8, 10, 12, 14, 16, 18, 20, 22, and 24. The Cover title is sourced from the year/title line and does not use the `1. ...総表` reference line. Physical page 10 retains the two source lines for `科学技術・イノベーション` and `推進事務局` as one Cover entry candidate, with both source lines linked in provenance.

Development failure regression checks cover Reconstruction Agency marker rows, Environment Ministry same-line left/right content and wrapped text, National Personnel Authority three-digit items, MHLW marker/request separation, and MLIT H5 `（項）` and right-side continuation. A rerun removes legacy `cover-*.csv` files from the generated output directory. These checks do not establish corpus-wide generalization.

## Tests

The single continuous artificial TXT fixture still covers all 16 left/right R/I/C/E state combinations. Its header lines model the observed dual-column header; its hand-authored expected CSV uses left-column-then-right-column order. Additional tests cover integrated Cover provenance offsets, same-line starts, marker/table/three-digit standalone rows, same-line continuation, the six-page development failures, the 11-page CAO Cover PDF, two-/four-digit header codes, and title/reference separation. The focused suite passes 15 tests.
