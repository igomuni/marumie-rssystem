# 概算要求（総表も TOC もない PDF）の階層を明細表の行の位置から決める規則の評価 — 契約

状態: 実行前に commit する。総表の行の並びで階層を決める規則（Hierarchy From Position）の明細表版。TOC を持ち、明細表を持つ source で、規則が TOC をどれだけ再現するかを数える（記述）。規則は下の 3 つに固定し、結果を見て増やさない。結果を見てから、総表のない source に使う追補を、ユーザーの了承のうえで書く。

## 規則（明細表の行の並びだけを見る。`row_type` は明細表 CSV のもの）
- **項-D:** `CODE3` の次の行が `DETAIL` のとき、その `CODE3`（コード3桁と名称）を項とする。
- **勘定-D:** `CODE1` の行（先頭が 1 桁）を勘定とする。
- **会計-D:** `CODE2` の行のうち、先頭が 2 桁で、名称が MOF の特別会計の名前と（幅の統一・空白除去後に）完全一致するものを会計とする。

## 評価
TOC を持ち、明細表を持つ source ごとに、TOC の `（項）`・`（勘定）`・`（会計）` の見出し（コードと名称。幅の統一と空白除去をした名称）を正解として、規則の集合と比べる。一致（tp）、正解にあって規則にない（fn）、規則にあって正解にない（fp）を FY2024・FY2025 で合計し、例を記録する。
出力: `docs/inventory/budget-request-hierarchy-from-detail/{rule-evaluation.json, rule-errors.csv}`。`scripts/research/evaluate-budget-request-hierarchy-rules-detail.py` を実行前に commit する。
