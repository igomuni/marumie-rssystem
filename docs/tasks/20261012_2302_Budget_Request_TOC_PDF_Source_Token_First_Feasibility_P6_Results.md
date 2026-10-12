# FY2024概算要求TOC — PDF Source Token Identity First P6 Results

**Status: COMPLETE — Development Feasibility / Failure Isolation.** This study observed PDF-native text items, page geometry metadata, and rendered appearance for the frozen P2 population. It did not evaluate semantic TOC relations, source correspondence to Raw Text, or assembly.

## 1. Study boundary

P6 is a development study designed after P2–P5, not a held-out evaluation or accuracy estimate. The observation protocol and population were frozen in commit `4bc1693a26b3c3e6e36b70dc1aa870f4215018ee` before extraction and rendering. P2–P5 frozen artifacts and results were not changed.

The page set was formed from all 50 rows of the P2 frozen candidate inventory, deduplicated by `(source PDF SHA-256, physical page)`: 15 PDFs and 17 physical pages. Candidate IDs identify population provenance only. PDF-native observations did not use Raw Text fragments, ownership labels, or expected TOC relations.

## 2. PDF-native token observations

The source PDFs matched the frozen inventory hashes (15/15). All selected pages were unrotated, with a page view of 842 × 595 points. Using `pdfjs-dist` 5.4.296, the fixed `getDocument` and `getTextContent({ disableNormalization: true })` options, both extraction passes returned 6,655 text items across 17 pages and zero non-text content items.

Every returned item was retained, including empty and whitespace-only items. Per-page distinct text counts use exact original `str` values, including empty and whitespace strings; duplicate count is the excess occurrence count and does not collapse items. Across pages, the sums are 2,205 distinct text values and 4,450 duplicate excess occurrences. All 6,655 items carried a six-value transform and an approximate item em-box bbox. This does not mean every blank or whitespace item has useful visual extent.

The frozen occurrence identity is `(PDF SHA-256, physical page, pdf.js version, extraction-options ID, returned text-item index)`. It was stable across the repeated extraction for the required contract fields: page metadata, per-page counts, returned index/order, exact text, occurrence tuple, transform, and bbox had zero mismatches. A second independent invocation regenerated the machine outputs byte-for-byte.

The captured `fontName` field differed for all 6,655 items between the two extraction passes (`g_d0_*` versus `g_d17_*` style aliases). This is recorded as ancillary, run-scoped pdf.js metadata, not stable source identity. It was preserved in both inventories and was not used to identify an item. Text, order, identity tuple, transform, dimensions, and bbox otherwise matched. Item index remains an extractor/version/options-scoped observation ID, not a persistent PDF glyph ID.

## 3. Rendered-page observations

All 17 frozen pages were rendered with Poppler `pdftoppm` 26.09.0 as PNG at 150 dpi using the default page box and orientation. Each image is 1755 × 1240 pixels. The images show printed text in ruled table regions; density and the amount of blank space vary by page. Some visual rows and wrapped labels consist of multiple PDF text items. The item bbox is an approximate font-metric em box, not a character or glyph-ink boundary. Visual review did not assign ownership or pair title-like and page-number-like strings.

Primary and independent page observations are both preserved in the external export. The independent review checked all 17 page IDs, all 15 PDF hashes, item counts/indexes, transforms/bbox granularity, and supplied renders. Result: `SOURCE_OBSERVATION_CONFIRMED` 17/17. This status confirms the recorded source observations only; it does not claim character-level geometry, exact glyph correspondence, or TOC semantics.

## 4. Existing primitive feasibility

No existing primitive was executed over the P6 population.

| Primitive | Primary assessment | Independent assessment | Reconciliation |
|---|---|---|---|
| SourceToken | REUSABLE_WITH_ADAPTER | REUSABLE_WITH_ADAPTER | Agreement: adapter must retain P6 occurrence identity and explicitly represent bbox granularity/availability and rotation. |
| TableGeometry | REUSABLE_WITH_ADAPTER | REUSABLE_WITH_ADAPTER | Agreement: geometric observations require adapted identity and bbox provenance; outputs remain geometric candidates. |
| LogicalRow | REUSABLE_WITH_ADAPTER | REQUIRES_RESEARCH_CHANGE | Unresolved scope interpretation: the primary view treats its reversible geometric continuation candidates as adapter-compatible; the independent view treats multi-row continuation grouping as outside P6's N0–N2 observation boundary. No P6 execution or semantic relation was used to resolve this difference. |
| SpatialRegion | REUSABLE_WITH_ADAPTER | REQUIRES_RESEARCH_CHANGE | Unresolved scope interpretation: the primary view treats geometric region candidates as adapter-compatible; the independent view treats cross-row region grouping as beyond P6's frozen item-observation scope. No majority vote was used. |

Both assessments agree that existing contracts do not natively carry the complete P6 occurrence tuple or explicit bbox granularity/uncertainty. The disagreement for LogicalRow and SpatialRegion is retained for review; it does not authorize an adapter or parser implementation.

## 5. Failure isolation

| Family | Observation |
|---|---|
| PF-1 — Missing Native Text | Not observed in this fixed population: all 17 pages returned text items and the rendered pages visibly contain text. |
| PF-2 — Unstable Item Identity | Not observed for the frozen occurrence tuple and required comparison fields. The generated `fontName` alias varies and is not identity. |
| PF-3 — Insufficient Geometry | Item-level transforms and approximate item em boxes were available for all returned items. Character-level bbox was not provided; exact glyph geometry remains unavailable. |
| PF-4 — Item / Visual Text Segmentation Difference | Visual rows, rules, and wrapped labels do not map one-to-one to text item boundaries. This is an observation, not by itself a parser failure. |
| PF-5 — Reading Order Difference | No definitive mismatch was asserted from the page views. The returned item order is recorded separately from visual layout; two-column pages do not establish a canonical visual scan order. |
| PF-6 — Primitive Contract Mismatch | Existing primitives do not represent the full P6 identity tuple or uncertain bbox state. SourceToken/TableGeometry need an adapter assessment; LogicalRow/SpatialRegion have a preserved review disagreement about scope. |
| PF-7 — Insufficient Evidence / Other | Character-level position and persistent glyph identity are absent. No extraction error or source hash mismatch was observed. |

## 6. Validation and artifacts

- P2 inventory SHA-256: `0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438`.
- P2 manifest SHA-256: `83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed`.
- P2 freeze document SHA-256: `c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb`.
- P6 page inventory SHA-256: `015e3da0aea9e854f2464570ad09d43926e145b3fb21b3615dacd833171b4273`.
- P6 blinded packet SHA-256: `536b34d2b3aec7931b369ecc2e3180f2dd2fb9315cc567a3ca6679188c955ae6`.
- Frozen protocol: `docs/tasks/20261012_2239_Budget_Request_TOC_PDF_Source_Token_First_Feasibility_P6.md`.
- Extraction, render, visual, primitive, and independent-review outputs and hashes are recorded in `data/work/exports/20261012_2239_FY2024_TOC_PDF_Source_Token_First_P6/` and its `hashes.json` / `render-manifest.json`.
- `git diff --check` and the P6 extractor execution/syntax validation passed. Existing production and P2–P5 files were not changed.
- No formal held-out evaluation, primitive execution, Raw Text mapping, ownership decision, alignment resolver, or assembly was performed.

## 7. Environment and next decision

The P6 worktree uses base `c1acc89b4c205e6c5dffb53c561bf21082853724`. `origin/main` later advanced to `8c89566cbb9ea2c0d761ca598d55752ed673b0a4` for unrelated total-table work. The P6 branch was not refreshed or rebased. The canonical main worktree remained at `c1acc89` and was not changed during this P6 continuation. The earlier Orca worktree-creation fast-forward noted in the restart review remains an environment incident; no rollback was attempted.

P6 establishes that pdf.js text-item observations and approximate item-level geometry are reproducible under a fixed version and option set for this population. It does not establish persistent glyph IDs, character-level coordinates, semantic rows, title/page relationships, or Raw Text source correspondence. Whether to pursue visual line/region observations, adapt the existing geometric primitives, or keep semantics unresolved is a user/ChatGPT decision.
