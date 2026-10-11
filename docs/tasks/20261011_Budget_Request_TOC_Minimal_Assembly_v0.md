# FY2024 Budget Request TOC — Minimal Assembly v0

## Scope and research position

This iteration applies two frozen candidate families to the PR #416 primitives:

- H1: `title_page → title_only_candidate`
- H2: `page_only → title_only_candidate`

The output is an exploratory development census. It is not a formal held-out evaluation, a final TOC, or an accuracy claim. The implementation does not alter or consume source primitives and does not join text. It preserves candidate relations as unresolved when the available primitive evidence does not establish item ownership.

## Freeze

The preregistration, fixture, and expected results were committed before the implementation in `d2ac1e6a8e7fd1da1667633d67af4e7ca784991c` (`research: freeze TOC minimal assembly contract`). Their SHA-256 values are:

| File | SHA-256 |
|---|---|
| `preregistration.md` | `4d01e896e4ae1f6d1f8261252f84e2bf4da89f26a9d32a4cb3cf75c276e971d3` |
| `fixture.json` | `69a68e1f6edf8b571af74dcca6cdb0397d2c3be15a24c5e1d59fbcbbef7851ba` |
| `expected-results.json` | `cc3cc25032e0d2137b8255f4b68c7d3b58f123119b93b4e229bdb221bc95ac10` |

The fixture contains six H1 cases and five H2 cases. The independent pre-freeze review checked every source primitive span against its raw line and reviewed the H2-D4 distinct title spans. The contract deliberately has no automatic `RESOLVED` rule: #416 records side, source span, raw text, page reference, and order, but no ownership or continuation relation. Adjacency and uniqueness can propose a candidate but cannot prove that a title fragment belongs to a page reference.

## Implementation

Commit `d6c0287f4e49437bdffc09ac545022570483ee43` adds the independent assembly module, tests, and 82-page runner. H1 and H2 candidate detection remain separate. The adapter assigns stable provenance IDs; barriers prevent candidates from crossing unresolved source text. The module retains title fragments and page references without producing a concatenated title. PR #416's primitive module, the v0 CSV parser, and the frozen #416 artifacts were not changed.

## Development validation

Focused tests:

```text
npx vitest run scripts/research/toc-column-primitives-v1.test.ts scripts/research/toc-minimal-assembly-v0.test.ts
2 test files passed; 16 tests passed.
```

`npx tsc --noEmit` passed. ESLint on the new assembly module, its tests, and runner passed with the repository's legacy configuration (`ESLINT_USE_FLAT_CONFIG=false`); ESLint printed its configuration deprecation warning. The full suite reported 1,855 passed, 3 skipped, and 2 failed. Both failures are in `app/lib/mof-kou-moku-v2-linkage.artifacts.test.ts` and both have the same known cause: `public/data/mof-kou-moku-2023.json` is absent. No other test failed.

## Exploratory 82-page census

Input accounting matched the frozen population: 82 TOC pages, 55 PDFs, DIRECT 55 / INHERITED 27. Page text and PDF hashes matched the raw-text manifest. Column boundaries were available on 72 pages and unavailable on 10; 37 pages had unresolved cuts. The runner accounted for 3,028 primitives and 946 barriers.

| Hypothesis | RESOLVED | CANDIDATE_UNRESOLVED | AMBIGUOUS | UNMATCHED |
|---|---:|---:|---:|---:|
| H1 | 0 | 31 | 0 | 1,936 |
| H2 | 0 | 78 | 0 | 487 |

These are observation counts, not record counts. A primitive may participate in the independent H1 and H2 inventories. In particular, H2 candidates include page-heading adjacency and are not all plausible TOC record pairings.

Examples:

- CFA p3: the page reference `94` and following `必要な経費` are retained as an H1 candidate with separate source fragments. They are not concatenated. A similar wrap exists nearby, so line adjacency alone is not enough to establish ownership.
- NDL p2: `国(国)13` and `令和６年度概算要求定員表` are retained as an H2 candidate on unknown side. The split page-local header prevents column attribution; no visual or link evidence was used to auto-resolve the pair.
- MOF p2: all primitives remain source observations. No assembly is resolved, so the post-hoc MOF mixed-line cases are not joined by this module.

No original primitive or barrier was unaccounted for. The two-run comparison passed for 12 deterministic payload files; the validation file records the comparison and is excluded from its own comparison.

## Output

Main output directory:

`data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/`

Archive: `data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0.zip`; SHA-256: `ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79`

Reproduction command:

```sh
npx tsx scripts/research/run-toc-minimal-assembly-v0.ts --out-dir=data/work/exports/<run-id>_FY2024_TOC_Minimal_Assembly_v0 --development-test-result=PASS
```

For a deterministic comparison, pass `--verify-against=<previous-output-directory>`. Detailed hashes, page accounting, and status counts are in that output's `validation.json` and `exploratory-summary.json`.

## Limits and next decision

The PoC can enumerate structurally adjacent candidates and preserve their source evidence. It cannot determine which title-only fragments continue a prior item or whether a page-only marker belongs to a following title. Consequently, this run does not establish that Minimal Assembly can safely produce resolved rows from #416 primitives. The next research decision is whether additional source evidence or a richer primitive relation is justified before final TOC generation; this report does not make that decision.
