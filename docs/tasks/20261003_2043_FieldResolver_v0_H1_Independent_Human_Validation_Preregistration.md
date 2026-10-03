# FieldResolver v0 H1 independent human validation 事前登録

2026-10-03。H1 の frozen AI Visual GT を、独立した human reviewer による全数分類で検証するための対象・blind 条件・判定規則を、**reviewer が PDF を見る前に**凍結する。**65 件の PDF 目視、human label 作成、AI/human 比較は行っていない。**

## 1. Background

#366 held-out は STOP、#367 の guard は GO-WITH-SCOPE。H1 は #367 の guard 発火 65 unit のうち未ラベルだった 38 unit を全数 audit した。

## 2. Frozen H1 result（不変）

frozen AI Visual GT に基づく H1 evaluation の事前登録済み判定は **GO**（commit `b8c71b2`）。`humanReview: pending`。

## 3. Purpose

frozen #367 P3 guard-fire population 65 unit を、AI GT を参照しない独立 human reviewer が同一の visual-only 3 ラベル規則で全数分類し、frozen AI Visual GT の validation evidence を得る。H1 の再実験でも、H1 P4 GO の書換えでも、fresh held-out の汎化試験でも、guard 改修実験でもない。

## 4. Non-claims

結果は guard の一般化可能性・未知 PDF での安全性・FieldResolver v0 全体の GO の根拠にしない。human review 1 名分の証拠であり、複数 reviewer 間の一致は扱わない。

## 5. 65-unit population

F = #367 frozen P3 guard-fire population（65）、L27 = P3 評価で guard が発火した labeled unit（27）、U38 = H1 worklist（38）。H = L27 ∪ U38 = F、L27 ∩ U38 = ∅。identity は `unitId = documentKey:page:logicalRowIndex` の完全一致のみ。標本抽出はせず全数を対象にする。

## 6. Human-review worklist（HV-P1 freeze）

- path: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-worklist.json`
- SHA-256: `3546e523b8982c863dad51b889d0cb07dd978a529e20bcc70a12ef5eb8226c69`
- freeze commit: `a58e83f430dc74cda334eafef73f8c5aee5dead0`
- 65 unit、unitId 辞書順（旧 27 / 新 38 の区別・AI label 順で並べない）。locator（unitId / documentKey / canonicalUrl / physicalPage / code / anchorYPt）のみ。
- machine provenance は別ファイル `h1-human-validation-provenance.json`（SHA-256 `6b216113…d7f0`）。reviewer には渡さない。

## 7. Source PDF inventory

worklist 内 `sources` に、7 本の原本（cfa 3 / env 7 / maff 5 / meti 38 / mhlw 1 / mlit 6 / mod 5 unit）の canonicalUrl・local path・SHA-256・page count・unit 数を記録（合計 65）。原本は `data/download/`、変更しない。

## 8. Blind protocol

reviewer に渡すのは locator・原本 PDF・3 ラベル定義・visual-only 規則のみ。AI label、H1/#367 の visual GT、baseline name/value、FieldResolver・guard の出力、A/B/C/D、発火理由、reasonCode、continuation 候補、既知 failure、AI 説明、AI/human agreement、旧 27 件の「正解例」提示は見せない。review instructions に AI GT へのリンクを含めない。65 件が guard 発火母集団であること自体は既知で、個々の発火理由は見せない。

## 9. 3 labels

H1 事前登録（`4ad66c4`）+ 補遺（`2e7656e`）と同じ操作的意味。`complete_on_current_logical_row`（当該行で完結し、直下に同一名称の続きが無いと視覚的に判断できる場合のみ）/ `incomplete_continues_below`（直下に同一名称として続いていると視覚的に判断できる）/ `unclear`（対象は特定できるが継続の有無・所属を断定できない。推測が必要なら unclear）。

## 10. Visual-only evidence rules

許可: 原本 PDF、worklist、locator、PDF 上で見える文字、行・列・罫線・位置関係・code・金額、単純な拡大、170 dpi render。禁止: AI GT、baseline、guard 出力、extracted text、OCR、reasonCode、A/B/C/D、一般知識、日本語としての自然さによる推測、他ページの類似名称、AI の説明。

## 11. Human-validation status rule（review 開始前に凍結）

`H_complete` / `H_incomplete` / `H_unclear` / `H_decisive`（= complete + incomplete）を 65 件で算出し、合計 65 を確認する。

| status | 条件 |
|---|---|
| VALIDATED | `H_complete == 0` かつ `H_unclear == 0`（65/65 が incomplete） |
| CONTRADICTED | `H_complete >= 1`（H1 GO を削除せず、AI GT と human evidence の矛盾を別 result として保存） |
| INCONCLUSIVE | `H_complete == 0` かつ `H_unclear >= 1`（unclear を除外して VALIDATED にしない） |

結果ごとの禁止: VALIDATED でも H1 を fresh held-out に読み替えず、guard を default ON にせず、H2 を省略しない。CONTRADICTED でも AI GT・H1 P4 result・human GT を書き換えず、不一致 PDF をその場で再判定せず、guard 修正へ直行しない。INCONCLUSIVE でも unclear を除外・二値化しない。

## 12. Planned human GT freeze

予定 path: `…/h1-human-validation-visual-gt.json`（各 unit に `unitId` / `label` / `reviewerType: human`、必要なら review metadata）。AI GT はコピーしない。status は GT freeze 後に機械的に算出する。

## 13. Planned AI/human agreement evaluation

human GT を freeze するまで AI GT とは比較しない。freeze 後の別 phase で exact agreement count・rate、3×3 confusion matrix、disagreement 件数と unitId を算出する。review 中に agreement を表示しない。

## 14. Blind violation handling

reviewer が AI 結果を偶然見た場合は blind violation として何を・どの unit について・いつ見たかを記録し、勝手に続行せず停止して人間レビューに委ねる。

## 15. Immutability

frozen AI Visual GT（`3cb9eb9a…1318b9`、commit `3d00e16`）と H1 P4 result（commit `b8c71b2`、artifact `015ded41…e3e767`）は不変。human validation の結果が何であっても上書きしない。human validation と H2 generalization、guard 改修は混ぜない。
