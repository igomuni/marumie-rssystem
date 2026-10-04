# MOF Pipeline V2 XML 事項 Parser v0 — Implementation Freeze

2026-10-04。凍結済み preregistration（commit `2305be0`）に従う production parser v0 の実装を freeze する。**1,256 件の reference projection との full comparison は、この freeze commit より前に実行していない**（開発では 29 行の hand-checked fixture・synthetic fail-closed fixture・既存 regression test だけを使用）。freeze 後は結果を見るまで parser を変更しない。

## Frozen inputs（pre-flight で再計算して一致を確認）

- preregistration: `docs/tasks/20261004_2104_MOF_PipelineV2_FY2024一般会計XML事項Parser_v0_Preregistration.md`（commit `2305be0`、SHA-256 `ef55ce1c18681517257f5f384f6e86d67d331f5dbcf5808e058d04fb18747c49`）
- source set: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-source-set.json`（SHA-256 `62df90fb32caf5997ecb2772eb0c84da66789b635eb1bc024743cf6a8da2afe3`）
- reference projection: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-reference-projection.json`（SHA-256 `e6335aceb0c7d69888206cada038dcb03db5e25f7c2a10a8d5ae6104c2d615d9`）
- hand-checked fixture: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-hand-checked-fixture.json`（SHA-256 `664f0fbee2470311831db9dfbe53cd6e315a0e1f549767612d159b862d408fd1`）
- fingerprint の scope: 28 種は全 328 XML（inventory）、9 種は事項表の 94 ファイル（preregistration §3 と source-set artifact）。矛盾なし。

## Implementation

- parser: `scripts/pipeline-v2/lib/mof-budget-xml-items.ts`（SHA-256 `1d52634ba40bcfabd6fcdae477417daaf309ce8f2c8decf3c9ca251e6e041a79`）。reference 生成 script・reference projection・source-set artifact を import / 読込せず、独自の XML 読み取りを持つ。
- API: `parseMofBudgetXmlItemFile({ filename, bytes, documentId, menuChain, sourceSet })` → `recognized`（records・counts・sourceSha256）/ `not_target` / `unsupported`、構造が想定外なら `MofXmlParseError`（code 付き）。`readMenuAncestorChains(menuText)`。
- 実装した規則（preregistration どおり）: title 完全一致による事項表の識別と header の完全一致、行 5 種の分類（組織計・説明のみは出力しない）、組織の primary（先頭行の列 1）と secondary（running_title・目次 chain）の整合、項の carry-forward（コード順を使わない）、名称は CDATA と gaiji の子文字を区切りなしで連結（trim なし）、gaiji は (1508, 填) のみ、qt は文字に寄与せず数を保持、金額は header に対応する col6・col8・col10 の raw と千円整数（blank→0・差額計算・符号補完・`△ 0` なし）、col4 は `col4Raw`、列 11 は非空の確認のみ。
- production schema・`sections.jsonl`・public data・UI/API には統合していない。

## Development validation（full oracle 比較なし）

- tests: `scripts/pipeline-v2/lib/mof-budget-xml-items.test.ts`（SHA-256 `c65006546cc9bbdbc14b07a3c6c492fb109052a00a1a1c37873d55ad09db316a`）。基本動作、not_target / unsupported、hard failure（decode・malformed・root/encoding/DOCTYPE・table・header・未知行・空セル・項コード・col4・金額・組織・セル内容・文書順）、frozen hand-checked fixture の 29 行（足場を前置した行単位の test）。44 件 pass。
- `tsc` pass、lint error 0、全体 vitest 108 files / 1,353 tests pass。

次: 本 commit のあとに初めて full frozen evaluation（1,256 件）を実行し、preregistration の判定を機械的に適用する。
