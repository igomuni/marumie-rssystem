# FY2024 概算要求 TOC A 層 — Full-Corpus Status Assessment（POST_HOC）

成果物: `tests/fixtures/budget-request-toc-full-corpus-status/2024/`（`full-corpus-h1-output.json` / `full-corpus-status.json` / `human-review-queue.json` / `assessment-manifest.json`）。生成: `scripts/pipeline-v2/run-budget-request-toc-full-corpus-status.ts`。

## Purpose

#402 の後、TOC 82 page 全体について「frozen H1 まで反映した現在の A 層が、何を観測でき、何を観測できず、どこを人間が次に確認すべきか」の**現状地図**を機械的に作る。次の仮説を決める unit ではなく、その前段。parser・H1・GT・評価 contract・threshold は変更していない。failure の原因は決めていない。

## Research status

- **formal evidence（不変）**: #396（旧 parser #393・first held-out 23・`STOP_SAFETY`）と #402（H1・new held-out 25 の one-shot・`SAFETY_PASS_COVERAGE_REPORTED`）。本 unit は再判定・再生成をしない。
- **本 unit（POST_HOC）**: 82 page 全件に現在の frozen H1 を適用した棚卸し。formal held-out evaluation ではない。第 1・第 2 の held-out は本 unit 以降「未観測」ではない。23 / 25 の値には `POSTHOC_REEXECUTION` を付し、formal result と混同しない。

## Population

development / explored 34 + first held-out 23 + new held-out 25 = 82、overlap 0、出力 82 page に重複なし。H1 を同一入力で 2 回実行して出力 hash 一致（決定的）。new 25 の出力は #402 の formal output と完全一致。

## Current machine-observed extraction status（ALL 82）

| 項目 | 値 |
|---|---|
| page state | SPLIT 35 / UNSPLIT 44 / ABSTAINED 3（`RIGHT_EVIDENCE_INSUFFICIENT`） |
| right band | resolved 35 / unresolved or no evidence 47 |
| output unit | 3119（LEFT 1167 / RIGHT 967 / UNSPLIT 985） |
| row kind | REQUEST 1519 / MARKER 1106 / TITLE_OR_HEADING 454 / OTHER_CODE 14 / WRAPPED_FRAGMENT 0（fragment は row ではなく attachment）/ UNKNOWN_ABSTAINED 26 |
| fragment attached | 55 |
| abstained unit | 26（全て `FRAGMENT_WITH_PAGE_REF`）、page abstain 3 |
| H1 trigger | 39 行 / 20 page（REQUEST 25 / MARKER 14）、分割 39（1:1）。negative-control 行 91 |

partition 別（development 34 / first 23 post-hoc / new 25 post-hoc）は `full-corpus-status.json` の `byPartition`。例: SPLIT = 20 / 9 / 6、UNSPLIT = 13 / 12 / 19、ABSTAINED = 1 / 2 / 0、H1 trigger 行 = 19 / 10 / 10。

## Existing-GT status（POST_HOC_STATUS_ONLY・#395 evaluator を変更せず適用）

| | first 23（現在の H1・post-hoc） | new 25（post-hoc。#402 と同一出力） | combined 48（`DESCRIPTIVE_AGGREGATE_ONLY_NOT_A_FORMAL_HELDOUT_RESULT`） |
|---|---|---|---|
| GT comparable / parser comparable / matched | 802 / 727 / 727 | 560 / 560 / 560 | 1362 / 1287 / 1287 |
| CORRECT / INCORRECT / ABSTAINED / UNRESOLVED | 727 / 0 / 75 / 0 | 560 / 0 / 0 / 0 | 1287 / 0 / 75 / 0 |
| severe（4 family 合計） | 0 | 0 | 0 |
| fragment（GT） | 17：correct 15 / incorrect 1 / unresolved 2 | 3：correct 3 | 20：correct 18 / incorrect 1 / unresolved 2 |
| provenance 不一致 | 0 | 0 | 0 |

first 23 の fragment の incorrect 1・unresolved 2（`AMBIGUOUS_OWNER_GROUP`）は事実の記録のみで、原因は未判断。page ABSTAINED は first 23 に 2 page（`RIGHT_EVIDENCE_INSUFFICIENT`）。

## 観測可能性（単一の「抽出率」にしない）

A. page 構造解決: SPLIT 35 / UNSPLIT 44 / ABSTAINED 3。B. 右 column: band 解決 35 / 未解決 47。C. token row: GT 48 page の comparable 1362 のうち matched 1287・abstained 75・unresolved 0（development 34 の parser comparable unit 1338 は GT なしで `GT_UNAVAILABLE`）。D. fragment: attached 55、GT 48 page で correct 18 / incorrect 1 / unresolved 2 / wrong 0。E. 適用可否: NOT_COMPARABLE（PLAIN_ROW 86・classification 1362・UNSPLIT で column 非主張 362・page-level 31）、GT unavailable = development 34 page。

## Human-review queue

40 page（development 22 / first 12 / new 6）。理由別（複数付与あり）: PAGE_ABSTAINED 3 / OTHER_CODE_PRESENT 1 / FRAGMENT_UNRESOLVED_OR_WRONG 2 / H1_TRIGGER_PRESENT 20 / H1_NEGATIVE_CONTROL_PRESENT 35 / KNOWN_TOKENLESS_FRAGMENT_RELEVANT 2（機械定義: header zone で最初の trigger 行より後ろにあり、E 以右に text を持つが row-start token を持たない行）/ UNSPLIT_WITH_GT_RIGHT_ROWS・SEVERE_DETECTED_POSTHOC・INCORRECT_ROW・OMITTED_SILENTLY・ORDER_INVERSION・UNRESOLVED_PRESENT は 0。**priority・severity は付けていない**。候補理由は failure diagnosis ではない（`H1_TRIGGER_PRESENT` は正常に見える positive の control 候補）。

## What this does NOT establish

correctness proof ではない／production GO ではない／B 層 GO ではない／GT のない development 34 page を correct とは判定していない／failure の原因を決めていない／acceptance threshold を設定していない（`UNRESOLVED_ACCEPTANCE_THRESHOLD`）。coverage 的な数字は報告のみ。

## Next

`READY_FOR_HUMAN_FAILURE_ISOLATION_REVIEW`（human-review-queue を人間が確認する段階へ進んでよい、のみ）。
