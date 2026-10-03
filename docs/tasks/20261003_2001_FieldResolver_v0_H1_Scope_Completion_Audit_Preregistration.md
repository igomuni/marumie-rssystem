# FieldResolver v0 H1 scope-completion audit 事前登録

2026-10-03。#367（incomplete-name safety guard）の `GO-WITH-SCOPE` に残った未ラベル 38 unit を、PDF を見る前に評価規則ごと凍結する。**このドキュメントの時点で 38 件の PDF 視覚確認・GT 作成・評価は行っていない。**

## 1. Background

- #366: FieldResolver v0 held-out 初回評価。正式判定 **STOP**（false resolved 2）。変更しない。
- #367: guard `A ∧ B ∧ ¬C ∧ ¬D`（既定 off）の P3 凍結評価。判定 **GO-WITH-SCOPE**。guard 発火層に Visual GT の complete が 0 件で、false abstention は未測定。差分母集団 3,365 record のうち guard 発火は 65 件、うち Visual GT 済みは 27 件、未ラベルが 38 件。

## 2. Purpose

未ラベル 38 件を全数 audit し、#367 に残った「発火した 65 件の中に complete があるか」という不確実性を、その母集団の範囲で閉じる（scope-completion audit）。H1 は fresh held-out の汎化試験ではない。

## 3. Non-claims

H1 の結果は次の根拠にしない: 未知 PDF への汎化 / guard 全体の population precision / 全概算要求 PDF の false-abstention rate / recall / cross-page continuation・x 整列を満たさない continuation への安全性 / 2 桁 code 問題・総表 template 問題の解決 / hierarchy 依存 field の汎化 / FieldResolver v0 全体の GO。#366 の STOP も変えない。

## 4. Frozen population

- F = #367 P3 凍結評価と同一の文脈・resolver・guard on/off で name が変化した record 全て（|F| = 65）。
- L = F ∩ P3 の Visual GT 43 unit（|L| = 27。43 unit のうち guard 非発火の 16 件は F に含まれない）。
- U = F \ L（|U| = 38）。identity は `documentKey:page:logicalRowIndex` の完全一致のみ（名称・目視による照合は禁止）。
- 再現は P3 評価 CLI と同一手順（resolver source SHA-256 `758eb8f6…bb224` と凍結成果物の freeze commit `587a477` 一致を確認）。invariant（|F|=65・|L|=27・|U|=38・重複なし・F=L∪U・L∩U=∅）は全て成立。

## 5. P1 worklist freeze

- freeze commit: `caefc6206f85bf9217b307797ea7ae01b7c83bd3`
- path: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-scope-completion-worklist.json`
- SHA-256: `fa9a3abebad3452d0a4bfd761044f83b88427ba1eef2bc7069179155ce57028c`
- 38 unit、unitId 辞書順。各 unit は既存 gt-worklist と同じ locator（unitId / canonicalUrl / physicalPage / code / anchorYPt）のみ。baseline name・guard 出力・predicate 値・reasonCode・stratum は含めない。
- 生成: `scripts/pipeline-v2/build-budget-request-h1-guard-fire-worklist.ts`（集合演算と出力のみ。推論コードは未変更）。静的検証 test あり。

## 6. 仮説 H1

> frozen #367 P3 guard-fire population のうち、P3 時点で Visual GT 未作成だった 38 unit には `complete_on_current_logical_row` が存在しない（全数命題）。

## 7. Visual GT labels

- `complete_on_current_logical_row`: 対象 record の名称は現在の対象行で完結しており、baseline resolution の外側に同一 record の名称として続く追加文字が確認できない。
- `incomplete_continues_below`: baseline resolution の外側に、同一 record の名称として下方へ続く追加文字列が視覚的に確認できる。
- `unclear`: 視覚情報だけでは追加文字列が同一 record の名称の続きか断定できない（名称欄/備考欄の判別不能、同一/次 record の判別不能、罫線・重なり・欠損、ページ境界など）。

## 8. Visual-only evidence rules

使ってよい: 原本 PDF 上で視覚確認できる文字・位置関係・罫線・列・行・code・金額。locator は対象位置を探すためだけに使う。
使わない: extracted text による補完 / baseline name からの推測 / FieldResolver・guard の出力や predicate / reasonCode / difference 計算 / blank→0 / 他ページからの補完 / 一般知識 / 日本語としての自然さ / 括弧の閉じ具合などの字句推測 / #366・#367 の既知結果。見えないものは補わず、所属を断定できなければ `unclear`。

## 9. Blind protocol

GT 作成者に見せる: 原本 PDF、frozen worklist、locator、上記 3 ラベル定義、visual-only 規則。
見せない: baseline name/value、guard on/off 出力、A/B/C/D predicate、発火理由、reasonCode、continuation 候補の extracted text、#367 の unit 別結果、failure 予測、機械による分類。
38 件が guard 発火母集団であること自体は既知のため、完全 blind とは呼ばず「guard-fire reason・machine output に対して blind な Visual GT」と記述する。

## 10. Primary endpoint

`N_complete = count(complete_on_current_logical_row)`。あわせて `N_incomplete`、`N_unclear`、`N_decisive = N_complete + N_incomplete` を記録する。

## 11. GO / STOP / INCONCLUSIVE（H1 専用。#367 の `FAC ≤ 2` 基準は転用しない）

| 判定 | 条件 | 意味 |
|---|---|---|
| GO | `N_complete == 0` かつ `N_unclear == 0` | 38 件に false abstention の反例なし |
| STOP | `N_complete >= 1`（`N_unclear` の有無を問わない） | H1 棄却。guard 廃棄を意味しない |
| INCONCLUSIVE | `N_complete == 0` かつ `N_unclear >= 1` | 反例は未観測だが全数で「completeなし」と確定できない。unclear を後から二値化しない |

## 12. Secondary descriptive metrics

GO/STOP とは独立に保存する: 38 件の `N_complete / N_incomplete / N_unclear / N_decisive`、および既存 27 件と合わせた 65 件の `complete_total / incomplete_total / unclear_total`。後者は「frozen P3 guard-fire population 内の観測分類」と表現し、guard precision とは書かない。

## 13. 計画（本ドキュメントの範囲外）

P3: 38 件の Visual GT 作成・freeze → P4: 評価 → P5: result 記録。いずれも人間レビュー後の別指示で開始する。negative result / STOP / INCONCLUSIVE もそのまま保存する。

## 14. 変更禁止

この事前登録・worklist・判定基準は、38 件の PDF を見た後に変更しない。worklist の差し替えもしない。
