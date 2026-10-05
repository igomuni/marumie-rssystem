# 概算要求 hierarchy level-frame counterfactual — protocol（T3 を実行する前に固定）

直前研究（stack-reset、`cc01c47` / `c0311ca`）の判定は「事前登録規則の網羅漏れで INVALID、measurement は有効」として保存し、書き換えない。本研究は別の研究単位で、T2（source-derived range + manual 開始直前の stack reset）から **level frame の参照元だけ**を C0 の frozen frame に替えた T3 を作り、T2 の残差が frame に反応するかを見る。manual range は counterfactual の入力値の供給元であり GT ではない。MOF・PDF 目視・意味判断は使わない。

## 1. 依存 artifact（実行時に hash guard。親 commit `c0311ca`）
- `tests/fixtures/budget-request-hierarchy-stack-reset/2024/evaluation.json`: `e31d2cadecd30ef401b5fc2a77f2b930c1eacd38c7bb15a35f6988a87a0d0128`
- `tests/fixtures/budget-request-hierarchy-stack-reset/2024/causal-rows.json.gz`: `e19d0098d7995ecfc618c20fe99476d482f41e0b91aff54912d1c053b5f390c9`
- `scripts/pipeline-v2/run-budget-request-hierarchy-stack-reset-counterfactual.ts`: `b1b5f54382b4b34a876c65ec3ec4b94a05fcf2268d1a6af8e980149f341a4a5c`
- `scripts/pipeline-v2/lib/budget-request-stack-reset-counterfactual.ts`: `b0f940c99ec27a1ca4a185b811f944b8beda093862b0230912a5133999889c61`
- `docs/tasks/20261005_1520_Budget_Request_Hierarchy_Stack_Reset_Counterfactual_Result.md`: `31fc3cb2c4342a0f777a47844693d6d29de8b95ea986f6b74e4398186cc87e74`
- さらに前の依存（source-range の range-manifest・phaseA-evaluation・compare lib・hierarchy v2・field resolver）は直前 protocol と同じ hash（実行時に runner の guard で検査）。

## 2. 現行 code の source evidence（実装前に確認した事実）
1. x-cluster は `IndentClusterV2`（clusterIndex・xMin・xMax・memberCount・level・placementBasis・latticeEvidence）の配列 `indentClusters`。
2. 生成規則: eligible node の `xIndentEvidence.keyTokenXMin` を昇順に並べ、隣接差 ≤ clusterGap（referenceFontSize 由来）で group 化。support ≥ minClusterSupport の group を placed、`singletonRootPlacement: lattice-supported` の規則で左端 singleton を追加 placed。level = placed cluster の昇順 rank（1 始まり）。
3. node の assignment: `x >= xMin && x <= xMax` を満たす最初の cluster に `{clusterIndex, level: cluster.level, placed: level !== null}` を割り当てる。どの cluster にも入らない node は初期値（clusterIndex null・level null・placed false）のまま = unplaced で stack に入らない。
4. C0 の frame は C0 hierarchy の `indentClusters` そのもの（mext 13・mhlw 15 cluster）で、runner 内で再現でき、直前 frozen artifact の `phaseA-evaluation.json`（controlClusters の xMin・xMax・memberCount・level）とも照合できる。T1 / T2 は 27 / 34 cluster（source range 全体の eligible node から生成）。
5. frame と stack の境界: level の付与（cluster → node）は stack pass の前段で完結し、stack pass は node の level と document order だけを読む。したがって frame を差し替え、stack pass を同じ replay にすればよい。production code の変更は不要。

## 3. T3 exact contract
- T3 hierarchy = T2 の hierarchy の複製に対し、(a) `indentClusters` を C0 hierarchy の `indentClusters` に置換、(b) eligible な各 node の `xIndentEvidence` を、**C0 frame に対し上記 §2-3 の既存 assignment 規則（first match、x 範囲内）で**再割り当て（node の x は T2 の `keyTokenXMin` のまま。frame は T3 node から再学習しない・nearest 閾値や許容差は追加しない）、(c) stack を replay して edges を作り直す（node population・document order・eligibility・activation range は T2 と同一）。
- reset: T2 の frozen locator node id（mext `detail-p1045-r4`、mhlw `detail-p1555-r4`。`evaluation.json` の `resetEvents`）の位置、すなわち document order でその node の**処理直前**に stack を空にする。その node が T3 で unplaced になっても reset の位置は変えない（`replayStackAtNode`）。manual end での reset はしない。
- FieldResolver は `resolveFields({pages: source range 全 page, hierarchy: T3})`。FieldResolver 等は変更しない。
- assignment fail-closed: eligible な node の x が C0 の cluster のどれにも入らない場合、その node の row は **R5（unavailable）**として扱い、置換えたり近傍 cluster へ割り当てたりしない（件数を `frameUnassignedNodes` として報告）。cluster に入るが level が null の node は assignment 成功（unplaced、既存 semantics）。
- 変更しないもの: range・node population・eligibility・document order・reset・stack algorithm・FieldResolver・recordKind。

## 4. Population と join
primary = mext / mhlw の manual ∩ source の row（2,080。直前と同じ key `PDF + page + logicalRowIndex`）。prior-change diagnostic = primary から再導出した `V(C0) != V(T1)` の row（536 は hard-code しない）。negative control = same-range 6 PDF（5,893）。targeted = manual 開始 node。duplicate・unjoinable は INVALID。

## 5. Component 状態ベクトル（実 schema の field。重複計上なし）
- **L（level）**: `node.isNode`、`node.level`、`node.clusterX`。
- **P（parent / edge）**: `parentItem`{status, ref}、`parentOrg`{status, ref}、`node.edgeStatus`、`node.parentId`、`node.root`。
- **K（kind）**: `kind`（recordKind）、`basis`（recordKindBasis）。
- **非 hierarchy invariant I**: `codeRaw`・`nameRaw`・`nameStatus`・`nameReason`・`geometry`・`tokenRefs`（locator は join key、activation range と node population は M1・M2）。T2 vs T3 で 1 件でも変化したら INVALID。

## 6. Mechanism gate（全て PASS が前提）
M1 activation range（pages）T2=T3。M2 node id 集合・eligibility T2=T3。M3 document order（node id 列）T2=T3。M4 reset event: PDF ごとにちょうど 1 回、locator node id が frozen T2 と同一（same-range 6 PDF は 0 回）。M5 frame identity: T3 の `indentClusters` が C0 hierarchy のそれと完全一致（clusterIndex・xMin・xMax・memberCount・level・placementBasis・順序）、かつ frozen `phaseA-evaluation.json` の controlClusters と一致。M6 T2 reproduction: intervention 無効（T2 frame）で再生成した T2 の row table digest が frozen `evaluation.json` の `tableDigests.t2` と全 PDF で一致、C0 / T1 digest も frozen と一致。M7 非 hierarchy invariant I 全件一致。M8 same-range 6 PDF は C0=T1=T2=T3（5,893 row）。加えて既知値（2,080・536・490/37/9・S1=0/S2=499/S3=37/S4=0・cluster 13→27 / 15→34・source-only 3,053 / 7,001・same-range 5,893・T2 の manual-start 状態）を frozen artifact と照合。

## 7. Component-wise transition（primary 各 row の L/P/K ごと）
R0: `T2 == C0` / R1: `T2 != C0` かつ `T3 == C0` / R2: `T2 != C0` かつ `T3 == T2` / R3: `T2 != C0` かつ `T3 != T2` かつ `T3 != C0` / R4: `T2 == C0` かつ `T3 != C0` / R5: 欠落または frame 未割当（その row の 3 component すべて）。L/P/K を別集計し、row-level tuple `(L,P,K)` は観測された全種を出す。490（level_changed）・9（parent_changed）・37（newly_unclassified）は C0 vs T1 の primary change class（直前の `classifyChange` 定義）から機械的に追跡する。

## 8. 判定（優先順: INVALID → D4 → D5 → D1 → D2 → D3 → D6 → D0 → 網羅漏れは INVALID）
R1〜R5 は L・P・K の合計。
- INVALID: 上記 gate・join・dependency・same-range 回帰・invariant 違反・production diff のいずれかが失敗。
- D4 `LEVEL_FRAME_INTERVENTION_INTRODUCES_NEW_DIFFERENCE`: R4 > 0。
- D5 `FRAME_ASSIGNMENT_INCOMPLETE`: R4 = 0 かつ R5 > 0。
- D1 `LEVEL_FRAME_EXPLAINS_ALL_RESIDUAL_COMPONENT_DIFFERENCE`: R4 = R5 = 0、R2 = R3 = 0、R1 > 0。
- D2 `LEVEL_FRAME_IS_A_CAUSAL_FACTOR_WITH_RESIDUAL`: R4 = R5 = 0、R1 > 0、R2 + R3 > 0。
- D3 `NO_OBSERVED_LEVEL_FRAME_EFFECT`: R4 = R5 = 0、R1 = 0、R3 = 0、R2 > 0。
- D6 `LEVEL_FRAME_RESPONSIVE_WITHOUT_RESTORATION`（本 protocol で追加、直前研究の網羅漏れの教訓。指示書の D1〜D5 に含まれない組合せ）: R4 = R5 = 0、R1 = 0、R3 > 0。
- D0 `NO_T2_RESIDUAL`: R1〜R5 すべて 0（T2 と C0 に差が無い）。
- 判定規則は結果を見た後に変更しない。

## 9. 決定規則の網羅性 test（実データ件数を使わない synthetic）
all restored（D1）、partial restored + residual（D2）、no effect（D3）、newly introduced（D4）、assignment unavailable（D5）、responsive but not restored（D6）、no residual（D0）、gate failure（INVALID）、R4 と R5 の同時（D4）、R1 と R3 のみ（D2）、routing の全 3 component 合算。

## 10. 禁止と commit
production code の変更・manual range の削除・source range の採用・新 boundary detector・FieldResolver / recordKind / item detector / x cluster 規則 / level 定義 / stack algorithm の変更・MOF・fuzzy・PDF 目視・結果を見た後の frame・assignment・規則の変更は行わない。Commit A（本書）→ B（runner・replayStackAtNode・routing test）→ C（frozen evaluation）→ D（result・INDEX）。測定バグは初回結果を保存し独立 commit で修正する。
