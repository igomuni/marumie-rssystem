# 概算要求 PDF の「文書セット」の記述（inventory）— 契約

状態: 数える前に commit する。**記述のみ。規則・成功基準を置かない。** 目的: TOC を持つ source と、総表・明細表だけを持つ source が別 PDF に分かれている文書（FY2025 は内閣府・内閣官房・文部科学省など）を、突合で一つの文書として扱うための手がかりを、規則を置く前に数える。

## 数えるもの（FY2024・FY2025）
入力: `data/work/budget-request-csv/{2024,2025}/{toc,total-table,detail-table}/sources/*.csv`（source = PDF 1 本）。
1. **source の一覧:** 各 source の（TOC／総表／明細表の有無、TOC の項の数、総表の `CODE3` 数、明細表の `CONTEXT` の有無と最初の `CONTEXT`、明細表の目の行数）。FY2025 は凍結した PDF corpus（`tests/fixtures/budget-request-pdf-corpus/2025/pdf-corpus-freeze.json`）の `role`・`account`・`pageCount` も付ける。
2. **ファミリー:** source 名の末尾の数字（`_` `-` を含む）を除いた共通部分。ファミリーごとの source 数と、各 source の構成（上の有無）。
3. **TOC の項の所在:** TOC を持つ source の各項（コードと名称）が、同じファミリーの source の明細表・総表の `CODE3`（コードと名称が空白を除いて完全一致）に何件現れるか。現れる source、0 件、複数件、のそれぞれの件数。TOC を持つ source 自身に現れる場合も、他の source に現れる場合も、区別して数える。
4. **TOC のない source の所在:** 総表・明細表だけを持つ source の `CODE3`（コードと名称）が、どのファミリーのどの TOC の項に一致するか（同上の逆向き）。

## 出力
`docs/inventory/budget-request-document-sets/` に `sources.csv`、`families.csv`、`toc-kou-location.csv`、`summary.json`。`scripts/research/inventory-budget-request-document-sets.py` を実行前に commit する。
