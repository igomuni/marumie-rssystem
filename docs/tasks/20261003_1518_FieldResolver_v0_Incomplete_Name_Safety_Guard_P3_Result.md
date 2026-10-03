# FieldResolver v0 — incomplete-name safety guard: P3 実装・凍結評価の結果

## 結論

**事前登録の判定: GO-WITH-SCOPE。** 凍結した 43 unit（視覚 GT: incomplete 27・complete 16）で、guard は incomplete 27 件をすべて `ambiguous` にし（false-resolved incomplete 0、既知の p75 failure 3 件も全件）、complete 16 件は 1 件も abstain させなかった（FAC 0）。不変条件も破れていない。ただし **「G 層（guard が発火する層）の complete が 3 件未満」という事前登録の条件に該当**し、guard が complete な名称を過剰に abstain させるかは**この標本では測れていない**（GT で G 層に complete が 0 件）。そのため GO ではなく GO-WITH-SCOPE。

## 1. objective

P1 で事前登録した guard（`A ∧ B ∧ ¬C ∧ ¬D`）を最小範囲で実装し、P2 で凍結した視覚 GT に対し、事前登録の条件を一切変えずに評価する。名称の復元・結合は対象外。

## 2. frozen inputs

| 項目 | 内容 |
|---|---|
| start HEAD | `587a477`（working tree clean） |
| sample | `incomplete-name-guard-v0/sample.json`、43 unit、sha256 `bffdbd32…0807`（評価の前後で不変） |
| visual GT | `visual-gt.json`、sha256 `dcca2625…efe2`（不変）。complete 16・incomplete 27・unclear 0 |
| 他の凍結物 | 1321 本文・補遺・作業リスト・baseline artifact・LogicalRow のソースは freeze commit の blob と一致（評価 CLI が評価前に検証し、不一致なら実行しない）。P3 は FieldResolver のソースだけを変更 |
| 制限（保持） | 独立した人間のレビューは未実施（`humanReview: pending`）。標本の設計者と GT のラベル付けは同一。p75 の既知 failure の存在は GT 作成者が知っていた。GT の入力に predicate・FieldResolver の出力は使っていない |

## 3. implementation diff

`scripts/pipeline-v2/lib/budget-request-field-resolver.ts` のみ（+72/−2）。

- `FieldResolverInput.incompleteNameGuard?: boolean`（**既定 off**）。
- `observeIncompleteNameGuard(page, layout, row, next, toks, codeIdx)`: 事前登録の predicate をそのまま計算する。
- `guardedName(base)`: 発火時の name（status `ambiguous`、value null、`reasonCode: 'name_continuation_evidence_unmerged'`、`candidates` に断片の evidence を 1 つ。後続行の文字列は入れない）。
- `resolveFields`: name が `resolved` のときだけ guard を評価。**blank 判定の `rowOk` は guard 適用前の name の状態で決める**（blank が unresolved にならない）。
- LogicalRow・SourceToken・TableGeometry・DocumentHierarchy は変更なし。

## 4. exact predicate transcription

record の logical row を L、同じページの次の logical row を S、`ref` = ページの基準フォントサイズ（TableGeometry の値）。

- A: S の先頭 physical row の baseline − L の最終 physical row の baseline ∈ `[0.75·ref, 1.5·ref]`
- B: S の先頭 physical row の最初の非空白 token（visual-x 順）の中心が名称領域にあり、その xMin が L の名称領域内の非空白 token（record の code・要求番号は除く）のいずれかの xMin と `0.25·ref` 以内
- C: S が record の code で始まる（既存の code 観測と同じ判定）
- D: S の非空白 token のどれかの中心が前年度〜増減の列領域（前年度列の左端〜増減列の右端）にある
- 発火 = A ∧ B ∧ ¬C ∧ ¬D。閾値は LogicalRow の既存定数。結果を見た後の変更はない。

## 5. option semantics

off（既定）: 従来と同一。on: 発火した record の name のみ `resolved → ambiguous`。発火しない record・他の field は on/off で byte-identical。

## 6. tests

- 新規 `budget-request-field-resolver-incomplete-name-guard.test.ts`（9）: 発火／A・B・C・D それぞれが偽、閾値の境界（行間 1.5 倍＝10.416pt の内外、x 許容 0.25 倍＝1.736pt の内外）、off（既定）が従来と byte-identical、発火しないページで on/off が全体で byte-identical、発火しても name 以外が不変・blank が unresolved にならない、断片の evidence のみで後続行の文字列を含まない。LogicalRow が最初の `ambiguous` を連鎖で消す形（failure isolation）を合成ページで再現している。
- 新規 `budget-request-incomplete-name-guard-evaluator.test.ts`（5）: 混同行列と、GO/STOP の数値基準の機械的な適用。
- P3-C: guard off で既存の artifact を再生成し、`baseline-artifacts.json` の 21 件の sha1 が**全件一致**。
- 検証: `npx tsc --noEmit` OK／`npm run lint` エラーなし／`npx vitest run` 1,262 tests pass（P2 時点は 1,248）／`npm run build` OK。

## 7. frozen evaluation results（初回の 1 回。再実行・調整なし）

評価は凍結済みの 43 unit・視覚 GT に対し、guard on / off を同じ入力で比較。同じ入力での再実行で出力は byte-identical。

| Visual GT | guard が発火 | 発火しない |
|---|---:|---:|
| incomplete（27） | **27**（safety catch） | 0（false-resolved が残る） |
| complete（16） | 0（FAC） | **16**（維持） |

## 8. preregistered metrics

| 指標 | 値 |
|---|---:|
| false-resolved incomplete（guard 後も resolved） | 0 |
| safety catches | 27 |
| FAC（false-abstained complete） | 0（発火 27 件に対し 0%） |
| preserved complete | 16 |
| guard precision / recall | 100% / 100%（標本上） |
| known p75 failure（`006`／5 行の `011`／世界自然遺産の `011`） | すべて resolved → ambiguous（false-resolved 0） |
| 不変条件の差分（開発用 run・held-out ページ・additional ページの全 record 3,365 件） | name 以外の差 0、name の変化は resolved→ambiguous・value null のみ（発火 65 件。標本の 27 件を含む） |
| development Golden（20 target） | on/off で評価が同一（変化した outcome 0、false resolved 0・wrong source 0・wrong normalization 0） |
| held-out（16 ページ・52 target） | wrong source 0・wrong normalization 0・blank↔zero の取り違え 0。初回の false resolved 2 件のうち名称の切れの 1 件（`moe-p75-line-011-nature-positive.name`）が `ambiguous` になり、残り 1 件（GT locator の転記ミス）は変化なし |

## 9. GO / STOP 判定（事前登録 1321 §12 の機械的な適用）

| 条件 | 結果 |
|---|---|
| safety: known failure の false-resolved = 0 | 満たす（0） |
| safety: FRI ≤ 2 かつ incomplete の 10% 以下 | 満たす（0/27） |
| regression: FAC ≤ 2 かつ 発火数の 10% 以下 | 満たす（0/27） |
| 不変条件（name 以外の差 0、name の変化は resolved→ambiguous のみ、Golden 同一、wrong source/normalization・blank↔zero 0） | 満たす |
| informative（incomplete ≥ 10、unclear ≤ 20%） | 満たす（27、0%） |
| G 層の complete が 3 件以上（guard の過剰を測れる） | **満たさない（G 層の complete は 0 件）** |

→ **GO-WITH-SCOPE**（safety・regression・不変条件を満たし、informative の一部が不足）。

## 10. known limitations

- **FAC が測れていない**: 標本の G 層（発火する層、27 件）は GT でも全件 incomplete で、complete な名称が発火条件に当たるケースが標本に無い。complete の 16 件は guard が発火しない層（直下に整列した行が無い層）から取っており、構造上 FAC は 0 になる。「FAC 0」は guard の過剰が無い証拠ではない。
- **標本と predicate の同型**: 標本の層は guard と同じ predicate で作った。guard の発火と GT の incomplete が 27/27 で一致したのは、「直下に整列した、code も金額もない行」が視覚上も続きの行であることが多い、という性質の確認として読めるが、標本の外での precision は不明。
- **未ラベルの発火**: 評価対象の全 record 3,365 件で guard は 65 件発火した。うち 27 件が標本で、残り 38 件は GT が無い（complete な名称への誤発火があり得るが測っていない）。
- recall の限界: 後続行が直下でない・名称 x が揃わない継続、ページをまたぐ継続は対象外。
- 独立した人間のレビュー未実施、GT の作成者と標本の設計者が同一。

## 11. LogicalRow debt（今回触らない）

連鎖結合で `ambiguous` / `possibleContinuationOfLogicalRow` が上書きされ、継続の可能性の信号が失われる。下位層は凍結で、guard 単独の効果を測るため同時に変えない。直しても、FieldResolver が「信号なし＝完結」と読む脆さは残る。

## 12. human review

pending。レビューで GT の値が変わっても、今回の凍結した評価結果は置き換えず、差分として別記する。

## 13. next-step candidates（結果に基づく案。実装しない）

1. 発火した全 record（65 件）のうち未ラベルの 38 件を視覚 GT 化し、FAC を実測する（GT の作成者・手順を変えた独立レビューを含む）。
2. guard の発火条件に当たる complete な名称が存在するかを、別の母集団（別ページ・別省庁）から事前登録の方法で探す。
3. 独立した人間による視覚レビュー。
4. LogicalRow の継続リスク信号の保持（別実験）。
5. ページをまたぐ継続の guard（別の preregistration）。
