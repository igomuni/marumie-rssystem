# FieldResolver v0 H1 human validation result

## A. Status

human GT（reviewer H01、commit `13c7e76`）に事前登録の status 規則を機械適用し、その後に frozen AI GT との agreement を算出した。PDF の再確認・GT 修正・guard 修正はしていない。

## B. Frozen inputs

human GT `25ca613a…14a4`、raw response `3fa66693…8427`、reviewer metadata `42c5741e…2124`、human worklist `3546e523…6c69`、H1 AI Visual GT（38 unit）`3cb9eb9a…18b9`、#367 Visual GT `dcca2625…efe2`（hash はすべて評価前に一致を確認）。

## C. Human counts と status（human GT のみから算出）

| H_complete | H_incomplete | H_unclear | H_decisive |
|---:|---:|---:|---:|
| 0 | 65 | 0 | 65 |

**preregistered status rule mechanically yields VALIDATED**（`H_complete == 0 かつ H_unclear == 0`）。

## D. Blindness 手続きの状態（status とは別）

Case B。H01 は初見の第三者であることがユーザーにより確認されている（`user_attested_independent_reviewer`）が、reviewer 本人の pre-review declaration は記録されていない（`declarationTiming: not_recorded_pre_review`、`reviewerAuthoredDeclaration: false`、`protocolDeviation: true`）。したがって、これは事前登録どおりの手続きを完全に満たした blind validation とは表現しない。status 規則は変更していない。

## E. AI/human agreement

AI 側 65 unit は frozen artifact のみから再構成（L27 = #367 P3 評価で guard が発火した labeled unit 27、U38 = H1 AI Visual GT 38、重複なし、unitId の完全一致で human GT と同一集合）。

- exact agreement: 65 / 65（rate 1.0）
- 3×3 confusion（human 行 × AI 列）: incomplete×incomplete = 65、他の 8 セルはすべて 0
- disagreement: 0 件（unitId なし）

AI 側の label 件数は complete 0 / incomplete 65 / unclear 0（H1 P4 の secondary 結果と同じ）。

## F. Claims / non-claims

- 言えること: frozen P3 guard-fire population 65 unit について、reviewer H01 の human 分類は frozen AI Visual GT と全件一致し、事前登録の status 規則は VALIDATED を与えた。
- 言えないこと: guard の一般化可能性、未知 PDF での安全性、FieldResolver v0 全体の GO、複数 reviewer 間の一致、reviewer 本人の事前 declaration を伴う完全な blind validation。reviewer は 1 名（H01）のみ。
- H1 P4 の GO・#366 の STOP・#367 の GO-WITH-SCOPE は変更していない。H2 は未開始。

## G. Artifacts

- evaluation: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-evaluation.json`（SHA-256 `a8fd4767b360c51bfddf647413e1f413688526a0b0c4c2e5b9c6e600b7f39052`）
- 実行: `scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard-h1-human.ts`（frozen artifact のみ入力。human のみで status を確定してから AI 側を読む）

## H. Next step

H2 / guard 変更 / 追加 reviewer 等は開始せず、人間レビュー待ち。
