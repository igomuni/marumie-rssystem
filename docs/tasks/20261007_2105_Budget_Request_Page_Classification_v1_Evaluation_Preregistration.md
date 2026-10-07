# 概算要求 Page Classification v1 — Evaluation Design Preregistration

classifier 未実装・未評価。v0（preregistration `b4c4012`・GT `ca1c9c9`）は historical artifact として変更しない。v0 の classifier specification（vocabulary・DIRECT 先頭 5 行 matcher・継承規則・blank bridge・reset）も変更しない。本 doc と candidate fixture を visual GT 作成前に commit する。GT を見た後に規則・seed・cap・threshold を変えない（必要なら STOP）。

## 1. 動機（v0 の methodological negative result）

v0 GT は 172 row（FROZEN_EVALUATION 30、DETAIL・PRIORITY_* の continuation 0）、GT UNRESOLVED 0・OTHER 0。したがって v0 の `false resolved = 0` は対象 GT が無いため常に 0 であり、安全性の実証ではない。v1 は評価集合だけを新設する。

## 2. research question

> v0 classifier specification を変更せず評価するとき、v0 GT で不足した semantic-family coverage と false-resolved safety challenge を、label-conditioned sampling をせずに検証できる FROZEN_EVALUATION set を構成できるか。

classifier accuracy は測らない。まず評価集合が評価に十分かを判定する。

## 3. split と呼称

- split は sampling より先に固定: v0 candidate fixture の `publisherAssignment` をそのまま再利用（FROZEN: cao・fsa・mext・moj・ppc・reconstruction・sangiin）。publisher の手動移動なし。
- v1 の新規 GT candidate は FROZEN publisher の TEXT_OBSERVABLE page のみ。v0 GT 172 key は v1 candidate から全て除外（state の機械計算では通常 page として通過）。
- 呼称は `FROZEN_EVALUATION_V1`。corpus は探索・v0 GT を受けているため fresh held-out とは呼ばない。意味は「preregistration / candidate freeze 後、classifier 実装・tuning に使わない新規 visual GT page」。

## 4. candidate selection に使う evidence

許可: frozen Raw Text status・`nonEmptyLines`・page identity・publisherDomain・v0 matcher の結果・v0 継承規則の機械適用結果（state・family・distance）・Phase A category・PDF 境界・title literal の行位置・hash。禁止: v1/v0 の visual label、manifest role、MOF、OCR、Route C、人手の semantic 判断・目視選別・filename/publisher 名による手選び。

state machine は v0 §5 と同じ（DIRECT で更新、COVER は state を持たない、Phase A VISUALLY_BLANK は bridge、RASTER・fully-EMPTY・CONFLICT は reset）。

## 5. strata（GT を見る前に freeze）

hash: `sha256("{seed}|{stratum}|{localPdfPath}|{physicalPage}")` 昇順。seed `budget-request-page-classification-v1-eval-20261007`。stratum tag は family・bucket を含む（例 `DIRECT_BALANCED/COVER`、`CONTINUATION_BALANCED/DETAIL/d3-5`、risk は stratum 名）。同一 page は複数 strata に属してよく、GT row は 1 件。

- **A DIRECT_BALANCED**: FROZEN・TEXT_OBSERVABLE・v0 directMatch=DIRECT・v0 GT 外。family ごと hash 順で最大 8（全 7 family。pool が小さければ全件）。
- **B CONTINUATION_BALANCED**: FROZEN・NONE・active inheritable state あり・v0 GT 外。family（6）× distance bucket（d1 / d2 / d3-5 / d6+）ごと最大 2。active state family は sampling metadata であり GT ではない。
- **risk strata R1〜R7**（machine-observable な条件のみ。OTHER/UNRESOLVED を狙った sampling ではない）。各 stratum は「publisherDomain ごとに hash 順で先頭 3 件 → 全体を同 hash 順 → 先頭 24」。
  - R1 NO_ACTIVE_STATE: NONE かつ active state なし。
  - R2 PRE_DIRECT_TRANSITION: NONE・active state あり、同一 PDF の次の TEXT_OBSERVABLE page Q（VISUALLY_BLANK は skip、その他の EMPTY で打ち切り）が DIRECT かつ family ≠ active family。Q は条件定義にのみ使い、classifier の look-ahead rule にしない。
  - R3 LONG_INHERITANCE_TAIL: NONE・active state あり・TEXT_OBSERVABLE distance ≥ 20。先に family ごと hash 順で最大 6 を選び、その集合に上記 cap を適用。
  - R4 POST_BLANK_BRIDGE: VISUALLY_BLANK を 1 枚以上挟み、blank 前に active state があり、blank 後最初の TEXT_OBSERVABLE page が NONE（blank 自身は候補にしない）。
  - R5 POST_RESET: RASTER・fully-EMPTY・CONFLICT の reset event 直後、同一 PDF で最初の TEXT_OBSERVABLE page。
  - R6 TITLE_OUTSIDE_DIRECT_WINDOW: 先頭 5 行では NONE だが non-empty line 6〜20 に v0 title literal がある（v0 matcher と同じ検出器）。line 6〜20 は classifier rule に追加しない。
  - R7 PDF_START_WITHOUT_DIRECT: PDF の最初の TEXT_OBSERVABLE page が NONE。
- **C CORPUS_RANDOM_V1**: 上記に含まれない FROZEN・TEXT_OBSERVABLE・v0 GT 外から hash 順 32。補助であり safety の主手段ではない。

## 6. evaluation-set adequacy gate（GT freeze 後に判定。classifier より先）

- SAFETY_NEGATIVE = GT `OTHER` または `UNRESOLVED`。将来 classifier が既知 7 family を出せば false resolved。
- **Safety adequacy**: SAFETY_NEGATIVE rows ≥ 10 かつ publisherDomains ≥ 2 かつ risk strata（R1〜R7、複数 membership は全て数える）≥ 2。1 つでも欠ければ insufficient、rows == 0 なら `false-resolved safety = NOT EVALUABLE`（「0 件だから false resolved = 0」としない）。
- **Semantic coverage adequacy**: core 5 family（COVER・TOC・SUMMARY・DETAIL・STAFFING）が GT に各 ≥ 5 row。TOC・SUMMARY・DETAIL・STAFFING は CONTINUATION_BALANCED または R2/R3/R4 所属の GT row が各 ≥ 3。PRIORITY_* は publisher-domain limitation により exemption（core 5 の不足は exemption にしない）。
- 判定: ADEQUATE / STOP FOR REVIEW、INSUFFICIENT / STOP、INVALID / STOP。ADEQUATE でも classifier は実装しない。

## 7. 将来の classifier 評価（今回は実施しない）

v0 GO 基準は historical として維持。v1 が ADEQUATE の場合に限り: known-form resolved precision（正しい resolved / known-family prediction）、coverage（resolved / known-family GT row）、false resolved（GT OTHER/UNRESOLVED に known 7 family）、safety-negative false-resolved rate（false resolved / SAFETY_NEGATIVE rows）を報告し、false resolved = 0・precision 100%・coverage ≥ 95% を GO の必要条件とする。coverage 不足のみは GO-WITH-SCOPE 候補。

## 8. candidate freeze の実測（label 前。機械的観測のみ）

fixture `page-classification-v1-eval-candidates.json`、generator `build-budget-request-page-classification-v1-eval-candidates.ts`（2 回生成で同一）。

- FROZEN TEXT_OBSERVABLE 1,563、v0 GT 除外後の pool 1,533。candidate 89 row、v0 GT overlap 0、duplicate 0、text hash 不一致 0。
- 内訳: DIRECT_BALANCED 28、CONTINUATION_BALANCED 16、R1 3、R2 3、R3 6、R4 0、R5 1、R6 0、R7 1、CORPUS_RANDOM_V1 32。
- pool 実測: R1 299（全て mext）、R2 3、R3 1,087、R4 0、R5 1、R6 0（corpus 全体でも 0）、R7 1。PRIORITY_* の pool は 0、STAFFING の direct pool は 1・continuation pool は 0、TOC continuation は d1 の 1 件のみ。
- 予告（label 前の観測）: 上記 pool から、safety / semantic coverage の gate が満たされない可能性が高い。その場合も規則・閾値は変更せず、INSUFFICIENT を negative result として保存する。

## 9. 禁止事項

classifier 実装・評価、v0 artifact の変更、GT 後の sampling/threshold/seed 変更、GT label を使った selection、OTHER/UNRESOLVED の手探し、publisher の手動移動、manifest role・近傍 page による GT 補完、look-ahead や line 6〜20 検索の classifier 化、OCR、Route C、MOF、frozen fixture・`data/download/` の変更。
