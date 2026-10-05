# Header-Position Level-Frame Support Provenance Isolation — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

事前登録した判定規則で **D1 `HEADER_SUPPORT_PROVENANCE_STRUCTURALLY_DISTINCT`**。non-circular な complete structural separator が 5 件（clusterFirstSupportPosition・clusterLastSupportPosition・clusterSupportPageSpan・layoutRangeId・layoutRangeLength）成立した。ただし、事後の Phase B confound diagnostic で、これらは **document の規模・PDF の identity とほぼ同義**である疑いが強い（下記）。D1 は規則どおりだが、「次研究で eligibility 仮説にできる独立な evidence class が見つかった」とは読めない。

## Fact

- Phase A（freeze `bc541ee`、source-only、A1〜A9 PASS、再実行 byte 一致）: P1 = 900（mext 450 / mhlw 450）、P2 = 288（20230907 22・000157010 45・ippan_o 2・gaisanyoukyu 219）、P3 = 1,689、P4 = 51。duplicate 0、unjoinable 0、provenance loss 0。feature 数は 79（circular 6・descriptive 3 は separator 判定の対象外）。
- P1 vs P2 の complete separator（availability はいずれも 0.996 以上、mext / mhlw のそれぞれが P2 と disjoint）:
  - clusterFirstSupportPosition: P1 = {r0}、P2 = {r1, r4, r6, r9}。
  - clusterLastSupportPosition: P1 = {r5, r7}、P2 = {r9}。
  - clusterSupportPageSpan: P1 = {[500,1000)}、P2 = {[3,5)・[20,50)・[50,100)・[200,500)}。
  - layoutRangeId: P1 = {1-1339, 21-1723}、P2 = {7-147, 9-106, 9-540, 21-193, unassigned}。
  - layoutRangeLength: P1 = {[1000,∞)}、P2 = {[50,100)・[100,200)・[500,1000)}。
- strong partial separator は 0（complete が先に成立）。clusterLayoutRangeCount 系の TVD は 0.76 で partial 閾値（0.80）に届かない。F3（table-frame geometry）・F4（lexical shape）・F5（sequence）に complete / partial separator はない。
- Phase B（diagnostic、`phaseB-diagnostic.json` sha `77f33ce8…c8d60`、再実行 byte 一致）:
  - P2 288 node は全件が same-range の T4 変化 row（1,759）に含まれ、全件が unplaced（frame 未割当）。P3 は 1,689 のうち 1,471 が変化 row に含まれる。
  - P1 900 は両 PDF とも全件が manual 開始より前の page にあり、manual 開始 node 2 は P1 に含まれない。primary の 462 / 55 / 64 は manual range 内の row で、row 単位の P1 への帰属は frozen artifact に無い（page 位置だけを記録）。
  - confound: complete separator 5 件の value の PDF への対応は、layoutRangeId の 7 値すべて、clusterSupportPageSpan の 5 値のうち 4 値、clusterFirstSupportPosition の 5 値のうち 4 値が 1 つの PDF にしか現れない（PDF identity の代理）。clusterSupportPageSpan の `[500,1000)` と layoutRangeLength の `[1000,∞)` は primary の 2 PDF（それぞれ約 1,300 / 1,700 page の document）にだけ現れ、same-range の 6 PDF（107〜540 page）には現れない。
  - secondary: P2 vs P3 は frozenRelation・rowTopMinusFrameTop 等（relation の定義に由来）と clusterMaxGap が complete、行の文字数・token 数が strong partial。P1 vs P4 は 16 feature が complete（cluster の規模・page 数 / gap 数・行の文字数などで、P4 は 51 node のみ）。

## Observation

- P1（x = 37.982 cluster の header node）の cluster は、document 全体にわたり約 3 page ごとに 1 node（450 page・450 run）が現れる構造で、first support が document 先頭、span が 500〜1,000 page、layout range が単一の長大 range にある。P2 の cluster は短い document の範囲内に収まる。この差は、source-only の cluster support の規模・分布の差として確かに存在する。
- しかしその差は、document 全体の規模（page 数）の差と区別できない。primary 2 PDF が same-range 6 PDF より遥かに長い document であることと同時に起きている。table-frame の geometry・lexical shape・sequence の feature では P1 と P2 は分離されない。

## Interpretation（D1 の範囲）

規則上は D1 だが、成立した separator が document の規模・PDF identity と交絡しているため、これを level-frame support の eligibility evidence として独立に用いてよいかは本研究では確定しない（protocol の「PDF identity そのものではない」条件は layoutRangeId の値の識別までは検査しておらず、この点は事前登録の穴として開示する。結果を見て規則は変更していない）。P1 が x = 37.982 を除外すべき、P2 が正しい support、C0 / manual が正しい、新しい eligibility rule が確立した、とは主張しない。

## 限界

母集団は同じ 8 PDF（P1 は 2 PDF）。document 規模を揃えた比較は本研究の範囲外。次 phase 候補（開始しない）: document 規模・PDF identity を制御した（例: 規模の近い PDF 同士、または規模に依存しない構造量だけの）再比較を別研究で事前登録する、または table-frame 路線を level-frame support eligibility から外す判断。

## Validation

tsc 0 error、lint error 0、vitest（bin・signature・compare・routing・source scan）pass、Phase A / B 再実行で byte 一致、frozen hash guard、production code diff 0。

今回は inventory のみ。production・hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。C0・manual contract・MOF は教師でも oracle でもない。
