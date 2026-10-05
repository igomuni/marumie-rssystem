# 概算要求 level-frame table-frame eligibility counterfactual — protocol（Phase A の結果を見る前に固定）

直前研究（cluster provenance、D1、`6f5d6b8`）の続き。source-only の evidence class を 1 つだけ（table-frame relation）追加し、level frame の x-cluster を構成する **support node だけ**を body / table position と判定できる node に限定する counterfactual（T4）を行う。node 自体は削除しない。C0・manual contract・MOF・header label の文字列は frame 構築に使わず、C0 に近づくことを成功条件にしない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseA-cluster-inventory.json tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseA-support-nodes.jsonl.gz tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseB-diagnostic.json tests/fixtures/budget-request-level-frame-cluster-provenance/2024/phaseB-prior-change-join.json.gz tests/fixtures/budget-request-hierarchy-level-frame/2024/evaluation.json tests/fixtures/budget-request-hierarchy-stack-reset/2024/evaluation.json tests/fixtures/budget-request-source-range-hierarchy/2024/range-manifest.json tests/fixtures/budget-request-source-range-hierarchy/2024/phaseA-evaluation.json scripts/pipeline-v2/lib/budget-request-p1-outlier.ts scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts scripts/pipeline-v2/lib/budget-request-level-frame-counterfactual.ts scripts/pipeline-v2/lib/budget-request-stack-reset-counterfactual.ts scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts scripts/pipeline-v2/lib/budget-request-field-resolver.ts scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts docs/tasks/20261005_1720_Budget_Request_Level_Frame_Cluster_Provenance_Result.md`: ``
- table-frame の既存 rule: `frameOf`・`classifyPosition`（FRAME_TOLERANCE = 0.5、`budget-request-p1-outlier.ts`）・`relationOf`（`budget-request-table-frame-eligibility.ts`）・long vertical rule の取得（`extractDrawingPrimitives` → `mergeVerticalRules` → `longRules`）を変更せず再利用する。

## 2. Population
- Primary: mext / mhlw（source-derived range、node universe は T2 と同じ。manual range は Phase B の比較ラベルとしてだけ使い、T4 construction には使わない）。
- Negative control: same-range 6 PDF（既存契約と source range が一致する PDF）。
- 全 8 PDF で T4 を実行する。

## 3. table-frame relation の node への適用（実装前に確認した技術的事実）
既存 `relationOf(bbox, longVerticalRules)` は bbox と page の long vertical rule だけを取る純関数であり、hierarchy node にそのまま適用できる。node の bbox = その node の logical row の `bbox`（LogicalRowCandidate.bbox、行全体）。page の long vertical rule は frozen の drawing-primitive 取得経路（page 単位の operator list）で得る。relation は `header_position_supported | body_or_table_position_supported | ambiguous | unavailable`。隣接 page からの補完はしない。

## 4. T4 の one change
T2（source range・node universe・eligibility・document order・stack reset（frozen locator: mext p1045 r4 / mhlw p1555 r4、same-range は reset なし）・stack algorithm・parent resolution・recordKind・FieldResolver）を base に、frame support を変える 1 点のみ。
1. frame support = relation が `body_or_table_position_supported` の node のみ。header・ambiguous・unavailable は support から除外（node は hierarchy に残す）。
2. T4 frame = 既存の `observeDocumentHierarchyV2('detail', ・・・, HIERARCHY_B_ONLY_OPTIONS)`（cluster algorithm・support minimum・ordering・level assignment は不変）を、support 以外の logical row を除いた page 入力に対して実行して得た `indentClusters`。この実行は frame を得るためだけに使い、node は使わない。
3. 全 T2 node（除外 node を含む）を T4 frame に既存 assignment 規則（first match、x 範囲内。`assignToFrame`）で割り当て、同じ reset 位置の stack replay と FieldResolver を T2 と同一に実行する。fallback は作らない。どの cluster にも入らない node は unplaced（既存 semantics、coverage cost として報告）。
4. 非介入の恒等性: 全 row を support にした同じ code path が T2 frame（frozen の 27 / 34 cluster と同一）を再現する。

## 5. Phase A（source-only。C0・manual range・T3・MOF 非参照）
node ごとに: PDF・page・logicalRowIndex・node id・keyTokenXMin・node bbox・frame availability・frame bbox（frameOf）・relation・support eligible・eligibility reason（`relationOf` の reason）・source provenance を保存。PDF ごとに: T2 node 数・relation 分布・support eligible 数・除外数（header・ambiguous・unavailable 別）・T4 cluster 数・cluster の x・support 数・page 数・page-span・run 数・layout range 関係（frozen layout summary）・T4 frame への frame-unassigned node 数。さらに x = 37.982 の T2 最左 cluster（frozen provenance の cluster 0）について、T2 support の relation 分布・T4 support 数・T4 cluster の有無・除外理由・node が hierarchy に残るか・T4 frame への割当状態を出す（この cluster の消失は gate にしない）。
**Phase A gate**: A1 T2 node universe が frozen と一致（mext / mhlw は frozen support node の node id 集合と一致、cluster 数 27 / 34）。A2 table-frame classifier / geometry code の hash が frozen 再利用と一致。A3 T4 construction（Phase A runner・lib）に C0 / manual / MOF / T3 への参照がない（source scan test）。A4 T4 以外の hierarchy code path が不変（hierarchy・FieldResolver の hash 不変、非介入の恒等性）。A5 duplicate / unjoinable 0。A6 provenance loss 0。A7 再実行 byte 一致。A8 production code hash 不変。1 つでも失敗なら primary decision を出さず INVALID。Phase A の artifact を commit（freeze）してから Phase B。

## 6. Phase B（freeze 後のみ。frozen の C0 / T1 / T2 / T3 / manual range 参照可）
- frame 遷移: T2 cluster ごとに、その T2 support のうち support eligible の数 e と全数 n で `support_removed`（e = 0）・`support_reduced`（0 < e < n）・`support_maintained`（e = n）。T4 の各 cluster は、区間が単一の T2 cluster の区間に含まれるなら「T2 由来」、含まれなければ `new_cluster`（含まれる場合に 1 つの T2 cluster に ≥ 2 の T4 cluster が入れば split として別途報告）。x / ordering の変更も列挙。removed を「誤り」と解釈しない。
- B4 33 / B5 12 は frozen Phase B diagnostic の relation を再利用し別表。
- row-level L/P/K: 2,080 row を frozen join key（PDF + page + logicalRowIndex）で、C0 / T1 / T2 / T3 / T4 について component（L = isNode・level・clusterX、P = parentItem・parentOrg・edgeStatus・parentId・root、K = kind・basis）ごとに集計。T2 → T4 の transition は既存の R0〜R5（C0 / T2 / T4 の比較、R5 = 欠落または T4 frame 割当不可）。known population（490 / 37 / 9）と manual 開始 node 2 を別出力。
- 非 hierarchy invariant: codeRaw・nameRaw・nameStatus・nameReason・geometry・tokenRefs が T2 と T4 で一致。
- same-range 6 PDF（5,893 row）: T2 → T4 の L/P/K 変化行数。変化があれば source-only relation まで分解（例外 rule は追加しない）。

## 7. 指標と数値 gate（事前固定）
- M1 Structural localization: T2 の B4 33 cluster のうち `support_removed` + `support_reduced` の割合。**過半数 = 17 cluster 以上**。
- M2 Primary hierarchy effect: primary 2,080 row の T2 → T4 の L/P/K transition。「新しい hierarchy change」の行 = いずれかの component が R3 または R4 の row。**大量 = 2,080 の 5% 超（> 104 row）**。
- M3 Negative-control stability: same-range 5,893 row の L/P/K 変化行 = 0。
- M4 Coverage cost: support 除外 node 数・T4 frame 割当不可 node 数・ambiguous / unavailable の件数。primary row の T4 割当不可（R5）が **2,080 の 10% 超（> 208 row）**、または primary 2 PDF のどちらかで T4 frame が 0 cluster なら coverage 不足。
C0 一致率を単一 score にしない。

## 8. 判定（優先順）
- **D0 `INVALID`**: Phase A gate A1〜A8 の失敗、frozen dependency 不一致、join failure、primary の非 hierarchy field の変化 > 0、production diff、preregistration 違反。
- **D4 `TABLE_FRAME_SUPPORT_COVERAGE_INSUFFICIENT`**: gate は通るが、primary 2 PDF の両方で T4 frame が構築できない、または primary の T4 割当不可 row が 10% 超（「どちらか」ではなく**どちらかの PDF で T4 frame が 0 cluster**も不足とする。上記 M4 のとおり）。
- B4 の過半数に structural effect（M1）が無い → **D3 `TABLE_FRAME_SUPPORT_SIGNAL_WEAK`**。
- M1 を満たすとき: same-range に L/P/K 変化がある → **D2 `TABLE_FRAME_SUPPORT_SIGNAL_PRESENT_BUT_CONTROL_REGRESSION`**。same-range が安定で primary の新しい hierarchy change が 5% 超 → **D5 `TABLE_FRAME_SUPPORT_CHANGES_DIFFERENT_COMPONENT`**。same-range が安定で new_cluster が 0 かつ新 change ≤ 5% → **D1 `TABLE_FRAME_SUPPORT_LOCALIZES_B4_WITHOUT_CONTROL_REGRESSION`**。それ以外の組合せ（例: same-range 安定・新 change ≤ 5% だが new_cluster > 0）は結果を見て規則を足さず **`INVALID_DECISION_RULE_GAP`**。
- routing test（synthetic）: D1・D2・D3・D4・D5・D0・RULE_GAP を網羅。

## 9. STOP と non-goals
親 commit・frozen hash 不一致、既知値（27 / 34・61 cluster・support 4,667・B1 16 / B4 33 / B5 12・536・1,214・2,080・5,893・reset locator）を再現できない、node universe / range / reset / production の変更、Phase A での C0 / manual / MOF 参照、decision rule の網羅漏れは STOP。non-goals: production 実装・full-corpus rollout・B5 専用 rule・merge / pruning rule・header label・organization 辞書・MOF・fuzzy・precision / recall・GT・PR 作成。結果を見て table-frame rule・tolerance・eligibility・cluster rule・bbox 定義を変更しない。測定バグは初回結果を保存し、独立 commit で修正する。
Commit A（本書）→ B（T4 実装・test の freeze）→ C（Phase A freeze）→ D（Phase B）→ E（result・INDEX）。
