# 概算要求 level-frame cluster provenance inventory — protocol（Phase A の inventory を見る前に固定）

直前研究（level-frame counterfactual、D1、`dae9d5c`）の frozen result は変更しない。本研究は新しい frame rule を作らず、T2（source-derived）frame の mext 27 / mhlw 34 cluster が**どの source node・page・layout・row shape で形成されているか**を source-only で inventory し（Phase A）、その freeze 後にだけ C0 frame / manual range との対応を diagnostic として記述する（Phase B）。C0・manual range・MOF は Phase A の feature / 分類の選択に使わず、Phase B でも teacher にしない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-hierarchy-level-frame/2024/evaluation.json`: `cb3c75bf9bb2dc2ffef9cff7adbd899d3020b68eb8ab42a6ee21a0a68186641a`
- `tests/fixtures/budget-request-hierarchy-level-frame/2024/component-rows.json.gz`: `66c0584bf55a0526d4d9c7791accb3fc281c49387f714ae3436c3ac62e11b239`
- `tests/fixtures/budget-request-hierarchy-stack-reset/2024/evaluation.json`: `e31d2cadecd30ef401b5fc2a77f2b930c1eacd38c7bb15a35f6988a87a0d0128`
- `tests/fixtures/budget-request-hierarchy-stack-reset/2024/causal-rows.json.gz`: `e19d0098d7995ecfc618c20fe99476d482f41e0b91aff54912d1c053b5f390c9`
- `tests/fixtures/budget-request-source-range-hierarchy/2024/range-manifest.json`: `3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e`
- `tests/fixtures/budget-request-source-range-hierarchy/2024/phaseA-evaluation.json`: `72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6`
- `tests/fixtures/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`: `67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266`
- `tests/fixtures/budget-request-layout-hierarchy-inventory/2024/layout-page-inventory.json`: `fb74ca44614e5170fb20508343551dd5491b37251f6774a45cb7a418b008441b`
- `scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts`: `4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d`
- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts`: `758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224`
- `scripts/pipeline-v2/lib/budget-request-level-frame-counterfactual.ts`: `07912b03fd9bf1353b8e7f3f826f3678b7fa1580f9fa23595047049776e4314e`
- `docs/tasks/20261005_1620_Budget_Request_Hierarchy_Level_Frame_Counterfactual_Result.md`: `1202922fdc33ddb00e27905b2dedb5c7da082ab59a553ac0217ad22e28058067`
- 補足: stack-reset の protocol / runner / lib、source-range の runner / compare lib は直前 protocol と同じ（実行時に guard）。

## 2. Phase A（source-only。C0・manual range・T3 assignment・MOF 非参照）
対象は mext / mhlw。source-derived activation range は frozen `range-manifest.json` の `sourceDerived` のみを読む（manual の field は読まない）。`observeDocumentHierarchyV2('detail', source range の全 page, HIERARCHY_B_ONLY_OPTIONS)` を実行し（T2 の frame は T1 の frame と同一）、`indentClusters`（既存 cluster id / order / 表現のまま）を cluster universe とする。support node = eligibility が candidate で `xIndentEvidence.clusterIndex` がその cluster の node（既存 assignment: x が [xMin, xMax] に入る最初の cluster）。FieldResolver は Phase A で使わない。
**support node ごとの provenance**: PDF・cluster id・node id・page・logicalRowIndex・keyTokenXMin・code raw（observedCodeParts）・rowShape・lexical class（node-local 規則: request_no_then_code かつ `^\d{2}-\d{2,5}$` → request_like、`^\d{3}$` → plain3、それ以外で `-` を含む → hyphen_other、数字のみ → other_numeric、その他 non_code）・rowTokenCount・page 内 node 順位（eligible node の document order での page 内 index）・eligibility の basis（headerEvidenceObserved の kind 一覧）・layout relation（frozen layout-summary の ranges で page が属する range の id `from-to`（どの range にも属さない page は `unassigned`）と signature、detail-range 分類 = signature が `H:` の直後が `-` でない、layout-page-inventory の page の header 有無・requestEvidence・requestDominantX）・rule-line relation = `not_available`（frozen rule-line inventory と決定的に join する key が無いため今回は付与しない。rule-line extractor は変更しない）。name status は FieldResolver 由来なので Phase A では扱わない。
**cluster ごと**: PDF・cluster id・level・xMin・xMax・memberCount・placementBasis・latticeEvidence の有無、support の min / max / distinct x・x spread、support page 数・first / last page・page list・contiguous page run（連続する整数 page の最大列）の一覧（start・end・support count）・run 数。「sparse」の閾値は作らず raw count のみ。
**source-only structural classification（記述軸。良い / 悪いではない）**:
- A Support extent: unique page 1 → `single_page`、run 1 → `multi_page_single_run`、run ≥ 2 → `multi_run`、support 0 → `unclassifiable`。
- B Layout concentration: support の layout range id が 1 種類 → `single_layout_range`、2 種類以上 → `multiple_layout_ranges`、全 support が `unassigned` → `layout_unavailable`。
- C Lexical composition: 5 class の count / ratio（primary label を選ばない）。
- D Request relation: request_like の count・それ以外の count・`mixed`（両方 > 0）。
- E Document distribution: run 1 → `contiguous`、run ≥ 2 → `reappears_in_separate_runs`。
**Phase A gate**: A1 T2 frame identity（cluster 数 27 / 34 と、cluster の xMin・xMax・memberCount・level が frozen `phaseA-evaluation.json` の treatmentClusters と順序込みで一致。key 順序非依存）。A2 support completeness（各 cluster の support 数 = memberCount、全 support の x が [xMin, xMax]）。A3 node uniqueness（同一 node が複数 cluster に出ない、全 eligible node がちょうど 1 つの cluster に入る、provenance の重複・欠落なし）。A4 source-only compliance（Phase A の生成 code に manual range / C0 / h0 / MOF / T3 への参照が無いことを source scan test で確認）。A5 deterministic rerun（byte 一致）。A6 production invariance（production code の hash 不変）。いずれか fail なら Phase B に進まない。
Phase A の artifact と classification を freeze commit してから Phase B を実行する。

## 3. Phase B（Phase A freeze 後のみ。C0・manual range・T3 assignment 参照可）
Phase A の cluster / feature / category は変更しない。C0 frame = C0 hierarchy の `indentClusters`（manual range の page で既存規則により生成。frozen controlClusters と照合）。各 T2 support node を T3 で使った既存 assignment（first match、x 範囲内）で C0 cluster に割当て、assigned C0 cluster id / unassigned・C0 level・T2 level を保存。距離関数・nearest・overlap 閾値は作らない。
**cluster-to-C0 relation（優先順）**: B6 `unclassifiable`（support 0 など assignment 不能）→ B4 `c0_unassigned_only`（全 support が unassigned）→ B5 `mixed_assigned_unassigned`（assigned と unassigned が混在）→ B3 `crosses_c0_clusters`（assigned が 2 以上の C0 cluster に分かれる）→ 残りは単一 C0 cluster に対応: その C0 cluster に対応する単一対応 cluster がこの 1 つだけなら B1 `one_to_one`、2 つ以上なら B2 `split_member`。意味（正しさ・余計さ）は持たせない。
**manual-region relation**: node の page が manual 開始 page より前 `before_manual`・manual 範囲内 `inside_manual`・終了 page より後 `after_manual`。cluster ごとに count、region ごとの unique page 数と layout range 数。cluster は削除・選択しない。
**rank shift**: primary intersection（manual 範囲内）の node の T2 level・C0 level・level delta、(T2 cluster, C0 cluster) の遷移 matrix。**split**: 単一 C0 cluster に対応する複数 T2 cluster の x・support count・page run・layout range・region count を列挙。「追加 cluster」(27-13 / 34-15) は count difference であり semantic category にしない。
**prior-change 536 join**: frozen `component-rows.json.gz`（prior フラグ true の row）と frozen stack-reset `causal-rows.json.gz`（change class）から機械的に 536 を導出し、node id `detail-p{page}-r{row}` で T2 support node に join、cluster・C0 assignment・level・B 分類・manual region composition・layout を付与。known subset 490 / 37 / 9 は別表。原因は推測しない。
**manual-start 2 node**: frozen stack-reset の locator node。frozen の観測（T1/T2 cluster 1・level 2、T3/C0 cluster 0・level 1）を再現した上で、T2 cluster の全 support provenance 要約・region 別 support・layout・lexical・B 分類を付与。
**C0 frame-unassigned 1,214 node**（mext 649・mhlw 565、primary intersection 0）: 属する T2 cluster・cluster ごとの count・page run・layout・region・lexical composition。「不要」と解釈しない。

## 4. Pattern family（Phase B 実行前に固定）
- P-A C0 split: 同一 C0 cluster に単一対応する T2 cluster が 2 以上。
- P-B C0-unassigned: B4 または B5 の T2 cluster が 2 以上。
- P-C manual-region concentration: support の全件が同一の 1 region に入る cluster が、同じ region で 2 以上。
- P-D layout-range concentration: support の全件が単一かつ同一の layout range id（`unassigned` を除く）に入る cluster が、同じ range で 2 以上。
- P-E repeated page-run: 2 以上の cluster が、同一の（start, end）の page run を共有する。
各 family は PDF 別に判定し、いずれかの PDF で成立すれば成立とする。「正しい cluster rule」を意味しない。

## 5. 判定（優先順: INVALID → D3 → D1 → D2）
- INVALID: Phase A gate A1〜A6 の失敗、frozen dependency 不一致、T2 frame を再現できない、duplicate / provenance corruption、production diff。
- D3 `CLUSTER_PROVENANCE_INCOMPLETE`: B6 > 0、または 61 cluster の relation 付与・536 row・manual-start 2 node・unassigned 1,214 node のいずれかに provenance join の欠落がある。
- D1 `CLUSTER_PROVENANCE_STRUCTURALLY_LOCALIZED`: 欠落なしで、P-A〜P-E のいずれかが成立。
- D2 `CLUSTER_PROVENANCE_REPRODUCIBLE_BUT_DIFFUSE`: 欠落なしで、P-A〜P-E がすべて不成立。
routing test（synthetic、実データ件数を使わない）: full + P-A → D1、full + P-B → D1、full + P-C → D1、full + なし → D2、B6 / join 不足 → D3、gate failure → INVALID。

## 6. 禁止と commit
cluster の削除・merge・support threshold・x threshold・layout ごとの frame・意味による選別・MOF・fuzzy・PDF 目視・production 変更・結果を見た後の feature / category / 規則の変更は行わない。Commit A（本書）→ B（Phase A code・test・inventory・A1〜A6 の freeze）→ C（Phase B）→ D（result・INDEX）。測定バグは初回 artifact を保存し独立 commit で修正する。
