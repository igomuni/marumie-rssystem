# 概算要求PDF manual activation contract の必要性 paired diagnostic — protocol（treatment hierarchy を実行する前に固定）

page-header label 単独の activation boundary 路線の frozen negative result（branch `research/budget-request-refined-header-structural-reevaluation`、`35e8bc0`）の後続。新しい boundary evidence は探さず、前提を検証する: 既存の手書き activation range を再現しなくても、source から決定できている detail-table range 全体を activation unit として既存 DocumentHierarchy mechanism に適用できるか。manual boundary を再現する必要があるか、を観測する。manual boundary に treatment を近づける調整は禁止。production・hierarchy algorithm は変更しない。

## 1. One change（唯一の入力差分）
- Control: 既存 DocumentHierarchy（`observeDocumentHierarchyV2('detail', pages, HIERARCHY_B_ONLY_OPTIONS)`）+ 既存の手書き activation range（`hierarchyContractFor` の契約範囲）。
- Treatment: 同じ DocumentHierarchy + source-derived detail-table range。
- 変更禁止: hierarchy algorithm・FieldResolver・SourceToken・TableGeometry・LogicalRow・recordKind rule・item detector・name resolution・page-header projection・table-frame rule・layout range detector・MOF matcher・normalization・rotate・level_gap・x cluster threshold・stack・manual contract。

## 2. Population と range manifest
primary population = 既存 hierarchy 契約を持つ 8 PDF（`paired-manifest.json` `4fb70f3a…`）。source-derived range = frozen layout inventory（`layout-summary.json` `67808613…`）の layout range のうち、契約の開始 page を含み、header 成分を持つ（detail-table）もの。新しい range detector は作らない。`range-manifest.json`（SHA-256 `3e00df69…201e`）に PDF ごとの manual range・source-derived range・relation（exact_same / source_superset / source_subset / overlap_other）・page の region（intersection / manual_only / source_only / outside_both）を保存。機械的な結果: exact_same 6 PDF（cfa 7-147・env 21-193・maff-fukko 7-20・meti 9-106・mlit-fukko 7-10・mod 9-540）、source_superset 2 PDF（mext: manual 1045-1339・source 1-1339 で source_only 1,044 page、mhlw: manual 1555-1700・source 21-1723 で source_only 1,557 page）。

## 3. Paired join と change class
join key = `PDF + page + logicalRowIndex`（既存の anchor。前研究で使用）。control only / treatment only / both / unjoinable / duplicate key を数える（予期しない duplicate・unjoinable は STOP）。
region（page / row 単位）: intersection / manual_only / source_only / outside_both。same-range 6 PDF は全 row が intersection。
intersection の row の change class（排他的な primary を次の優先順で 1 つ割り当て、flag は multi-label でも保存）: newly_unclassified（recordKind が unclassified 以外 → unclassified）／unclassified_resolved（unclassified → 他）／record_kind_changed（他の kind の変化）／root_changed（root か否かの変化）／parent_changed（parent ref または parent status の変化）／level_changed（hierarchy level の変化）／other_changed（上記以外の出力 field の変化。name の status・値など）／unchanged。比較する field — hierarchy-derived: node か否か・x cluster・level・parent ref・edge status・root・recordKind・parent item / organization status。source-local: code・token・geometry・name・locator。

## 4. Phase A（source-only。MOF を見ない）
- A1 same-range exact control: 6 PDF で control と treatment の output（record 数・locator・recordKind・hierarchy level・parent ref・parent status・name status・provenance）が canonical に一致。control は frozen baseline の ON records artifact（`baselineOnRecordsSha256`）とも byte 一致することを確認する。不一致は infrastructure failure で STOP。
- A2 mext / mhlw intersection invariance: 上記の change class を数える。
- A3 source-only region の inventory（PDF 別）: page・logical row・node・root・organization・item・request・detail_line・unclassified・level_gap・parent resolved / unresolved / not_observed・name status・distinct x cluster・hierarchy depth。正しさは仮定しない。
- A4 state propagation: source range 全体の x cluster（xMin・xMax・memberCount・level）と manual range 単独の x cluster・cluster rank の対応・manual start の node の edge 状態（control: root か・親、treatment: 親 node が manual start より前か・祖先候補・level）を比較する。
artifact を freeze（Commit C）するまで Phase B を実行しない。

## 5. Primary decision（Phase A の前に固定）
- D4 `PAIRED_DIAGNOSTIC_INCONCLUSIVE`: same-range control の不一致・frozen dependency の不一致・duplicate / unjoinable・exception・provenance loss・source-derived range を一意に再現できない・control が frozen baseline と一致しない。
- D2 `ACTIVATION_RANGE_CHANGES_HIERARCHY_STATE`: D4 でなく、same-range 6 PDF は一致するが、mext / mhlw の intersection で、hierarchy-derived の field（level・parent・root・recordKind・parent status・node 性・x cluster）または source-local の field（name の status / 値など）のいずれかが 1 row でも変化する。manual contract が「正しい」とは結論しない（source-local の変化は FieldResolver の見出し layout の引き継ぎが range 開始位置で変わることに由来しうるが、range が出力を変える事実として D2 に含める）。
- D3 `SOURCE_RANGE_ADDS_ONLY_NONSEMANTIC_OR_ABSTAINED_STRUCTURE`: intersection が完全に不変で、source-only region に item・organization・親が resolved の request が 1 つも形成されない（件数がすべて 0。「ほぼ」の閾値は使わない）。manual contract 不要とはまだ言わない。
- D1 `SOURCE_RANGE_DROP_IN_REPLACEMENT_SUPPORTED`: 上記いずれでもない（same-range 一致・intersection 完全一致・duplicate / unjoinable / exception / provenance loss 0・再実行一致・manual region の output を壊さない・source-only region が deterministic に処理される）。semantic correctness・hierarchy precision は意味しない。
判定の順序: D4 → D2 → D3 → D1。

## 6. Phase B（Phase A の freeze 後のみ。post-freeze diagnostic）
MOF は generator の教師・range 選択に使わない。対象: mext / mhlw の intersection で treatment により kind / parent が変わった row（D2 の場合）、source-only region で item と分類された row、source-only region で親 item が resolved の request。項: 名称あり・exact_unique・exact_ambiguous・no_exact_match・name_unavailable（P1 matcher の原則、一般会計のみ、組織を安全に使える場合は P1 matcher、名称単独は診断のみと明記）。事項: 親 item が deterministic に解決した request のみ（parent exact_unique・jikou exact_unique・no_exact_match・parent_unresolved・name_unavailable。事項名だけを MOF 全体から検索しない）。MOF overlap が高くても source range が正しいとは言わず、低くても range を狭めない。Optional: frozen の range-local item candidate artifact（`full-evaluation.json`）の candidate と source-only region の hierarchy item の overlap（candidate は GT ではなく、候補規則も変更しない）。

## 7. 禁止・順序
full 74 / 82 PDF への rollout・production の変更・new range detector・page-header label の再調整・ambiguous 1,196 row の分解・manual boundary を再現する新 evidence の探索・semantic label の解釈・組織名辞書・MOF による range 調整・fuzzy・FieldResolver / recordKind / item detector / level_gap / x cluster threshold / stack の変更・rotate・manual contract の書き換え・結果を見た後の gate / range / rule の変更は行わない。Commit A（本書・range manifest）→ B（paired runner・comparator・integrity test）→ C（Phase A の frozen evaluation）→ D（Phase B）→ E（result・INDEX）。測定バグが見つかった場合は初回結果を保存し、population / rule / gate を変更したか否かを明記し、measurement fix は独立 commit、preregistration は書き換えない。
