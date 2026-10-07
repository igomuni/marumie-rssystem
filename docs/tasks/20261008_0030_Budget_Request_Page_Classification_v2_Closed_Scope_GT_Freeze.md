# 概算要求 Page Classification v2 — Closed-Scope GT Freeze と adequacy 判定

classifier 未実装・未評価。v0・v1 の artifact と v2 preregistration（commit `ee1f256`）は GT 後も変更していない。claim は FY2024 known-form closed-scope routing に限定し、**open-set safety は NOT EVALUATED / NOT CLAIMED**。

## 判定: INSUFFICIENT / STOP（negative result として保存）

STAFFING の continuation 件数が閾値に達しない。事前登録の STOP 条件どおり、GT を足して閾値を満たそうとしない。

## GT（blind-v2 順で目視。OCR・manifest role・近傍 page・Raw Text・v0/v1 GT は不使用）

| | COVER | TOC | SUMMARY | DETAIL | STAFFING | PRIORITY_SUMMARY | PRIORITY_DETAIL | OTHER | UNRESOLVED |
|---|---|---|---|---|---|---|---|---|---|
| rows（170） | 12 | 23 | 31 | 88 | 14 | 0 | 2 | 0 | 0 |

source hash 不一致 0、text hash 不一致 0、prior GT overlap 0、candidate と 1:1。

## adequacy

- core family（各 ≥10）: COVER 12・TOC 23・SUMMARY 31・DETAIL 88・STAFFING 14 → 充足。
- DIRECT core（各 ≥5）: 5 family とも 12 → 充足。
- CONTINUATION（visual GT が同 family、各 ≥5）: TOC 8・SUMMARY 12・DETAIL 16・**STAFFING 1** → **STAFFING 不足**。
- PRIORITY_*: prior GT 除外後の DIRECT pool は 0、continuation pool は PRIORITY_DETAIL の 2 のみ（sampled 2、visual GT 2、いずれも DETAIL ではなく PRIORITY_DETAIL）。PRIORITY_SUMMARY は 0。評価済みとは扱わない。
- open-set safety: **NOT EVALUATED**。GT の OTHER・UNRESOLVED は 0 件で、`OUT_OF_SCOPE_FALSE_RESOLUTION` は NOT EVALUABLE。

## 観測（label 後。規則変更の根拠にはしない）

- 不足の原因は事前登録時に予告した pool の小ささ（STAFFING の continuation 候補は prior GT 除外後に D1 の 1 件のみ）。FY2024 corpus で STAFFING の continuation（定員表が複数 page に続く例）は prior GT を除くとほぼ存在せず、この corpus・v0 の継承規則では評価集合を構成できない。
- DIRECT・CONTINUATION の全 row で GT が matcher の family／継承されるはずの state family に一致した（観測であり変更根拠にしない）。NO_ACTIVE_STATE の 12 page は DETAIL 11・STAFFING 1、PRE_DIRECT_TRANSITION の 12 page は DETAIL 4・SUMMARY 6・TOC 2 で、全て既知 form（v1 同様、coverage miss になり得る領域であって unsafe ではない）。
- 既知 7 form 外の page は、v0・v1・v2 の計 431 label 中 1 件も見つかっていない。ただしこれは OTHER の不在の証明ではない。

## 含意（次の判断は review 後）

- known-form routing の評価は、STAFFING continuation を除けば v2 GT で実施可能な水準にある。STAFFING continuation を v2 の評価対象から外す／別 scope にする、あるいは評価を継続しない、は事前登録の変更になるため新 version の preregistration として扱う。ここでは決めない。
