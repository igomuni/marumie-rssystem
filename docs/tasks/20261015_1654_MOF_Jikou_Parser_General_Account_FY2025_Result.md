# MOF 事項 parser の一般化（一般会計 FY2025）— 結果

状態: 契約（`3a052e8`）どおり実行済み。結論: **FY2025 一般会計（成立後・提出時）の事項 CSV を、規則を足さずに作れた。両版とも例外なし・94 / 234 一致・項 806 が公式 CSV の項と完全一致。FY2024 の出力はバイト単位で不変。**

契約: `docs/tasks/20261015_1654_MOF_Jikou_Parser_General_Account_FY2025_Contract.md`。成果物: `tests/fixtures/mof-xml-parser-general/`（`manifest.json` `b390f06a…`）。

## 実装（契約からの逸脱が1つ）

- **逸脱:** 契約 §1 は parser（`mof-budget-xml-items.ts`）の編集を想定したが、この file は評価 artifact（`mof-budget-xml-items-evaluation.test.ts`）が source hash で凍結しており、編集すると凍結テスト2件が落ちる。凍結の hash を書き換えることはしないため、**v0 は無変更**のまま、`lib/mof-budget-xml-items-general.ts` に複製し、そこにだけ spec（帳票 ID・DOCTYPE・見出しの年度の文字。省略時は FY2024）を足した。規則・文法・失敗の種類は同じ。
- `build-mof-jikou-csv.ts` は `<2024|2025|2025_teishutsu> <out-dir>` を取る。FY2024 は従来の境界（凍結 source set の SHA・menu の SHA・1,256 件）、FY2025 は commit 済み source set の SHA と 94 / 234 だけを境界にする（事項件数の期待値は置かない）。
- FY2025 の source set は inventory の `files.csv` から機械的に作った（`scripts/research/make-mof-xml-source-set.py`。各版 328 = 94 + 234、SHA-256 は `de7731e5…`（成立後）、`57b2433f…`（提出時））。

## 回帰条件（すべて成立）

| 条件 | 結果 |
|---|---|
| FY2024 `jikou-general.csv` がバイト単位で同一（`2b92b50e…`） | 同一（`cmp`） |
| 既存の parser 関連テスト | `scripts/pipeline-v2` の 169 files / 1,674 tests 通過、テストの変更なし |
| FY2025 の2版を2回実行して同一 | 同一 |

`jikou-general-run.json` は parser の file SHA を記録するため、FY2024 については FY2024 の fixture（#471）を更新していない（回帰の対象は CSV）。

## 結果

| | 成立後 | 提出時 |
|---|---:|---:|
| target / non-target | 94 / 234 | 94 / 234 |
| 事項（要求行） | 1,287 | 1,287 |
| 項（開始行） | 806 | 806 |
| 小計行 / 説明だけの行 | 89 / 28 | 89 / 28 |
| 所管 / 組織 | 18 / 94 | 18 / 94 |
| 要求額の合計（千円） | 115,197,845,248 | 115,541,501,128 |

- 例外（`MofXmlParseError`）・`unsupported` はなし。事項件数は事前に期待値を置かなかった（報告のみ）。
- **項の一致（契約 §3-3）:** （所管, 組織, 項コード, 項名）の集合が、#471 の FY2025 `kou-general.csv` と両版とも **806 / 806 で完全一致**（片側だけの項 0）。
- **Σ事項と公式 CSV の項の合計（記述のみ）:** 806 項すべてで、事項の要求額の合計＝公式 CSV の項の合計（両版）。版ごとの総額も一致（上表）。parser の調整には使っていない。
- **成立後と提出時の差:** 事項行の対応は同じ（1,287 行）。金額が違う事項行は **5 行**（#471 の目の行では 14 行。事項は目より粗いため数が違う）。

## 未了・注意

- 特別会計は対象外（別段階。行の文法の事前登録が先）。
- 確認用スクリプト `scripts/research/check-mof-jikou-fy2025.py` は、契約 §3 の確認を、parser の実行の後に書いて commit した。確認の内容は契約に事前登録済みで、結果を見て変えていない。出力は `check.json`。
