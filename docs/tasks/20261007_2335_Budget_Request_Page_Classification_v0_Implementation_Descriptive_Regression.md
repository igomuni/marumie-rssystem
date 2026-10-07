# 概算要求 Page Classification v0 — Implementation と Descriptive Regression

frozen v0 specification の literal implementation（commit `dc82479`）と、v3 cumulative benchmark 431 row に対する記述的 regression。**research validation でも fresh held-out GO でもない。**

## 歴史的結果（不変）

- v0 / v1 / v2 evaluation design: いずれも INSUFFICIENT（v1・v2 は INSUFFICIENT / STOP）。
- v3 cumulative benchmark: mechanical adequacy observation = PASS、formal judgment = **INVALID / STOP**（preregistration freeze 前に結果を観測）。431 row は post-hoc / descriptive benchmark。
- open-set safety: **NOT EVALUATED**（GT OTHER/UNRESOLVED = 0 のため open-set false-resolution は計算不能）。

## 実装

- rule の source は **frozen v0 specification のみ**（v0 preregistration と frozen matcher `lib/budget-request-page-classification-direct.ts`）。v1/v2/v3 は rule の source にしていない。
- Phase A の isolation category は、v0 preregistration が定義する runtime 入力（「PR-1 の Raw Text と Phase A の EMPTY-page observation のみを使う」）として使用。VISUALLY_BLANK は NO_TEXT かつ state 不変（bridge）、RASTER・fully-EMPTY・Phase A に無い EMPTY は NO_TEXT かつ state reset、CONFLICT は UNRESOLVED（source=null）かつ reset、COVER は state を持たない。OTHER は出力しない。
- 出力は raw text availability / classification status（RESOLVED / UNRESOLVED / NO_TEXT）/ semantic page type を分離。NO_TEXT の page に semantic type は付けない。
- **implementation 後の GT-conditioned tuning = NONE**。431 GT は commit 1 の後に初めて読んだ。

## full corpus（実測）

9,899 page、raw EXTRACTED 8,968 / EMPTY 931。RESOLVED 8,667（DIRECT 312・INHERITED 8,355）、UNRESOLVED 301（全て NO_ACTIVE_STATE）、NO_TEXT 931（VISUALLY_BLANK 116・RASTER 1・fully-EMPTY 814）。page type: DETAIL 8,291・SUMMARY 164・TOC 82・COVER 69・STAFFING 49・PRIORITY_DETAIL 11・PRIORITY_SUMMARY 1。bridge された blank は 71 page。corpus classification digest `39464fc7…`、2 回生成で同一、page 欠落・重複 0。

## conformance（GT を見ずに実施）

v0/v1/v2 の candidate fixture に freeze 済みの machine observation（directResult / activeStateFamily）と実装出力を照合: v0（direct 62・state 46）・v1（29・49）・v2（62・93）で mismatch 0。physical PDF 境界・page 順序・hash・COVER/OTHER 非継承・CONFLICT・blank bridge・reset・no look-ahead は unit test で確認。

## 431 descriptive regression

| | rows | resolved | abstained | coverage | precision | wrong-family |
|---|---|---|---|---|---|---|
| overall | 431 | 403 | 28 | 93.5% | 100% | **0** |
| DIRECT subset | 150 | 150 | 0 | 100% | 100% | 0 |
| CONTINUATION subset | 101 | 101 | 0 | 100% | 100% | 0 |
| v0 DEVELOPMENT | 142 | 142 | 0 | 100% | 100% | 0 |
| v0 FROZEN_EVALUATION | 30 | 28 | 2 | 93.3% | 100% | 0 |
| v1（FROZEN_EVALUATION_V1） | 89 | 78 | 11 | 87.6% | 100% | 0 |
| v2（FROZEN_EVALUATION_V2） | 170 | 155 | 15 | 91.2% | 100% | 0 |

GT family 別: COVER 32/32・TOC 50/50・SUMMARY 74/74・PRIORITY_* 12/12・STAFFING 30/32・DETAIL 205/231。**abstention 28 件は全て `UNRESOLVED:NO_ACTIVE_STATE`**（DETAIL 26・STAFFING 2）。これは v1/v2 の risk stratum（NO_ACTIVE_STATE・PDF 先頭で DIRECT なし等）に由来する safe abstention で、wrong-family ではない。v0 DEVELOPMENT が 100% なのは、そこが frozen spec の設計に最も近い sampling だったことと整合する観測であり、検証の根拠ではない。

「431 のうち 0 件が誤り」は、既知 7 form に限った記述的観測で、validated を意味しない。

## engineering judgment

**IMPLEMENTATION_CONFORMANT / STOP FOR REVIEW**（frozen spec 変更なし・conformance 0 mismatch・決定的・hash mismatch 0・page 欠落重複 0・wrong-family 0）。coverage 93.5% は報告値であり、不足分は全て abstention。

## downstream scope

次工程で routing primitive として使用可能: Raw Text page → conservative page family routing → Cover / TOC parser selection。ただし page family prediction は PDF の semantic correctness・open-set safety・事項抽出の正しさ・MOF 照合の正しさの保証ではない。fresh held-out validation: NO、open-set validation: NO。次工程は原則 Cover + TOC Structure（Detail Structure は後回し）。
