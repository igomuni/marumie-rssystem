# MOF Pipeline V2 FY2024一般会計 事項 Normalized Output 統合（production generation 結果）

2026-10-04。#370 の frozen parser v0 を V2 の production pipeline に接続し、「事項」を additive な normalized output として生成した。設計（commit `ceef2bc`、`20261004_2152_MOF_PipelineV2_事項NormalizedOutput_Inventory_設計.md`）は結果に合わせて変更していない。概算要求 PDF との照合は開始していない。

## 判定: **GO**

## Base / commits

base `origin/main` `db5f596`（#370 merge 後）、branch `research/mof-v2-item-output-integration`。commit A `ceef2bc`（contract inventory と設計）、commit B `b6432de`（production integration と test）、commit C（本結果）。

## 設計の要点（詳細は設計書）

- 用語: V2 の section＝項、item/subItem＝目、parser v0 の item＝項・request＝事項。normalized では V2 の語に合わせ、事項を `jikou` と呼ぶ。
- output: `data/normalized/mof/fy2024/budget-jikou.jsonl` と `budget-jikou-manifest.json`（additive。既存の `budget-items.jsonl`・`manifest.json`・`sections.jsonl` は無変更）。entrypoint `pipeline:v2:normalize:mof-jikou`（`normalize-mof-jikou.ts`）、写像 `lib/mof-jikou.ts`、型 `MofBudgetJikouRecord`。
- ID: `mofjik_` + stableId(fiscalYear・phase・budgetStatus・sectionNaturalKey・事項名)。頁・行を含まず、事項名単独にしない。
- 親: 既存の `sectionNaturalKey` と `parentSectionId`（`mofsec_`）。所管は menu の祖先 chain（「甲号予定経費要求書」の直前の要素から末尾の「所管」を除く）から決定的に得る。fuzzy は使わない。
- 金額: parser の千円整数 ×1000（円）、raw を保持。blank→0・差額計算・符号補完なし。`col4Raw` は semantic-neutral のまま。
- parser は #370 の frozen 実装をそのまま使用（SHA-256 `1d52634b…1a79` が manifest と一致）。親子判定は parser の出力を使い、再実装していない。

## Production generation（FY2024 一般会計 当初予算 `202411001`）

| 項目 | 結果 |
|---|---|
| 事項 records | 1,256（expected 1,256） |
| unique recordId / duplicate | 1,256 / 0 |
| missing / extra / duplicate locator（frozen reference 比） | 0 / 0 / 0 |
| 親の項の解決 | 1,256 / 1,256（sectionNaturalKey・parentSectionId の両方）、orphan 0、ambiguous 0 |
| 親の項（unique） | 784（既存 V2 の initial・general の項 784 と一致） |
| 組織 / source XML | 94 / 94（XML 328 = target 94 + not_target 234） |
| failure / unsupported / structural failure | 0 / 0 / 0（発生時は例外で出力しない） |
| frozen reference との field 一致 | organization・sectionCode・sectionName・jikouName・jikouNameLines・col4Raw・amountYen・previousAmountYen・differenceYen・amountsRawThousand・nameQtCount・nameGaiji・locator が全て 1,256 / mismatch 0 |
| 既存 output の不変 | budget-items.jsonl・manifest.json・sections.jsonl・budget-events.jsonl の SHA-256 が生成前後で一致 |
| 決定的な再実行 | 同一入力で再生成して jsonl・manifest の SHA-256 が一致 |

artifact: `tests/fixtures/mof-jikou-normalized/2024/202411001-integration-evaluation.json`（SHA-256 `066dc9cd35e7ab301b409491206c48b4de9a582bb72a0c48c045e65a7cf2973e`）。output `budget-jikou.jsonl` は `data/` 配下で git 管理外（SHA-256 は artifact に記録）。

## Validation

`tsc` pass・lint error 0・全体 vitest pass（commit C 時点）。mapper・検証関数の test 38 件（hand-checked fixture 29 行の写像で金額・名称が変質しないことを含む）。

## Claim boundary

主張できるのは、「FY2024 一般会計 当初予算 `202411001` の frozen XML source set に対し、凍結した parser v0 を V2 の normalized output に統合し、1,256 件を欠落・余剰・重複なく、親の項を全件決定的に解決して生成できた」まで。特別会計・補正予算・他年度への対応、col4 の意味、publish / UI / API への公開、概算要求 PDF との対応は主張しない。parser の source-set 契約により、entrypoint は frozen source set（filename + SHA-256）に固定されている（一般化は別 phase）。

## Limitations

`pipeline:v2:validate`（`validate-v2.ts`）には事項の検証をまだ組み込んでいない（検証は生成時と本評価で実施）。publish 層・derived 層への事項の追加は未着手。

## 次

概算要求 PDF から抽出した「項・事項」と、V2 の「項・事項」の reconciliation（exact・normalized exact・unmatched・ambiguous・1:N・N:1 の観測）。今回は開始していない。
