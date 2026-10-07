# 概算要求 Page Classification v2 — Closed-Scope Preregistration

classifier 未実装・未評価。v0・v1 の preregistration / candidate / GT / judgment は historical artifact として変更しない（v0 evaluation design: INSUFFICIENT、v1: INSUFFICIENT）。本 doc と candidate fixture を visual GT 作成前に commit する。GT を見た後に seed・strata・cap・threshold・scope を変えない（必要なら STOP）。

## 1. claim / non-claim

**claim**: FY2024 acquired corpus の Raw Text observable pages のうち visual GT が既知 7 form の page について、v0 frozen rule が known-form routing をどの precision / coverage で行えるか。対象はこの corpus・extraction contract・known forms に限定する。router は安全側出力として `UNRESOLVED` を許容する。

**NOT CLAIMED / NOT EVALUATED**: 未知 PDF form の検出能力・OTHER の recall・一般的 open-set safety・FY2024 corpus 外／他年度への generalization・MOJ/FSA fully-EMPTY page や MEXT raster-only p1044 の semantic classification・OCR/Route C でしか観測できない page・項/事項/金額の抽出・MOF 照合。`GT OTHER / UNRESOLVED = 0` でも open-set false-resolved safety = 0 とは書かず、`open-set safety = NOT EVALUATED` とする。

v1 の safety gate を緩めるのではなく、v1 は INSUFFICIENT のまま保存し、v2 は claim 自体を closed-scope に限定した新しい preregistration である。

## 2. v0 classifier specification（変更なし）

DIRECT window は先頭 5 non-empty lines、matcher は `lib/budget-request-page-classification-direct.ts`、vocabulary 9 値、継承は physical PDF 内のみ（TOC/SUMMARY/DETAIL/STAFFING/PRIORITY_* が継承可、COVER/OTHER/UNRESOLVED は不可）、VISUALLY_BLANK 116 は state を変えない blank bridge、nonblank EMPTY・unresolved EMPTY・CONFLICT は state reset。v1 で観測した R1 DETAIL・R5 DETAIL・R7 STAFFING を救うための追加・変更はしない（coverage miss になり得る frozen evidence）。

## 3. 評価集合と独立性

publisher split は新設しない（publisher generalization の評価ではない）。名称は `FROZEN_EVALUATION_V2`（fresh held-out とは呼ばない）。独立性は、v0 GT 172 と v1 GT 89 の `(localPdfPath, physicalPage)` の和集合（unique 261、fixture から機械生成）を candidate から全除外し、v2 GT を classifier 実装・tuning に一切使わないことで確保する。prior GT は key exclusion にのみ使い、semantic label は sampling に使わない。candidate selection の evidence は Raw Text status・page identity・hash・publisher・v0 matcher/state・distance・Phase A category・PDF 境界・行位置・deterministic hash のみ（OCR・Route C・MOF・manifest role・v2 label・人手選別は不使用）。

## 4. strata（GT を見る前に freeze）

seed `budget-request-page-classification-v2-closed-scope-20261007`、hash `sha256("{seed}|{stratum}|{family}|{bucket}|{localPdfPath}|{physicalPage}")` 昇順（該当しない field は空文字）。同一 page は 1 row、strata は配列で保持。

- **A DIRECT_BALANCED_V2**: TEXT_OBSERVABLE・v0 directMatch が単一 known family・prior GT 外。machine-predicted family ごと最大 12（family は prediction metadata であり GT ではない）。
- **B CONTINUATION_BALANCED_V2**: TEXT_OBSERVABLE・NONE・active inheritable state あり・prior GT 外。family（TOC/SUMMARY/DETAIL/STAFFING/PRIORITY_SUMMARY/PRIORITY_DETAIL）× distance bucket（D1=1、D2_5=2..5、D6_20=6..20、D21_PLUS≥21）ごと最大 4。
- **C KNOWN_COVERAGE_RISK_V2**（各最大 12、machine-observable 条件）: C1 NO_ACTIVE_STATE、C2 POST_RESET（RASTER・NO_TEXT_UNRESOLVED・CONFLICT 直後の同一 PDF 最初の TEXT page）、C3 PDF_START_WITHOUT_DIRECT、C4 PRE_DIRECT_TRANSITION（次の TEXT page Q が別 family の DIRECT。Q は条件定義にのみ使い、classifier の look-ahead にしない）。
- **D CORPUS_RANDOM_V2**: 上記に含まれない TEXT_OBSERVABLE・prior GT 外から 48。OTHER/UNRESOLVED を探す sampling ではない。

## 5. evaluation-set adequacy gate（GT freeze 後、classifier より先）

- core family（COVER・TOC・SUMMARY・DETAIL・STAFFING）が visual GT に各 ≥ 10 row。
- DIRECT adequacy: `DIRECT_BALANCED_V2` に属し visual GT が同じ family の row が core 5 各 ≥ 5。
- CONTINUATION adequacy: `CONTINUATION_BALANCED_V2` に属し visual GT が同じ family の row が TOC/SUMMARY/DETAIL/STAFFING 各 ≥ 5（sampling prediction ではなく visual GT family で数える）。
- PRIORITY_* は rare form。pool が閾値未満なら STOP 条件に含めず、pool・sampled・GT 件数を明記し「評価済み」と書かない。
- GT に OTHER/UNRESOLVED が出たら freeze のまま、core count に入れず、将来評価で `OUT_OF_SCOPE_FALSE_RESOLUTION` として別集計。件数 0 でも `open-set safety = NOT EVALUATED`。adequacy に最低 negative 件数は要求しない。
- 判定: ADEQUATE / STOP FOR REVIEW、INSUFFICIENT / STOP（GT を足して閾値を満たそうとしない）、INVALID / STOP。ADEQUATE でも classifier は実装しない。

## 6. 将来の classifier 評価 metric と GO 基準（v2 が ADEQUATE の場合のみ）

WRONG_FAMILY_RESOLUTION（GT known に別 known family を返した件数）、KNOWN_FORM_RESOLVED_PRECISION（正しい known-family prediction / 全 known-family prediction。UNRESOLVED は分母外）、KNOWN_FORM_COVERAGE（known-family prediction / known-form GT row。UNRESOLVED は coverage miss）、EXACT_ACCURACY（参考）、OUT_OF_SCOPE_FALSE_RESOLUTION（GT OTHER/UNRESOLVED に known family。target 0 なら NOT EVALUABLE）。

- GO: WRONG_FAMILY_RESOLUTION = 0・precision 100%・coverage ≥ 95%（GT に OTHER/UNRESOLVED があれば OUT_OF_SCOPE_FALSE_RESOLUTION = 0 も必要）。
- GO-WITH-SCOPE: WRONG_FAMILY_RESOLUTION = 0・precision 100%・coverage < 95%（不足が safe abstention のみ）。open-set generalization は NOT CLAIMED のまま。
- STOP: WRONG_FAMILY_RESOLUTION > 0・precision < 100%・observed OTHER/UNRESOLVED への false resolution > 0・frozen input 不一致・v0 spec 逸脱・test/hash/contamination failure。

## 7. candidate freeze の実測（label 前。機械的観測のみ）

fixture `page-classification-v2-candidates.json`、generator `build-budget-request-page-classification-v2-candidates.ts`（2 回生成で同一）。

- prior GT unique 261、pool（TEXT_OBSERVABLE 8,968 − 261）8,707。candidate **170** row、prior GT overlap 0、duplicate 0、text hash 不一致 0。
- 内訳: A 60（COVER/TOC/SUMMARY/DETAIL/STAFFING 各 12。PRIORITY_* の direct pool は 0）、B 39、C1 12・C4 12、D 48。C2・C3 の pool は prior GT 除外後 0（v1 で使用済み）。
- B の pool 実測: TOC D1 11・D2_5 5・D6_20 0・D21_PLUS 0／SUMMARY 19・27・27・0／DETAIL 63・209・562・7,272／STAFFING D1 の 1 のみ／PRIORITY_DETAIL D6_20 の 2 のみ。
- **label 前の予告**: STAFFING の continuation 候補は pool が 1 件しかなく、sampling 上は STAFFING の CONTINUATION adequacy（≥5）を満たせない。この点で adequacy が INSUFFICIENT になる可能性が高い。閾値・pool は変更せず、結果が INSUFFICIENT なら negative result として保存する。

## 8. 禁止事項

classifier の実装・評価、v0/v1 artifact・rule・negative result の変更や再解釈、GT 後の sampling/threshold/scope 変更、OTHER/UNRESOLVED の手探し、prior GT label の sampling 利用、manifest role の GT 利用、近傍 page からの GT 補完、OCR、Route C、MOF、Summary/Detail parser、項/事項/金額抽出、search index、`data/download/` と PR-1/Phase A fixture の変更。
