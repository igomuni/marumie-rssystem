# FY2024 概算要求 TOC A 層 — H1 One-Shot Formal Frozen Evaluation（新 held-out 25 page）

raw 成果物: `tests/fixtures/budget-request-toc-h1-formal-evaluation/2024/`（`evaluation-launch-manifest.json` / `new-heldout-h1-output.json` / `formal-evaluation-result.json` / `execution-started.json`）。

**最終判定: `SAFETY_PASS_COVERAGE_REPORTED`**（protocol compliant・positive trigger 10 行 / 5 page・severe 0・blocking unresolved 0）。意味は「この frozen 新 held-out 25 page で severe error は観測されず、positive trigger が存在した」のみ。production GO / B 層 GO / parser の正しさの証明ではない。保存して STOP。H1 修正・GT 修正・failure isolation・追加分析・再実行は行っていない。

## Pre-flight

- latest main `6c361b9`、#401 merged、working tree clean。
- H1 source `ea6af6de…78343`、membership digest `06c2e68d…ab28`・file `7c238b9b…38d06`、GT `693ce90d…3705f`・ledger `49d48e46…881f1`・render manifest `9ed0844b…c81`・GT freeze manifest `c41b6b51…1f0`（freeze manifest 内の hash も一致）。#398 prereg `0c3a377b…1b27`・#393 `f3b726f8…636dd`・#395 `958985cc…33f00` 不変。
- 実行前の新 25 への H1 実行 0 / #393 実行 0 / trigger census 0 / parser 出力の閲覧なし。

## Execution

- evaluator（#395 を機械化した `budget-request-toc-row-assembly-evaluator.ts`、#396 と同一・変更なし）と runner を launch 前に commit し、launch manifest（sha256 `d5c42558…01be0`）で hash 固定。実行後も一致。
- **H1 の formal execution = 1 回**（25 page 全件）、retry 0、failure artifact なし。H1 output sha256 `64f344ff43728b8957fe695046a5a60ac8951703824051bc06a83078f257f366`。評価は保存済み出力の read-only。
- 結果 `formal-evaluation-result.json` sha256 `7b024a25dd3f62b4987126fd275f9275b4afbf40b7569df490175fb9c83f2283`。runner sha256 `e4164d15…7e794`、evaluator sha256 `d5bb1708…eb96`。

## 結果（raw）

| 項目 | 値 |
|---|---|
| page | 25（DIRECT 22 / INHERITED 3）。ASSEMBLED_SPLIT 6 / UNSPLIT 19、PAGE_ABSTAINED 0 |
| page outcome | CORRECT 6（SPLIT かつ GT 右 ROWS）/ NOT_COMPARABLE 19（UNSPLIT かつ GT 右 blank） |
| GT comparable / parser comparable / matched | 560 / 560 / 560 |
| row state | CORRECT 560 / INCORRECT 0 / ABSTAINED 0 / UNRESOLVED 0 |
| OMITTED_SILENTLY / ORDER_INVERSION | 0 / 0 |
| NOT_COMPARABLE（row） | PLAIN_ROW 54、classification 560、UNSPLIT で column 非主張 202 |
| severe | FALSE_POSITIVE 0 / WRONG_COLUMN 0 / WRONG_FRAGMENT 0 / PROVENANCE 0（合計 0） |
| fragment | GT 3：correct 3 / wrong attachment 0 / unresolved 0 |
| provenance | unit 720・fragment 3 を検査、不一致 0 |
| coverage（報告のみ） | page 25/25・physical row 560/560・comparable-row classification 560/560・fragment attachment 3/3 |
| **H1 positive trigger** | **10 行 / 5 page**（REQUEST 6 / MARKER 4 / OTHER_CODE 0）。H1 の分割行 10 と 1:1。negative-control 行 16（whole-line のまま） |

abstention 0・unresolved 0。trigger の集計は formal output 生成後に、H1 出力と raw line から機械的に行った（#393 は新 held-out に実行していない）。

## #396 との関係

#396 は旧 parser・first held-out 23 page で別 population。**paired comparison ではない**（「10 severe → 0」とは述べない）。positive trigger 行数が偶然同じ 10 であることにも意味づけはしない。

## Limitations

- sample は 25 page で小さく、汎化は主張しない。新 held-out は #396 と同じ publisher の別 page を含み得る。
- PLAIN_ROW どうしの同一行統合・分割は検出できない（#395）／duplicate group では個別行を特定できない／`WRONG_ROW_START_CLASSIFICATION` は NOT_COMPARABLE／GT は同一 agent の作成（#401 で事前 freeze。independent ではない）。
- 19 page は UNSPLIT で GT 右 blank のため page-level NOT_COMPARABLE。H1 が作用する positive trigger は 5 page に限られる。
- `UNRESOLVED_ACCEPTANCE_THRESHOLD`（coverage 下限・abstention 上限・分類許容）は未決のまま。数値 coverage 1.0 は報告のみで基準にしていない。

## 次

この PR では原因分析・追加仮説・parser 修正を行わない。H1 の production への取込み、B 層、他 FY への適用は別 unit の判断（`UNRESOLVED_ACCEPTANCE_THRESHOLD` の扱いを含む）。
