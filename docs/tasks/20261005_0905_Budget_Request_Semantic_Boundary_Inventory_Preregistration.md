# 概算要求PDF item-shaped row の semantic boundary inventory — mechanism inventory と事前登録

rule-line geometry inventory（branch `research/budget-request-rule-line-geometry-inventory`、`dc301e9`）の後続。罫線 anchor では semantic kind を分離できなかったため、geometry で item-shaped row を拾った後に、既存 DocumentHierarchy がどの evidence で意味境界を作っているかを source / code evidence から分解する。新しい `recordKind=item` 規則・hierarchy generator・FieldResolver 修正・MOF による調整は行わない。広範な row-level 比較（`--phase=evaluate`）は、本書を commit するまで集計しない。

## 0. 開示（既知 evidence）

- code 読解（下記 §A）。FieldResolver の `recordKindBasis` の文字列は分岐ごとに固定。
- 事前に閲覧した値: cfa（`20230907_policies_budget_04.pdf`）の hierarchy 区間の `recordKindBasis` の件数（hyphen 360・nested under request 78・nested under detail_line 26・level_gap 26・request 番号 24・strong header collision 22・parent kind not determined 11・root 7・no edge 3）。他 PDF の basis 分布は未集計。
- 直前研究の既知値（rule-line anchor x=50.0、item offset 8.6 / 22.4、organization 7 が item と同 offset、887 行の内訳）は frozen artifact から再確認済み。

## A. 既存 mechanism（code evidence）

### 入力と node の生成（`budget-request-document-hierarchy.ts` v1 + `-v2.ts` B）
- 入力は SourceToken / TableGeometry / LogicalRow のみ。コード値・語・省庁名・外部辞書・固定 pt 値・GT は使わない（冒頭コメントと実装。organization 名の辞書は使っていない）。
- node（見出し候補行）= logical 行の先頭の非空白 token が `^\d{3}$` で後続 token が 1 つ以上ある行（形 A）、または先頭が `^\d{1,3}$` で 2 番目が `NN-NN`（形 B = request）。code の lexical pattern・後続 token の有無だけを見る。名称の内容・column layout・見出し文字列・request 以外の番号は見ない。
- x-level: key token の xMin を、入力 range 全体で単一連結クラスタリング（隣接差 ≤ 0.25 × 基準フォントサイズ）し、支持 2 行未満のクラスタは unplaced。placed クラスタの xMin 昇順の順位が level（意味型ではない）。v2-B の `lattice-supported` は、浅い側の支持の少ない根クラスタを、右隣の階段の連続を根拠に placed にする。
- 実験オプションは `HIERARCHY_B_ONLY_OPTIONS`（`headerCollisionHandling: 'observe-only'`、`singletonRootPlacement: 'lattice-supported'`）。header collision は観測のみで除外しないが、FieldResolver が `strong header evidence`（evidence 2 種以上で page_edge_row を含む）の node を unclassified / 親断定不可にする。
- 状態を跨ぐ: node の stack は文書順（ページ昇順・行順）で、ページをまたいで親を辿る。クラスタ・level は入力 range 全体の統計。

### edge
文書順の stack: level 以上の top を pop し、残った top が親候補。親の level = 子の level − 1 → `resolved_by_indent_sequence`、飛ぶ → `level_gap`、親なし → `unresolved`（root）。unplaced の node は edge を持たない。

### recordKind への変換（`budget-request-field-resolver.ts`）
1) 行頭 request 番号 → `request`、2) ハイフン付き code → `detail_line`（いずれも hierarchy 非依存）、3) 3 桁 plain code で hierarchy node あり → `kindFromHierarchy`: strong header evidence → unclassified／edge なし → unclassified／root（unresolved で親候補なし）→ `organization`／edge が `resolved_by_indent_sequence` でない → unclassified／親が request shape → `detail_line`／親の kind が organization → `item`／親が unclassified → unclassified／その他 → `detail_line`、4) それ以外（node なし。hierarchy null を含む）→ `unclassified`。
- 手書き contract: hierarchy を適用する page 範囲は `A2_EXPERIMENTS` の定数（PDF から導出するコードはない）。hierarchy ON/OFF で変わる分岐は 3)・4) と request の親の項。

## B. Population（frozen、`population-887.json`）

rule-line anchor（range-anchor）基準の offset（0.1pt）が、control 8 PDF の hierarchy 区間にある既存 item の offset クラスタ（8.6 / 22.4）に入る 3 桁 plain code 行。locator key = `localPath|page:logicalRowIndex`。再現: 887（item 97・detail_line 613・unclassified 170・organization 7）、locator の重複 0。SHA-256 `24f4803b…1aee`。existing ON kind は human GT ではない（artifact の metadata に明記）。

## C. 固定する分析（evidence fields・mechanism 分類・比較・判定）

- evidence fields: population artifact のとおり（PDF・page・row・ON kind・`recordKindBasis`・code・lexical class・桁数・名称 status・code x・name x・anchor x・anchor 相対 offset・range の request 基準 x と相対 offset・header 有無・page 内 row index・range の先頭 / 末尾・前後 ±3 行の kind / lexical class / 名称 status・直前の request / heading までの行数・parent ref・source token / row refs）。
- mechanism 分類（`recordKindBasis` から固定。`lib/budget-request-semantic-boundary.ts`）: M1 = 行単独の形（request 番号・ハイフン code・node なしで名称 token なし）／M2 = range 内の文書順 stack・x-level・page 状態（child of root・nested under …・level_gap・parent kind not determined・strong header collision・no edge・parent node missing）／M3 = root（入力 range 内で自分より浅い見出しが先行しない行 = organization）に依存する分岐／M4 = 説明できない（node なしで名称 token がある、未知の basis）。
- item vs detail_line: 同じ anchor offset での kind 混在、range の request 基準 offset（直前に凍結した −6.9pt ±1.0pt の帯 [−7.9, −5.9]）に入る行数。
- item vs organization: organization 行が帯に入る数、row-local feature（code 桁数・code class・名称 status/reason・名称 resolved・header 有無・layout variant）で item と organization が disjoint か。
- unclassified 170: basis から `no_node_row_shape_no_name_token` / `no_node_unexplained` / `node_unplaced_no_edge` / `level_gap` / `parent_kind_not_determined` / `strong_header_collision` / `parent_node_missing` / `other_unresolved`（contract / range 外は population が hierarchy 区間内のため 0）。分類不能は unresolved に隔離し、誤分類とは断定しない。
- sequence evidence: kind 別の前後 1 行の kind、直前 3 行以内に request がある行、page / range 先頭の行。
- portability: boundary rule / activation range / coordinate frame を分離して記述（code evidence に基づく）。回復件数は評価しない。

## D. 判定規則（機械的。結果を見た後に変更しない）

- `itemVsDetailSeparable` = detail_line の request 基準 offset が帯に 0 行 かつ item 97 全てが帯に入る（hierarchy を使わず range-local frame の行単独 evidence で item と detail_line が分かれる）。
- `orgMechanismIdentified` = organization 7 の basis が全て root かつ item 97 の basis が全て child of a hierarchy root（mechanism が code path で特定できる）。
- `m3Rows` = item・detail_line・organization の行のうち M3 の数。
1. population が再現しない → `INCONCLUSIVE`。2. 両方偽 → `NO_DETERMINISTIC_SEMANTIC_BOUNDARY_IDENTIFIED`。3. 片方だけ真 → `SEMANTIC_BOUNDARY_PARTIALLY_IDENTIFIED`。4. 両方真かつ `m3Rows = 0` → `EXISTING_HIERARCHY_SEMANTIC_BOUNDARY_DETERMINISTIC_AND_PORTABLE`。5. 両方真かつ `m3Rows > 0` → `SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT`。
規則 5 になりやすいのは、organization が root（M3）として定義されている code 上の事実による。これを開示した上で、件数・分布を併記する。

## E. 禁止・限界

MOF による kind 判定、MOF 784 への調整、candidate・ON kind を GT と呼ぶこと、unclassified や detail_line を自動的に誤分類とみなすこと、organization 7 を除いて混入を良く見せること、sparse range の候補数・回復件数の推計、production 変更、protocol・threshold の事後変更は行わない。control population に限定。rotate=90 は別問題。sparse range の detector は未実装。post-hoc の source inspection は実施する場合 post-hoc と明記する。
