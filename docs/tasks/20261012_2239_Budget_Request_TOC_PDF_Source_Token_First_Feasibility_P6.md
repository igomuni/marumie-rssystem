# FY2024 Budget Request TOC — PDF Source Token First Feasibility P6

**Status:** preregistered development feasibility study; PDF observation has not started. The study tests PDF-native source-token observability and existing primitive compatibility, not TOC ownership or assembly.

## Research position

P6 follows P2–P5 and is post-hoc development research, not held-out evaluation or an accuracy estimate. It asks whether fixed-version PDF text items can serve as reproducible source observations without requiring a Raw Text span mapping. P2–P5 results and frozen artifacts remain unchanged. No source mapper, alignment algorithm, row/region parser, ownership rule, or assembly is implemented.

### Questions

1. Can PDF-native text items be identified reproducibly under fixed extraction conditions?
2. What text, order, transform, page, and position information is available, and at what granularity?
3. Which existing SourceToken, TableGeometry, LogicalRow, and SpatialRegion contracts can be reused as observations?
4. What PDF-native TOC text and spatial evidence can be recorded without inferring semantic relations?
5. What remains unresolved in a PDF-native-first design?

## Frozen inputs and population

The population is every distinct `(source_pdf_sha256, physical_page)` in the P2 frozen candidate inventory: 50 candidate observations, 15 PDFs, and 17 physical pages. Duplicate pages are deduplicated only for page-level extraction; all originating candidate IDs remain attached as provenance. Selection does not use token extraction, geometry, Raw Text matching, or semantic labels.

Frozen source files:

| Artifact | SHA-256 |
|---|---|
| `tests/fixtures/budget-request-toc-pdf-row-region-relation/2024/candidate-inventory.csv` | `0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438` |
| `tests/fixtures/budget-request-toc-pdf-row-region-relation/2024/candidate-inventory-manifest.json` | `83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed` |
| P2 freeze document | `c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb` |
| P5 durable ZIP | `94acbfc0cdb0c66ec537124504da4f7e1c14b2d6f9f044caa284e81f6929f410` |

The frozen page inventory is `tests/fixtures/budget-request-toc-pdf-source-token-first/2024/p6-page-inventory.json`; the observation packet is `p6-blinded-observation-packet.jsonl`. The inventory preserves source candidate IDs as provenance only. The observation packet contains PDF identity and physical page, not ownership labels, Raw Text fragments, P3/P4/P5 matches, or expected item relations.

At freeze, page dimensions and rotation are not populated from new extraction. The PDF SHA-256 is checked against the frozen P2 row and the canonical source PDF. All 17 pages must be present and all hashes must match.

## Layer boundary

| Layer | Meaning | P6 |
|---|---|---|
| N0 | PDF identity, hash, physical page, page box, rotation, tool provenance | Observe |
| N1 | PDF-native returned text item identity, exact text, index/order, transform and item geometry | Observe |
| N2 | Item-level spatial and rendered-page observations | Observe |
| N3 | TOC title/page ownership, multi-line assembly, semantic relation | Out of scope |

Geometry, visual proximity, item order, or a number-like string never establishes an N3 relation. `getTextContent()` returned order is reported as returned item order; it is not assumed to be visual reading order or original graphics-operator order.

## Frozen extraction and identity contract

### Tool and options

- Node.js runtime is recorded at execution; direct dependency `pdfjs-dist` is fixed at `5.4.296` by `package.json` and `package-lock.json`.
- Load PDF bytes from the frozen source PDF and call pdf.js `getDocument` with the repository page extractor's fixed options: `cMapUrl=node_modules/pdfjs-dist/cmaps/`, `cMapPacked=true`, `standardFontDataUrl=node_modules/pdfjs-dist/standard_fonts/`, and `verbosity=0`.
- Call `page.getTextContent({ disableNormalization: true })`.
- Preserve the sequence of all returned text items (`'str' in item`) including empty and whitespace-only strings. Count and report non-text/marked-content entries separately; do not silently treat them as text items.
- Do not apply NFKC, whitespace removal, text correction, sorting, or semantic normalization. Any display/analysis normalization, if later needed, is a separate field and cannot change identity or source text.

### Version-scoped occurrence identity

An extraction occurrence ID is the exact tuple `(PDF SHA-256, physical page, pdfjs-dist version, frozen extraction-options identifier, text-item index)`. A serialized ID may hash this tuple, but the tuple itself must remain in output. Index is assigned in pdf.js returned text-item order after excluding non-text entries. It is a version- and option-scoped observation identifier, **not** a persistent PDF glyph ID. Repeated strings remain separate items with separate indexes. Item identity is distinct from within-item characters; P6 makes no character-level identity claim.

### N0/N1 fields

For every page record the PDF path/hash, physical page, document page count, `page.view`, page width/height, rotation, extractor/version/options, total `content.items`, text-item count, non-text count, extraction status, and warnings/errors.

For every returned text item record occurrence ID, text-item index, exact `str`, UTF-8 text hash, returned order, `hasEOL`, `dir`, `fontName`, `width`, `height`, six-value transform, and item bbox where supported. Preserve empty/whitespace items. Record duplicate text groups without collapsing items.

`SourceTokenBBox` uses top-left page coordinates in points and pdf.js font metrics to approximate an item em box; it is not a glyph-ink or character bbox. Raw `transform` remains in PDF user space. Existing `pageMetaFrom` rejects nonzero rotation. The P6 extraction wrapper must preserve page metadata and all text items even when rotation prevents applying the existing bbox helper; in that case bbox granularity is `UNDETERMINED`, and raw item transform/width/height are retained. Do not alter the existing helper.

## N2 rendered-page observation

Render all 17 frozen physical pages with Poppler `pdftoppm` version `26.09.0`, PNG, 150 DPI, default page box/orientation, one page per invocation. Record command/options, tool version, input PDF hash, physical page, output pixel dimensions, and PNG SHA-256. Inspect each render alongside its PDF-native item inventory.

Record whether visible text is represented in the native text items, whether item boxes approximately correspond to visible placement, item/visual segmentation differences, observable visual rows, page-level/item-level/region-only/character-level granularity, and uncertainty. Compare native text with the render without filling missing text from Raw Text. Do not call numeric strings page references or title-like strings TOC titles. Do not combine nearby items or infer ownership.

Human visual notes are source observations, not deterministic program output. If visual text is unreadable or placement cannot be resolved, record `AMBIGUOUS` or `UNDETERMINABLE`.

## Existing primitive compatibility review

Review source code and contracts without changing them:

- `scripts/pipeline-v2/lib/budget-request-pdf-page.ts`
- `scripts/pipeline-v2/lib/budget-request-source-token.ts`
- `scripts/pipeline-v2/lib/budget-request-table-geometry.ts`
- `scripts/pipeline-v2/lib/budget-request-logical-row.ts`
- `scripts/pipeline-v2/lib/budget-request-spatial-region.ts`

For SourceToken, TableGeometry, LogicalRow, and SpatialRegion, document input/output contract, PDF identity and geometry requirements, Raw Text dependencies, order assumptions, semantic assumptions, unresolved/error representation, and applicable tests. Classify each `DIRECTLY_REUSABLE`, `REUSABLE_WITH_ADAPTER`, `REQUIRES_RESEARCH_CHANGE`, or `INSUFFICIENT_EVIDENCE`. “Reusable with adapter” records a requirement, not permission to implement one. Do not assume LogicalRow means semantic TOC row or SpatialRegion means a TOC item.

## Repeated extraction and review

After protocol freeze, extract every fixed page twice under the exact same PDF bytes, pdf.js version, and options. Compare page metadata, item counts, item order, exact text, occurrence tuple, transforms, and item bbox. Exclude timing from equality. A mismatch is retained; unstable fields are not presented as stable identity.

After primary observations, an independent Orca Worker reviews all 17 pages using the frozen protocol, PDFs, renders, and token inventories. Do not provide primary feasibility classifications or P1/P2 ownership labels. Preserve each review separately and reconcile by page/item ID after both records are complete. Disagreement is not settled by majority vote.

Review statuses: `SOURCE_OBSERVATION_CONFIRMED`, `SOURCE_OBSERVATION_DISAGREEMENT`, `AMBIGUOUS`, `UNDETERMINABLE`.

## Failure families

- PF-1 Missing Native Text
- PF-2 Unstable Item Identity
- PF-3 Insufficient Geometry
- PF-4 Item / Visual Text Segmentation Difference (requires evidence of an observation impact; mere splitting is descriptive only)
- PF-5 Reading Order Difference (requires comparison with rendered visual placement; do not infer from item order alone)
- PF-6 Primitive Contract Mismatch
- PF-7 Insufficient Evidence / Other

Each record includes page/item identity, source evidence, observation, impacted layer, interpretation, uncertainty, independent review, and unresolved status. Multiple families may apply. Do not force a single cause.

## Freeze boundary and status

This protocol and the 17-page inventory must be independently reviewed and committed before extracting new P6 text items, rendering pages for P6 review, or evaluating primitive outputs. Pre-freeze actions are limited to Git/hash/population verification and source/API/tool-contract inspection. The freeze commit must precede all P6 token and visual observations. If the protocol is not implementable as written, stop before observation and escalate; do not loosen it after results.

The P6 worktree was created from commit `c1acc89b4c205e6c5dffb53c561bf21082853724`. After creation, `origin/main` advanced to `8c89566cbb9ea2c0d761ca598d55752ed673b0a4` with an unrelated total-table CSV change. Per the user's restart decision, do not refresh, rebase, or update the canonical main worktree or P6 branch. Record this base difference in the results and PR.

## Non-goals and protected files

No Raw Text-to-token mapping, Semantic Ownership, TOC Assembly, OCR, semantic text classification, new reusable row/region parser, or production integration. Do not edit P2–P5 frozen artifacts/results, existing PDF primitives, parser/regex, TOC CSV v0, GT, source PDF/Raw Text, total-table research, or `docs/tasks/INDEX.md`.

## Acceptance and validation

P6 is complete only when all 17 pages are fixed and hash-verified, the frozen protocol precedes extraction, all returned text items are accounted for, repeated extraction is compared, position granularity is explicit, all 17 pages have visual observations and independent review, primitive compatibility is assessed from source contracts, failures and unresolved cases are retained, and outputs regenerate deterministically. Token availability alone is not TOC Assembly readiness.

Run syntax checks, focused tests for any new research utility, `git diff --check`, source/output hash validation, and deterministic reruns. Do not run or alter production code to satisfy P6. No held-out evaluation is performed.
