# Hierarchy Stack-Reset Counterfactual — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

事前登録した判定規則では **INVALID（規則の網羅漏れ `uncovered`）**。gate・join・same-range 回帰・非 hierarchy 不変は全て PASS で、測定自体は有効。S1=0・S2=499・S3=37・S4=0 は D1〜D4 のどれにも当たらない（D2 は S1>0 を、D3 は S3=0 を要求）。規則は結果を見た後に書き換えない。次 phase の分岐も、この結果に対応する分岐は事前に定義されていない。

## Fact（frozen: `evaluation.json` sha `e31d2cad…0d0128`、`causal-rows.json.gz` sha `e19d0098…c9`）

- C0 / T1 は直前の frozen row table digest と全 PDF で一致。既知値（2,080・536・490/37/9・cluster 13→27 / 15→34・source-only 3,053 / 7,001・same-range 5,893）を再現。
- Gate PASS: replay validity R0（reset なし replay が T1 edges と一致）、M1〜M6（reset は mext p1045・mhlw p1555 の先頭 node 直前に各 1 回、same-range 6 PDF は 0 回、T1/T2 の node・cluster・level 同一、非 hierarchy field 全件一致）。duplicate 0、unjoinable 0。same-range 5,893 row は C0=T1=T2。
- 因果分類（primary 2,080 row）: S0 1,544、S1 0、S2 499、S3 37、S4 0、S5 0。
- field 別（C0 vs T1 → T2）: level_changed 490 は全て S2（T2 でも不変）、parent_changed 9 は全て S2、newly_unclassified 37 は全て S3（T1 から変化し、C0 にも戻らない）。
- S3 37 row の T2 vs C0 の差は level_changed のみ。T1 vs T2 の差は unclassified_resolved と parent_changed（うち 4 row は root_changed も）。つまり reset により kind・parent・root は C0 と同じ状態に戻るが、level（source-derived frame）は T1 のまま残る。
- manual 開始 node（mext p1045 r4 / mhlw p1555 r4）: C0 は organization・level 1・root。T1 は unclassified・level 2・親 p990 / p1006 の node。T2 は organization・level 2・root（親関係が消え、level は T1 のまま、kind は C0 と同じ）。
- T1 vs T2 の manual range 外の差: mext 0、mhlw 3（manual end 以降。primary 対象外）。

## Observation / Interpretation（規則の範囲）

- この population では、stack carry-over は kind と親の変化（37 row の kind、manual 開始 node の root 化など）の原因として観測されたが、level の変化 490 row と 親 9 row には影響しなかった（level は x-cluster / level frame 側）。判定としては網羅漏れ（INVALID）であり、D1〜D4 のいずれも主張しない。
- 「control が正しい」「source range が誤り」「T2 が production 案」「full corpus へ一般化できる」は主張しない。

## 限界と次の論点

- 母集団は mext / mhlw の manual 交差部のみ。MOF・PDF 目視は使っていない。
- 事前登録の判定が S1=0 かつ S3>0 を網羅していなかった（instructions の D1〜D4 自体の穴）。次の指示で、level の frame 起因（S2 の 499 row）と、stack 起因で kind / parent だけが戻る S3 の 37 row を分けて扱う規則を新しく事前登録するかを判断する。

## Validation

tsc 0 error、lint error 0、vitest（replay・分類・判定の単体 5 件）pass、評価の再実行で byte 一致、frozen hash guard、production code diff 0。

今回は counterfactual のみ。production hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。MOF と manual contract は GT でも oracle でもない。
