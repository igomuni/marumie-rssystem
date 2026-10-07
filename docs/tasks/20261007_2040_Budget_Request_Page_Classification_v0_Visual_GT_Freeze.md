# 概算要求 Page Classification v0 — Visual GT Freeze

classifier 未実装・未評価。preregistration（commit `b4c4012`）の後に作った GT の記録。preregistration doc と candidate fixture は GT 作成後も変更していない。

## 作り方

- 対象: candidate 172 row（`page-classification-v0-candidates.json`）。全 row を 80dpi PNG に render。
- blind 順: `sha256("blind|{localPdfPath}|{physicalPage}")` 昇順の連番で 1 枚ずつ目視。stratum・split・path・Raw Text・manifest role・前後 page・MOF は見ずに label（OCR 不使用）。
- label: 7 form の見た目（title・表の列構成・ヘッダ）で判断。title が無い continuation も page 自身の列構成から form を付けた（INHERITED rule のコピーではない）。迷う page は UNRESOLVED の予定だったが該当なし。
- 凍結: `tests/fixtures/budget-request-page-classification/2024/page-classification-v0-visual-gt.json`、取り込み script `scripts/pipeline-v2/freeze-budget-request-page-classification-visual-gt.ts`。

## 結果（実測）

| | DEVELOPMENT | FROZEN_EVALUATION |
|---|---|---|
| rows | 142 | 30 |
| COVER | 8 | 4 |
| TOC | 18 | 4 |
| SUMMARY | 21 | 4 |
| DETAIL | 71 | 16 |
| STAFFING | 14 | 2 |
| PRIORITY_SUMMARY / PRIORITY_DETAIL | 1 / 9 | 0 / 0 |

- UNRESOLVED 0、OTHER 0。source PDF hash 不一致 0、text hash 不一致 0。
- stratum 別: DIRECT 62（全 family で GT = matcher family）、CONTINUATION 46（全 row で GT = 継承されるはずの state family）、CORPUS_RANDOM 64（DETAIL 63・SUMMARY 1）。
- DIRECT・CONTINUATION で GT と matcher/state が全件一致したのは観測であり、matcher・rule の変更根拠にしない。

## limitation（GT 後に判明。規則は変更しない）

- GT に UNRESOLVED・OTHER が 1 件も無く、`false resolved`（GT UNRESOLVED への断定）は**この GT では測れない**（常に 0）。安全性の検証力は弱い。
- FROZEN_EVALUATION は 30 row で、DETAIL・PRIORITY_* の continuation が無く、PRIORITY_* は両 split とも評価側に無い。
- CORPUS_RANDOM は DETAIL が 63/64。先頭 5 行に title が無い SUMMARY/TOC/STAFFING の深い continuation や OTHER の取りこぼしは、この母集団ではほぼ検出できない。
- 以上は新 version の preregistration（split 先行の sampling、UNRESOLVED/OTHER 候補の追加 sampling 等）で扱う。

## 次

classifier の実装・評価は review 後。
