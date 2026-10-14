# 明細表 ↔ MOF 突合 X anchor — FY2025 held-out validation（one-shot）— preregistration

状態: **評価契約（実行前に固定）。** 結果は別の task doc に書く。FY2025 で metric を出す実行は1回だけ。
位置づけ: #452 の development 仮説（FY2024 の220行で 216/220）を、独立な年度（FY2025）で一度だけ検証し、K2（項の持ち越し）を採用するかを判断する。

## 入力（完全固定。照合できなければ何も計算せずに STOP）
- FY2025 明細表 primitive: `data/work/budget-request-csv/2025/detail-table/`。`output-manifest.json` の SHA-256 は `0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7`（#459）。`sources/*.csv` の集合と各 hash が manifest と完全一致すること。
- MOF canonical: `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl` の SHA-256 は `9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38`（#457）。
- スクリプト: `scripts/research/validate-detail-table-mof-x-anchor.py`（本 commit で固定。SHA-256 は commit 後に結果 doc に記録し、実行時の値と照合する）。

## 規則（FY2024 から変えない。#452 のコードを写した）
- 対象は一般会計。CONTEXT 行が無い source、特別会計（CONTEXT が4桁で始まる）、CONTEXT が `^NN 〇〇所管` に合わない source は除外し、除外した DETAIL の行数を理由別に出す。
- J1: `(ministry, 事項名) == (ministry, jikouName)` の exact。正規化しない。候補数で 0 / 単一 / 複数に分ける。
- immediate X: DETAIL の直前の行が CODE3/CODE2 で `^([0-9]{2,3}) (.+)$` に合うときの名称部。
- X_anchor: immediate X が無いとき、同じ source の行順で上に戻り、自身が immediate X を持つ直近の先行 DETAIL の X。anchor の探索では MOF を一切参照しない。
- 比較は `sectionName == X` の exact だけ。金額・K3・O・NFKC・部分一致による救済はしない。

## エンドポイント
- **primary:** J1 単一のうち、immediate X が無く anchor が取れた行で、`sectionName == X_anchor` が成り立つ割合。
- **secondary（記述）:** J1 単一で immediate X がある行の `sectionName == X` の割合 / 両者を合わせた source-only X の割合 / J1 複数で X（immediate、無ければ anchor）を適用した後の候補数 0 / 1 / 2+（1 になっても matched に昇格しない）。
- 除外・分岐の件数をすべて出す: 理由別の除外、DETAIL コードの形の不一致、J1 0候補・単一・複数、anchor が取れない行。primary で不一致だった行も列挙する（記述のみ）。

## 判定（結果を見る前に固定）
- primary の評価可能な行数が **50 未満なら INCONCLUSIVE**。
- 50 以上で、一致率が **95% 以上なら GO（K2 を採用してよい）、95% 未満なら STOP**。点推定で判定する。Wilson 95% 区間は記述として添える。
- 50 と 95% は FY2025 のどの数も見る前に決めた（95% は ChatGPT 案。development の 98.2% を踏まえたもの。50 は Coordinator 案）。

## 手順
1. スクリプトの FY2024 モード（`… 2024`）で、#452 の development の数（単一 694・複数 215・0候補 73、primary 216/220、複数の anchor 88 / 33）を再現することを確かめた。これは FY2025 の情報を含まない（本 commit の前に確認済み）。
2. 本 doc とスクリプトを commit する。
3. `python3 -I scripts/research/validate-detail-table-mof-x-anchor.py 2025 tests/fixtures/detail-table-mof-x-anchor-validation/2025/result.json` を **1回だけ** 実行する（出力ファイルが既にあれば、スクリプトは実行を拒否する）。stdout と result.json の SHA-256 を記録する。
4. 結果を見て、規則・母集団・閾値を変えない。入力の hash 不一致などで実行が止まった場合は、metric が出ていないので、原因を直してから再実行してよい（その経緯を記録する）。
