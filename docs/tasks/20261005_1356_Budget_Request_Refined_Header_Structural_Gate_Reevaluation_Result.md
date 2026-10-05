# 概算要求PDF table-frame refined projection 後の page-header structural gate 再評価 — 結果

protocol: `20261005_1355_Budget_Request_Refined_Header_Structural_Gate_Reevaluation_Protocol.md`（Commit A `8e9a4e4`、doc SHA-256 `649b6c44…3388`）。implementation freeze は Commit B `70d74de`（gate 移植 `abbd9437…c078`・script `026b522f…5882`）、frozen evaluation は Commit C `55ab1ad`、本結果は Commit D。gate の式・threshold・segment algorithm・decision rule・projection は結果を見て変更していない。production は無変更。label の意味は解釈していない。manual contract は diagnostic のみで、refined projection や segment rule の生成・変更には使っていない。MOF は使っていない。

**Primary decision: `HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC`（D2）。** G1・G3・G5 は通過、G4 が再び不通過（mext 2・mhlw 7）。projection artifact を table-frame refinement まで抑制しても、manual boundary 以外の label transition が source 上に残る。header-label 単独の activation-boundary 研究は、この frozen 条件では支持されず、一旦終了とする。

## Pre-flight / frozen dependencies
branch `research/budget-request-refined-header-structural-reevaluation`、親 `2ca8130`、origin/main `38e5080`（chain は未 merge）。frozen 入力（corpus manifest・current / alternative projection・alternative の segment 評価・refined の評価と candidate relation・table-frame eligibility 実装・label protocol と gate の frozen script・layout summary・paired manifest）の hash を script が照合し、すべて一致。working tree は未追跡 `.DS_Store` 2 件のみ。

## One change
gate への入力 projection を alternative → table-frame refined projection に置き換えただけ。refined projection は frozen artifact から決定的に導出（新しい rule なし）: alternative を基に、header position でなかった採用 page 3 を current の出力に戻す。gate の式・threshold・segmentation（blank bridge なし）・layout range・manual contract は不変。gate は frozen の alt 評価の移植（`lib/budget-request-header-gates.ts`）で、alternative projection に適用して frozen の値（G1 0.9543・G4 mext 2 / mhlw 7・label segment 330・全 segment 467）を再現することを equivalence test と実行時の照合で確認した。

## Projection integrity（frozen refined evaluation と照合。すべて一致）
evaluable 9,145・current nonblank 6,195（変化 0）・accepted 2,529・rejected body/table 2・rejected unavailable 1・unresolved 5・current から変化した page 2,529（accepted のみ）・source fidelity violation 0・provenance missing 0。

## Segment comparison
| metric | current | alternative | refined |
|---|---:|---:|---:|
| observed_nonblank | 6,195 | 8,727 | 8,724 |
| observed_blank | 2,950 | 418 | 421 |
| label segment | 2,818 | 330 | 328 |
| 全 segment | 5,482 | 467 | 464 |
| 同 label の非連続な再出現 | 2,554 | 64 | 64 |
| 直接 label→label transition | 96 | 127 | 127 |
| mext segment | 904 | 5 | 5 |
| mhlw segment | 911 | 11 | 11 |

## Structural gates（refined projection、frozen の定義と threshold）
| gate | numerator / denominator・実測値 | threshold | 結果 |
|---|---|---|---|
| G1 nonblank 比率 | 全体 8,724 / 9,145 = 0.954、non-discovery 4,672 / 5,066 = 0.922 | ≥ 0.5（両方） | PASS |
| G3 manual 境界 | mext 開始・mhlw 開始・mhlw 終了の 3/3 が label segment の境界かつ layout 境界でない | 3/3 | PASS |
| G4 境界の特異性 | manual 境界以外の label transition: mext 2・mhlw 7 | ≤ 2（各） | **FAIL**（mhlw） |
| G5 一般性 | non-discovery 71 PDF のうち 48 PDF が `prefix(inner)` 過半 = 0.676 | ≥ 0.5 | PASS |

## Manual boundary diagnostic（diagnostic のみ）
- mext 1045: 前 page（1044）は blank、当該・次 page は `文(文)`。label segment の開始。layout 境界ではない。provenance は current と同じ（`before_first_code_row`）。
- mhlw 1555: 前 `厚(障)`、当該・次 `厚(地)`。label segment の開始。layout 境界ではない。
- mhlw 1700: 前・当該 `厚(労)`、次（1701）`厚(中)`。label segment の終了。layout 境界ではない。
3 境界とも alternative と refined で同じ label。

## G4 failure isolation（rule を変えず、label の意味は解釈しない）
manual 境界以外の label transition（mext 2・mhlw 7、計 9）はすべて alternative projection にも存在し、refined で新規に発生したものは 0。
| PDF | page | before → after | transition type | current にも存在 |
|---|---:|---|---|---|
| mext | 896 | `文(本)` → `文(所)` | 直接 label→label | なし（current では blank を挟み segment 境界が異なる） |
| mext | 1260 | `文(文)` → `文(ス)` | 直接 label→label | あり |
| mhlw | 9 | （blank）→ `厚` | blank の後 | あり |
| mhlw | 21 | `厚` → `厚(本)` | 直接 | あり |
| mhlw | 1228 | `厚(本)` → `厚(検)` | 直接 | あり |
| mhlw | 1256 | `厚(検)` → `厚(ハ)` | 直接 | あり |
| mhlw | 1281 | `厚(ハ)` → `厚(試)` | 直接 | あり |
| mhlw | 1470 | `厚(試)` → `厚(障)` | 直接 | あり |
| mhlw | 1603 | `厚(地)` → `厚(労)` | 直接 | あり |
8 件は隣接する 2 page の nonblank な label が異なる直接 transition（current projection でも観測される。7 件）で、projection artifact ではなく source 上に実在する label transition。
- mext の manual range 内の transition は 1260 の 1 件、mhlw の manual range 内は 1603 の 1 件。

## Alternative → refined で変わった page（3 page・3 PDF）
| PDF・page | table-frame relation | old（alternative） | new（refined） |
|---|---|---|---|
| `2023_fukkochougaisansaisyutsu.pdf` p66 | body/table | nonblank（本文 row を採用） | blank |
| `r6gaisan-yokyusyo-250905.pdf` p18 | body/table | nonblank（本文 row を採用） | blank |
| `r6sandanhyou.pdf` p140 | unavailable（罫線なし） | nonblank | blank |
label segment の変化: 前 2 PDF は 2 → 1、`r6sandanhyou.pdf` は 4 → 4。mext・mhlw の segment と gate への影響はない（G4 の値は alternative と同じ）。

## Decision interpretation
- 支持された範囲: refined projection でも G1・G3・G5 は成立し、manual 境界 3 点は label segment の境界で layout 境界ではない（G3）。table-frame refinement は projection の調整としては成立している（前研究の D1）。
- 支持されなかった範囲: page-header label 単独を activation boundary とする仮説。source 上に manual 境界以外の label transition が mhlw に 7 件（直接 transition 6 件を含む）残り、G4 を満たさない。これは projection artifact ではない。
- 主張しない: manual contract が正しい・label の意味・hierarchy の正しい生成・full corpus での精度・header label が hierarchy boundary として無意味であること（G4 の閾値の下での判定）。

## Limitations
G4 は mext と mhlw の 2 PDF に対する frozen の閾値（≤ 2）で、2 PDF に限る。transition の意味（組織の区切りなど）は解釈していない。manual contract は GT ではない。rotate=90 は対象外。

## 次の研究判断（開始しない）
header-label 単独の activation-boundary 研究は終了。次の研究単位は、元の目的である「full-corpus DocumentHierarchy を source evidence からどう構成するか」へ戻し、document / range-level の別 evidence と hierarchy state の組み合わせを検討する。header predicate のさらなる微調整・ambiguous 1,196 row の分解には進まない。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 135 files / 1,498 tests pass。評価の再実行で artifact 不変（structural evaluation `76eb8665…43a6`・refined projection `1a4ba6ca…0327`・transition inventory `9d514a13…2ff1`）。`scripts/pipeline-v2/lib` は新規ファイルの追加のみで production diff は 0。commit: A `8e9a4e4`、B `70d74de`、C `55ab1ad`、D（本結果）。測定バグなし。

今回は table-frame refined projection を固定したまま既存の structural gate を変更せずに再評価した研究であり、production title extractor / DocumentHierarchy / FieldResolver / recordKind / item detector は変更していない。MOF と manual contract は teacher にしていない。
