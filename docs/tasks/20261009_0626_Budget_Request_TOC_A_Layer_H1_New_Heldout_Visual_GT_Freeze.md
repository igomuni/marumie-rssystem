# FY2024 概算要求 TOC A 層 — H1 新 held-out Visual GT Freeze

成果物（`tests/fixtures/budget-request-toc-row-assembly-header-zone-right-row-h1/2024/`）: `new-heldout-ground-truth.json` / `new-heldout-annotation-ledger.json` / `new-heldout-render-manifest.json` / `new-heldout-visual-gt-freeze-manifest.json`（`NEW_HELDOUT_VISUAL_GT_FROZEN`）、転記元 `new-heldout-visual-gt-source.txt`、生成 `scripts/pipeline-v2/build-budget-request-toc-h1-new-heldout-visual-gt.ts`。

**visual-only GT の freeze のみ。** 新 25 page への H1 / #393 の実行・trigger census・parser 出力の閲覧・formal evaluation は 0（held-out parser 実行は #396 の 1 回のまま）。judgment = `READY_FOR_H1_ONE_SHOT_FROZEN_EVALUATION`（次 unit で一回限りの formal evaluation を始めてよい、のみ。H1 の安全性・有効性の GO ではない）。

## 方法

- 対象: #400 で凍結した membership 25 page（digest `06c2e68d…ab28`）を canonical order で 1 回ずつ。順序・membership は変更なし。
- 原本 PDF を read-only で `pdftoppm` 110dpi で render して目視（#392 と同条件）。PNG は repo に含めず sha256 のみ render manifest に記録。`pdftotext`・parser・H1 の出力は使用・表示していない。GT の値は視覚のみ。
- supplemental render: 1 page（`jbaudit … 20230906_02.pdf` p3）。page ref 列が黒枠内の反転表示で 110dpi では判読が不安定だったため、その列を 300 / 600dpi で crop して目視した（理由は ledger）。見えた値のみ転記。
- #392 の GT schema を継承（REQUEST_NUMBER_ROW / MARKER_ROW / PLAIN_ROW。PLAIN_ROW は visual-only で parser mapping なし）。H1 固有の class・label は作っていない。page ref は見えた表記のまま（`電 1` `原 1` の prefix も保持）。
- **schema 上の範囲限定（要確認）**: 指示書 §7 は row の title 転記を最低限としているが、#392 の schema を継承して REQUEST / MARKER row の title は転記していない（評価 contract #395 が title を使わず、転記しても評価に寄与しないため）。PLAIN_ROW と wrapped fragment は title / text を転記した。
- quality pass は visual GT の内部整合のみ（row ID 一意・(column, order) 一意・要求番号の連番・ledger 集計との一致・fragment owner の存在・render と member の identity 一致）。annotation correction は 0。parser / H1 との比較・trigger 数え上げはしていない。

## GT の記述統計（GT のみから。H1 trigger の集計はしていない）

| 項目 | 値 |
|---|---|
| page | 25（DIRECT 22 / INHERITED 3）。右 column 使用 6 / blank 19 / ambiguous 0 |
| visual row | 614（REQUEST_NUMBER 303 / MARKER 257 / PLAIN 54）、LEFT 441 / RIGHT 173 |
| wrapped fragment | 3（owner は全て UNIQUE。AMBIGUOUS 0 / NO_SAFE_OWNER 0） |
| 丸囲み要求番号（見えたもの） | 18 |
| unresolved / unreadable | 0 / 0 |

## 限界

GT は同一 agent の作成で独立検証ではない。110dpi の目視転記のため誤読の可能性は残る（自己整合チェックのみ）。新 held-out は #396 の held-out と同じ publisher の別 page を含み得る。positive-trigger の有無は未確認で、0 なら `H1_UNVALIDATED`（#398）。`UNRESOLVED_ACCEPTANCE_THRESHOLD` は未決。GT freeze 後の誤り修正は silent fix せず別 correction protocol。
