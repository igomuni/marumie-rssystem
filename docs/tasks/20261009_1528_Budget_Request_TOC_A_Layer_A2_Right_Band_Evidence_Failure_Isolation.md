# FY2024 概算要求 TOC A 層 — A2 right-band evidence の corpus-level failure isolation（census のみ）

census: `tests/fixtures/budget-request-toc-a2-right-band-evidence-failure-isolation/2024/census.json`（生成 `scripts/pipeline-v2/analyze-budget-request-toc-a2-right-band-evidence.ts`、helper `lib/budget-request-toc-a2-right-band-evidence.ts`）。

## 1. Objective / research question

H5（mlit `001630995.pdf` p6）で確認された「right-only raw line 上の request token が現行 evidence 述語から除外される」mechanism は、TOC 82 page corpus 内でどの程度・どの状態で発生しているか。**機械的な観測のみ。** visual semantics は付与しない。新 rule・仮説・preregistration・閾値・parser 変更は一切ない。

## 2. Source boundary / no PDF visual review

- 入力: 既存 raw-text artifact `data/work/budget-request-raw-text/2024/pages/*.jsonl` の `nonEmptyLines`（PDF 再抽出なし）。82 page の母集団・partition・現行 page state は `tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-status.json`。
- PDF・`data/download` の PDF は開いていない。pdftotext / pdftoppm / screenshot / Web は未使用。
- 使用した JSONL 55 本の sha256 を commit 済み `raw-text-manifest.json` の `artifactSha256` と全件照合して一致（census.json の `input.verifiedArtifactSha256` に全件記録）。各 page の `textSha256` も status fixture と一致。

## 3. 現行 evidence 述語（`scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts`、#393 frozen 版 `budget-request-toc-row-assembly.ts` も同一式）

- L12 `REQUEST_TOKEN_SOURCE = \d{1,3}\s+\d{2}[‐‑-]\d{2}`、L15 `BAND_TOLERANCE_CHARS = 2`、L16 `BAND_MIN_EVIDENCE = 2`。
- L22 `RIGHT_BAND_EVIDENCE = \d{1,4}(\s+)(REQUEST_TOKEN)`（`gu`）。L91-99 `bandEvidenceOf`: 行の先頭 non-ws index `first` より後ろに開始する token だけを `requestStarts` に採用（行内先頭 token は除外）。marker は band evidence に使わない。
- L128-137: starts ≥ 2 → 最大 − 最小 > 2 なら `MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS`、それ以外は edge = min。starts == 1 → `RIGHT_EVIDENCE_INSUFFICIENT`（page abstain）。starts == 0 かつ marker 候補 > 0 → `MARKER_ONLY_RIGHT_BOUNDARY`、marker も 0 → `ASSEMBLED_UNSPLIT`。

## 4. Diagnostic 定義（census 実行前に固定。コード先頭コメントと同一。結果を見て調整していない）

用語: a = accepted request evidence 数（現行述語どおり）。rejected = 全 request token のうち accepted でないもの。**right-only-line candidate** = rejected かつ行内先頭 token かつ開始 index > 0。index 0 の行内先頭 token は left 列頭 / 全幅行と区別できないため `lineStart0Candidates` として別カウントし right-only に含めない。**right-only-line candidate は raw line 上の位置の機械的ラベルであり、visual に right column であることを意味しない。**

A2 pattern = right-only candidates が 2 件以上あり、開始 index が tolerance 2 以内の 1 window に 2 件以上入る。resolved = 現行 pageState が `ASSEMBLED_SPLIT`。

| 分類 | 定義 |
|---|---|
| A2_LIKE_REJECTED_RIGHT_ONLY | a < 2 かつ A2 pattern |
| A2_PATTERN_BUT_CURRENTLY_RESOLVED | a ≥ 2 かつ A2 pattern かつ resolved |
| MIXED_OR_UNRESOLVED | 上記以外で、a ≥ 2 なのに resolved でない / `FROZEN_INPUT_MISMATCH` |
| A1_LIKE_SPARSE | a < 2 かつ A2 pattern なし かつ `PAGE_ABSTAINED`（INSUFFICIENT / MARKER_ONLY） |
| NO_A2_PATTERN | 上記以外の A2 pattern なし（SPLIT、または a == 0 の `ASSEMBLED_UNSPLIT`） |

A1_LIKE_SPARSE と NO_A2_PATTERN の境界（a == 0 の UNSPLIT をどちらに置くか）は曖昧なので、各分類内に sub-breakdown（accepted0 / accepted1 / accepted2plus / markerOnly）を併記し、レビュー側で再分類できるようにしてある。

## 5. Anchor validation（H4 / H5 / H6）

`observations.json`（#404）の値と再計算結果を突き合わせ、全項目一致（request token 総数・accepted 数と位置・firstTokenOnLine 数・開始 index histogram）。値は期待値として hard-code せず fixture から読んで照合している。

| id | page | token 全数 | accepted（line:idx） | firstTokenOnLine | 開始 index histogram（全 token） | right-only | 分類 |
|---|---|---|---|---|---|---|---|
| H4 | mhlw 05-2b-01 p4 | 20 | 1（6:51） | 19 | {0:19, 51:1} | 0 | A1_LIKE_SPARSE |
| H5 | mlit 001630995 p6 | 50 | 1（4:53） | 49 | {0:19, 53:1, 55:30} | 30（全て idx55） | A2_LIKE_REJECTED_RIGHT_ONLY |
| H6 | mod gaisanyoukyu p4 | 23 | 1（4:57） | 22 | {0:22, 57:1} | 0 | A1_LIKE_SPARSE |

H4 / H6 は A1 的（accepted 1・right-only 不成立）、H5 は A2 アンカー（right-only 30 件が idx55 の 1 cluster）となることを機械的に確認した。

## 6. Corpus census（FACT）

- 82 page（partition: DEVELOPMENT_EXPLORED 34 / FIRST_HELDOUT_POSTHOC 23 / NEW_HELDOUT_POSTHOC 25）。全 82 page で再計算した accepted 数が status fixture の `rightBandEvidenceCount` と一致し、H1 再実行の pageState / abstention reason / edge も status と一致。
- 現行 state: SPLIT 35 / UNSPLIT 44 / PAGE_ABSTAINED 3（H4・H5・H6、全て `RIGHT_EVIDENCE_INSUFFICIENT`）。
- accepted 数の分布（page 数）: 0→44, 1→3, 2→1, 3→6, 5→1, 6→1, 7→1, 8→1, 9→1, 10→2, 11→1, 13→1, 14→1, 15→1, 16→5, 17→2, 18→2, 19→2, 20→2, 21→1, 22→2, 27→1。
- request token 総数 1,612 = accepted 451 + rejected 1,161。rejected のうち line-start(idx0) 1,017、right-only 142（18 page）、「先頭でないが直前が数字+空白でない」2、残りは 0（reason 分類の合計 = 1,017 + 142 + 2 = 1,161）。
- 分類（page 数。括弧は partition: dev / first / new、sub-breakdown）:

| 分類 | pages | dev / first / new | sub-breakdown |
|---|---|---|---|
| A2_LIKE_REJECTED_RIGHT_ONLY | 1 | 1 / 0 / 0 | accepted1: 1 |
| A2_PATTERN_BUT_CURRENTLY_RESOLVED | 16 | 12 / 3 / 1 | accepted2plus: 16 |
| A1_LIKE_SPARSE | 2 | 0 / 2 / 0 | accepted1: 2 |
| NO_A2_PATTERN | 63 | 21 / 18 / 24 | accepted0: 44、accepted2plus: 19 |
| MIXED_OR_UNRESOLVED | 0 | – | – |
| 合計 | 82 | 34 / 23 / 25 | |

## 7. Candidate page（A2_LIKE_REJECTED_RIGHT_ONLY）

| pdf | page | partition | state | accepted | right-only | idx histogram | known human id |
|---|---|---|---|---|---|---|---|
| mlit.go.jp/page/content/001630995.pdf | 6 | DEVELOPMENT_EXPLORED | PAGE_ABSTAINED | 1 | 30 | {55:30} | H5 |

**H5 以外の候補 page はない。** A1_LIKE_SPARSE の 2 page は H4・H6（FIRST_HELDOUT_POSTHOC、right-only 0）。

## 8. Negative control（A2_PATTERN_BUT_CURRENTLY_RESOLVED、16 page）

right-only 同型 pattern があるが、現行 accepted evidence だけで band が resolved（SPLIT）の page。いずれも pageState は `ASSEMBLED_SPLIT`。

| pdf | page | partition | accepted | right-only | idx |
|---|---|---|---|---|---|
| env 000157010 | 3 | dev | 10 | 7 | {59:7} |
| env 000157012 | 3 | dev | 3 | 2 | {55:2} |
| maff 230901-2 | 3 | first | 5 | 11 | {55:11}（H2） |
| maff 230901-2 | 5 | dev | 16 | 3 | {60:3} |
| meti eneju_o | 3 | dev | 3 | 2 | {55:2} |
| meti ippan_o | 3 | dev | 17 | 4 | {55:4} |
| mhlw 05-1b-01 | 3 | new | 10 | 13 | {56:13} |
| mhlw 05-1b-01 | 4 | dev | 13 | 8 | {57:8} |
| mhlw 05-1b-01 | 5 | first | 21 | 2 | {55:2} |
| mhlw 05-1b-01 | 7 | dev | 8 | 4 | {57:4} |
| mlit 001630995 | 7 | dev | 3 | 14 | {57:14} |
| mlit 001630995 | 9 | dev | 3 | 2 | {57:2} |
| mof 2024ippan_2 | 2 | dev | 3 | 17 | {55:17}（H7） |
| reconstruction 2023_fukkochougaisansaisyutsu | 3 | dev | 9 | 13 | {55:13} |
| reconstruction 2023_fukkochougaisansaisyutsu | 4 | first | 14 | 7 | {53:7} |
| soumu 000901372 | 3 | dev | 15 | 2 | {56:2} |

観測: 現行述語で resolved の SPLIT page の多くに、accepted evidence の index に近い位置（idx 53〜60）で同型の right-only 先頭 token が存在する。right-only candidate を持つ 18 page は上記 16 + H5 + mext 20230914 p4（right-only 1 件・pattern なし）。

## 9. FACT / MECHANISM / UNRESOLVED

**FACT**
- H5 と同じ raw-text / evidence-predicate の組（right-only 先頭 token が rejected になり、かつ a < 2 で A2 pattern を満たす）は、82 page 中 **H5 の 1 page のみ**で観測された。
- right-only 先頭 token 自体は 18 page・142 件で観測され、うち 16 page は a ≥ 2 で現行 SPLIT。
- 現行 PAGE_ABSTAINED 3 page は H4・H5・H6 のみ。

**MECHANISM**
- 現行述語は「行内先頭 token」を evidence から除外するため、raw line 上で先頭 token が行頭空白の後ろにある行は accepted にならない。この除外が a < 2 の page で効くと page abstain（`RIGHT_EVIDENCE_INSUFFICIENT`）になる。H5 でそれが起きている。

**UNRESOLVED**（推測しない）
- right-only candidate が実際に right column か、request row か。visual 境界・row ownership。
- candidate を evidence に加えるべきか、band が本来 resolved すべきか。
- 16 control page の right-only candidate の意味、a == 0 の UNSPLIT 44 page に right-only 構造が無いこと自体の意味。

## 10. Claim boundary

言えるのは「H5 と同じ raw-text / evidence-predicate mechanism が機械的に 1 page（H5 自身）で観測され、right-only 先頭 token 自体は 18 page で観測された」まで。「N page は right-column detection failure」「rejected candidate を evidence に加えれば直る」とは言えない。GT / formal evaluation / human review の代替ではない。

## 11. Next research question（仮説ではない）

H5 以外の A2 候補が corpus 内に存在しない（1/82）場合、現行 evidence 述語の除外条件は corpus-level の失敗要因として扱う価値があるか。16 control page の right-only candidate は何を表しているか（既存 GT / human review の範囲で確認可能か）。

## 12. 変更していないもの

production parser / H1 parser・既存 frozen fixture・GT・preregistration・evaluator・formal evaluation artifact・threshold・tolerance・min evidence・package.json・`data/download`・旧 workspace。新 hypothesis・preregistration・parser 変更はない。

## 13. 実行環境メモ

HelloOrcaWorld worktree に `data/work` が無いため、helper は `--raw-text-root`（既定 `data/work/budget-request-raw-text/2024`）を持つ。今回は旧 workspace の `/Users/igomuni/MyGitHub/marumie-rssystem/data/work/budget-request-raw-text/2024` を read-only で指して実行した（コピー・`data/work` 作成なし）。再現コマンド:

```bash
npx tsx scripts/pipeline-v2/analyze-budget-request-toc-a2-right-band-evidence.ts --raw-text-root <raw-text-root> --freeze-fixture
```

決定性: 同一入力で 2 回実行し census.json の sha256 が一致（`f1e9b0c9c0e7335de5c847d8b7cc0cac2997f20489c240bcfc7a6a61ecc44b60`）。CI は commit 済み census.json と合成行の unit test のみを使い、`data/work` を必要としない。
