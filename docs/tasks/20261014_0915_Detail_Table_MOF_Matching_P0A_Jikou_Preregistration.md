# 明細表 ↔ MOF 突合 P0-A（`budget-jikou`、事項レベル）— preregistration

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。判定の閾値は設けず、記述的な結果のみ。
前提: 第0段の棚卸し（`…Detail_Table_MOF_Matching_Key_Inventory.md`、#447。ChatGPT レビューで GO）。

## 問い
FY2024 明細表の DETAIL 行（事項）は、MOF `budget-jikou`（一般会計の当初予算、1,256行）と、exact な文字列キーでどの程度結べるか。結べない主因は何か。

## 対象と分母（事前固定）
- 明細表側: `row_type = DETAIL` の全行（1,641行）。各行の所管・会計は、同じ source の `CONTEXT` 行から取る（source ごとに0〜1行）。
- **eligible（主分母）:** 2桁の所管 CONTEXT を持つ source の DETAIL 行。
- **out-of-scope:** 4桁の会計 CONTEXT（特別会計）の source の DETAIL 行。`budget-jikou` は一般会計のみ。unmatched に入れない。
- **context unavailable:** CONTEXT 行が無い source（11）の DETAIL 行。unmatched に入れず、別集計。
- MOF 側: `budget-jikou.jsonl` の全1,256行（旧リポジトリ `data/normalized/mof/fy2024/`）。

## キー（事前固定。これ以外は使わない）
- **J0（lexical baseline）:** 明細表の DETAIL の名称（`NN‑NN ` の後ろ）と `jikouName` の exact 一致。全 DETAIL 行を対象。一致は「同一事項」と確定したことを意味しない。
- **J1（主 candidate key）:** 所管 ＋ 名称の exact 一致。明細表の所管は、CONTEXT 行の `^[0-9]{2}\s+(.+?)所管` の括弧部（例: `29 環境省所管` → `環境省`、`19 内閣府所管（こども家庭庁）` → `内閣府`）。MOF は `ministry`。この抽出は CONTEXT の文法からの構造的な field extraction であり、名寄せではない。抽出できない CONTEXT は context unavailable と同じ扱い（別集計）。eligible 行だけが対象。
- 明細表の名称は、CSV の仕様どおり空白が除かれている。**MOF 側の `jikouName` にも手を加えない。** 空白・全角半角・Unicode・括弧・別名の正規化、部分一致、辞書による対応は禁止。
- **K3（structural diagnostic、join には使わない）:** J1 で候補が1件のペアについて、DETAIL の末尾2桁（`NN‑NN` の後ろの `NN`）と `col4Raw` が exact 一致するかを数える。
- K2（項）・K4・K5 は凍結対象外。金額・部分一致・名寄せ・親子復元は禁止。

## 分類と集計
- 各 DETAIL 行を、候補数で `0 = unmatched / 1 = single exact candidate / 2+ = multi-match` に分類する。multi-match は、金額・項・K3 で解消しない。
- J0 は全 DETAIL 行・eligible・out-of-scope・context unavailable のそれぞれで、J1 は eligible で、集計する。所管別の内訳も出す。
- **逆方向 coverage（別集計）:** `budget-jikou` の各行が、J1 で、明細表のどの DETAIL 行からも候補にならないか、1行から、2行以上から候補になるか。省庁別。
- 補助の記述統計（突合の材料にはしない）: `jikouName` が空白を含む行数、明細表と MOF の所管名の集合（突合前の列挙）。

## 禁止・限界
- 金額は一切使わない（明細表は概算要求、MOF は当初予算で意味が違う）。
- 本段は exact な文字列の重なりの測定で、一致を正しい突合とは解釈しない。名称の重なりがあっても、同一事項かどうかは確定しない。
- 判定は記述のみ。次段（P1: unmatched の原因分類）は、この結果をレビューしてから決める。
