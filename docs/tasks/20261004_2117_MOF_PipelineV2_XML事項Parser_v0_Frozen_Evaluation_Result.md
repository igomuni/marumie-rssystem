# MOF Pipeline V2 XML 事項 Parser v0 — Frozen Evaluation Result

2026-10-04。**first full frozen evaluation。** implementation freeze（commit `b890e74`）の後に初めて、frozen reference projection（1,256 件）との full comparison を実行した。parser・preregistration・oracle・raw XML は変更していない。

## 判定: **GO**

preregistration（commit `2305be0`）§16 の規則を機械的に適用: source-set integrity 一致／94/94 認識／1,256/1,256 出力／missing・extra・duplicate・orphan・ambiguous が 0／必須 field が reference projection と 100% exact／gaiji・qt・fingerprint の期待挙動を全件満たす／fail-closed test が通る。全 condition が真。

## Frozen source / implementation

- preregistration `2305be0`、source set（SHA-256 `62df90fb…afe3`）、reference projection（`e6335ace…15d9`）、hand-checked fixture（`664f0fbe…8fd1`）— 評価前に hash を再計算して一致。
- implementation freeze commit `b890e74`。parser `scripts/pipeline-v2/lib/mof-budget-xml-items.ts`（SHA-256 `1d52634b…1a79`）。評価時の parser source hash は freeze 時と一致（評価 script が確認）。
- 評価は `raw frozen XML → frozen parser → actual → frozen reference projection → exact comparison`。評価 script `scripts/pipeline-v2/evaluate-mof-budget-xml-items-v0.ts` は parser を呼び、reference 生成 script とはロジックを共有しない。

## Population と metrics

| 項目 | 結果 |
|---|---|
| 全 XML | 328 |
| target 認識 | 94 / 94 |
| not_target（正しく事項表と扱わなかった） | 234 / 234（誤認 0、unsupported 0、structural failure 0、silent skip 0） |
| expected / actual records | 1,256 / 1,256（missing 0・extra 0・duplicate 0） |
| 項の割当 exact | 1,256 / 1,256（orphan 0・ambiguous 0） |
| file ごとの行数（項の開始行・事項行・組織計行・説明のみ行） | 94 ファイルとも一致 |

field 別（exact / mismatch）: organization・itemCode・itemName・itemNameLines・requestName・requestNameLines・amountsRaw（col6・col8・col10）・amountsThousandYen（col6・col8・col10）・col4Raw・itemStartsInThisRow・provenance（file・row・page・rowNo）・requestQtCount・requestGaiji・itemQtCount・itemGaiji はすべて **1,256 / 0**。provenance の source SHA-256 は 94 / 0。

特殊構造: gaiji 2 / 2（code 1508・填）、qt 11 / 11（事項名・項名）、known target fingerprint 9 種（3・33・2・1・9・4・9・2・31 ファイル）はすべて全件認識。fail-closed の test（hard failure・not_target・unsupported・hand-checked fixture 29 行を含む 44 件）と全体の vitest は通っている。

## Artifact

`tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-frozen-evaluation.json`（SHA-256 `627b86565f699702057cf70ba70166f88ff6b06f62041ccb51f527a31ddf5da9`）。入力の hash・implementation commit・各 metrics を持ち、mismatch があれば unit locator を保持する形（今回 mismatch は 0 件）。

## Claim boundary

主張できるのは、「FY2024 一般会計 当初予算 `202411001` の frozen XML source set に対し、preregistered rule を実装した production XML 事項 parser v0 が、frozen reference projection と事前登録された全 acceptance criteria を満たした」まで。特別会計・補正予算・他年度・MOF XML 全体への一般化、col4 の意味の確定、PDF との対応、概算要求 PDF との match key、V2 production schema への統合は主張しない。

## Known limitations

reference projection は独立 human GT ではなく、parser とは独立に実装前に生成した research extraction（同一人物による別実装の一致であり、共通の誤読が両方にあれば検出できない）。hand-checked fixture は AI による原文との目視照合。評価は 1 つの帳票だけで、col11（説明）・組織計行は出力していない。V1 の生成物は oracle に使っていない。

## 次の phase（未開始）

fresh held-out（特別会計・補正予算など）の population を parser の出力を見る前に凍結する別 phase、V2 への事項の公開方法の設計は、いずれも別指示。production schema への統合・PDF×MOF 照合は今回開始していない。
