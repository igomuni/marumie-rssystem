# FY2024 TOC Minimal Assembly PoC — preregistration

**Iteration:** H1 title continuation and H2 page-only/title-only pairing  
**Status:** frozen by the commit that adds this preregistration, fixture, and expected-results package  
**Research role:** exploratory development only; no formal held-out evaluation.

## Relationship to earlier work

This is a separate research iteration based on the frozen primitive observations from PR #416. It does not amend or replace the #416 preregistration, fixtures, expected results, parser, or census. The assembly module will consume #416 primitive values and add deterministic provenance IDs in an adapter; it will not change primitive recognition or column segmentation.

## Scope

Only these directed candidate families are in scope:

- **H1:** `title_page → title_only_candidate`
- **H2:** `page_only → title_only_candidate`

The work records candidate relationships and determines whether the available primitive evidence is sufficient to resolve them. It does not generate final TOC rows, normalize text, join across pages, or implement other continuation directions.

## Input and provenance

Input is the output of `segmentPage()` in `scripts/research/toc-column-primitives-v1.ts`, run over the frozen Plain Text pages identified by the 2024 raw-text manifest and structure inventory. Original primitives are immutable. Since #416 has no persistent primitive ID, the adapter derives a stable ID from source PDF path, physical page, line index, side, source range, kind, and exact raw text. The ID is provenance only and does not encode semantic identity.

All source ranges use JavaScript UTF-16 code units as defined by #416. Every candidate retains the original primitive IDs and text fragments. No joined title string is emitted for unresolved candidates.

## Candidate ordering and adjacency

1. Candidate pairs must share source PDF and physical page.
2. With known sides, only primitives on the same side are ordered together. A different-side primitive does not interrupt that side's sequence.
3. Within a side, order is `rawLineIndex`, then `sourceRangeUtf16[0]`, then stable primitive ID.
4. Empty raw lines are ignored. A nonempty primitive or an unresolved/unsafe-cut source line on the same side interrupts adjacency; candidates may not skip it.
5. When side is `unknown`, line order may identify a *possible* pair only when the two relevant nonempty observations are on consecutive nonempty raw lines. This yields `CANDIDATE_UNRESOLVED`, never `RESOLVED`.
6. A primitive used in multiple candidate relationships is retained in each observation; no candidate consumes or deletes source evidence.

## Resolution rule

The available #416 primitive fields encode primitive kind, raw text, source span, raw-line order, and side. They do not encode whether a title-only fragment continues a prior title or is an independent heading, nor whether a page-only token belongs to a following title. Same-page adjacency, a page reference, known same-side attribution, and uniqueness are candidate evidence but do not independently establish item ownership.

Therefore, this iteration has **no automatic `RESOLVED` rule** for H1 or H2. A candidate is `CANDIDATE_UNRESOLVED` unless an independently represented, pre-existing source relation field proves ownership; #416 provides no such field. No such field may be added from PDF-specific interpretation in this iteration. This is a deliberate negative-result condition, not an implementation failure. The `RESOLVED` state remains in the output vocabulary for contract completeness but must have count zero for this input contract.

Statuses:

- `RESOLVED`: permitted only if an input source relation explicitly establishes ownership; not producible from current #416 primitives.
- `CANDIDATE_UNRESOLVED`: one structurally eligible pair exists, but ownership is not established.
- `AMBIGUOUS`: more than one structurally eligible counterpart exists for a primitive.
- `UNMATCHED`: an eligible primitive has no counterpart in the directed family.

H1 and H2 candidate searches are independent. If a primitive participates in competing H1/H2 candidates, preserve the conflict and do not prioritize either family.

## H1 conditions

An H1 candidate requires a `title_page` followed by the next nonempty primitive on the same known side, where that next primitive is `title_only_candidate`. It must be in the same PDF and physical page, and no same-side nonempty primitive or unresolved/unsafe-cut line may intervene. When the side is unknown, the consecutive-nonempty-line fallback above may create only an unresolved candidate. These conditions do not resolve continuation ownership.

## H2 conditions

An H2 candidate requires a `page_only` followed by the next nonempty `title_only_candidate` under the same PDF/page/order constraints. A known same side is necessary to resolve but is not sufficient to do so. Unknown-side pairs, including NDL p2, remain candidate-unresolved.

## Fixture inventory

`fixture.json` contains source-derived CFA p3 and NDL p2 observations plus synthetic cases. `expected-results.json` is independently authored and fixes candidate/status/accounting expectations before implementation. It does not assert that a candidate pair is a correct semantic record.

| Case | Family | Expected status / behavior |
|---|---|---|
| H1-D1 | CFA p3: printed page 94 then `必要な経費` | Candidate unresolved; preserve both fragments |
| H1-D2 | Synthetic known-side adjacent title pair | Candidate unresolved; adjacency does not prove ownership |
| H1-D3 | Cross-side title-only fragment | No cross-side candidate; both sources retained |
| H1-D4 | Title-only independent-heading control with same observable shape | Candidate unresolved; do not merge |
| H1-D5 | Intervening same-side item | No skipped candidate; unmatched observations retained |
| H1-D6 | Unsafe-cut barrier | No candidate may cross the barrier |
| H2-D1 | NDL p2 L25/L26 | Candidate unresolved; unknown side |
| H2-D2 | Synthetic known-side adjacent page-only/title-only pair | Candidate unresolved; same-side adjacency alone does not prove ownership |
| H2-D3 | Unknown-side pair | Candidate unresolved |
| H2-D4 | Multiple possible titles | Ambiguous |
| H2-D5 | No counterpart | Unmatched |

## Explicit non-goals

No Column Segmentation or Primitive Extraction changes; no regex changes; no geometry-based matching; no PDF-specific exceptions; no semantic title completion; no cross-page assembly; no final TOC CSV; no production integration; no formal held-out evaluation.

## Pre-implementation checks

Before the freeze commit, independently verify fixture/expected consistency, family direction, source IDs and spans, status conditions, unknown-side handling, no skipped barriers, no text additions, and unchanged #416 files. If a rule capable of resolving an actual source pair requires additional semantics, geometry, or source annotations, stop and report that limitation rather than weakening this contract.
