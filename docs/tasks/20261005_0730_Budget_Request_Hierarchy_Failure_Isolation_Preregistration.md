# 概算要求 hierarchy / record detection failure isolation — 事前登録（Phase A–C）

full-corpus baseline（branch `research/budget-request-full-corpus-baseline`、HEAD `e630c1c`）の後続。production code は変更しない。OFF の結果は、本書を commit するまで計算・閲覧しない。

## 0. 依存（凍結）の確認

| 対象 | 値 |
|---|---|
| corpus manifest SHA-256 | `4a2a10ec…dde7a`（82 PDF / 9,899 pages / digest `af9b06fa…5e5dc`） |
| baseline extraction / population / reconciliation | `89b28cbe…069f` / `3ec53c13…bf8` / `2f14d15c…2904` |
| P1 matcher | `da08b377…c19a`（無修正で再利用） |
| FieldResolver（production、無変更） | `758eb8f6…b224` |
| baseline 数値 | 成功 74 / hard_failure 8、request 4,245、item 97、unclassified 15,304、親 `not_observed` 3,971、一般会計 request 2,993、comparable 101、exact_unique 98 を artifact から再確認済み |

## A. 作用機構の inventory（read-only、`scripts/pipeline-v2/lib/budget-request-field-resolver.ts`）

### Fact（コード）

1. `resolveFields({ pages, hierarchy })` の `hierarchy` は `DocumentHierarchyV2Result | null`。null なら `idx = null`（`resolveFields` 冒頭）。baseline runner は hierarchy 契約のある区間でのみ `observeDocumentHierarchyV2` を呼んで渡し、それ以外は null を渡す。
2. `recordKind` の決定順（コード行に対応）: ① 行頭の request 番号あり → `request`、② ハイフン付きコード → `detail_line`、③ 3 桁コードのみで hierarchy node がある → `kindFromHierarchy`（root → `organization`、親が organization → `item`、親が request/item → `detail_line`、edge が resolved でない／strong header 衝突 → `unclassified`）、④ それ以外（plain code で node 無し。hierarchy null を含む）→ `unclassified`。
3. したがって `item` と `organization` は ③ からしか生じない（hierarchy が null なら生じない）。`request`（①）とハイフン付き `detail_line`（②）は hierarchy に依存しない。plain code の `detail_line` は ③ からしか生じない。
4. request の親の項（`parentItemAssociation`）: `idx` が null → `not_observed` / `hierarchy_artifact_not_available`。`unclassified` → `unresolved` / `record_kind_undetermined`。node 無し → `not_observed` / `row_is_not_a_hierarchy_node`。edge が Safe（`resolved_by_indent_sequence` かつ strong header 衝突無し）のときのみ `resolved`（親 node ref を保持）。`parent_item_not_item_kind` は FieldResolver ではなく P1 matcher が、解決済みの親 record の `recordKind !== 'item'` から付ける診断。
5. 名称（`rowLocal.name`）・金額・column layout は hierarchy を読まない（`hierarchyDependent` 以外の field）。`lastHeaderLayout` は区間内で引き継がれる。
6. SourceToken / TableGeometry / LogicalRow は hierarchy を入力にしない（runner の呼び出し順で hierarchy は FieldResolver の直前）。よって ON/OFF で上流出力は同一。
7. join key: record の `anchor = { page, logicalRowIndex }`（上流 provenance）。親は `parentNodeRef` 末尾の `-p<page>-r<row>` で同一区間内の anchor に解決する（baseline の population 構築と同じ）。

### Interpretation（実験で検証するもの。コードだけで結論しない）

- ③ の性質から、OFF では ON の `organization` / `item` / plain code の `detail_line` は `unclassified` になるはずである。これは作用機構の予測であり、実データでの規模（どの kind がどれだけ移るか、request の親が何件失われるか、name status が動くか）は paired で測るまで不明。
- ON でも hierarchy が `unclassified` を残している（baseline の hierarchy 区間で 1,078 件）。OFF 側の `unclassified` との構成差は本実験で比較する。

## B. paired population

- 単位: hierarchy 契約を持つ PDF の hierarchy 区間（`paired-manifest.json`、SHA-256 `4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1`）。ON は baseline と同一入力、OFF は同一ページ範囲を `hierarchy = null` の 1 区間として実行する（区間を分割しない）。
- 分類規則（結果を見る前に固定、`build-budget-request-hierarchy-paired-manifest.ts`）: ① hierarchy 区間が無い／contract から再計算した区間と不一致 → `excluded_contract_mismatch`、② baseline ON artifact 欠落・原本 hash 不一致・区間欠落・ページ数不一致・成功以外の status → `excluded_other`、③ baseline で hard_failure → `excluded_independent_hard_failure`、④ それ以外 → `paired_evaluable`。
- 結果（規則適用後。OFF とは独立）:

| status | PDFs | pages | logical rows（候補） |
|---|---:|---:|---:|
| paired_evaluable | 8 | 1,403 | 51,869 |
| excluded_independent_hard_failure | 0 | 0 | 0 |
| excluded_contract_mismatch | 0 | 0 | 0 |
| excluded_other | 0 | 0 | 0 |

8 PDF は cfa / env / maff-fukko / meti / mext-detail / mhlw / mlit-fukko / mod。rotate=90 の 8 PDF は hierarchy 契約を持たないため母集団に入らない（rotate は対象外・未修正）。null 区間（hierarchy 区間の外）は paired の対象外。

## C. 仮説・指標（事前登録）

paired unit は anchor で ON と OFF を join する。join できない unit は推測で対応付けず `unjoinable`、同一 anchor の重複は `duplicate` とする。

- H1（item）: ON の `item` が OFF で `item` でなくなる。測定: ON/OFF の item 件数、ON item → OFF kind の遷移、OFF item → ON kind の遷移、PDF・省庁別。
- H2（unclassified）: ON で semantic kind の行が OFF で `unclassified` へ移る。測定: ON kind × OFF kind の遷移行列。
- H3（親）: ON で request だった unit の親の項の状態遷移（`resolved_item` / `resolved_non_item` / `unresolved` / `not_observed` の ON→OFF）。
- H4（補助）: 同一 paired population（一般会計）の funnel `request → 名称あり → 親 item resolved → 親 MOF exact_unique（comparable）→ jikou exact_unique` の ON/OFF 差。P1 matcher を無修正で使用し、exact 率の改善・悪化は主目的としない。
- name status: `column_layout_unobserved` / `continuation_ambiguous` / `no_name_token` を含む name status/reason の ON→OFF 遷移（全 join unit）。
- 追加の記述: (a) `parent_item_not_item_kind`（一般会計 68 件）が OFF で消えるか／ON に残るか、(b) baseline の `unclassified` 15,304 件の既存 metadata による inventory（hierarchy あり/なし、省庁、PDF、ページ、name status、column layout の有無、同一区間内で前後の行の recordKind）。人手ラベルは付けない。(c) 74 PDF の観測（baseline）と paired の実験的証拠と解釈を分けて記述し、回復件数は推計しない。

### 判定規則（機械的。結果を見た後に閾値・条件を追加しない）

量の定義（paired_evaluable 全体、join できた unit）: `I` = ON item のうち OFF で item でないもの、`R` = ON item のうち OFF でも item のもの、`X` = ON が unclassified 以外で OFF が unclassified の unit、`Y` = ON も OFF も unclassified の unit、`P` = ON で親が `resolved_item` の request のうち OFF で `resolved_item` でないもの、`C_on` / `C_off` = 一般会計 request のうち親 MOF が exact_unique に到達（P1 の exact_unique / exact_ambiguous / no_exact_match のいずれか）した件数、`S_I` / `S_P` = `I>0` / `P>0` の PDF 集合、`A_I` / `A_P` = それらの publisherAuthority の種類。

1. `INCONCLUSIVE`: ON control が全件一致しない／join で unjoinable・duplicate がある／ON と OFF のページ集合が異なる／paired_evaluable が 2 PDF 未満または publisher が 2 未満／OFF の実行が失敗した。
2. `HIERARCHY_NOT_PRIMARY`: `I = 0` かつ `X = 0`。
3. `HIERARCHY_MAJOR_CAUSAL_FACTOR`: `I>0` かつ `P>0` かつ `C_on > C_off` かつ `|S_I|≥2` かつ `|A_I|≥2` かつ `|S_P|≥2` かつ `|A_P|≥2`、かつ `I > R`（item の損失が限定的でない）かつ `X > Y`（OFF の unclassified の多くが hierarchy 除去で生じ、ON 側の残余より大きい）。これらは件数同士の比較であり、割合の閾値ではない。
4. 上記以外（`I>0` または `X>0` で、3 を満たさない）→ `HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT`。

制約: 結果を 74 PDF へ一般化しない。`I`・`P` は §A-3/4 のとおりコード上の構造から必然的に大きくなり得るため、判定は「実測した規模」を記録するための規則であり、新 hierarchy による回復件数の根拠にはしない。「小さいが 0 でない」差は 4 に入り、規模は数値で併記する。

## D–E. 実行順序（固定）

1. 本書・paired manifest・runner・純関数と synthetic test を Commit A で凍結（SHA と本書の hash を結果文書に記録）。
2. D: `--phase=control` で ON を再実行し、baseline の records artifact とバイト単位・field 単位（件数・recordKind・locator・name status・親 status）で一致を確認。不一致なら STOP（OFF は走らせない。runner も `on-control.json` の `allMatched` を要求する）。
3. E: `--phase=off`。その後、評価 script で ON/OFF を join し、上記指標・funnel・unclassified inventory・68 件を集計し、判定規則を適用する。

## 禁止事項

production code 変更（FieldResolver / recordKind / name / hierarchy / rotate）、hierarchy の生成・新規付与、recordKind・親・名称の補正、baseline の再定義、fuzzy matching、人手 GT、PR 作成。
