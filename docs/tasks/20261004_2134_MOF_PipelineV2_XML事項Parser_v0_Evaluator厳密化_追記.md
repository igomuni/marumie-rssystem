# MOF XML 事項 Parser v0 — evaluator の GO 条件の厳密化（追記）

2026-10-04。PR #370 のレビューで、frozen evaluator が preregistration §16 の GO 条件を完全には機械適用していないと指摘された（Medium）。**parser・preregistration・oracle（reference projection・hand-checked fixture・source set）・raw XML は変更していない。** 初回評価の artifact と result document（`20261004_2117_…_Frozen_Evaluation_Result.md`）も書き換えず保持する。

## 指摘された穴

初回の evaluator は、(1) source set の完全性（ローカルの XML が 328 件で、94 target + 234 non-target のファイル名集合と過不足なく一致すること）、(2) non-target 234/234、(3) fail-closed test の通過、を GO 条件に含めていなかった。このため non-target XML が 1 本欠けても、target と 1,256 records が揃っていれば GO になり得た。artifact の整合性 test も合計を `<= 328` としていた。

## 修正（evaluator と test のみ）

- `scripts/pipeline-v2/lib/mof-budget-xml-items-evaluation-rules.ts`: `checkSourceSetCompleteness`（欠落・余剰・重複・件数を検出）、`failClosedTestsPassed`。unit test（non-target を 1 本欠く・余剰・同数の差し替え・重複・0 件・最低件数未満）を追加。
- `evaluate-mof-budget-xml-items-v0.ts`: GO 条件に `sourceSetComplete328`・`nonTarget234of234`・`failClosedTestsPass`（parser の test file を実行して失敗 0・44 件以上を要求）を追加。出力は別 file `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-frozen-evaluation-hardened.json`（初回の artifact は保持）。
- artifact test: 328 = 94 + 234 の過不足なしを `toBe` で検査し、初回・再実行の両 artifact に適用。

## 再実行の結果

厳密化した evaluator を同じ frozen 入力に対して再実行した。判定は **GO**（初回と同じ）。ローカルの XML は 328/328 で source set と完全一致、non-target 234/234、fail-closed test は失敗 0。field 別の exactness・coverage・hierarchy・special structures は初回と同じ（1,256 / mismatch 0）。artifact SHA-256 `fdcf2477dad9394f20c18b648a809011f65488bc0924dd8c785c2a252fe1af09`。初回 artifact は `627b86565f699702057cf70ba70166f88ff6b06f62041ccb51f527a31ddf5da9` のまま。

## 位置づけ

初回の GO は、当時 328/328 が実際に揃っていた事実を示す記録として保持する。厳密化は「再実行可能な evaluator が preregistration を完全に強制する」ための契約の修正であり、結果を変えるための変更ではない（parser は frozen のまま）。
