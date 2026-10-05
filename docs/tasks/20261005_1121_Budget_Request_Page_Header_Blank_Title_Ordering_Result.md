# 概算要求PDF page header blank / title ordering source-schema inventory — 結果

protocol: `20261005_1117_Budget_Request_Page_Header_Blank_Title_Ordering_Protocol.md`（Commit A `c65e760`、doc SHA-256 `b3ed7980…f2f8`）。Phase A の freeze は Commit B `2b04fcc`（Phase B より前）、Phase B の比較は Commit C `5d2d135`。rule・gate は結果を見た後に変更していない。production code は無変更。blank に前後 page の label を補完していない。label の意味は解釈していない。manual contract・existing ON kind は GT ではなく、MOF は使っていない。

**判定: `PROJECTION_ARTIFACT_DOMINANT`（Phase A の事前登録規則 2）。** 前回 `observed_blank` 2,950 page のうち 2,607（88.4%）は、label-shaped row が source に存在するのに、current projection の cut-off（最初の code 行より前）が落としていた。

## Pre-flight / frozen dependencies
branch `research/budget-request-page-header-blank-title-ordering-inventory`、親 `8d6e682`、origin/main `38e5080`（chain は未 merge）。frozen 入力（corpus manifest・protocol・前回の projection / summary / structural comparison・layout summary・paired manifest・semantic-boundary population）の hash を script が照合。working tree は未追跡 `.DS_Store` 2 件のみ。

## Corpus coverage
82 PDF / 9,899 page。前回の current projection を同じ code path で再現し、全 page の status が一致（observed_nonblank 6,195・observed_blank 2,950・unavailable_rotate90 754）。Phase A の evaluable は 9,145 page。

## Blank reason distribution（denominator 2,950）
| reason | pages |
|---|---:|
| projection_cutoff_before_label | 2,607 |
| source_label_absent | 194 |
| label_shape_unrecognized | 149 |
| source_order_ambiguous / unavailable / other_observed_structure | 0 |

`projection_cutoff_before_label` の内訳（primary class）: `label_and_code_same_row` 2,537、`label_without_code` 36、`label_before_code` 15、`multiple_labels_after_code` 9、`code_before_label` 6、`multiple_labels_before_code` 4。

## Ordering class distribution
observed_blank: label_and_code_same_row 2,537・neither_label_nor_code 252・code_without_label 91・label_without_code 36・label_before_code 15・multiple_labels_after_code 9・code_before_label 6・multiple_labels_before_code 4。observed_nonblank: label_without_code 2,302・label_before_code 2,090・multiple_labels_before_code 1,085・ordering_ambiguous 335・code_without_label 242・neither 128・label_and_code_same_row 7・multiple_labels_after_code 3・code_before_label 3。

Fact: blank page の多くは、先頭 token が 3 桁の数字（ページ番号が 100 以上の page）で後ろに label が続く 1 つの logical row（例 `100 内（消）`、x=38）を持つ。この row は code-shaped（先頭 token が 3 桁）と label-shaped を同時に満たすため、current projection は「最初の code 行より前」の定義でこの row 自体を title から外し、title 行が空になる。code 行が label より前にある `code_before_label` は 6 page に過ぎない。

## Sequence inventory（前回 projection の state の連なり）
label→blank→same label が 2,528、label→blank→different label が 76（blank 1 page を挟む場合）。blank→label 2,642・label→blank 2,655。連続 blank run は長さ 1 が 2,612、2 が 2、3 が 34、5・7・9 が各 1〜2、10 以上が 3。同 normalized label の再出現距離は 1 page が 3,377、2 page が 2,552、3〜5 page が 2。

## PDF distribution
blank page を持つ PDF は 57、`projection_cutoff_before_label` を持つ PDF は 37。上位は `001630995.pdf` 460（cutoff 431）・mhlw `05-1b-01.pdf` 457（450）・mext `…_03.pdf` 451（450）・`05-2b-01.pdf` 343（340）・`gaisanyoukyu.pdf` 222（220）。一般会計は cutoff 2,222・source_label_absent 144・label_shape_unrecognized 69、特別会計は 385・50・80。会計差は観察のみ（原因は推測しない）。特定 PDF に偏るが、37 PDF に跨る。

## Representative examples（`(class, localPath, page)` の辞書順の先頭 3 件。`page-ordering-summary.json`）
例: `blank:projection_cutoff_before_label|label_and_code_same_row` の先頭は `cms_caa205_230914_03.pdf` page 104 で、logical row index 0・x=38・y=20.8 の raw `100 内（消）`（token refs [1, 0]）が code-shaped かつ label-shaped。他の class も各 3 件を保存。

## Phase B comparison
- `label→blank→label`（blank 1 page、前後が両方 observed_nonblank）の triple のうち、blank page 自身の source label の normalized が前後の label と一致: 前後が同じ label の 2,528 triple のうち 2,490 は own が両方に一致、10 は両方と異なる、28 は own label なし。前後が異なる 76 triple は own が前のみ一致 16・次のみ一致 20・own なし 40。補完ではなく、blank page 自身の source label の観測。
- x=38 の 3 桁 code 行（mext・mhlw の manual range 外の各 450 件、計 900 件）: すべて `projection_cutoff_before_label` の page 上で、primary class はすべて `label_and_code_same_row`（900/900）。
- semantic-boundary population の page: organization 7・item 97 はすべて observed_nonblank の page 上。detail_line 613 のうち 63、unclassified 170 のうち 102 は blank（cutoff）の page 上。
- layout 境界の前後 page: observed_nonblank 113、blank（source_label_absent 59・label_shape_unrecognized 43・cutoff 5）。

## mext / mhlw
- mext: page 1044 は `neither_label_nor_code`（source 上も label-shaped row がない blank page）で、1045 は `label_before_code`（`文(文)`）。それ以外の blank の大半（450）は偶数 page の `label_and_code_same_row`。current projection の segment 904（label 453・blank 451）→ diagnostic（blank page 自身の source label を使う、post-freeze）では 5 segment（label 4・blank 1、直接 label transition 2）。
- mhlw: 1554 `厚(障)`（multiple labels）→1555 `厚(地)`、1699〜1701 は `厚(労)`→`厚(中)`。current の 911 segment → diagnostic で 11 segment（label 10、直接 label transition 8）。blank 451 のうち 450 が cutoff。
- manual 境界（8 PDF）の diagnostic: 開始が label segment の開始になるのは cfa・env・meti・mext・mhlw・mlit・mod の 7 PDF、終了が label segment の終了になるのは maff・mhlw の 2 PDF。診断の一致率で rule は選ばない。

## Optional counterfactual diagnostic（post-freeze。production rule・新 extractor ではない）
| | current | diagnostic |
|---|---:|---:|
| label segment | 2,818 | 400 |
| 全 segment | 5,482 | 563 |
| 直接 label transition | 96 | 170 |
| blank を挟む同 label の再出現 | 2,529 | 49 |
| blank を挟む別 label | 114 | 102 |
| mext の全 segment | 904 | 5 |
| mhlw の全 segment | 911 | 11 |

diagnostic は blank page 自身の source label を使い、前後からの補完は行っていない。

## Decision（Phase A の規則）
reproduced 真、`unavailable` + `source_order_ambiguous` + `other_observed_structure` = 0（< 0.5）、`projection_cutoff_before_label` が最大で 2,607/2,950 = 0.884 > 0.5 → `PROJECTION_ARTIFACT_DOMINANT`。

## Fact / Observation / Interpretation / Unresolved
- Fact: current projection は最初の code 行（先頭 token が 3 桁数字の row）より前の row を title とする。page 番号が 3 桁以上の page で、その row に label も入る。
- Observation: blank page の 88.4% は label-shaped row を持ち、そのうち 97.3%（2,537/2,607）が label と 3 桁数字が同じ row にある。
- Interpretation: 前回の D2 の主因（大量の blank による分断・450 件規模の transition）は、source が blank なのではなく、current projection の定義による artifact だった。
- Unresolved: label-shaped text が存在することと、それを page header として採用すべきかは別。label の意味・hierarchy への適用・正しい activation 範囲は未確定。

## Limitations
label-shaped の定義（上端帯 0.2・normalized が `prefix(inner)` 形）は固定であり、本文の括弧付き行は上端帯の外として除外している。上端帯の幅の感度は検討していない。rotate の 754 page は未評価。Phase B の診断は discovery と同じ corpus 上の観測で、manual contract は GT ではない。実装バグ: Phase B script の mext focus の PDF 選択（接尾辞 `_03.pdf` が消費者庁の PDF にも一致）を commit 前に修正（rule の変更ではない）。

## 次の研究（開始しない）
`PROJECTION_ARTIFACT_DOMINANT` のため、source-only な alternative title projection rule（title 行の定義に先頭 3 桁の数字行を含めるか等）の事前登録を検討する。その際も manual boundary を教師にしない。production は変更しない。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 128 files / 1,476 tests pass。Phase A・Phase B の再実行で artifact は不変（`9eb910a8…`・`45a157b4…`・`49ac0a3c…`）。Phase A の rule / artifact は freeze 後に変更していない。`scripts/pipeline-v2/lib` は新規ファイルの追加のみ。commit: A `c65e760`、B `2b04fcc`、C `5d2d135`、D（本結果）。

今回は current page-header projection で blank となる page が source 上でも blank なのか、row ordering により label-shaped text が projection から落ちているのかを分離する source/schema inventory である。production title extractor、DocumentHierarchy、FieldResolver、recordKind、item detector、rotate 対応、MOF matcher は変更しない。manual contract と MOF は Phase A の source分類には使用していない。
