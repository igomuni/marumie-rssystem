# 文科省 複数行項名称の source-only continuation — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

**複数行に折り返された項名称に、既存 FieldResolver の凍結済み guard predicate（直下・名称開始 x が揃う・code なし・金額なし）を満たす間だけ名称 continuation を連結した結果、MOF name-only exact coverage は 717 / 784 → 725 / 784（+8）に増加し、既存 717 項の loss は 0 でした（GO）。** 文科省の対象 3 項はすべて回収でき、同じ rule が他 PDF の 5 項も回収した（3 項だけの特殊処理ではない）。

## 1. baseline

前回 after（既存 8.6pt candidate 973 + 内閣府 profile candidate 65 = 1,038）を同じ突合関数で再計算し、717 / 784・unmatched 67・文科省 unmatched 8 と exact 717 の identity を再現（`baseline.json`）。対象 PDF: `mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf`（SHA-256 `6df221df…a6bf71`、1,339 page）。

## 2. 対象 3 項の physical failure class（Phase A、`phaseA-isolation.json`）

| 項（PDF page・code） | 現行の抽出 | continuation 行 | 分類 |
|---|---|---|---|
| p1141・050 | LogicalRow が次の行を `ambiguous`（連結しない）→ `continuation_ambiguous` で名称 abstain | 「施設整備費」 | SUPPORTED |
| p1142・070 | 同上 | 「化振興会施設整備費」 | SUPPORTED |
| p556・230 | 折り返し行が `continuation_by_geometry` に上書きされ、名称が断片「科学技術・学術政策推進」のまま resolved | 「費」 | SUPPORTED |

3 項は物理的に同じ構造: 項の名称が同一の名称セル内で次の行に折り返され、その行は直下（行間 1.0 × 基準フォントサイズ）・名称開始 x が一致（差 0.001pt）・code なし・金額列の token なし、同じ行の右側（x ≈ 470〜480）には別セルの「内容 / 要旨」の説明文が並ぶ。次の行は別項の code 行（p1141 / p1142）または右側の説明文のみの行（p556）で、名称領域に続かない。症状の違い（abstain と断片 resolved）は production の LogicalRow の仕様によるもので、physical failure class は同じ。位置の特定には MOF 名称を使ったが continuation の判定には使っていない。

## 3. preregister した continuation rule（`…Continuation_Preregistration.md`）

既存 8.6pt candidate の logical row L について、同一 page の次の logical row が凍結済みの `observeIncompleteNameGuard`（A: 行間 0.75〜1.5 × 基準フォントサイズ・B: 名称開始 x の差 0.25 × 基準フォントサイズ以内・¬C: code で始まらない・¬D: 金額列に token なし）を満たす間、その行の name 領域内の token（x 昇順）を名称に追記する（右側の別セルは追記しない）。MOF との一致・名称長・意味を終了条件に使わない。新しい閾値を作らない。実装は research lib `budget-request-name-continuation.ts`（production 変更なし）。

## 4. corpus 全体での発火

既存 8.6pt candidate 973 行（63 PDF）に適用し、**発火 9 candidate / 5 PDF**（すべて 1 行追記、最大 1 行）: 文科省 `_03` 3・厚生労働省 `05-1b-01` 3・こども家庭庁系 `20230907_policies_budget_04` 1・農林水産省 `230901-2` 1・財務省 `2024ippan_2` 1。非発火 candidate の名称は byte-equivalent（変化 0）。基底名称の同値性 gate: 発火しない resolved 965 candidate すべてで、本実装の基底名称が production の名称と一致（不一致 0）。発火全件の before name・追記した source text・after name・provenance・guard・continuation token の bbox は `continuation-fired.jsonl.gz`。

## 5. coverage（717 → after）

| metric | before | after | delta |
|---|---:|---:|---:|
| MOF total | 784 | 784 | 0 |
| exact-covered | 717 | 725 | +8 |
| unmatched | 67 | 59 | −8 |
| 文科省 unmatched | 8 | 5 | −3 |
| distinct normalized MOF names covered | 683 | 691 | +8 |

720 を GO 条件にも hard-code にもしていない。実測は +8（対象 3 項 + 他 PDF の 5 項）。

## 6. 新規 exact の全件（`new-exact-matches.jsonl.gz`）

国立美術館施設整備費（`_03` p1141）・日本芸術文化振興会施設整備費（p1142）・科学技術・学術政策推進費（p556）・子ども・子育て支援年金特別会計へ繰入（`20230907_policies_budget_04` p98）・復興事業費等東日本大震災復興特別会計へ繰入（`2024ippan_2` p130）・独立行政法人農業者年金基金運営費（`230901-2` p117）・独立行政法人国立重度知的障害者総合施設のぞみの園運営費 / 施設整備費（`05-1b-01` p1137 / p1139）。発火 9 のうち 1 件（`05-1b-01` p545、原爆死没者追悼平和祈念館施設費）は MOF の未一致項に対応しない（exact 化もしていない）。

## 7. 文科省の残り 5 項と negative evidence

`SOURCE_FULL_NAME_ABSENT` と確認済みの 5 項（防災科学技術研究所・国立青少年教育振興機構・日本原子力研究開発機構・教職員支援機構・日本スポーツ振興センター系の施設整備費）は、after でも exact になっていない（生成 0）。令和 6 年度金額 0 の情報は名称生成・continuation 判定に使っていない。金額 0 を理由に「概算要求に項が無い」とは主張しない。

## 8. regression と validation

lost exact MOF row 0／unrelated PDF の名称変化 0／item code・anchor・deltaX の変化 0／非発火 candidate の名称変化 0／duplicate 0／provenance loss 0（追記 token はすべて page の source token）／source にない文字の補完 0（追記は name 領域の token のみ）。tsc・lint・全 vitest・再実行（after / fired / new-exact とも byte 一致）。production code と `data/download/` の変更なし。

## 主張してよいこと

source 上で項名称セルの continuation と構造的に確認できる複数行名称を連結することで、name-only exact coverage を追加回収できた。まだ主張しない: 金額 0 だから項が PDF に存在しない、文科省未一致 5 項が欠落している、すべての PDF で同じ continuation rule が完全、drawing-path PDF を解決した、full-corpus item extraction が完成した、MOF が PDF の GT である。
