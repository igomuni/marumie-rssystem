# 概算要求 Page Classification v1 — Evaluation GT Freeze と adequacy 判定

classifier 未実装・未評価。v0 artifacts・classifier specification・v1 preregistration（commit `4dbc6ca`）は変更していない。

## 判定: INSUFFICIENT / STOP（negative result として保存）

v1 の FROZEN_EVALUATION_V1 GT（89 row、全て目視 label）は評価集合として不十分。規則・閾値は変更しない。

## GT（blind-v1 順で目視。OCR・manifest role・近傍 page・Raw Text・v0 GT は不使用）

| 型 | COVER | TOC | SUMMARY | DETAIL | STAFFING | PRIORITY_* | OTHER | UNRESOLVED |
|---|---|---|---|---|---|---|---|---|
| rows | 8 | 5 | 18 | 56 | 2 | 0 | 0 | 0 |

source hash 不一致 0、text hash 不一致 0、v0 GT overlap 0、candidate と 1:1。

## adequacy

- **Safety: INSUFFICIENT**。SAFETY_NEGATIVE rows 0（閾値 ≥10・domains ≥2・risk strata ≥2 のいずれも未達）。`false-resolved safety = NOT EVALUABLE`。0 件だから false resolved = 0 とはしない。
- **Semantic coverage: INSUFFICIENT**。core の STAFFING が 2（≥5 未達）。continuation/risk 所属の GT row は TOC 1・STAFFING 0（≥3 未達）、SUMMARY 7・DETAIL 16 は充足。PRIORITY_* は publisher-domain limitation により exemption（pool 0）。

## 観測（label 後。規則変更の根拠にはしない）

- risk stratum の pool は R1 299（全て mext）・R2 3・R3 1,087・R4 0・R5 1・R6 0・R7 1。R4 と R6 は corpus に該当 page が無い（R6 は corpus 全体でも 0）。
- R1（active state なし、mext の 3 page）・R5（MEXT p1044 直後）は GT が DETAIL。v0 classifier が UNRESOLVED を返せば coverage miss になる領域であり、safety-negative ではなかった。R7 の mext p1 は STAFFING（先頭 page に title が無い）で、v0 の DIRECT window では取れない領域。
- 全 89 page が既知 7 form のいずれかに目視で収まった。FROZEN publisher 7 社の TEXT_OBSERVABLE 1,563 page（v0 GT 除外後 1,533）の中で、既知 form 外の page は今回の machine-observable な risk condition では見つからなかった。これは「corpus に OTHER が無い」ことの証明ではない。

## 含意（次 version の入力。ここでは決めない）

- FY2024 FROZEN publisher の page population では、safety-negative は label-conditioned でない sampling では得にくい。safety の検証力を得るには、split の見直し（DEVELOPMENT 側 publisher を含める）、他年度・他 corpus、あるいは安全性の定義（既知 form の取り違え＝誤分類を false resolved に含める等）を別研究として設計する必要がある。
- 現 GT でも known-form precision / coverage の測定自体は可能（DIRECT・CONTINUATION・R1〜R3・R5・R7 に既知 form の label がある）。ただし v1 gate は ADEQUATE ではないため、GO 判定には使えない。
