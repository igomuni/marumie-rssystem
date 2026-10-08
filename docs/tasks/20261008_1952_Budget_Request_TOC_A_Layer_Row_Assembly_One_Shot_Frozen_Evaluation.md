# FY2024 概算要求 TOC A 層 row assembly — One-Shot Frozen Held-out Evaluation

raw 成果物: `tests/fixtures/budget-request-toc-row-assembly-evaluation/2024/`（`evaluation-launch-manifest.json` / `heldout-parser-output.json` / `evaluation-result.json` / `execution-started.json`）。

**最終判定: `STOP_SAFETY`**（protocol compliant、severe 10 件）。保存して STOP。parser 修正・GT 修正・matching 修正・threshold 設定・追加分析・再実行は行っていない。

## Protocol

- formal execution count = 1（retry 0、failure artifact なし、candidate drop/replacement 0）。
- evaluator は launch 前に commit（`abaa5811…`）し、launch manifest（sha256 `80897a1a…f5b7d`）で hash を固定。実行後も hash 一致。
- frozen 入力（#391 prereg `0cfec657…2ac8`、#392 GT `2e18ecd3…c4444`、#393 parser `f3b726f8…636dd` / ruleConfig `6a0565e6…14251`、#395 amendment `958985cc…33f00`、membership `8fa5a8a8…a44156`）は全て一致。
- parser output sha256 `d95abb76…b6f6b`、evaluation result sha256 `fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66`。

## 結果（raw。解釈を含まない）

| 項目 | 値 |
|---|---|
| page | 23（DIRECT 14 / INHERITED 9）。ASSEMBLED_SPLIT 9 / UNSPLIT 12 / PAGE_ABSTAINED 2（RIGHT_EVIDENCE_INSUFFICIENT） |
| page outcome | CORRECT 9（SPLIT かつ GT 右 ROWS）/ NOT_COMPARABLE 12（UNSPLIT かつ GT 右 blank）/ ABSTAINED 2 |
| GT comparable row / parser comparable unit / matched | 802 / 717 / 717 |
| row state | CORRECT 717 / INCORRECT 10 / ABSTAINED 75 / UNRESOLVED 0 |
| OMITTED_SILENTLY / ORDER_INVERSION | 0 / 0 |
| NOT_COMPARABLE（row） | PLAIN_ROW 32、row-start classification 802（独立計測不能）、column 非主張 160 |
| severe 合計 | **10**（5 page） |
| FALSE_POSITIVE_ROW_ASSEMBLY | 10（全て MERGE 検出、5 page） |
| WRONG_COLUMN_ASSIGNMENT / WRONG_FRAGMENT_ATTACHMENT / PROVENANCE_MISMATCH | 0 / 0 / 0 |
| fragment | GT 17：CORRECT 15 / UNRESOLVED 3（AMBIGUOUS_OWNER_GROUP）/ 他 0 |
| blocking unresolved | 3（AMBIGUOUS_OWNER_GROUP、2 page） |
| provenance | unit 837・fragment 16 を検査、不一致 0 |
| pageResolutionCoverage | 21/23 |
| physicalRowCoverage | 717/802 |
| comparableRowClassificationCoverage | 727/802 |
| fragmentAttachmentCoverage | 15/17 |

severe の個別 evidence（page・GT key・parser unit・reason）と stratum 別 coverage は `evaluation-result.json` の `summary.severe` / `summary.coverage.byStratum`、page 別は `pages[]`。

## Limitations（#395 のとおり）

PLAIN_ROW どうしの同一行統合・分割は検出できない／duplicate key group では個別行を特定できない／`WRONG_ROW_START_CLASSIFICATION` は NOT_COMPARABLE／token 一致は transcription 差を区別できない／GT は同一 agent が作成（独立検証ではない）／`UNRESOLVED_ACCEPTANCE_THRESHOLD`（coverage 下限・abstention 上限・分類許容）は未決のまま。

## 次

この PR では原因分析をしない（仮説検証・parser fix simulation・threshold sensitivity・GT 再確認・PDF 再 render・失敗 page の目視は禁止）。必要なら次の failure isolation unit とする。
