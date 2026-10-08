# FY2024 概算要求 TOC A 層 row assembly — Visual GT Freeze

機械可読な正本: `tests/fixtures/budget-request-toc-row-assembly/2024/`（`ground-truth.json` / `annotation-ledger.json` / `render-manifest.json` / `gt-freeze-manifest.json`、転記元 `visual-gt-source.txt`）。

**本 unit は Visual GT freeze のみ。parser・parser output・評価・rule 変更・B 層は一切行っていない。** judgment = `READY_FOR_TOC_ROW_ASSEMBLY_IMPLEMENTATION`（preregistration と Visual GT が freeze された。次に parser 実装 unit を始めてよい、のみ。formal held-out 評価 GO ではない）。

## 方法

- 対象: #391 で固定した HELDOUT_CANDIDATE 23 page（DIRECT 14 / INHERITED 9、membership digest `8fa5a8a8…a44156`）。差し替え・追加・除外なし。
- 元 PDF は read-only。対象 page を `pdftoppm` 110dpi で render して目視（render は repo に含めず、PNG の SHA-256 のみ `render-manifest.json`）。
- **GT は PDF の視覚のみ**。Raw Text は page identity / hash 照合にのみ使用し、visual field の補完には使っていない。parser は未使用。LEFT/RIGHT は視覚レイアウトで判定し、character index・T=2 は使っていない。
- 記録単位: page（column 構成・右 column の状態）、row（`{pdf}#{page}:{column}:{orderInColumn}`）、fragment（visual owner・一意性・順序・text）。row 種別は見た目の形式のみ（REQUEST_NUMBER_ROW / MARKER_ROW / PLAIN_ROW）。丸囲みは「見えた」事実のみ記録し、復元・推測はしない。page ref は見えた表記のまま。
- 自己整合チェック（visual 内部のみ）: 各 page で要求番号が連番、page ref が page 内で非減少。異常 0。

## 件数（integrity 用の記述統計。評価ではない）

| 項目 | 値 |
|---|---|
| page | 23（右 column に row あり 11 / 右 blank 12） |
| visual row | 834（REQUEST_NUMBER 492 / MARKER 310 / PLAIN 32）、LEFT 556 / RIGHT 278 |
| wrapped fragment | 17（owner は全て visual に一意） |
| 丸囲み要求番号（見えたもの） | 27 |
| unresolved page / row / fragment | 0 / 0 / 0 |
| unreadable field | 0 |

## 新しい visual risk 観測（rule は変更しない）

- 右 column が marker row（項）から始まる page がある（左 column 最終 row の続き）。
- page ref セルに罫線ボックスが見える page がある（mof 2 page）。読みには影響なし。
- 左右同時の wrapped fragment、marker-only の右 column、OTHER_CODE 形式は、この 23 page では観測されなかった（NOT_COVERED のまま）。

## Frozen hashes

SHA-256 は `gt-freeze-manifest.json` に記録（preregistration `0cfec657…2ac8` は不変）。GT 誤りは silent fix せず別 correction protocol / 研究単位で扱う。

## 限界

- 同一 agent が GT を作成し、後続の parser も実装し得る。commit order と hash で leakage を抑えるが独立検証ではない。
- 110dpi の目視転記であり、誤読の可能性は残る（自己整合チェックのみ実施）。
- 23 page の candidate は目視により held-out GT evidence になった。以後 development tuning に使わない。
