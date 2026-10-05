# 概算要求 header-position level-frame support provenance isolation — protocol（feature の全件列挙・比較の前に固定）

直前研究（table-frame eligibility counterfactual、D3、`c11bf55`）は変更・再解釈しない。T4 で除外された primary の x = 37.982 header-position support と、same-range 6 PDF で level frame に参加していた header-position support が、**source-only provenance 上で構造的に区別できるか**を、新しい rule を作らずに inventory する failure isolation（H1: 区別できる／H0: 現在の evidence では区別できない。H0 も有効な成果）。T5・新しい eligibility / pruning / merge rule・x = 37.982 専用除外・threshold 探索・table-frame rule や logical-row bbox の変更は行わない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseA-t4-frame.json`: `51e128205dbbd00c4ebae206ad6060f8098e3167cef78d229df89b91cf09fac8`
- `tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseA-node-relations.jsonl.gz`: `21f167c30d5f3ac51821de36bc3f53e87df88718c90474fba7eae6f44a46dcea`
- `tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseA-freeze-manifest.json`: `fb93c036377b769f5669e4da2ec299e6aca50c232c5cbaa8bcf9c9f99e4ddf49`
- `tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseB-diagnostic.json`: `e93fc23adac0b77c2ec83ee8d933576defe94ce47e9f597621fa89377d7b73ca`
- `tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseB-frame-transition.json.gz`: `8ac8f21deb22528d1c930663667617112bd6fb92b286a31f6f0b4db7d8c106ab`
- `tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseA-cluster-inventory.json`: `2bb3e5929fcb9539b78018f740c112222956fd70a776796322e5900d46b672e5`
- `tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseA-support-nodes.jsonl.gz`: `fef26771118722adf35d9f367b4bdab03c0897c8f5f8efeecb9fdc3b4ee34b6e`
- `tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseB-diagnostic.json`: `60dea6388658118a1aeb6aafd50633f88fd9679467f0cff03e41d13e40b5b3f6`
- `tests/fixtures/budget-request-source-range-hierarchy/2024/range-manifest.json`: `3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e`
- `tests/fixtures/budget-request-source-range-hierarchy/2024/phaseA-evaluation.json`: `72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6`
- `tests/fixtures/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`: `67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266`
- `scripts/pipeline-v2/lib/budget-request-p1-outlier.ts`: `9cb749d2a3b80f1e71ff3993f9db77e57c723f552c56e1ea5d3a88a11637e5d4`
- `scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts`: `b43eab8b5e129b5755619c9ea3f037682a2d843dae8c4fbfb39535ab5bfffdf2`
- `scripts/pipeline-v2/lib/budget-request-table-eligibility-frame.ts`: `802796e97f2d5d644f60667e91f3201184c41475e3ecc42939b54b540b43a2b9`
- `scripts/pipeline-v2/lib/budget-request-cluster-provenance.ts`: `d8f24f672c537e5fcf27482f83c8c3c312f0076215b460fcb7506cb969183764`
- `scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts`: `4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d`
- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts`: `758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224`
- `scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts`: `d2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5`
- `docs/tasks/20261005_1800_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Result.md`: `f52320b58a6b9c1b612d1d0a3b673b442fe9b7270da2e95c0a2705ebeae26b0c`
- table-frame classifier（`frameOf`・`classifyPosition`・`relationOf`、tolerance 0.5）・T4 の node relation artifact は上記 frozen を再利用し、新しい geometry・bbox rule は作らない。

## 2. Population（frozen artifact から機械的に、outcome 非依存に列挙。件数は hard-code しない）
- **P1**: mext / mhlw の T2 frame で x = 37.982 の cluster（frozen cluster provenance の cluster 0、xMin = 37.982）に属し、frozen T4 relation が `header_position_supported` の node 全件。期待値 mext 450 / mhlw 450 / 計 900（A1 で照合、不一致は STOP）。
- **P2**: same-range 6 PDF（range-manifest の relation が `exact_same`）の T2 support node（eligible node のうち T2 cluster に属するもの）のうち、frozen T4 relation が `header_position_supported` の node 全件。L/P/K の変化では選ばない。
- **P3**: same-range 6 PDF の T2 support node のうち relation が `body_or_table_position_supported` の node（secondary）。
- **P4**: mext / mhlw の B4 cluster（frozen cluster provenance の relation）のうち、frozen T4 の support effect が `support_maintained` の cluster の T2 support node（secondary）。
- 主比較は **P1 vs P2**。P3 / P4 は補助の diagnostic で、P1 vs P2 の代替にしない。
- population の identity は frozen の失敗解析結果から利用してよいが、feature の構成には使わない。

## 3. Phase A / B の分離
Phase A の feature 構成は、C0・manual range・MOF・L/P/K の変化・T3・T4 の downstream row outcome・名称の意味・text の人間解釈を参照しない。feature は SourceToken・TableGeometry・LogicalRow・既存 hierarchy node・frozen layout inventory・frozen T4 の node relation（source-only の Phase A artifact）だけから作る。Phase A の artifact を commit（freeze）してから Phase B（outcome との join）を実行し、Phase B の結果で Phase A の feature・bin・規則を変更しない。

## 4. Feature family（事前登録。parent / stack / level は使わない）
node ごとに保存する。値が取れない場合は null とし、missing reason を残す（隣接 page からの補完はしない）。
- **F1 page / run**: page、normalized page position（(page − 範囲先頭) / (範囲末尾 − 範囲先頭)）、その node の T2 cluster の support page から作る contiguous page run の id / run の page 長、cluster の support page 数、span、run 数、contiguous か multi-run か、page 内 node ordinal、page 内 hierarchy node 数。manual boundary からの距離は作らない。
- **F2 layout**: frozen layout-summary の range id（from-to、無ければ unassigned）・signature・detail 分類（signature が `H:` で始まり `H:-` でない）・range 内 page position・range length・cluster support の layout range 数・単一 / 複数。
- **F3 table-frame geometry**（frozen relation の入力 geometry。tolerance は既存の 0.5）: frame available、frame bbox、row bbox、row top / bottom、row と frame top / bottom の signed distance（yMin − top、yMax − top、yMax − bottom）、row と frame left / right の signed distance（xMin − left、xMax − right）、row-frame overlap relation（既存の classification）、frozen relation。
- **F4 lexical shape（意味なし）**: token 数、first token class（rowShape）、plain3 flag、request-shaped flag、code-shaped flag、numeric-only flag、code token 長、following-token 有無、row の文字数、正規化（NFKC・空白除去）後の文字数、character-class signature（digit / punctuation / kana / kanji / latin / other を連続畳み込みした記述）。
- **F5 sequence**（同一 source-derived range 内、hierarchy node の前 3 / 後 3）: 前 / 後 k = 1..3 の node との x 関係（shallower / same / deeper。same は既存 parameter clusterGap 以内）、rowShape、request-shaped flag、page をまたぐか、logical-row distance（同一 page のみ）。さらに same-x run の長さと first / middle / last / only。
- **F6 cluster morphology**（T2 cluster の support）: node 数、page 数、PDF 数、density（node 数 / page 数）、extent（single_page / multi_page_single_run / multi_run）、first / last support page の normalized position、gap 数（run 数 − 1）、最大 gap（run 間の空き page 数）、layout range 数、request-shaped support 数、non-request support 数。

## 5. Circular feature（D1 / D2 の separator 判定から除外。descriptive と Phase B には使える）
absolute x（keyTokenXMin、row bbox の xMin / xMax、frame left / right に対する x の signed distance）、x bin、cluster index / rank、T2 cluster id、leftmost flag、T4 で除外されたという事実、PDF identity（mext / mhlw という名前）、manual 開始より前 / 後、C0 関連、L/P/K outcome。F1〜F6 の他の feature は non-circular とする。

## 6. 連続量の bin（結果を見ずに固定。post-hoc な閾値探索はしない）
- 個数 / 長さ（count）: 下限含む半開区間で境界 `[0, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, ∞)`。
- signed distance（pt）: 境界 `(-∞, -100, -50, -20, -5, 0, 5, 20, 50, 100, ∞)`。
- 比率・normalized position（0〜1）: 幅 0.1 の 10 区間。density: 境界 `[0, 1, 1.5, 2, 3, 5, 10, ∞)`。
- カテゴリ値の distinct 数が P1 ∪ P2 で 20 を超える feature（例: character-class signature）は separator 判定の対象外（descriptive のみ）。
- raw の分布・quantile は descriptive に出してよいが separator には使わない。

## 7. 比較と separator の定義
feature ごとに（P1 vs P2）: availability、distinct value 数、P1 / P2 の分布、overlap、disjoint か否か、categorical（binned）の total variation distance（TVD）、missing rate、PDF 別（mext P1 vs P2、mhlw P1 vs P2、combined、P2 の PDF 別分布）。
- **complete structural separator**（non-circular feature のみ）: P1 と P2 の observed value set が disjoint、P1 / P2 の availability がともに 0.95 以上、mext P1 と mhlw P1 のそれぞれの value set が P2 の value set と disjoint、PDF identity そのものではない。
- **strong partial separator**（complete が無い場合、non-circular feature のみ）: combined の TVD ≥ 0.80、P1 / P2 の availability がともに 0.90 以上、mext P1・mhlw P1 それぞれの最頻値が combined P1 の最頻値と同じで、その値の相対頻度が P1_pdf より P2 で低い、P2 から任意の 1 PDF を除いても TVD(P1, P2 − q) ≥ 0.80。
- 閾値（0.95 / 0.90 / 0.80）は結果を見て変更しない。

## 8. Phase A integrity gate
A1 P1 = 900（mext 450 / mhlw 450）。A2 P2 / P3 / P4 が frozen artifact から一意に列挙できる（互いに重複しない）。A3 duplicate node id = 0。A4 unjoinable = 0（population の node が hierarchy・relation・layout・cluster 所属に join できる）。A5 source provenance loss = 0。A6 frozen table-frame / layout implementation の hash 一致。A7 Phase A の feature 構成に C0 / manual / MOF / T3 / T4 downstream / L/P/K outcome の参照がない（source scan test）。A8 再実行 byte 一致。A9 production code hash 不変。

## 9. 判定（優先順 D0 → D4 → D1 → D2 → D3）
- **D0 `INVALID`**: A1〜A9 のいずれかの失敗、frozen mismatch、preregistration 違反、production diff。判定規則の網羅漏れは結果を見て追加せず `INVALID_DECISION_RULE_GAP`。
- **D4 `SOURCE_FEATURE_COVERAGE_INSUFFICIENT`**: P1 または P2 の 10% 超の node で feature universe（hierarchy node・relation・layout・cluster 所属への join）を構成できない。個別 feature の missing はその feature の availability として扱い、population 全体を落とさない。
- **D1 `HEADER_SUPPORT_PROVENANCE_STRUCTURALLY_DISTINCT`**: non-circular な complete structural separator が 1 つ以上ある。
- **D2 `HEADER_SUPPORT_PROVENANCE_PARTIALLY_LOCALIZED`**: complete は無いが non-circular な strong partial separator が 1 つ以上ある。
- **D3 `HEADER_SUPPORT_NOT_DISTINGUISHABLE_WITH_CURRENT_SOURCE_EVIDENCE`**: 上記のいずれにも該当しない。
- routing test（synthetic）: D0・D4・D1・D2・D3・gap を網羅。

## 10. Phase B（Phase A freeze 後のみ）
P2 と same-range の T4 変化 row（frozen table-eligibility Phase B の `sameRangeControl.detail`）の join（P2 total・変化 row に関与・unplaced に関与・関与しない）、P1 と primary の変化（462 / 55 / 64・manual 開始 2 node）との relation（row は manual range 内で、P1 が manual 開始前にあるかを page で見る）、P2 vs P3・P1 vs P4 の secondary comparison、representative example（population × 主要カテゴリごとに stable node id の辞書順先頭 2 件）。この outcome で Phase A の separator を調整しない。「manual 開始前だから除外する」rule は作らない。

## 11. STOP と non-goals
親 commit・frozen hash の不一致、P1 900 / T4 relation を再現できない、P2 を outcome 非依存に列挙できない、production code の変更が必要、新しい geometry threshold が必要、node provenance の喪失、規則の網羅漏れ。non-goals: T5・新 rule・full-corpus rollout・MOF・fuzzy・precision / recall・GT・PR 作成。測定バグは初回出力を保存し独立 commit で修正して開示する。
Commit A（本書）→ B（Phase A 実装 freeze）→ C（Phase A freeze）→ D（Phase B）→ E（result・INDEX）。
