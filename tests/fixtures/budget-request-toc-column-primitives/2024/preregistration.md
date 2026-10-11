# FY2024 TOC Column Primitives v1 — development preregistration

**Status:** frozen by this preregistration/fixture commit on 2026-10-11 (Asia/Tokyo). This is a descriptive development contract for primitive extraction only. It does not define an assembly operation, parser implementation, evaluator, test, or result.

## Why a separate v1 iteration


## Scope and invariants

- Input is a frozen UTF-8 page text, physical PDF page number, and zero-based source line index. All offsets are UTF-16 code-unit offsets into the decoded page text; line offsets include the preceding page text and each preceding line terminator as one UTF-16 unit. Raw source lines and raw segment slices are preserved exactly.
- A page-local column boundary is available only when a line on that physical page matches the exact header regex below. The candidate cut is `floor((end of first ページ marker + start of the second 要求 marker) / 2)`, measured in UTF-16 units from the start of the header line and reused as a column position for each body line on that page.
- If no qualifying header exists on a page, every line has `boundaryStatus: NO_PAGE_LOCAL_BOUNDARY`, `side: null`, and stays unsplit. Simple whole-line page-only and title-only candidates may still be observed with unknown side; no mixed line is parsed as a whole.
- If a cut would fall between two non-horizontal-whitespace code units, or through any complete known page-reference span, do not split or repair the line. Preserve the original source line and mark it `UNRESOLVED_BOUNDARY_CUT`; emit no side-assigned primitives for that line.
- Otherwise split at the exact header-derived UTF-16 column into left `[0, cut)` and right `[cut, end)` slices. Preserve slice bounds into the source line. Apply primitive recognition independently to each side segment. Do not join, reorder, normalize, correct, or semantically continue text across lines or columns.
- Primitive kinds are `page_only`, `title_page`, `title_only_candidate`, and `unresolved`. These are observations, not semantic document hierarchy labels. No page-only/title-only pairing or other assembly is permitted.
- A page-reference token must be terminal in the segment. `page_only` requires the whole horizontal-whitespace-trimmed segment to match the page-reference regex. A title plus recognized page token requires the title/page separator below. If neither rule matches, emit a `title_only_candidate`, except that an unsupported terminal numeric/prefix form after a permitted separator is `unresolved` with reason `UNSUPPORTED_TERMINAL_PAGE_FORM`.
- Keep the exact source page-reference spelling. ASCII digits, spaces, punctuation, and parentheses are never normalized. Do not infer a page reference from arbitrary digits within a title.

## Frozen regex source strings

These are literal ECMAScript regex source strings. `\t` denotes a horizontal tab; source text is not normalized before matching.

```text
HEADER_REGEX = ^要求[ \t]+区[ \t]+分[ \t]+(?<page>ページ)[ \t]+(?<secondRequest>要求)
PAGE_REF_REGEX = ^(?:[0-9]{1,4}|エ[ \t]+[0-9]{1,4}|電[ \t]+[0-9]{1,4}|原[ \t]+[0-9]{1,4}|国[ \t]+[0-9]{1,4}|国\(国\)[ \t]?[0-9]{1,4})$
PAGE_ONLY_REGEX = ^[ \t]*(?:[0-9]{1,4}|エ[ \t]+[0-9]{1,4}|電[ \t]+[0-9]{1,4}|原[ \t]+[0-9]{1,4}|国[ \t]+[0-9]{1,4}|国\(国\)[ \t]?[0-9]{1,4})[ \t]*$
TITLE_PAGE_REGEX = ^(.*?)(?:[ \t]{2,}|[.・…･·。]{2,})([0-9]{1,4}|エ[ \t]+[0-9]{1,4}|電[ \t]+[0-9]{1,4}|原[ \t]+[0-9]{1,4}|国[ \t]+[0-9]{1,4}|国\(国\)[ \t]?[0-9]{1,4})$
UNKNOWN_PAGE_TAIL_REGEX = ^(.*?)(?:[ \t]{2,}|[.・…･·。]{2,})([^ \t]*[0-9]{5,}|[^ \t]+[ \t]+[0-9]+)$
KNOWN_PAGE_REF_SPAN_REGEX = (?<![^ \t])(?:[0-9]{1,4}|エ[ \t]+[0-9]{1,4}|電[ \t]+[0-9]{1,4}|原[ \t]+[0-9]{1,4}|国[ \t]+[0-9]{1,4}|国\(国\)[ \t]?[0-9]{1,4})(?![^ \t])
NONBLANK_BOUNDARY_CUT_REGEX = (?<=\S)(?=\S)
TITLE_PAGE_SEPARATOR_REGEX = (?:[ \t]{2,}|[.・…･·。]{2,})
TITLE_EDGE_WS_REGEX = ^[ \t]+|[ \t]+$
```

The v0 leader set is copied from `scripts/pipeline-v2/lib/budget-request-plain-text-csv.ts` `stripPageReference` (`/[.・…･·。]{2,}/u`): two or more literal members of `[.・…･·。]` (ASCII period `.`, middle dot `・`, ellipsis `…`, half-width middle dot `･`, middle dot `·`, or Japanese full stop `。`). The page-reference alternatives are limited to ASCII digits 1–4; `エ`, `電`, `原`, or `国` followed by one or more horizontal spaces and ASCII digits 1–4; or literal `国(国)` followed by zero or one horizontal space and ASCII digits 1–4. The `国(国)` parentheses are literal characters. For the derived `titleText` field only, trim horizontal padding using `TITLE_EDGE_WS_REGEX`; preserve all original spacing in `rawText`, and never trim or rewrite the page-reference spelling or source offsets.

Header detection searches source lines for `HEADER_REGEX`; the header markers are non-overlapping and `secondRequest` is the first `要求` after the captured `ページ`. If multiple qualifying header lines disagree on the candidate cut, the page has no usable boundary and all lines remain unsplit with `NO_PAGE_LOCAL_BOUNDARY`. Boundary calculation and line slicing use UTF-16 positions, not Unicode code points, UTF-8 byte offsets, or visual PDF points.

## Cases and evidence

`fixture.json` labels every case `SOURCE_DERIVED` or `SYNTHETIC`. Source-derived raw strings were independently read from `data/work/budget-request-plain-text/2024` and checked against the manifest page hashes; each source record also identifies the PDF path, PDF SHA-256, physical page, page-text SHA-256, line index, and UTF-16 line start. The source PDFs are available under the workspace `data/download` symlink. Physical PDF pages and printed page references are distinct.

| Case | Evidence and purpose |
|---|---|
| D1 | Synthetic single-line `title_page` with request-like prefix and printed page. |
| D2 | Synthetic single-line `title_page` without a request number. |
| D3 | Synthetic same-raw-line left and right items become two distinct primitives. |
| D4 | CFA physical p3 source lines 19 and 21: separate left/right primitives (88/143 and 88/145). |
| D5 | CFA physical p3 printed page 94 followed by `必要な経費`, retained separately as `title_only_candidate`; for both raw lines, record left `[0,52)` and right `[52,end)`, including the empty right slice for the 16-unit line. |
| D6 | Synthetic standalone `page_only`, unknown side. |
| D7 | Synthetic `title_only_candidate`, unknown side. |
| D8 | METI source examples for all `エ 9`, `電 1`, and `原 1` forms; expected output accounts for every resulting segment, including left-side pages. |
| D9 | NDL source examples `国 1` and `国(国)13`, preserving distinct spellings. |
| D10 | Synthetic boundary crossing a page token; preserve whole line as `unresolved`. |
| D11 | Synthetic no page-local header; unknown side and no split. |
| D12 | Synthetic positive left/right contamination guard; each side meets the frozen title/page separator and no primitive may leak across sides. |
| D12-N | Synthetic negative control preserving the original one-space separators; neither side is expected to match `TITLE_PAGE_REGEX`. |

The qualifying page-local header regex occurs on 72 of 82 inventory pages. The exact ten pages without a match are listed in `expected-results.json` under `noHeaderInventoryPages`; the list is keyed by source PDF path and physical page and includes inventory classification source plus the relevant raw TXT header lines. It was enumerated by checking the exact regex against each physical page in the 82-page frozen structure inventory and cross-checking page identity and text SHA-256 against the corresponding source TXT page. The listed pages are unknown-side and never force a split. Unrelated physical-page 94/95 observations are excluded; the CFA case references physical p3 and printed-page token 94. Frozen kinds are exactly `title_page`, `page_only`, `title_only_candidate`, and `unresolved`. `expected-results.json` is a manually authored expected-output contract, not a parser run or evaluation. It repeats the exact regex strings so the fixture and preregistration freeze the same recognition and boundary rules before implementation. Synthetic cases exercise only segmentation safety; source-derived cases establish raw source evidence, not ground truth for any downstream semantic use.

## Explicit non-goals

No assembly, row reconstruction, title continuation, page-reference normalization, semantic classification, cross-page state, inferred columns, geometry-derived boundaries, PDF-coordinate offsets, implementation, tests, or evaluation results are in this iteration. Any ambiguous boundary or unsupported terminal page form remains unresolved for coordinator review.

## Freeze revision 1 — post-STOP contract-alignment correction

This section is a versioned correction after the original freeze commit `a792b5d0d682cdc76099dc8b709967788265c898`; that commit and its negative result remain unchanged in history. The correction follows the development failures observed before implementation validation and does not change the research hypothesis, regex source strings, segmentation formula, assembly exclusion, or acceptance criteria. This remains development evidence, not formal held-out evaluation.

### D12 fixture correction

D12 is synthetic. Its original raw line was `LEFT 88             RIGHT 145`, which places only one horizontal space between each title and page token and therefore contradicts the frozen `TITLE_PAGE_REGEX` requirement of at least two spaces (or a permitted leader). The positive fixture now uses `LEFT      88             RIGHT  145`. Its synthetic header yields the frozen midpoint cut at UTF-16 column 12, immediately after the left page token and within the horizontal gap before the right title. Both source slices independently match the unchanged regex. The original one-space line is retained as D12-N, a negative case expected not to produce either `title_page` primitive.

### Side representation clarification

`side: null` denotes page-level boundary metadata when no page-local boundary is available. It is not a valid `Primitive.side` value. Every primitive uses exactly `left`, `right`, or `unknown`; a whole-line primitive observed without a determinable column has `side: unknown`. The pre-revision expected output encoded `null` on several no-boundary primitives and omitted `side` from D9 primitive expectations, while the D9 test compared it. The expected shape is corrected consistently for D1, D2, D6, D7, and D9; page-level no-boundary metadata remains `null`. This clarifies the already stated distinction between unavailable page boundary and unknown primitive side and adds no new extraction or assembly rule.
