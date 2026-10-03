# FieldResolver v0 H1 human GT freeze

2026-10-03。独立 human validation の reviewer H01 の返却物を、結果評価前に raw response と human GT として freeze する。**ラベル件数は未集計、human-validation status は未判定、AI/human agreement は未評価、H2 は未開始。** AI GT は読み込んでいない。

## 1. Background

HV-P2 事前登録（`54ba20d`）・blindness 補遺と reviewer package（`25b0aab`）に従い、reviewer に 65 unit の worklist・protocol・原本 PDF 7 本の package を渡して分類を得た。

## 2. Raw reviewer response

- 受領ファイル: `20261003_2155_FieldResolver_v0_H1_Human_Review_Results.json`
- SHA-256: `3fa66693676aff229d61e90eb6be52612058a2bd3f0078c5361c7920fa1a8427`
- reviewerId: `H01`、unit 数: 65
- 保全先: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-reviewer-response-H01.json`（byte-identical copy。SHA-256 一致を確認）

## 3. Structural validation（件数集計なし）

frozen worklist（`tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-worklist.json`、SHA-256 `3546e523…6c69`）と unitId 集合が完全一致、重複・欠落・余剰 0、全 unit が `unitId` / `label` / `reviewerType` を持ち、`reviewerType == human`、ラベルは許可 3 種のみ。修正・補完・正規化は一切していない。

## 4. Blindness evidence（実際の状態）

Case B。
- `blindnessEvidenceStatus: user_attested_independent_reviewer`
- `declarationTiming: not_recorded_pre_review`
- `reviewerAuthoredDeclaration: false`
- `protocolDeviation: true`

H01 が初見の第三者であったというユーザー提供の provenance はあるが、reviewer 本人による pre-review declaration は記録されていない（返却物は `reviewerId` と `units` のみ）。この点を protocol deviation として保存し、後知恵で preregistration-compliant とは扱わない。以後の result document でも「fully preregistration-compliant な independent blind validation」と無条件には表現しない。metadata: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-reviewer-metadata.json`（SHA-256 `42c5741e…a2124`）。

## 5. Human GT

- path: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-visual-gt.json`
- SHA-256: `25ca613a3f8fdfd806a60d7c6033109561bbb627719a5324ee3c16746cb514a4`
- raw response の各 unit を `unitId` / `label` / `reviewerType` のまま元の順序で転記した deterministic projection（`scripts/pipeline-v2/build-budget-request-h1-human-validation-gt.ts`）。AI GT・AI result・agreement 情報は含まない。
- integrity test: `budget-request-incomplete-name-guard-h1-human-gt.test.ts`（構造・projection・metadata。件数集計なし）。

## 6. 未実施

label 件数の集計、VALIDATED / CONTRADICTED / INCONCLUSIVE の判定、AI/human agreement・confusion matrix・disagreement、H2 は開始していない。frozen の事前登録・AI GT・H1 P4 result は変更していない。
