# 概算要求PDF page header label / segment inventory — 結果

protocol: `20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md`（Commit A `b53df74`、doc SHA-256 `fed62291…5493`）。Phase A の source-only projection は Commit B `3eab154` で freeze（Phase B の前）、Phase B の比較は Commit C `e57b291`。extraction・segmentation・gate は結果を見た後に変更していない。production code は無変更。label の意味は解釈していない。MOF は使っていない。manual contract・existing ON kind は GT ではない。

**判定: `HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC`（D2、規則 5）。** label と segment は決定的に再現できるが、事前登録した G4（境界の特異性）を満たさない。manual 境界との一致（G3）は事前登録の 3 境界ですべて成立した。

## Pre-flight
branch `research/budget-request-page-header-label-segments`、親 `9fbeb57`、origin/main `38e5080`（chain は未 merge）。frozen 入力（corpus manifest・protocol・projection・layout summary・paired manifest・population）の hash を script が照合。working tree は未追跡 `.DS_Store` 2 件のみ。Phase A の freeze（B）は Phase B（C）より前。

## Discovery provenance
label 候補は前回の post-hoc 観測（mext / mhlw を含む既存 hierarchy 契約 8 PDF）から発見。8 PDF 上の一致は development observation。non-discovery 74 PDF は別集計（semantic GT がなく held-out accuracy ではない）。

## Label extraction mechanism（Fact）
pdf.js text → SourceToken → TableGeometry → LogicalRow を PDF ごとに 1 回 open して再実行。first title line = 最初の code 行より前の先頭 logical row。raw = 非空白 token の連結。normalized = NFKC + 空白・数字の除去。blank と unavailable は別 status、blank を跨いで結合・carry-forward しない。

## Coverage
82 PDF / 9,899 page。evaluable 9,145 page（observed_nonblank 6,195・observed_blank 2,950）、unavailable_rotate90 754 page（rotate は page 単位で判定。rotate=90 の 8 PDF のうち回転していない page は評価できた。他の unavailable は 0）。observed_blank の内訳: title 行なし 2,759・数字のみ 191。評価可能 page の nonblank 比率は 0.677（discovery 0.702、non-discovery 0.658）。

## Vocabulary / lexical shape
distinct raw label 5,905（page 番号の位置・値が raw に混じるため）、distinct normalized label 190。`prefix(inner)` 形 5,731 page（そのうち prefix 1 文字・inner 1 文字が 5,702）、その他 464 page。non-discovery の evaluable PDF 71 本のうち 48 本（67.6%）で nonblank page の過半が `prefix(inner)` 形。

## Segment inventory
label segment 2,818（長さ 1 page が 2,702、10 page 以上が 60）。label→label の直接 transition 96、blank / unavailable を挟んで別 label になる transition 114、同 label の非連続な再出現 2,554。page 1 に label がある PDF は 79。長さ 1 の segment が多いのは、偶数 page などで first title line が空になり（次節）、1 page ごとに blank が挟まって segment が分断されるため（blank を bridge しない事前登録の帰結）。

## Layout relation（構造相関のみ）
label segment の開始 2,739 件のうち layout range の境界と一致するのは 86（直接 15・blank 経由 71）、layout range の内部 2,508、layout 判定不能 145。逆に layout 境界 110 のうち、label transition を伴うもの 15、同一 label のまま 6、blank / unavailable を伴うもの 89。→ label segment は layout range の細分で、layout 境界の大半は blank page に隣接する。一致率の高低は semantic の根拠にしない。

## Manual contract relation（discovery 8 PDF）
manual 開始・終了が label segment の開始・終了 page と一致するのは、layout 境界で説明できない 3 境界（mext 開始 1045・mhlw 開始 1555・mhlw 終了 1700）で 3/3（G3 通過）。layout 境界と manual 境界が一致する 6 PDF では、label segment の開始が layout 開始と同じ page に出るのは 5 PDF（cfa・env・meti・mod・mlit）で、maff は manual 開始が label segment の開始でない（終了のみ一致）、label が追加情報か layout との共起かは区別できない（label は layout を上回る境界情報を与えていない）。manual 境界以外の label transition は PDF 全体で mext 451・mhlw 457（G4 の ≤ 2 を満たさない）。

## mext
layout range 1-1339、manual 1045-1339。label segment は 904。manual 開始は label `文(文)` の segment の開始で、直前は空 title の page 1044（blank は bridge しない）。blank を挟んで別 label になる transition は `文(所)`→blank→`文(文)`。manual range 内部の直接 label→label transition は 1（`文(文)`→`文(ス)`、page 1260）。manual 終了 1339 は文書の最終 page。transition の大半は page 92 以降の偶数 page の blank 1 page と label の交互。manual 開始の transition は blank を挟む点で、他の「blank を挟む 450 の交互」と構造的には区別できない（違いは前後の label が異なること）。

## mhlw
layout range 21-1723、manual 1555-1700。label segment は 911。1555 は `厚(障)`→`厚(地)` の直接 transition の開始、1700 は `厚(労)`→`厚(中)`（1701）の直前の segment の終了。同 PDF の直接 label→label transition は 8 件（9 件の distinct label 変化のうち、post-hoc の診断。blank を無視して数えたもので、segment の定義とは別）。manual 開始・終了はその 8 件に含まれるが、同種の transition が他にもあり（`厚(本)`→`厚(検)` 1228、`厚(検)`→`厚(ハ)` 1256 など）、manual 境界に特異的とは言えない。

## Existing root / item-shaped relation（population 887、構造のみ）
organization 7・item 97 はいずれも label segment の先頭 page 付近に集中せず（organization は先頭 page 1・6 page 以上離れた行 6、item は 6 page 以上が 75/97）、segment の最初の 3 桁 plain code 行でも segment 内の最浅 x の行でもない（item 97・organization 7 のいずれも 0）。detail_line 613 のうち 63 は blank segment 上、unclassified 170 のうち 102 は blank segment 上（segment の外）。segment 内に複数 root-shaped 行があるのは item 0/97・organization 0/7。→ 既存の root / item-shaped row の位置は label segment の境界とは対応しない。

## x=38 の浅い 3 桁 code 行
mext・mhlw とも manual range 外の 450 件はすべて observed_blank の page 上（1 page ごとに独立した blank segment の先頭 page、label page 上は 0）。first title line が blank になる page のうち、title 行より前に code 行（x=38 の 3 桁数字）がある page として現れており、この 3 桁の行が title より前に来ることが blank の原因として構造上は成立している（意味は解釈しない）。organization / item とは決めつけない。

## Discovery vs non-discovery
nonblank 比率: discovery 0.702・non-discovery 0.658。`prefix(inner)` 形の比率: discovery 0.978・non-discovery 0.880。non-discovery でも同じ lexical / segment 構造が再現（G1・G5 通過）。

## 否定的な evidence
blank page による分断が支配的で、manual 境界以外の transition が 450 件規模。label segment は layout range の細分に近く、layout 境界に追加の情報を与えない。root / item-shaped row は segment 境界と対応しない。mext の manual range 内にも label の直接 transition がある。

## Decision
G1 通過（0.677 / 0.658 ≥ 0.5）、G3 通過（3/3）、G4 不通過（451 / 457 > 2）、G5 通過（0.676 ≥ 0.5）→ 規則 5 `HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC`。G4 の閾値は前回の観測（mext の manual range 内にも label 変化がある）を知った上で、特定の PDF に合わせず事前に決めたもの。blank 交互による分断が G4 の数値を支配している。

## Limitations
label の意味は解釈していない／discovery 8 PDF 上の一致は development observation／first title line の定義（最初の code 行より前）に 3 桁の数字行が先行する page で blank になる性質は事前登録どおりで、修正していない／rotate は page 単位で、回転した 754 page は未評価／manual contract・existing ON kind は GT ではない。

## Next step（候補・開始しない）
D2 のため semantic inventory へは進まない。blank を生む 3 桁の数字行（x=38）が title の前に来る page で first title line が取れない問題が分断の主因なので、次に 1 つだけ選ぶなら、title 抽出の定義（最初の code 行より前、という条件）を別の evidence class として事前登録し直す inventory。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 127 files / 1,471 tests pass。projection・summary・structural comparison は再実行で artifact 不変（`9ff3b970…`・`599acde0…`・`e196ab81…`）。frozen artifact は変更していない。`scripts/pipeline-v2/lib` は新規ファイルの追加のみ。commit: A `b53df74`、B `3eab154`、C `e57b291`、D（本結果）。

今回は page header label の structural inventory であり、label の意味解釈は行っていない。production DocumentHierarchy / FieldResolver / recordKind / item detector は変更していない。MOF を教師として使用していない。manual contract との一致は semantic GT とは扱っていない。
