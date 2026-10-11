# FY2024 Budget Request TOC — Column Primitives v1

## Status

Development PoC complete through the exploratory census of all 82 TOC pages. The work tests Column Segmentation and segment-local Primitive Extraction only. It does not assemble records, generate final TOC CSVs, connect to production, or claim held-out accuracy.

## Freeze history and D12/D9 repair

The original freeze `a792b5d0d682cdc76099dc8b709967788265c898` is preserved. The original STOP arose from two mismatches:

- D12 expected two `title_page` primitives although its title/page separators were single spaces and the frozen regex requires at least two horizontal spaces or repeated leaders.
- D9 compared a primitive with a missing side expectation even though the contract requires `left | right | unknown`; `null` is reserved for page-level boundary metadata.

Freeze revision `9008277e36031f56d239343cca21757bb5ff7bda` corrected the positive D12 to `LEFT      88             RIGHT  145` and aligned side expectations. Revision `72fa35c068d193349cea8a51dae76ffc5e357436` added D12-N for the original negative form and clarified the one-header-line fixture contract. The frozen regex and primitive schema semantics were not expanded. Independent pre-freeze review approved revision 2.

Preregistration, fixture, and expected-results SHA-256:

- `ac188b6fdbf26d0544397c39339feb56151ee6b27708038789210b30457d1245`
- `824472c5ed26fd66f56799ec14bb529687b2e8babf6ac2ecd115f2b11d36a93d`
- `5f3fd7f108cd290bb149ac441c8b07239e5bb90aa672592d966c9a19261d5b41`

## Implementation

The independent research module is `scripts/research/toc-column-primitives-v1.ts`; its census runner is `scripts/research/run-toc-column-primitives-v1-census.ts`. The v0 parser remains byte-identical at SHA-256 `69d0541281f862c2a063caf9234533395dbacbda25a125ed3940242f599073c3`.

Column segmentation and primitive extraction are separate operations. A safe header-derived boundary produces left/right source slices; a cut through nonblank text or a recognized page-reference token remains unresolved. When the page-local boundary is unavailable, only clear whole-line candidates are emitted with `side: unknown`; mixed or unclassifiable lines are retained unresolved. Page-reference spelling remains source text. There is no cross-line assembly or parent ownership inference.

## Development validation

Frozen cases D1–D12 plus D12-N pass: 10 focused tests. CFA p3 retains separate same-line left/right items ending in 88/143 and 88/145. The 94 item and following `必要な経費` remain separate observations. Known prefix forms retain their source spelling. NDL p2 retains page/title material as unknown-side observations without joining them.

`npx tsc --noEmit` passed. `npm run lint` exited 0 with existing warnings in application files; no lint warning was reported for the new research module. Full `npm test`: 1,849 passed, 3 skipped, and 2 failures in the already-known `app/lib/mof-kou-moku-v2-linkage.artifacts.test.ts`, both caused by absent `public/data/mof-kou-moku-2023.json`. The new focused suite and TypeScript check pass.

## Exploratory census

All 82 TOC physical pages from 55 PDFs were processed after verifying all 55 original PDF hashes, all TXT page counts/page hashes, and all 82 inventory page hashes. Population: DIRECT 55, INHERITED 27.

- Header boundary available: 72 pages; unavailable: 10 pages (all DIRECT, none INHERITED).
- Pages with unsafe cut lines: 37.
- Segment observations: 3,044 (left 1,122; right 759; unknown 1,163); 2,407 empty side slots are counted separately.
- Primitive observations: 3,034: title_page 1,461; page_only 100; title_only_candidate 543; unresolved 930.
- Unresolved inventory: 940 rows, including 10 nonblank lines on pages with no boundary and no emitted primitive.
- Page reference observations: ASCII digits 1,436; `エ` 76; `電` 30; `原` 9; `国` 1; `国(国)` 9; no page candidate 1,473.

These are extraction observations, not record counts or accuracy. The 82-page exploratory output and case discussion are in the ignored directory `data/work/exports/20261011_1622_FY2024_TOC_Column_Primitives_v1_Resume/`; its ZIP is generated for transfer. The census runner validates each segment and primitive source span against its original line using UTF-16 half-open offsets. Two independent reruns produced byte-identical outputs.

## Validation and boundary

- Existing v0 parser unchanged.
- Source PDF, TXT, raw manifest, and inventory were read-only.
- No Minimal Assembly or final CSV output was added.
- No formal held-out evaluation was performed.
- Full-suite environmental failures are limited to the two missing-artifact tests listed above.

The PoC shows that same-line left/right extraction can preserve separate primitives when the header-derived boundary is usable. Ten DIRECT pages lack a page-local boundary, and 37 pages contain at least one unsafe cut line; these remain unknown or unresolved. Whether the primitive contract is sufficient for Minimal Assembly remains a separate research decision.

## Post-hoc no-boundary mixed-line guard (PR #416 follow-up)

After the original 82-page census, a read-only review identified a no-page-local-boundary failure: a line containing multiple table entries could pass the frozen terminal `title_page` regex as one whole-line primitive. This was confirmed on MOF `2024ippan_2.pdf`, physical page 2, TXT SHA-256 `b453a2a821ba81b4c33406cf25e115d01416986235b5e072493e09e5d00afc46`, page-text SHA-256 `3e398e82d5ac63d33117036443b58502efbc394e62e1d83a5b0233ebe10eab98`. PDF rendering confirmed mixed left/right content at zero-based lines L7 and L62–L66. This is post-hoc development evidence, not GT or held-out data.

Root cause: in `segmentPage()`'s `boundary === null` path, a nonterminal known page-reference signal was overridden whenever the whole line also matched `title_page` or `page_only`. The correction adds a narrow guard for an otherwise matching whole-line `title_page` only when at least two known page-reference spans each have preceding nonblank text and a frozen title/page separator. It suppresses the whole-line primitive and preserves the full raw line in the existing unresolved inventory. It does not split the line, assign a side, select a page reference, assemble records, or change any regex/schema/frozen artifact. D1/D2 and a single coded-item control remain positive controls; arbitrary digits alone do not trigger the guard.

The six confirmed MOF lines were added as a separate post-hoc regression fixture. Existing frozen D1–D12 and D12-N remain unchanged. Focused tests: 12 passed; `npx tsc --noEmit`: passed; lint exited 0 with existing application warnings. Full suite: 1,851 passed, 3 skipped, 2 known failures in `app/lib/mof-kou-moku-v2-linkage.artifacts.test.ts` because `public/data/mof-kou-moku-2023.json` is absent.

The same 82-page exploratory census was rerun twice with byte-identical outputs. Before → after: 3,034 → 3,028 primitive rows; `title_page` 1,461 → 1,455; `page_only` 100 → 100; `title_only_candidate` 543 → 543; unresolved-kind primitives 930 → 930; unresolved inventory 940 → 946; unknown-side no-boundary `title_page` 179 → 173. Exactly six baseline rows changed, all MOF p2 L7/L62–L66. Boundary availability remained 72/10 and unsafe-cut pages remained 37. The increase of six in the unresolved inventory records retained source lines, not six newly emitted unresolved-kind primitives. These counts describe parser output, not accuracy.

The post-hoc evidence and reproducible comparison are in the ignored directory `data/work/exports/20261011_1655_FY2024_TOC_No_Boundary_Mixed_Guard/`. The guard addresses the observed repeated-candidate family only; other mixed lines may have a single candidate and remain unknown-side primitives. It is not a general column detector. Minimal Assembly, final CSV generation, formal held-out evaluation, and production integration remain out of scope.
