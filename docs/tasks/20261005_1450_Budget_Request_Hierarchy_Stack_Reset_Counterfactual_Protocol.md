# 概算要求 hierarchy stack-reset counterfactual — protocol（T2 を実行する前に固定）

直前研究（D2、`0f17317`）の 536 row の hierarchy state change を、source-derived range の x-cluster / level frame を固定したまま manual 開始位置で stack だけを reset して因果分解する。manual boundary は intervention point としてのみ使い、GT / teacher ではない。MOF・PDF 目視・意味判断は使わない。

## 1. 依存 artifact（実行時に hash guard）


## 2. 条件
- C0: 直前 control（manual range、frame も stack も manual range から）。
- T1: 直前 treatment（source-derived range 全体の frame、stack は range 先頭から）。
- T2: T1 と同じ pages / nodes / x cluster / level をそのまま使い、**stack の replay だけ**を変える。stack は production の `observeDocumentHierarchyV2` が level 付与後に document order の eligible かつ placed の node へ適用する後段の pass（`while stack.top.level >= c.level pop`）なので、research runner が T1 の nodes から同じ pass を replay する。production code は変更しない。
- reset locator: T1 の nodes（document order）のうち hierarchyEligibility=candidate かつ placed で `sourcePage >= manual start page` を満たす最初の node の**処理直前**に stack を空にする。reset は PDF ごとにちょうど 1 回。manual end での reset はしない。reset 対象は manual range と source range の開始が異なる PDF（mext p1045・mhlw p1555）のみ。same-range 6 PDF は reset を発火させない（開始が一致するため）。
- replay の validity guard R0: reset なしで replay した edges が T1 の edges と（parentNodeId・childNodeId・status・ancestorCandidateNodeIds で）完全一致すること。不一致なら実装不成立で STOP。
- T2 の hierarchy = T1 の hierarchy（nodes・indentClusters・options）に、replay した edges を差し替えたもの。reset 後の edge の evidence は T1 の同 child の edge の evidence を保持する（ただし parent なしになった edge は no_preceding_shallower_heading の evidence）。FieldResolver は edge の status / parent / ancestors のみを読む。FieldResolver は変更せず `resolveFields({pages: source range 全 page, hierarchy: T2})` を実行する。

## 3. Population と join
- Primary: mext / mhlw、manual range ∩ source range の row（直前研究の 2,080 row。mext 1,082 + mhlw 998）。
- Negative control: same-range 6 PDF（5,893 row）。C0 = T1 = T2 を要求する。
- Diagnostic: C0 != T1 の 536 row（primary の比較から再導出）。
- join key: `PDF + page + logicalRowIndex`（直前と同じ）。duplicate・unjoinable が 1 件でもあれば INVALID。

## 4. 比較 field（schema 上の実在 field。T2 実行前に固定）
**hierarchy-state vector V**（RowRec）: `kind`（recordKind）、`basis`（recordKindBasis）、`parentItem`{status, ref}、`parentOrg`{status, ref}、`node.isNode`、`node.level`、`node.clusterX`、`node.edgeStatus`、`node.parentId`、`node.root`。`nameStatus`/`nameReason` は hierarchy の影響を受けうる別 field として V の外で invariant 確認する。
**非 hierarchy invariant I**: `codeRaw`、`nameRaw`、`nameStatus`、`nameReason`、`geometry`、`tokenRefs`。T1 vs T2 で全件一致を要求（M6）。
V の等価は JSON 完全一致。直前の change class（`classifyChange`、排他的 primary は newly_unclassified > unclassified_resolved > record_kind_changed > root_changed > parent_changed > level_changed、flags は multi-label）の定義は変更しない。

## 5. 因果分類（row ごと、V のみ）
S0: C0=T1=T2 / S1 `stack_reset_restores_control`: C0≠T1 かつ T2=C0 / S2 `reset_has_no_effect`: C0≠T1 かつ T2=T1 / S3 `mixed_residual`: C0≠T1 かつ T2≠C0 かつ T2≠T1 / S4 `reset_induced_change`: C0=T1 かつ T2≠C0 / S5 上記で表現できない（join / schema 欠落）。
field-level decomposition: 直前の primary change class（level_changed・parent_changed・newly_unclassified）ごとに、C0 vs T1 / T1 vs T2 / T2 vs C0 の changed row 数と S1〜S4 を出す。flags 別（level・parent・root・kind）の T2 vs T1 の変化数も出す。

## 6. Mechanism gate（すべて PASS が前提。1 つでも失敗なら INVALID/STOP）
M1: T1 と T2 の activation range（pages）が一致。M2: nodes の id 集合・順序が一致（T2 は T1 の nodes を共有）。M3: indentClusters が（xMin・xMax・memberCount・level・placementBasis で）一致。M4: node の xIndentEvidence（level・clusterIndex・placed）が node ごとに一致。M5: reset が mext / mhlw でそれぞれちょうど 1 回、locator は §2 の規則で決まる node で発火、same-range 6 PDF では 0 回。M6: T1 vs T2 の非 hierarchy field I が全件一致。加えて R0、C0 / T1 が直前 frozen artifact（`phaseA-evaluation.json` の rowTableDigests、各 PDF）と一致、same-range 6 PDF が C0=T1=T2、既知値（2,080・536・490・37・9・cluster 13→27 / 15→34・source-only 3,053 / 7,001）の再現。

## 7. 判定（D1→…ではなく次の優先順で機械的に決定: INVALID → D4 → D1 → D2 → D3）
- INVALID/STOP: 上記 gate・join・dependency・same-range 回帰・非 hierarchy 変化・production diff のいずれかが失敗。
- D4 `STACK_RESET_INTRODUCES_ADDITIONAL_STATE_CHANGE`: S4 > 0（S1〜S3 も報告）。
- D1 `STACK_CARRYOVER_SUFFICIENT_FOR_PRIOR_CHANGE`: S4 = 0 かつ S3 = 0 かつ 536 row 全てが S1。
- D2 `STACK_AND_RANGE_GLOBAL_STATE_BOTH_CAUSAL`: S1 > 0 かつ S2 + S3 > 0（S4 = 0）。
- D3 `STACK_RESET_NO_OBSERVED_EFFECT`: S1 = 0 かつ S3 = 0 かつ 536 row で T2 = T1（S4 = 0）。
- 上記のいずれにも当たらない場合（S4=0・S1=0・S3>0 など）は規則の網羅漏れとして INVALID に分類し、結果をそのまま報告する（判定後に規則を書き換えない）。

## 8. Manual-start targeted diagnostic
mext / mhlw それぞれで manual start page 以降の最初の hierarchy node について、C0 / T1 / T2 の level・parentId・edgeStatus・kind、T1 の親 node（page）、T2 で親関係が消えたか、level が T1 のままか、を記録する。想定を結果として書かない。

## 9. 禁止
production code の変更・manual range の削除・source range の採用・新 boundary detector・header-label 調整・FieldResolver / recordKind / item detector / x cluster / level / stack algorithm の変更・MOF・fuzzy・candidate overlap・PDF 目視・結果を見た後の条件変更。Commit A（本書）→ B（runner・test）→ C（frozen evaluation）→ D（result・INDEX）。測定バグは初回結果を保存し、独立 commit で修正する。
