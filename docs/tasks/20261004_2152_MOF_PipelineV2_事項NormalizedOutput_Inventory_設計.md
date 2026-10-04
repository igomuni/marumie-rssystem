# MOF Pipeline V2 事項 Normalized Output — contract inventory と設計

2026-10-04。base: latest `origin/main`（`db5f596`、#370 merge 済み）、branch `research/mof-v2-item-output-integration`。#370 の frozen parser（`scripts/pipeline-v2/lib/mof-budget-xml-items.ts`）は main 上に存在し、無変更。**本書は実装前の設計記録で、実装結果に合わせて書き換えない。**

## P0. 現行 V2 の normalized output contract

- entrypoint: `npm run pipeline:v2:normalize:mof`（`normalize-mof.ts`）。入力は MOF CSV ZIP（科目別内訳）。出力 `data/normalized/mof/fy{year}/{budget-items.jsonl,manifest.json}`。derive は `derive-mof.ts`（`derived/mof/fy{year}/sections.jsonl` ほか）。publish は `publish-v2.ts`。
- `budget-items.jsonl` = `MofBudgetItemRecord`（`types.ts`）。**source-preserving な 1 行 = 項 × 目**。`schemaVersion: 2`・`recordType: 'mof_budget_item'`・`recordId`（`stableId`、`mofrow_` 接頭辞）、会計・所管（ministry）・組織・特別会計・勘定・機関、`sectionCode/sectionName`、`subItemCode/subItemName`、`sectionNaturalKey`・`legacySectionKey`・`itemNaturalKey`・`scopeNameItemKey`、`source: SourceRef`（domain・path・file・dataset・year・zipEntry・rowNumber）、phase 別の金額（initial は `amountYen/previousAmountYen/differenceYen/sourceAmountColumn`、円）。順序は sortKey で決定的。
- `sections.jsonl` = `MofDerivedSection`。id は `stableId([sectionKeyOf(8 fields)], 'mofsec_')`（accountType・ministry・organization・specialAccount・subAccount・agency・sectionCode・sectionName の正規化連結）。
- stable ID: `stable-id.ts`（`stableId`＝NFKC・空白除去・US 区切り・SHA-256 先頭 20 桁）。
- 下流: `derive-integrated.ts`・`publish-v2.ts`・`validate-v2.ts` ほかが `budget-items.jsonl`・`sections.jsonl` を**ファイル名を指定して**読む（ディレクトリ走査はしない）。

### 用語の衝突（実装前に固定）

| 日本語 | V2 の既存用語 | #370 parser v0 / FieldResolver の用語 |
|---|---|---|
| 項 | **section**（`sectionCode/sectionName`、`mofsec_`） | **item**（`itemCode/itemName`） |
| 目 | **item / subItem**（`MofBudgetItemRecord`・`subItemCode/Name`） | — |
| 事項 | （V2 に無い） | **request**（`requestName`） |

parser v0 の `item` は V2 の `section`（項）に、parser の `request` は事項に対応し、V2 の `item` は目である。**normalized layer では parser の用語を持ち込まず、V2 の語（section＝項）に合わせ、事項は `jikou` と呼ぶ**（リポジトリに既存の語彙: `types/mof-jikou.ts`・`/mof-jikou`）。「item」「request」「matter」は使わない。

## P1. 設計

- **additive な別 output**: `data/normalized/mof/fy{year}/budget-jikou.jsonl` と `budget-jikou-manifest.json`。既存の `budget-items.jsonl`・`manifest.json`・`sections.jsonl` は変更しない。entrypoint は新規 `normalize-mof-jikou.ts`（`pipeline:v2:normalize:mof-jikou`）、写像は純関数の `lib/mof-jikou.ts`。`normalize-mof.ts` は変更しない。
- record type `mof_budget_jikou`、TypeScript 型 `MofBudgetJikouRecord`（`types.ts` に追加）、`schemaVersion: 1`。
- **parser との責務分離**: raw XML → frozen parser v0 → mapper → output。親子判定（carry-forward）の source of truth は parser で、mapper は再実装しない。同じ XML を別実装で再 parse しない。reference 生成 script・oracle は production から呼ばない。
- **フィールド**: `fiscalYear`・`phase`（`initial`）・`budgetStatus`（`enacted`。`202411001` は当初予算・成立版の archive 由来、既存 `budget-items` の initial 行と同じ）・`accountType: 'general'`・`ministry`・`organization`・`specialAccount/subAccount/agency`（空）／親の項: `sectionCode`・`sectionName`・`sectionNaturalKey`（既存 `mof-keys.ts` の `sectionNaturalKey`）・`parentSectionId`（`mofsec_…`、既存 `sectionKeyOf`＋`stableId`）／`jikouName`（parser の連結 text）・`jikouNameLines`（`<l>` ごとの source-faithful な配列）・`nameQtCount`・`nameGaiji`／`col4Raw`（semantic-neutral のまま）／`amountYen`・`previousAmountYen`・`differenceYen`（parser の千円整数 ×1000。整数乗算のみ）と `amountsRawThousand`（source の raw 文字列）・`sourceAmountColumns`（header の語）／`source`（既存 `SourceRef`: domain・path・file・dataset・year・sourceUrl）と `sourceLocator`（documentId・row キー・page・rowNo・sourceSha256）。
- **所管（ministry）**: parser は所管を出力しない。mapper は、**menu の祖先 chain の「甲号予定経費要求書」の直前の要素**から末尾の「所管」を除いたものを使う（例: 「内閣府所管」→「内閣府」、「皇室費」はそのまま）。明示的・決定的な規則で、名称の類似度は使わない。
- **金額**: blank→0、差額の再計算、符号補完はしない。parser が返した値だけを使い、既存 `yenFromThousand`（blank を 0 に倒す既定がある）は**使わず**、整数 ×1000 のみ。
- **ID**: `recordId = stableId([fiscalYear, phase, budgetStatus, sectionNaturalKey, jikouName], 'mofjik_')`。事項名単独は使わず、同名事項が別の項にあっても衝突しない。頁・行番号（改版でずれる）は ID に含めない。同一 key の重複は検出して失敗（fail-closed）。
- **順序**: ソース file 名 → 頁 → 行（文書順）。
- **親の接続**: `sectionNaturalKey`（既存 normalized の `budget-items.jsonl` の initial・general の項と完全一致）と `parentSectionId`（既存 `sections.jsonl` の id と一致）の**両方**が解決することを検証する。fuzzy は使わない。解決できなければ unresolved として失敗。
- **互換性**: 既存 output は追加のみで変更しない。実行前後で `budget-items.jsonl`・`manifest.json`・`sections.jsonl` の SHA-256 が不変であることを確認する。
- **scope**: FY2024・一般会計・当初予算・`202411001` の frozen source set のみ。parser の source-set 契約を維持するため、production entrypoint は凍結済みの source-set artifact（filename + SHA-256）を入力にする。scope 外のファイルは parser が unsupported とし、pipeline は失敗する。他年度・特別会計・補正予算には対応したと主張しない。

## Design gate（実装前の実測）

parent section の決定的な接続が可能かを実装前に確認した（frozen parser の 784 項 × 既存 V2 の initial・general 項）。menu 由来の所管を使い、既存の `sectionNaturalKey` で照合した結果、**784 / 784 が一致**（所管 18 種が V2 の所管と一致。生の文字列の完全一致でも 784 / 784）。既存 `sections.jsonl` の ID 体系の変更・大規模な移行・FY2024 固有の特殊処理・frozen semantics の変更はいずれも不要。design gate は通過。

## 次

実装（commit B）→ production generation と frozen 1,256 件との整合・既存 output の不変確認・判定（commit C）。
