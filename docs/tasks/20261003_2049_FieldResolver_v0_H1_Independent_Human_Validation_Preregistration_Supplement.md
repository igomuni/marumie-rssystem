# FieldResolver v0 H1 independent human validation 事前登録の補遺（reviewer blindness）

2026-10-03。HV-P2 事前登録（commit `54ba20d`、`20261003_2043_…_Preregistration.md`）の freeze 後に判明した reviewer blindness 上の抜けを、**human review 開始前に**閉じる。`54ba20d` は変更しない。**human reviewer による PDF 目視・human GT 作成・AI/human 比較は行っていない。**

## 1. Why this supplement exists

H1 P4 で観測・freeze された集計は、65 unit すべてで同一の結果だった。このため、集計結果を知ること＝個々の 65 unit の AI ラベルを事実上知ること、になる。unit-level の AI GT を直接見ていなくても、この集計を知る人は independent blind reviewer として不適格である。

## 2. 本補遺は 54ba20d を変更しない

population（65 unit）、3 ラベルの定義、VALIDATED / CONTRADICTED / INCONCLUSIVE の規則、AI Visual GT、H1 P4 の GO はいずれも不変。本補遺は blindness の明確化のみ。

## 3. Reviewer eligibility

適格な reviewer は、human GT を freeze する前に次のいずれも見ていない人: H1 AI Visual GT / #367 既存 Visual GT の 65 対象 unit に関するラベル / unit-level の AI ラベル / H1 P4 の unit-level evaluation / AI・human の一致情報 / **H1 P4 の集計結果（AI の 3 ラベル別合計）** / それと同義の「AI は 65 件すべてを同じ分類にした」という情報 / 個々の unit の AI 分類を推測可能にする情報。

## 4. Aggregate-result blindness requirement

AI GT の集計結果が全 unit 同一なので、**集計結果を知っている reviewer は blind ではない**。

## 5. Ineligible reviewer

次は今回の independent blind reviewer に使わない（能力や誠実性の問題ではなく blindness eligibility の問題）: H1 P4 result を読んだ研究担当者 / H1 P4 result を知っているユーザー本人 / この研究履歴を読んで集計を知っている AI agent・Sonnet session / H1 P3・P4 を実行して AI GT または集計を知った担当者 / review 開始前に AI の結果を誤って見た人。

## 6. Reviewer declaration

review 開始前に reviewer 自身が、reviewer protocol §2 の declaration（AI ラベル・集計・一致情報・個別分類を示す文書のいずれも見ていないこと、与えられた PDF・locator・分類規則のみで分類すること）を確認し、匿名の reviewer ID とともに記録する。human GT artifact とは別 metadata として保存してよい。氏名は repository に保存しない。

## 7. Blind violation handling

reviewer が禁止情報を開始前または途中で見た場合: (1) 何を見たかを記録する (2) その reviewer の結果を independent blind validation として扱わない (3) human GT を AI GT に合わせて修正しない (4) 別の eligible reviewer を用意するかは人間レビュー後の別判断 (5) 「影響はない」と自己判断して続行しない。誤閲覧が 1 unit だけでも同様。

## 8. Human-facing package contents

reviewer に渡すのは次のみ。repository 全体は渡さない。
1. `h1-human-validation-worklist.json`
2. reviewer protocol
3. 原本 PDF 7 本（cfa 3 / env 7 / maff 5 / meti 38 / mhlw 1 / mlit 6 / mod 5 unit、計 65）
4. package manifest

## 9. Forbidden package contents

`h1-human-validation-provenance.json` / `h1-scope-completion-p4-evaluation.json` / `h1-scope-completion-visual-gt.json` / #367 `visual-gt.json` / P4 result document / AI 結果を推測可能にする P3 関連文書 / repository 全体 / git history / AI GT を含む tests/fixtures 一式。

## 10. Frozen reviewer-facing artifacts

- reviewer protocol: `docs/tasks/20261003_2048_FieldResolver_v0_H1_Human_Reviewer_Protocol.md`、SHA-256 `6c9d40cf6a24c4998cdc0e3b339b97f66439f6593940e42c76a4380eb7b9993d`（AI 結果を一切含まない）
- worklist: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-worklist.json`、SHA-256 `3546e523b8982c863dad51b889d0cb07dd978a529e20bcc70a12ef5eb8226c69`（commit `a58e83f`、65 unit・変更なし）
- package manifest: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-package-manifest.json`、SHA-256 `33d2b5d1a01a6edb78e4826ebb07ff66ea20732cd7ffa15a25ccb63345fd59df`（原本 7 本の canonicalUrl・reviewer 用 filename・SHA-256・page count・unit 数。AI の label・result は含まない）
- staging / leakage 確認: `scripts/pipeline-v2/stage-budget-request-h1-human-review-package.ts`（repository 外の dir に worklist・protocol・manifest・原本コピーを組む。PDF 本文は開かず hash のみ。コミット・外部送付はしない）と、reviewer 向け 3 ファイルに AI 結果・machine output が含まれないことの test。

## 11. Unchanged

population / labels / VALIDATED・CONTRADICTED・INCONCLUSIVE 規則 / AI GT / H1 P4 の GO はすべて不変。

## 12. Status

human review は開始していない。reviewer への package 送付も行っていない。
