# 概算要求PDF organization / root 境界の source evidence inventory — protocol と判定枠組み（広い source inspection の前に固定）

item-shaped semantic boundary inventory（branch `research/budget-request-item-shaped-semantic-boundary-inventory`、`bf4e3a8`）の後続。production の DocumentHierarchy・recordKind・FieldResolver・item detector は変更しない。MOF は使わない。existing ON kind（item 97・detail_line 613・organization 7・unclassified 170）は human GT ではなく、既存 mechanism の説明対象。organization 7 を「正解の organization」と呼ばない。この phase は探索を許す source evidence inventory であり、同じ development population で見つけた規則は検証済みとは呼ばず `candidate_for_next_preregistration` とする。

## 0. 研究質問（別々に答える）

- RQ1 Activation boundary: 既存 hierarchy の手書き page 範囲の開始・終了に、PDF / upstream から観測できる deterministic evidence があるか（mext / mhlw が最重要の counterexample）。
- RQ2 Root identification: 「この row が hierarchy root」を、既存 stack の「親候補なし」から循環せずに、source evidence で説明できるか。
- RQ3 Root semantics: root-shaped row が organization / item / その他のどれかを、row-local geometry 以外の evidence で区別できるか（organization 7 vs item 97。ともに existing label で GT ではない）。
- RQ4 Contract dependency: organization / root 判定に必要な情報を、source-derived / sequence・state 依存 / manually encoded / upstream に無い / semantic interpretation 必要、に分離する。

## 1. Population（固定）

- primary: 既存 hierarchy 契約 8 PDF の hierarchy 区間（`A2_EXPERIMENTS`、`hierarchyContractFor`）。item-shaped population 887（item 97・detail_line 613・unclassified 170・organization 7）を `population-887.json`（SHA-256 `24f4803b…1aee`）から再現・照合。organization 7 はすべて cfa に偏る。
- boundary context（実データを見る前に固定）: row 単位は手書き range の start / end の前後 ±20 logical rows、page 単位は start / end page ±1 page。layout range と手書き range が一致しない mext / mhlw は、boundary の前後 ±10 page の窓で title 変化の頻度を測る（specificity のため。これらの 2 PDF だけ窓を広げる理由）。upstream は pdf.js text → SourceToken → TableGeometry → LogicalRow を研究用に再実行（保存済み artifact に title 行・非 code 行が無いため）。production は変更しない。
- 比較 group: organization 7・item 97・detail_line 613・unclassified 170・range start 周辺・range end 周辺・mext / mhlw・layout 境界と契約境界が一致する 6 PDF。

## 2. 観測する evidence（候補規則はまず作らない）

- text: page の title text（page 内で最初の code 行より前の logical row の rawText を ` | ` 連結、`titleText`。正規化した `titleSig` = 数字・空白を除いた文字列）、root 候補と item の `name.raw` / `name.normalized`、同じ正規化名が page title に含まれるか、同じ正規化名が PDF 内の他の 3 桁 plain code 行に出る回数。組織名リストは持たない。
- sequence: 直前・直後の logical row の形（code 行の lexical class・x）、次の request 行までの logical code 行の数、次の item-shaped 行までの数、x-level の増減、page 先頭の code 行か、table header（column header 行）直後か、detail range の開始直後か。item 97 側でも同じ feature を計数する。
- geometry: code x・name x・range の request 基準 offset・thin rule anchor（x=50.0）・layout signature・layout range・page サイズ。座標 detector の再調整はしない。
- range-outside: 手書き range の外側（start の直前 page・直前の rows、end の直後 page・直後の rows）の title・code 行の x-level・shallower row（range 内の最浅 root の x より 0.5pt 以上浅い 3 桁 plain code 行が range 外にあるか）。手書き range の値そのものは特徴量に使わない（境界との距離を比較に使うだけで、規則の入力にはしない）。

## 3. 事前に固定する candidate と判定

### Axis A — Activation boundary（8 PDF の手書き [a, b]）
生成的な candidate: AR1 = a と b を含む layout range（`layout-summary.json` の range）の [from, to]、AR2 = AR1 の range 内で request 行を含む最初と最後の page。boundary-correlated の検査（生成規則ではない）: AR4 = titleSig が a−1 と a、b と b+1 で変わるか、窓内の page 間 titleSig の変化率。
- `SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED`: AR1 か AR2 のいずれかが 8 PDF すべてで [a, b] を再現する。
- `LAYOUT_BOUNDARY_ONLY`: 上記でなく、AR1 が 6 PDF 以上で再現する（残りは手書き boundary を説明する source evidence が生成規則としては無い）。
- `MANUAL_CONTRACT_STILL_REQUIRED`: AR1 の再現が 6 PDF 未満。
- `INSUFFICIENT_EVIDENCE`: 必要な page の上流が取得できない。

### Axis B — Root semantics（organization 7 vs item 97）
feature は固定（`non_circular`: code 桁数・名称 resolved・名称 status/reason・layout variant・request 基準 offset の帯・名称が page title に含まれる・同名の他行の出現数（0 / 1 / 2 以上）・page 先頭の code 行か・直前の code 行の lexical class・直後の code 行の lexical class・次の request 行までの code 行数（1 / 2 / 3〜5 / 6 以上）・直前の plain3 行との x の増減・自分より浅い plain3 行が PDF 内の自分より前に存在するか。`circular`（既存の ON kind・basis から導く: 直前・直後の ON kind・直前の heading kind までの行数）は記録のみ）。categorical な値の集合が organization 7 と item 97 で disjoint なら separating feature。
- `SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED`: non_circular な separating feature が 1 つ以上ある（development 観測。GT 精度ではない）。
- `ROOT_EQUALS_RANGE_ROOT_ONLY`: 上記なしで、organization 7 の PDF の手書き range の外に、range 内の最浅 root より浅い 3 桁 plain code 行が存在する（root が range の切り方で生じている反例の可能性）。
- `SEQUENCE_STATE_ONLY`: non_circular な separating feature はなく、circular な sequence / state feature だけが disjoint。
- `INSUFFICIENT_EVIDENCE`: 上記いずれでもない。

### Overall decision（上から順）
1. `INCONCLUSIVE`（D5）: population が再現しない、または必要な page の上流が取得できない。
2. `READY_FOR_ORGANIZATION_ROOT_BOUNDARY_PREREGISTRATION`（D1）: A = `SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED` かつ B = `SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED`。
3. `ACTIVATION_BOUNDARY_UNRESOLVED`（D2）: B = `SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED` かつ A が candidate でない。
4. `ROOT_SEMANTICS_UNRESOLVED`（D3）: A = `SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED` かつ B = `INSUFFICIENT_EVIDENCE`。
5. `CONTRACT_DEPENDENCY_REMAINS`（D4）: 上記以外。
名称の意味を人間が読んで判定した場合は `semantic_human_interpretation` と明記し、source-derived rule と混同しない。結果を見た後に分類を変更しない。

## 4. 成果物・禁止・claim boundary

成果物: 本書、研究 artifact（8 PDF の契約と boundary context、organization 7、item 97、evidence matrix、mext / mhlw の boundary 観測。raw の text dump は commit せず、locator・token refs・row refs で原本に戻れる）、結果文書。禁止: production 変更、MOF の使用、手書き range 値を特徴量にすること、organization 名辞書の hard-code、level_gap 157 の修正、sparse detector、request 5 件未満条件の緩和、回復件数の推計。主張の上限: 既存 hierarchy control population とその boundary 周辺について、organization/root と activation boundary に使える source evidence を inventory し、次 phase で preregister 可能な source-derived candidate rule が存在するかを評価した、まで。full corpus の organization 抽出、item recall / precision の改善、MOF 784 との一致、organization 7 が正しいこと、sparse の解決、DocumentHierarchy の自動生成、manual contract の除去、mext / mhlw の boundary が正しいこと、は主張しない。
