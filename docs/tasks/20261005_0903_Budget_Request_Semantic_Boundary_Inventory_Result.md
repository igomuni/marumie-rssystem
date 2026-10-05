# 概算要求PDF item-shaped row の semantic boundary inventory — 結果

事前登録: `20261005_0905_Budget_Request_Semantic_Boundary_Inventory_Preregistration.md`（Commit A `e7302d8`、doc SHA-256 `6b84046b…5408`）。評価は Commit B `3f38c72`。mechanism 分類・判定規則は結果を見た後に変更していない。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT`（規則 5）。** 既存 hierarchy の意味境界は code path と row evidence で説明できるが、organization が root（入力 range 内で浅い見出しが先行しない行）として定義されている点が range / contract に依存する。規則 5 に入りやすい構造（organization = root = M3）は事前登録で開示済み。existing ON kind は human GT ではない。

## Pre-flight
branch `research/budget-request-item-shaped-semantic-boundary-inventory`、親 `dc301e9`、origin/main は `38e5080`（本研究 chain は未 merge）。frozen 入力（rule-line thin anchor・decision・range-local full evaluation・paired manifest）の hash を script が実行時に照合。working tree は未追跡 `.DS_Store` 2 件のみ。

## 既存 mechanism（code evidence。詳細は事前登録 §A）
- 入力: SourceToken / TableGeometry / LogicalRow のみ。node = 先頭が 3 桁 code で後続 token がある行（形 A）、または request 番号 + `NN-NN`（形 B）。名称の内容・外部辞書・organization 名・見出し文字列・column layout は使わない。
- level = 入力 range 全体の x クラスタ（隣接差 ≤ 0.25×基準フォント、支持 2 行以上）の順位。edge = 文書順 stack（親の level = 子の level − 1 で resolved、飛べば level_gap、親なしは root）。
- recordKind: root → organization、root の子 → item、request / それ以外の子 → detail_line、strong header collision・edge なし・level_gap・親 unclassified → unclassified。
- 手書き contract（`A2_EXPERIMENTS`）は hierarchy を適用する page 範囲だけ。source-derived: node 形状・x クラスタ・stack・kind の導出。manually encoded: 範囲。

## Population
887 を再現（item 97・detail_line 613・unclassified 170・organization 7）、locator の重複 0・unjoinable 0。

## Boundary analysis

| existing ON kind | `recordKindBasis`（件数） | mechanism |
|---|---|---|
| item 97 | child of a hierarchy root (organization) 97 | M2 |
| detail_line 613 | code-only row nested under a request 613 | M2 |
| organization 7 | hierarchy root: no parent candidate 7 | M3 |
| unclassified 170 | level_gap 157・parent kind not determined 10・strong header collision 3 | M2 |

M1 0・M2 880（item 97・detail_line 613・unclassified 170）・M3 7・M4 0（item・detail_line・organization の中では M2 710・M3 7）。

### item 97 vs detail_line 613
anchor 基準 offset では同じ 22.4 に item 16・detail_line 613・unclassified 116 が混在（8.6 には item 81・organization 7・unclassified 54）。range の request 基準 offset（前回 frozen の帯 −6.9 ±1.0）では、item 97 は全て −6.9、detail_line 613 は全て +6.9 で、帯に入る detail_line は 0。つまり hierarchy を使わなくても、range-local の request 基準 frame（layout 66 / 79 を吸収する）があれば item と detail_line は行単独の位置で分かれる。既存 hierarchy では detail_line は「親が request」で決まり（M2、stack の親）、item は「root の子」で決まる。sequence evidence: detail_line の前行は detail_line 376・request 193、item の次行は request 85（item の後に request が続く）。

### item 97 vs organization 7
organization 7 はすべて cfa（`20230907_policies_budget_04.pdf`）で、request 基準 offset は −6.9 で item と同じ（帯に 7/7）。row-local feature（code 桁数・code class・名称 status/reason・名称 resolved・header 有無）は item と organization で disjoint でなく、layout variant も 66 で item と重なる。次行は 7/7 が request。既存 hierarchy は organization 辞書を使わず、「入力 range 内で自分より浅い x クラスタの見出しが先行しない root」であることだけで organization にする（M3）。cfa の range には x の浅いクラスタが無く、本来項に相当しうる行が root として organization になる、という構造を示すが、それが誤りか否かは GT がなく判断しない。geometry では区別不能 → `semantic_boundary_required`（root 判定は range 内の浅い見出しの有無に依存）。

### unclassified 170
全て hierarchy node があり、`level_gap` 157（親が隣接 level でない = 親を断定しない設計上の abstention）、`parent kind not determined` 10（親が unclassified）、`strong header collision` 3。node なし 0、node 候補にならない行 0。contract / range 外 0（population は hierarchy 区間内）。したがって unclassified は「node があるが stack の状態から kind を決めない」M2 であり、source evidence 不足でも contract 外でもない。誤分類とは断定しない。PDF 別は mod 96・env 50・cfa 15・meti 9。

### sequence / state
boundary は行単独ではなく、range 内の文書順 stack と x-level（クラスタの順位）を必要とする（M2）。page / range 先頭の行に特別な扱いはない（firstInRange 0）。

## Portability
- boundary rule: x-level の順位と stack の親子で kind を決める規則そのもの（辞書・名称・コード値を使わない）。source-derived で deterministic。
- activation range: x クラスタ（支持 2 行以上）・stack・root は A2 の手書き range を入力に作る。root（organization）は range 内で浅い見出しが先行しないことに依存する。
- coordinate frame: x-level は range 内クラスタの相対順位で、絶対 x は使わない。layout variant（request x 66 / 79）の違いは request 基準の別 frame（−6.9）でも表現でき、item と detail_line の分離にはこちらが直接効く（ただし range 内の request 行が必要で、sparse range には使えない）。
- 3 要素は別問題: rule-line anchor（座標原点）は deterministic、range-local request x（frame）は dense range で deterministic、activation range（どの page に適用するか）と organization/root の境界は別。

## Decision
事前登録の規則を機械的に適用: itemVsDetailSeparable 真、orgMechanismIdentified 真、m3Rows 7（>0）→ `SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT`。

## Limitations
existing ON kind は GT ではない／control 8 PDF の hierarchy 区間・development detail range に限定／rotate=90 は別問題／full corpus の回復件数は未評価／sparse range の detector は未実装／MOF は semantic boundary の教師にしていない／hierarchy の内部状態（stack・x クラスタ）は baseline が保存しておらず、`recordKindBasis`・parent ref・前後行から説明した（hierarchy の再実行はしていない）。

## 次に進む候補（開始しない）
(1) organization / root の境界を決める source evidence（見出し文字・組織名・範囲外の浅い見出し）の inventory。(2) item vs detail_line を range-local の request 基準 frame で分ける場合の、request 行が 5 件未満の range での frame 取得（layout 66 / 79 の別 evidence）。(3) level_gap 157 件（item・detail の階段が崩れた行）の stack 状態の分解。production 変更・hierarchy generator は開始しない。

## 検証
tsc エラー 0・lint エラー 0・vitest 126 files / 1,466 tests pass。population・evaluation の再実行で artifact 不変（`24f4803b…`・`0a619469…`）。frozen artifact は変更していない。

今回は、FY2024 概算要求PDFの item-shaped row を既存 DocumentHierarchy がどう意味分離しているかを code と row evidence から説明し、semantic boundary rule と手書き activation range を分離できるかを判定する inventory である。DocumentHierarchy、FieldResolver、recordKind、item detector の production 変更、sparse range への detector 適用、MOF による調整は行っていない。
