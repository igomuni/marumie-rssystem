# 概算要求PDF source-only alternative title projection — frozen 評価の結果

preregistration: `20261005_1135_Budget_Request_Alternative_Title_Projection_Preregistration.md`（Commit A `99dc32c`、doc SHA-256 `c43c49a7…454e`）。implementation freeze は Commit B `096f0bd`（lib `17cb97ef…`・script `de59c244…`）、primary evaluation は Commit C `3528171`、segment / structural と result は Commit D。preregistration → implementation → evaluation の順序を守り、結果を見て rule・population・gate を変更していない。production code は無変更。blank への補完・bridge・救済は行っていない。label の意味は解釈していない。MOF は使っていない。

**Primary decision: `ALTERNATIVE_PROJECTION_PARTIALLY_SUPPORTED`（規則 2）。** 回復は 2,537 中 2,532 で、regression・non-target の変化は 0。ただし C2 に ambiguous（事前登録の定義）が 1,123 page、unresolved が 5 page 残った。

## Pre-flight / frozen dependencies
branch `research/budget-request-page-header-alternative-projection`、親 `373e7b4`、origin/main `38e5080`（chain は未 merge）。frozen 入力（corpus manifest・前回の projection / summary / structural comparison・title ordering の Phase A / B・population manifest・layout summary・paired manifest・semantic-boundary population・preregistration）の hash を script が照合。再現確認: corpus 82 PDF / 9,899 page、evaluable 9,145、observed_nonblank 6,195、observed_blank 2,950、unavailable_rotate90 754、cutoff 2,607、source_label_absent 194、label_shape_unrecognized 149、same-row 2,537。working tree は未追跡 `.DS_Store` 2 件のみ。

## Current mechanism（code evidence。詳細は preregistration P0）
現行 projection は `classifyRow(texts) !== 'other'` の最初の row（code row）より前の先頭行を title とする。`label_and_code_same_row` は、先頭 token が 3 桁のページ番号で後ろに label が続く row が code row になり、title 行が空になる page。label を取り出すために新しい regex は不要で、既存の normalization（NFKC・空白・数字の除去）だけで row 全体から一意に決まる。

## Preregistered alternative rule
現行が `observed_blank` の page で、現行の最初の code row が frozen label-shaped predicate（上端帯・`prefix(inner)` 形）を満たす場合に限り、その row を丸ごと title として projection（basis `label_on_first_code_row`、provenance = row index・token index）。他は現行と同一。

## Primary evaluation（9,145 page）
| class | pages | 結果 |
|---|---:|---|
| C1 current_nonblank | 6,195 | unchanged 6,195 / changed 0（M1: changed・missing・extra = 0） |
| C2 target_same_row | 2,537 | recovered 2,532 / unresolved 5 / mismatch 0 / ambiguous 1,123 |
| C3 cutoff_other | 70 | changed 0 |
| C4 source_label_absent | 194 | changed 0 |
| C5 label_shape_unrecognized | 149 | changed 0 |

M1 通過、M3（C3・C4・C5 の status 変化）0、M5 決定的（同一入力の 2 回の走査と再実行の artifact が一致、alternative artifact `cc071c77…c6cd`）、M6 source fidelity 違反 0（projection の raw は Phase A の frozen label evidence と raw・normalized・row index・token index が一致）、provenance missing 0。

## 失敗の分類（post-hoc diagnostic。rule は拡張しない。`c2-failure-diagnostic.json`）
- unresolved 5（`2023_fukkochougaisansaisyutsu.pdf` の page 45・47・48・59・62）: 現行の最初の code row が request 行（`28 30-15 …`）で、その後ろの 3 桁 row（例 `010 被災児童生徒就学支援等 （要旨）`）が Phase A の label-shaped 判定を満たしていた page。現行の最初の code row 自体は label-shaped でないので、alternative は救済しない（事前登録どおり）。この 5 page の label-shaped は本文の行（括弧付き）の可能性があるが、意味は判断しない。
- ambiguous 1,123（事前登録の定義: projection と normalized が異なる label-shaped row が同じ page に他にもある）: 他の label-shaped row はすべて最初の code row より後ろ（1,786 row、前にあるものは 0）。その normalized は `計,(,)`・`国庫債務負担行為の初年度前金,(,)`・`一般物件費,,(,,)` のように、数字を除去した後に括弧とカンマだけが残る本文の金額行で、frozen label-shaped predicate（上端帯 0.2 + `prefix(inner)` 形）の偽陽性とみなせる構造（意味解釈ではなく、normalized の字面）。projection 自体は最初の code row 1 つだけから作られており（他の row を使っていない）、projected label は変わらない。ambiguity は predicate の性質で、alternative rule の問題とは限らないが、事前登録の定義では C2 ambiguous 1,123 として数える。

## Segment re-evaluation（P4。primary decision の後）
| metric | current | alternative |
|---|---:|---:|
| observed_nonblank | 6,195 | 8,727 |
| observed_blank | 2,950 | 418 |
| label segment | 2,818 | 330 |
| 全 segment | 5,482 | 467 |
| 直接 label→label transition | 96 | 127 |
| 同 label の非連続な再出現 | 2,554 | 64 |
| blank を挟む同 label / 別 label | 2,529 / 114 | 39 / 85 |
| mext segment | 904 | 5 |
| mhlw segment | 911 | 11 |

参考値（前回の counterfactual、一致は要求しない）: label segment 400・全 segment 563・mext 5・mhlw 11。

## Reused structural gate（P5。前回の G1・G3・G4・G5 を変更せず再適用。`STRUCTURAL_GATE_NOT_REUSABLE` ではない）
- G1 通過（nonblank 比率 全体 0.954・non-discovery も 0.5 以上）、G3 通過（mext 開始 1045・mhlw 開始 1555・mhlw 終了 1700 がすべて label segment の開始 / 終了 page かつ layout 境界でない）、G5 通過（non-discovery 71 PDF のうち 49 PDF で `prefix(inner)` 形が過半、0.690）。
- G4（境界の特異性）: manual 境界以外の label transition は mext 2・mhlw 7（閾値 ≤ 2）で、mext は満たし mhlw は満たさない → G4 不通過。
- 判定は前回と同じ `HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC`（G3・G5・G1 は通過、G4 のみ不通過。前回は 451 / 457 の blank 交互が主因だったが、今回は mhlw の 7 件の実際の label 変化）。

## mext / mhlw
- mext: 904 → 5 segment。manual 開始 1045 は label segment の開始（前の page 1044 は source 上も blank）。manual range 内部の label transition は 1、range 外を含む他の transition は 2。終了 1339 は文書の最終 page。
- mhlw: 911 → 11 segment。開始 1555・終了 1700 はどちらも label segment の境界。PDF 内の他の label transition は 7（`厚(本)`→`厚(検)` など）で、manual 境界に特異的とは言えない。

## Answers
- Q1: 2,537 page のうち 2,532 を回復（他 5 は unresolved）。
- Q2: current nonblank 6,195 page は完全に不変。
- Q3: C3 70・C4 194・C5 149 に unintended change は 0。
- Q4: label segment は 2,818 → 330。
- Q5: 過剰 segmentation は主に projection artifact で説明できた（label segment −88%、全 segment −91%、同 label の非連続な再出現 2,554 → 64）。
- Q6: 同じ G4 のまま再評価すると mext 2（通過）・mhlw 7（不通過）で、G4 は不通過のまま。
- Q7: mext 1045・mhlw 1555 / 1700 は label segment の境界として残る（G3 通過）が、同種の label transition が mhlw に 7 件あり、特異的ではない。
- Q8: 未解決として残るもの: label の意味、manual range 内部の label transition（mext 1・mhlw 1）、range 外の transition の扱い、どの label 境界を activation 境界とみなすかの source-only な選択規則、C2 の ambiguous の原因である label-shaped predicate の偽陽性、request 行が先行する page、`source_label_absent` 194 / `label_shape_unrecognized` 149 / `cutoff_other` 70（今回は救済対象外）。

## Fact / Observation / Interpretation / Unresolved
- Fact: alternative projection は source の同一 row からのみ label を作り、C1・C3〜C5 を変えず、C2 の 2,532 page の raw・normalized・provenance が Phase A の frozen evidence と一致した。
- Observation: segment が 5,482 → 467 に減り、blank による分断はほぼ解消したが、G4 は mhlw の実際の label 変化 7 件のため不通過のまま。
- Interpretation: 前回の `HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC` の主因（過剰な分断）は projection artifact だったが、「境界に特異的でない」という性質自体（label 変化が manual 境界以外にも複数ある）は artifact を除いても残った。
- Unresolved: label の意味、header label を DocumentHierarchy の activation evidence として使えるか、manual contract が正解か。

## Limitations
primary の ambiguity は frozen label-shaped predicate（上端帯 0.2・`prefix(inner)` 形）の偽陽性に由来し、predicate は変更していない（変更は別の preregistration）。rotate の 754 page は対象外。manual contract は P5 の diagnostic としてのみ参照（alternative の生成には不使用）で GT ではない。

## 次の研究判断（候補・開始しない）
G4 が mhlw の実際の label 変化 7 件で不通過のため、header label を activation evidence として使うには、label 変化を manual 境界と区別する別 evidence（semantic inventory はまだ行わない）が要る。または、label-shaped predicate の偽陽性を扱う preregistration。production は変更しない。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 129 files / 1,481 tests pass。primary・segments・diagnostic の再実行で artifact 不変（alternative `cc071c77…`・primary `79e5a63a…`・segments `3eccc9ea…`）。`scripts/pipeline-v2/lib` は新規ファイルの追加のみ。commit: A `99dc32c`、B `096f0bd`、C `3528171`、D（本結果）。

今回は `label_and_code_same_row` という単一の projection failure mechanism に対する source-only alternative title projection の frozen evaluation であり、production DocumentHierarchy / FieldResolver / recordKind / item detector を変更していない。
