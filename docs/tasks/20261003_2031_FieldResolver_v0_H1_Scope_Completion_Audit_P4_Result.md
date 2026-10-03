# FieldResolver v0 H1 scope-completion audit P4 result

## A. Status

P4 完了。**frozen AI Visual GT に基づく H1 evaluation** であり、`humanReview: pending`。

## B. Frozen inputs

- worklist: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-scope-completion-worklist.json`、SHA-256 `fa9a3abe…7028c`、commit `caefc62`
- 事前登録 `4ad66c4`、補遺 `2e7656e`
- AI Visual GT: `…/h1-scope-completion-visual-gt.json`、SHA-256 `3cb9eb9a…1318b9`、commit `3d00e16`

## C. Integrity checks

worklist 38 / GT 38、unitId 集合一致、重複・欠落・余剰 0、ラベルは許可 3 種のみ、worklist・GT の SHA-256 と凍結 commit との一致を機械確認（全 PASS）。

## D. Primary result

| N_complete | N_incomplete | N_unclear | N_decisive |
|---:|---:|---:|---:|
| 0 | 38 | 0 | 38 |

判定: **GO**（事前登録 §11: `N_complete == 0 かつ N_unclear == 0`）。

## E. Decision rationale

事前登録済みの規則を frozen GT に機械的に適用した結果。基準の追加・変更はなく、#367 の `FAC ≤ 2` 基準は使っていない。

> frozen #367 P3 guard-fire population のうち P3 時点で未ラベルだった 38 unit について、frozen AI Visual GT 上は `complete_on_current_logical_row` も `unclear` も観測されなかった。事前登録済み H1 判定は GO。

## F. Secondary descriptive result

既存 27（P3 評価で guard が発火した labeled unit。unitId 完全一致で結合）+ 38 = 65 unit: complete_total 0 / incomplete_total 65 / unclear_total 0（合計 65 を確認）。**frozen P3 guard-fire population 内の観測分類**であり、未知 population の precision 推定ではない。

## G. Claims / non-claims

- H1 は scope-completion audit であり、fresh held-out の汎化試験ではない。
- GO は guard の一般化可能性、false abstention が 0 であること、FieldResolver v0 全体の GO、未知 PDF での安全性を意味しない。human visual classification による確定でもない。
- #366 の STOP は変更しない。#367 の GO-WITH-SCOPE は一般化 GO にしない。
- human review は pending、H2 は未開始。

## H. Next step

human review / H2 / guard 変更等は開始せず、人間レビュー待ち。

- evaluation artifact: `…/h1-scope-completion-p4-evaluation.json`（SHA-256 `015ded4173b3f03b6fb69d43053c447d10f79b5219490fa395fe5cca3ee3e767`）
- 実行: `scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard-h1.ts`（frozen artifact のみを入力とする純粋評価）
