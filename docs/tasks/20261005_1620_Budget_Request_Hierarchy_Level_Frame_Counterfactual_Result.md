# Hierarchy Level-Frame Counterfactual — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

事前登録した判定規則で **D1 `LEVEL_FRAME_EXPLAINS_ALL_RESIDUAL_COMPONENT_DIFFERENCE`**。T2（source range + manual 開始直前の stack reset）で C0 と異なっていた L/P/K の全 component が、level frame だけを C0 の frozen frame に替えた T3 で C0 と一致した（R1 のみ、R2・R3・R4・R5 は 0）。manual が正しいとは言わない。直前の stack-reset 研究の「規則網羅漏れで INVALID」は書き換えていない（measurement は有効だった）。

## Fact（`level-frame/2024/evaluation.json` sha `cb3c75bf…186641a`、`component-rows.json.gz`）

- T3: T2 と同じ activation range・node population・eligibility・document order・reset（T2 の frozen locator mext p1045 r4 / mhlw p1555 r4）・stack algorithm・FieldResolver。変更は level frame のみで、C0 の `indentClusters`（mext 13 / mhlw 15）を既存 assignment 規則（first match、x 範囲内）で T2 の全 node に再割り当て。frame は T3 node から再学習していない。
- Gate M1〜M8 全て PASS（M5: frame が C0 と完全一致、かつ frozen controlClusters と一致。M6: C0 / T1 / T2 の row table digest が frozen と全 PDF で一致。M8: same-range 6 PDF の C0=T1=T2=T3、5,893 row）。duplicate 0、unjoinable 0、非 hierarchy invariant 違反 0、既知値（2,080・536・490/37/9・5,893）再現。
- primary 2,080 row の component transition（R0 / R1 / R2 / R3 / R4 / R5）: L = 1,544 / 536 / 0 / 0 / 0 / 0、P = 2,071 / 9 / 0 / 0 / 0 / 0、K = 2,071 / 9 / 0 / 0 / 0 / 0。
- row tuple: (L=R0,P=R0,K=R0) 1,544、(L=R1,P=R0,K=R0) 527、(L=R1,P=R1,K=R1) 9。
- 既知 population: level_changed 490 は全て (L=R1,P=R0,K=R0)、newly_unclassified 37 は全て (L=R1,P=R0,K=R0)（T2 で P/K は C0 に戻っていて、残る L が T3 で C0 に戻る）、parent_changed 9 は全て (L=R1,P=R1,K=R1)（T2 では動かず、T3 で全 component が C0 に戻る）。
- manual 開始 node: C0 は x=51.765・cluster 0（level 1）・root・organization。T1 / T2 は同じ x の node が frame 27 / 34 cluster のうち cluster 1（level 2）に入り、T1 は親 p990 / p1006・unclassified、T2 は root・organization。T3 は C0 と同じ cluster 0・level 1・root・organization。
- frame 未割当 node は mext 649・mhlw 565（計 1,214）で、すべて manual range の外（primary row 0 件、R5=0）。
- 初回実行は M5 の frozen cluster 比較が key 順序依存（measurement bug）で全 PDF の gate が fail し INVALID になった。初回結果を `first-run-with-measurement-bug.json` に保存し、rule・population・intervention・gate を変えずに比較を key 順序非依存へ直す独立 commit で再実行した（comparison fix 以外の差はない）。

## Observation / Interpretation（D1 の範囲）

- 直前の T2 で残った L・P・K の差は、source range 全体から作られる x-cluster / level frame を C0 の frozen frame に替えるだけで、この population（mext / mhlw の manual 交差部 2,080 row）では全て C0 の状態に戻る。stack carry-over は kind / 親の一部（37 row）に、frame は level（536 row）と、stack では動かなかった parent 9 row を含めた残差に関与している。
- C0 が正しい、source-derived frame が誤り、manual contract が必要、full corpus に一般化できる、production 設計が決まった、とは主張しない。manual range は intervention 値の供給元であり GT ではない。MOF・PDF 目視は使っていない。

## 限界と次の論点

- 母集団は既存 contract の mext / mhlw のみ。T3 は manual 由来 frame を使うため、manual を必要としない source-only の frame 構成そのものは未検証（次 phase の論点）。
- 判定規則には、直前の網羅漏れの教訓として指示書の D1〜D5 に D6・D0 を追加した（今回は D1 に該当し、追加規則は使われていない）。

## Validation

tsc 0 error、lint error 0、vitest（replay・assignment・transition・synthetic routing 5 件）pass、評価の再実行で byte 一致、frozen hash guard、production code diff 0。

今回は counterfactual のみ。production hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。
