# Level-Frame Table-Frame Eligibility Counterfactual — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

事前登録した判定規則で **D3 `TABLE_FRAME_SUPPORT_SIGNAL_WEAK`**（B4 33 cluster のうち support が除外・縮小されたのは 15 で、過半数（17）に届かない）。integrity gate は全 PASS、coverage 不足（D4）には当たらなかった（primary の T4 割当不可は 64 / 2,080 row = 3.1%）。D3 が優先されたが、same-range 6 PDF の L/P/K 変化（1,759 row）と primary の新しい変化（462 row = 22%）も観測されており、規則の順序上は D2 / D5 には到達していない。

## Fact

- T4 の one change: frame support を、node の logical row bbox に既存 `relationOf`（`frameOf`・`classifyPosition`、tolerance 0.5）を適用して `body_or_table_position_supported` となる node に限定し、既存 cluster algorithm で T4 frame を構築。node は削除せず、全 node を T4 frame に既存 assignment（first match）で割り当て、T2 と同じ reset 位置で stack replay と FieldResolver を実行。
- 実装上の修正: 初回 Phase A は、support でない node の行を入力から**取り除く**実装が hierarchy v2 の「rowIndex = logicalRowIndex = 配列 index」の前提を壊し例外で停止した（`phaseA-first-run-crash.log` に保存。結果は出ていないが、3 PDF の件数が途中経過として出力された）。行を残して heading 候補にならないようにする（`visualTokenIndexes` を空にする）実装へ独立 commit で変更した。rule・population・gate・判定規則は不変。
- Phase A（freeze `affe1f6`、source-only、A1〜A8 PASS、再実行 byte 一致）: node 数・relation 分布・support 数・T4 cluster 数（T2 → T4）: 20230907 197・header 22・9 → 8、000157010 509・header 45・7 → 6、230901-4 68・0・5 → 5、ippan_o 394・header 2・6 → 5、mext 1,599・header 450 + ambiguous 848（support 301）・27 → 4、mhlw 3,068・header 450（support 2,618）・34 → 33、001630395 33・0・6 → 6、gaisanyoukyu 776・header 219・6 → 5。unavailable は 0。
- x = 37.982 の最左 cluster: 両 PDF とも T2 support 450 node の全件が header position で除外され、T4 の support は 0、T4 frame に対応する cluster は無く、450 node は hierarchy に残るが frame に割り当てられない（unassigned）。
- B4 33 cluster: support_removed 15、support_maintained 18（support_reduced 0）。frame 遷移は removed 15・preserved 7・x_or_level_changed 11。B5 12 cluster: removed 3・reduced 3・maintained 6。B1 16 cluster: removed 6・maintained 10。T4 の new cluster は 0。
- primary 2,080 row の component（R0 / R1 / R2 / R3 / R4 / R5）: L = 1,543 / 11 / 0 / 462 / 0 / 64、P と K = 1,953 / 0 / 8 / 0 / 55 / 64。row tuple: 全 component R0 が 1,543、(L=R1) 11、(L=R3,P=R0,K=R0) 399、(L=R3,P=R2,K=R2) 8、(L=R3,P=R4,K=R4) 55、全 R5 が 64。non-hierarchy field の変化は 0。
- 既知 population: level_changed 490 は L R1 7・R3 421・R5 62、P / K の R4 55・R5 62。newly_unclassified 37 は L R1 4・R3 33（P / K は R0）。parent_changed 9 は L R3 8・R5 1、P / K R2 8・R5 1。manual 開始 2 node: T4 は両 PDF とも cluster 0・level 1・root・organization（C0 / T3 と同じ。T2 は cluster 1・level 2）。この node の relation は body_or_table_position_supported。
- same-range 6 PDF（5,893 row）: L/P/K が変化した row は 1,759（header 位置の node が unassigned になる 288 row を含む）。変化なしの PDF は 230901-4 と 001630395 のみ（20230907 80、000157010 509、ippan_o 394、gaisanyoukyu 776 は T2 → T4 の全 region 合計）。
- coverage cost: support 除外は header 450 + 450 + 22 + 45 + 2 + 219 と mext の ambiguous 848。frame 未割当 node は mext 879・mhlw 450 など。primary の割当不可は 64 row。

## Observation

- table-frame relation は、x = 37.982 の 450 node（両 PDF）をすべて header position として分離でき、その cluster は T4 で消えた。しかしこの除去は B4 33 のうち 15 にとどまり、他の B4 cluster の support は body / table 内の node のため維持された。
- mext では frame が曖昧な node が 848 件（node の 53%）あり、support が 301 件に減って T4 frame が 4 cluster まで縮んだ。このため level（rank）が C0 とも T2 とも異なる row が primary で 462 件生じた（L = R3）。
- same-range では、header 位置と判定された node の x が T4 frame に入らない（unassigned）ため hierarchy 上 unplaced になり、また cluster 数が減って level の rank が動くため、既存の C0 = T1 = T2 の状態が広く変わった。

## Interpretation（D3 の範囲）

事前登録した 1 変更（table-frame relation による support 限定）は、特定の 1 cluster（最左）は source-only に分離できたが、B4 の過半数には効かなかった。decision の優先順では D3 が先に適用される。C0 が正しい、manual contract が必要、T4 が正しい、B4 が誤り、x = 37.982 が誤り、とは主張しない。D1 は成立していない。

## 限界と次の論点

- bbox の定義は logical row 全体（protocol 固定）。mext では行 bbox が frame 外にはみ出し ambiguous が大量に出た。これは今回の定義での観測であり、規則を結果を見て変えていない。
- B5 は解いていない。次 phase 候補（開始しない）: ambiguous / support 不足の失敗クラス（mext の 848）の分離、または support 限定ではなく別の evidence class。

## Validation

tsc 0 error、lint error 0、vitest（relation 再利用・neutralize・routing・source scan）pass、Phase A / B 再実行で byte 一致、frozen hash guard、production code diff 0。

今回は counterfactual のみ。production・hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。C0・manual contract・MOF は教師でも oracle でもない。
