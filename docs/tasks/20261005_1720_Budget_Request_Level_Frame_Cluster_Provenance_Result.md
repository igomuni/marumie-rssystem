# Level-Frame Cluster Provenance Inventory — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

事前登録した判定規則で **D1 `CLUSTER_PROVENANCE_STRUCTURALLY_LOCALIZED`**。Phase A gate（A1〜A6）全 PASS、B6 = 0、61 cluster・536 row・manual-start 2 node・frame 未割当 1,214 node がすべて provenance に join でき、P-A〜P-E のうち P-B・P-C・P-D・P-E が成立（P-A は不成立）。新しい frame rule は作っていない。D1 は「次の source-only frame 仮説を立てられる粒度まで構造化できた」ことだけを意味する。

## Fact

- Phase A（freeze `fb5fbd8`、C0・manual range・MOF 非参照。source scan test で確認）: T2 frame は mext 27 / mhlw 34 cluster で frozen と順序込みで一致（A1）。support 数 = memberCount・全 eligible node がちょうど 1 cluster（A2・A3）、再実行 byte 一致（A5）、production file hash 不変（A6）。inventory sha `2bb3e592…672e5`、support node 4,667 件（`phaseA-support-nodes.jsonl.gz` sha `fef26771…4b6e`）。rule-line relation は frozen inventory と決定的 join の key が無いため `not_available`。
- Phase A の記述軸: 61 cluster のうち single_page 19、multi_page_single_run 1、multi_run 41（450 page 上に 450 support を持つものなど広く分散する cluster を含む）。layout は 59 cluster が single_layout_range、mhlw の 2 cluster が multiple_layout_ranges。request-shaped と非 request が混在する cluster は 0（request-shaped support を持つ 2 cluster は全 support が request-shaped）。
- Phase B（C0 frame は manual range の page から既存規則で生成し frozen controlClusters と一致）: relation は B1 16（mext 7 / mhlw 9）、B4 33（14 / 19）、B5 12（6 / 6）、B2・B3・B6 は 0。
- Pattern: P-A（同一 C0 cluster への split）なし、P-B（B4・B5 が 2 cluster 以上）・P-C（support 全件が同一 region）・P-D（同一 layout range）・P-E（同一 page run 共有）が成立。
- 536 row（level_changed 490 / newly_unclassified 37 / parent_changed 9）は全件 inside_manual で、T2 cluster に join 可能。490 は B1 90・B5 400、37 は B1 4・B5 33、9 は B1 3・B5 6 の cluster に属する。
- manual 開始 node（mext p1045 r4 / mhlw p1555 r4、x = 51.765）: T2 cluster 1（level 2）、C0 cluster 0（level 1）で、frozen の観測を再現。この T2 cluster は B1（C0 cluster 0 と 1 対 1）で support は 4 / 8 node。
- frame 未割当 1,214 node（mext 649 / mhlw 565）は全件 manual range の外（primary 0）で、T2 cluster に join 可能。
- same-range の既知値（2,080・536・490/37/9・5,893・1,214・27/34・13/15）を frozen artifact から再現。

## Observation

- T2 の最左 cluster（cluster 0、x = 37.982、level 1）は両 PDF とも support 450 node・450 page・単一 layout range で、全件が manual 開始より前にあり、C0 frame には 1 node も割り当てられない（B4）。manual 内の node の level delta（T2 − C0）は mext で 1 が 215、7〜9 が 23、mhlw で 1 が 214、3〜13 が 82 で、delta 1 の node は、この最左 cluster が C0 より浅い位置に挿入されたことと整合する。delta が 3 以上の node は、他にも C0 に割り当てられない cluster が同じ側に挿入されている構造。
- B4 の 33 cluster はすべて support が manual range の外（inside 0）にある。count difference 14 / 19 は B4 の cluster 数 14 / 19 と一致したが、これは観測であって「余計な cluster」の定義ではない。
- B5 の 12 cluster は C0 の 1 cluster に対応しつつ、少数 node（1〜24）が C0 範囲に入らず未割当。490 / 37 / 9 のうち大半（400 / 33 / 6）がこの B5 cluster に属する。原因は推測しない。
- 490 / 37 / 9 の row は、すべて manual 範囲内の node で、T2 cluster 数は 20 / 4 / 4。

## Interpretation（D1 の範囲）

source-derived frame と C0 frame の差は、(a) manual 開始より前に support が集中する C0 非対応 cluster（B4）と、(b) C0 cluster と対応するが一部 node が C0 範囲外になる cluster（B5）に局在し、split（P-A）は無い。C0 が正しい、T2 cluster が誤り、manual range が必要、cluster の pruning / merge rule が確立した、full corpus に一般化できる、とは主張しない。

## 限界

母集団は mext / mhlw の 2 PDF。rule-line relation は未取得。MOF・PDF 目視・意味解釈は使っていない。

## 次 phase

D1 の分岐: 今回観測した family のうち source-only で定義できる evidence class を 1 つだけ選び、manual / C0 を使わない frame 構成仮説を次研究で事前登録する（今回は rule を作らない）。

## Validation

tsc 0 error、lint error 0、vitest（provenance・relation・routing・source scan）pass、Phase A / B の再実行で byte 一致、frozen hash guard、production code diff 0。

今回は inventory のみ。production・hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。C0・manual contract・MOF は教師でも oracle でもない。
