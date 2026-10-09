# TOC B層 Problem Observation（exploratory・8 page・実装なし）

出典略記: 「#N doc」= 該当 PR の task doc（対応表は `20261010_0003_Budget_Request_TOC_A_Layer_Research_Status_Consolidation.md` §2.1。以下「#410」）、「fx」= `tests/fixtures/` 配下の JSON、OUT = `budget-request-toc-full-corpus-status/2024/full-corpus-h1-output.json`、ST = 同 dir の `full-corpus-status.json`、CEN = `budget-request-toc-evaluator-ambiguity-failure-isolation/2024/census.json`、GT = `budget-request-toc-row-assembly/2024/ground-truth.json` と `budget-request-toc-row-assembly-header-zone-right-row-h1/2024/new-heldout-ground-truth.json`。本書の観察 fixture は `tests/fixtures/budget-request-toc-b-layer-problem-observation/2024/` の `observation-sample.json`・`visual-observations.json`。

記述ラベル: **[事実]** = committed fixture / doc の値、**[観察]** = 視覚観察者（reviewer）が PDF で見た記録、**[解釈]** = 観察者または本書の読み、**[未解決]** = 根拠がなく決めない点。

## 1. 目的と位置づけ

- B 層 = TOC 上の semantic / administrative hierarchy（会計・所管・組織・項・要求のどれがどれに属すか）。A 層（column segmentation・physical row assembly・fragment ownership）は階層を解釈しない（#389 `SPLIT_REQUIRED`、#391 §2）。
- 本書は **problem observation / semantic structure inventory のみ**。B 層の parser・resolver・hierarchy algorithm・schema・heuristic threshold の実装・選定、GT・preregistration・formal evaluation、A 層・evaluator・GT の変更、新しい仮説の提示を行わない。
- 設計原則 *Library for primitives, marumie-rssystem for semantics*。A 層に無い情報を B 層で推測補完しない（A 層が abstain した箇所は abstain のまま扱う）。

## 2. A 層 freeze state

- `TOC_A_LAYER_RESEARCH_FREEZE_WITH_KNOWN_LIMITATIONS` は **repo の committed 文書・fixture・コードに存在しない**（`docs` `tests` `.claude` `CLAUDE.md` を grep、0 件）。ChatGPT／ユーザー側の研究 sequencing 判断であり、本書がそれをここに記録する。
- 意味するのは「現在の A 層 evidence と known limitations を保存し、新しい A 層 hypothesis を追加せず、次の semantic-layer research へ進む」という research sequencing decision のみ。production-ready・完全・正しさの証明・全 page coverage を意味しない（#410 §12 も production claim なし）。
- 凍結された formal evidence（#410 §4。いずれも paired comparison ではない）:
  - #396（commit `9a776abfab646d15767367392c37b66106873181`）: `STOP_SAFETY`、severe 10（5 page）。negative formal result として保存。
  - #402（commit `a59f6e2571d2297e2855e0b2418cd328175a3a78`）: `SAFETY_PASS_COVERAGE_REPORTED`、comparable 560 / correct 560 / severe 0、fragment 3/3。意味は「この frozen new-heldout 25 page で severe error は観測されず positive trigger が存在した」のみで、production GO・B 層 GO・正しさの証明ではない。
- known limitations（#410 §8 より。**解決済みにしない**）: UNSPLIT 44 page、PAGE_ABSTAINED 3 page、E 未定義 47 page（= UNSPLIT 44 + ABSTAINED 3）、PLAIN_ROW は NOT_COMPARABLE、same-agent GT、held-out 標本サイズ（23 / 25）、publisher overlap、acceptance threshold 未決（`UNRESOLVED_ACCEPTANCE_THRESHOLD`）、circled request number の復元は A 層範囲外、production readiness 未確立。
- Deferred families の state の由来（#410 §6 の書き分けに従う。**今回再開しない**）:

| family | state | 由来 |
|---|---|---|
| A1 | LOW | #410 の proposed priority（本書上の提案）。原典に明示判断なし（#410 §6.1） |
| A2 | deferred | 経緯は repo 文書になく ChatGPT／ユーザー側判断（#410 §6.2） |
| B | `FAMILY_B_DEFER_AFTER_P0_POSITIVE_DISCOVERY` | 文字列は repo に無く ChatGPT／ユーザー側判断。repo 原典は #408 の「defer 候補」まで（#410 §6.3） |
| C | `FAMILY_C_DEFER_EVALUATOR_NON_1_TO_1_OWNER_GROUP` | #410 上の proposed consolidated state。確定した研究判断ではない（#410 §6.4） |

## 3. Observation sample

### 3.1 選定手順（`observation-sample.json` に要約を保持）

- 母集団は TOC 82 page（development 34 / first-heldout 23 / new-heldout 25）。選定は **commit 済み A 層 artifact の特徴量だけ**（ST・CEN・GT の `rightColumnVisual`）で行い、PDF を見る前、B 層の観察結果を見る前に規則を固定した。観察後に差し替えていない。特徴表は規則確定前に閲覧したが、閾値は閲覧値に合わせず丸め値を採用した。
- variation 21（DIRECT / INHERITED / SPLIT / UNSPLIT / PAGE_ABSTAINED とその組、MARKER_RICH（marker unit ≥30）/ REQUEST_RICH（request unit ≥45）/ DUP_MARKER / FRAGMENT_ATTACHED / RIGHT_USED_GT / RIGHT_BLANK_GT / H1_TRIGGER / UNIT_ABSTAINED / partition 3）。
- Phase 1（greedy 被覆。未被覆 variation を最も多く追加する page。tie は `(localPdfPath, physicalPage)` 辞書順。1 PDF 2 page まで）6 page、Phase 2（被覆 2 回未満の variation を埋める）2 page。実装は jq の reduce のみ。

### 3.2 sample 8 page

| id | PDF（論理パス末尾） / page | partition | classifierSource | A 層 pageState | GT |
|---|---|---|---|---|---|
| BS-01 | maff `230901-4.pdf` p3 | new25 | DIRECT | SPLIT | あり |
| BS-02 | meti `fy2024/pdf/ippan_o.pdf` p4 | first23 | INHERITED | UNSPLIT | あり |
| BS-03 | maff `230901-2.pdf` p5 | dev34 | INHERITED | SPLIT | なし |
| BS-04 | mhlw `24syokan/dl/05-2b-01.pdf` p4 | first23 | INHERITED | PAGE_ABSTAINED | あり |
| BS-05 | caa `cms_caa205_230914_02.pdf` p3 | first23 | DIRECT | UNSPLIT | あり |
| BS-06 | mhlw `24syokan/dl/05-1b-01.pdf` p3 | new25 | DIRECT | SPLIT | あり |
| BS-07 | mext `20230914-mxt_kaikesou01-000031817_01.pdf` p4 | dev34 | INHERITED | SPLIT | なし |
| BS-08 | mlit `page/content/001630995.pdf` p6 | dev34 | INHERITED | PAGE_ABSTAINED | なし |

- 8 PDF すべて別。被覆: DIRECT 01/05/06、INHERITED 02/03/04/07/08、SPLIT 01/03/06/07、UNSPLIT 02/05、PAGE_ABSTAINED 04/08、DUP_MARKER 02/03、FRAGMENT_ATTACHED 01/02/03/06/07、H1_TRIGGER 01/06、UNIT_ABSTAINED 01/05、MARKER_RICH 03/07、REQUEST_RICH 06、RIGHT_USED_GT 01/04/06、RIGHT_BLANK_GT 02/05。
- BS-02 は #409 の H3（census 上唯一の `FRAGMENT_OWNER_AMBIGUITY` page）、BS-04 は #404 の H4、BS-08 は同 PDF の H5（mlit `001630995.pdf` p6 = #405 の A2 anchor）に当たる。この対応は本書が #410 の anchor パスと sample のパスを照合して確認したもので、選定規則は human-review queue を使っていない（結果として重なった）。
- **被覆できなかった variation**: 母集団に存在しない DIRECT×PAGE_ABSTAINED。母集団にあるが sample 外の OTHER_CODE unit（jinji `900024096.pdf` p3 の 14 unit のみ。規則の variation に含めず）。circled request number は category 化していない。REQUEST_RICH・DIRECT_UNSPLIT・INHERITED_UNSPLIT は各 1 page のみ。BS-05 は小 page（marker 4 / request 1）で情報量が小さい。1 PDF 1 page のため同一 PDF 内の page 間関係は観察していない。
- **注意**: 本 sample は exploratory observation sample であり GT でも held-out でもない。観察した 8 page を後続の held-out として扱わない（観察者が内容を見た時点で blind でない）。観察者への指示に選定理由・既知の human review 結果は含めていない。

## 4. 観察結果（O1〜O7）

観察者は 4 名（R1: BS-01/05、R2: BS-02/06、R3: BS-03/07、R4: BS-04/08）。全 page 110dpi、crop なしで render（`visual-observations.json`）。以下は sample 横断の整理で、根拠は各 sample の reviewer 記録（`visual-observations.json`）にある。件数はこの 8 page の観察であり prevalence ではない。

### 4.1 O1 semantic row kinds

- **[事実]** committed fixture 上の marker は **`（組織）` `（項）` `（会計）` `（勘定）` `（所管）` の 5 形式のみ**。GT 567 行（組織 39 / 項 480 / 会計 18 / 勘定 24 / 所管 6）、parser 出力 1,106 unit（組織 79 / 項 963 / 会計 27 / 勘定 27 / 所管 10）。未知の marker 形式 0。**`（事項）` という marker は GT・OUT・ST・CEN のいずれにも 0 件**。`tests/fixtures` 全体の grep で `（事項）` が出るのは `budget-request-field-resolver/heldout-v0/golden.json` の 1 件（別文書の引用注記内の語で、TOC の marker ではない）。
- **[観察]** 8 page を見た 4 名の kind 記録にも `（事項）` は現れない。見えた kind: 5 種の marker 行、要求番号行（marker なし。番号列の数字 + `NN-NN` code + 名称 + ページ）、marker なしの見出し行（`令和6年度歳出概算要求額総表` / `明細表` / `概算要求定員表`。ページ参照付き）、ページ表題・所管見出し（`9101 東日本大震災復興特別会計（農林水産省）`、`25 厚生労働省所管`）、列見出し・ページ番号。
- 出現（観察）: 会計+所管+組織+項 = BS-01/05、組織+項 = BS-02/06、項+組織（組織が column 途中）= BS-03/07、項+勘定 = BS-04、項のみ = BS-08。
- **A 層 kind との対応 [事実+観察]**: marker 行 ↔ `MARKER_ROW`、要求番号行 ↔ `REQUEST_NUMBER_ROW`（`rowStartTokenRaw` が番号と code を連結）、総表/明細表 ↔ `TITLE_OR_HEADING`（ページ参照は `titleRaw` 内で `pageRefRaw` は null）、定員表行 ↔ `UNKNOWN_ABSTAINED`（`FRAGMENT_WITH_PAGE_REF`。BS-01/05）。GT 上はこれらの見出し行が `PLAIN_ROW`。
- **未知 kind**: 既存の kind に当てはまらず記録されたのは、見出し行の種類（総表/明細表/定員表が目次項目か見出しか。R2 は既存 category に確定せず記録）とページ表題領域の行のみ。新しい marker 形式は観察されず。

### 4.2 O2 hierarchy evidence

observable evidence の種類（観察）: ① marker token が種別を明示、② 行順、③ 区分列のインデント（会計 < 所管 < 組織 < 項 の順に右へずれ、要求番号行は項より浅い）、④ ページ列の値（項と最初の子 request が同値になる例: BS-03/04/08、BS-07 は近接値。後続 request は異なる）、⑤ 要求番号の連番（項・column をまたいで連続）、⑥ 同名称（BS-01 の 所管 31 復興庁 / 組織 010 復興庁）。罫線による grouping は BS-03/04 で無し。

| relation 候補 | 観察された evidence | 分類（観察者） | sample |
|---|---|---|---|
| 会計 → 所管 → 組織 → 項 の連鎖 | 種別 token、行順、インデント | DERIVABLE_FROM_EXPLICIT_MARKERS（種別）+ ORDER_DEPENDENT（親の特定） | 01, 05 |
| 項 → 直前の組織 | 行順、インデント | ORDER_DEPENDENT | 02, 06, 03 右, 07 右 |
| 要求 → 直前の項（同 column 内） | 項の直後に並ぶ。要求行に親 token なし。要求の `NN-NN` code と項 code に対応は見えない | ORDER_DEPENDENT | 全 sample（BS-04 の 項090→要求50 のみ DIRECTLY_OBSERVABLE と記録） |
| 右 column 先頭の要求の親 = 左 column 末尾の項 | 右先頭に先行 marker なし、要求番号が連続、ページ値一致（BS-03/08） | CROSS_COLUMN_DEPENDENT（BS-01 は +ORDER+PAGE_CONTEXT、AMBIGUOUS 併記） | 01(21〜24→901)、06(23→028)、03(90)、08(147→741) |
| page 先頭の要求（親 marker なし） | 先行 marker なし | PAGE_CONTEXT_DEPENDENT（BS-08 の 128 は AMBIGUOUS / NOT_OBSERVABLE 併記） | 07(42,43)、08(128) |
| 同 code の項の再出現が別 node | 間に別の組織 | ORDER_DEPENDENT（BS-02）/ PAGE_CONTEXT_DEPENDENT（BS-03） | 02, 03 |
| 項の組織所属が page 内に無い | 先行する組織 marker なし | NOT_OBSERVABLE_FROM_A_LAYER | 03 左, 07 右(440〜620) |
| 勘定 と後続の項の包含 | 勘定行の直後に項 050。項 code が 900→050 で戻る | AMBIGUOUS（low） | 04 |
| 総表/明細表/定員表 と marker 階層 | marker なし、最左インデント、位置は会計より前（総表/明細表）/ 末尾（定員表） | LAYOUT_DEPENDENT + AMBIGUOUS | 01, 05, 06 |
| ページ表題（`9101 …特別会計（農林水産省）`）と 会計 01 | 表枠外。code・名称・括弧書きが異なる | AMBIGUOUS / NOT_OBSERVABLE_FROM_A_LAYER | 01, 05 |
| 右 column が空 | 罫線と見出しのみ | DIRECTLY_OBSERVABLE（視覚。意味は NOT_OBSERVABLE） | 02, 05 |
| 組織 090 と 項 090 の区別 | token が異なる | DERIVABLE_FROM_EXPLICIT_MARKERS | 03（BS-07 も 組織 020 / 項 020） |

### 4.3 O3 scope / lifetime

- **[観察]** どの sample でも scope の終了を示す token は無い。marker は次の marker（同格以上）まで下位を覆うように見える（行順のみが手がかり）。BS-01/05 の 会計・所管・組織 は page 全体を覆うように見えるが終端 token なし。BS-02 の 組織 040 は 060 の直前まで。BS-06 の 組織 010 は右 column 末尾まで（再出現なし）。
- **[観察]** 項の scope が column / page 末尾で閉じない例: BS-01 の 項 901（左末尾、子は右先頭か）、BS-03 の 項 180、BS-06 の 項 072、BS-07 の 項 020、BS-08 の 項 789（いずれも末尾で子 request がページ内に無い）。BS-04 の 勘定 3 の scope は 項 050 以降のどこまでか不明。

### 4.4 O4 column interaction

- 1 column のみ（右が空）: BS-02, 05。右 column が使われる: BS-01, 03, 04（GT のみ。右は 2 行）, 06, 07, 08（視覚）。
- **[観察]** column 境界での遷移は、BS-01/06/08 で「左末が項 or request、右先頭が marker なしの request」、BS-03 で「左末が request なしの項 180、右先頭が marker なしの request 90」、BS-07 で「左末が request 64、右先頭が項 440」、BS-04 で「左末が request 49、右先頭が項 090」。要求番号は全ての境界で連続（20→21、22→23、89→90、64→65、49→50、146→147）。
- **[観察]** 継続を明示する token は 8 page のどこにも無い。観察者の記録: continuation に見える（BS-01/06/08。page-order dependent / AMBIGUOUS 併記）、continuation の可能性（BS-03/07。確定不能）、独立か継続か見た目だけでは区別不能（BS-04）。「右 column の context が reset か continue か」を示す token 自体が存在しない。
- **[観察]** 右 column に上位 marker（会計・所管）は無く、BS-03/07 の右 column 途中に 組織 が現れる。

### 4.5 O5 page boundary

| page | 先頭 | 末尾 |
|---|---|---|
| BS-01, 05, 06（DIRECT） | 総表/明細表 → 会計/組織 など上位から始まる（階層の起点） | BS-01/05 は定員表行、BS-06 は右末尾の項 072（子なし） |
| BS-02（INHERITED） | 組織 040 から（起点に見える）。要求番号は 38 から | 項 080 → 要求 50（続きはページ内から不明） |
| BS-03（INHERITED） | 左先頭が項 020（組織が page 内に無く、階層の途中に見える） | 左は子なしの項 180、右は要求 108 |
| BS-04（INHERITED） | 項 180 から（上位の見出しは page 内に無い） | 右は要求 50 |
| BS-07（INHERITED） | 要求 42, 43 が親 marker なしで始まる（階層の途中） | 右は子なしの項 020 |
| BS-08（INHERITED） | 要求 128 が親 marker なしで始まる | 右は子なしの項 789 |

- **[事実]** A 層 OUT では DIRECT 55 page は全て最初の非 TITLE unit が会計/組織、INHERITED の rows を持つ 24 page は request 13 / 項 9 / 組織 2（§3.2 の sample の起点と整合）。**[解釈]** 8 page の観察は A 層の page 分類（DIRECT/INHERITED）の傾向と矛盾しないが、一般化はしない。page 末尾の続きの有無は 1 page のみの観察では確認できない。

### 4.6 O6 physical vs semantic

A 層 row 境界と semantic node 境界の不一致・注意点（観察者の記録）:

- **fragment**: 名称が 2 物理行にまたがる row（BS-01 要求18、BS-02 の 5 件、BS-03 の要求81・102、BS-06 の要求10、BS-07 の項440・要求65、BS-08 の要求147）。A 層は fragment を owner row に保持（BS-08 は A 層 unit 0 のため無し）。語中で切れる例あり（BS-02「エネルギ|ー」、「繰|入」）。fragment は名称の完結に必要で、親の決定には影響しないように見える（観察者 4 名）。
- **番号と code の連結**: 視覚上は別列（要求番号列 / 区分列内の code）だが A 層は `rowStartTokenRaw` に連結（`1    01‑95`）。
- **見出し領域**: 表題・所管見出し・列見出し・ページ番号が複数の `TITLE_OR_HEADING` に分割され、左右の列見出しが 1 unit に連結（BS-02/03/07）。BS-01 では総表/明細表（TITLE）と定員表（ABSTAINED）が視覚上同種の行で A 層の kind が割れる。
- **semantic 群と物理行**: 項 + 配下 request が複数 physical row に跨る（BS-04）。BS-08 では項 741 と配下らしい request 147 が column 境界で分断される。
- **出力順**: BS-06 では UNSPLIT の表題・所管・見出しが sourceOrder の末尾に出力され、LEFT/RIGHT は同一 `lineIndex` 範囲を共有して column ごとに sourceOrder が 0 から再開する。順序依存の判定には `sourceOrder` だけでは足りず `lineIndex` と column が要る（観察者の記録）。**[事実]** OUT で SPLIT 35 page は `sourceOrder` が `lineIndex` 順でない page 数と一致（S1-A 集計。page 集合の同一性は未突合）。
- **page 識別**: 視覚上 1 つの目次 page に対し A 層は page 単位で出力する。BS-04/08 は A 層 unit 0 のため O6 の比較自体ができない。

### 4.7 O7 abstention propagation

| A 層 state | 事実 | B 層が安全に言えること | 言えないこと |
|---|---|---|---|
| SPLIT（BS-01/03/06/07） | LEFT/RIGHT の unit・sourceOrder・fragment owner・provenance を保持。階層・parent は保持しない | 各 unit の marker token・code・名称・ページ・column と、column 内の順序 | column 境界をまたぐ親（右先頭 request）、page 外 context、同 code の同一性（BS-03）、header zone 内の tokenless continuation（Family B） |
| UNSPLIT（BS-02/05） | 全 unit が column=UNSPLIT。右 column evidence 無し | その page の unit の順序と親候補の列挙 | 「右に行が無い」こと（UNSPLIT は分割しなかったという A 層の表明にとどまり、右が空であることの A 層 evidence ではない。BS-02/05 の右 blank は GT と視覚で確認） |
| unit ABSTAINED（BS-01/05 の定員表行） | `UNKNOWN_ABSTAINED`、内容 null、provenance のみ | 当該行が存在したという位置情報 | 当該行の種別・階層位置 |
| PAGE_ABSTAINED（BS-04/08） | rows=[]、`RIGHT_EVIDENCE_INSUFFICIENT`、page identity と hash のみ | その page に A 層 evidence が無いこと | page 内の marker・request・親子・column・fragment の何も |

- **BS-04・BS-08**: A 層は PAGE_ABSTAINED で unit 0 だが、**視覚では階層が明瞭に見える**（BS-04: 項 17 + 勘定 1 + request 20 の 38 行、BS-08: 項 21 + request 50 の約 71 行）。この観察は A 層 evidence ではない。BS-04 の GT は 38 行を持つが GT は B 層が参照できる A 層出力ではない。B 層は abstention を視覚知識で補完せず、「page 全体が不明」として扱う。
- **[事実]** abstain 3 page は全て `RIGHT_EVIDENCE_INSUFFICIENT`（#410 §6.1）。

## 5. Marker semantics

- **token が semantic type を明示するか**: 明示する（5 形式すべて。観察者 4 名一致）。ただし token は上下関係を明示しない（BS-04 R4）。要求番号行は marker token を持たず、番号列の数字の存在で kind が見分けられる（観察）。
- **code が識別するもの**: [事実] 桁数は 会計 2 / 所管 2 / 組織 3 / 項 3 / 勘定 1（GT・OUT で全件一致）。[観察] 各 marker の code は同種内の番号に見えるが、何の体系かはページ内に説明が無い（BS-01 の ページ表題 `9101` と 会計 `01` の関係も同様）。要求の `NN-NN` code は同一 page 内で重複し（BS-02: 01-95 が 38/42/45 ほか、BS-06・BS-07 も）識別子でないように見える。要求番号（連番）は page 内で一意に見える（[事実] OUT で同一 page 内の `rowStartTokenRaw` 重複 0、CEN requestUnique 1,519 / 1,519）。
- **同一 code の再出現**:
  - [事実] CEN（#409）: 同一 page・同一 (marker, code) の重複 key **82 件（全て MARKER、17 page。項 81 / 組織 1）**、request の重複は 0。
  - [事実] 82 件のうち **77 件は同一 key の `titleRaw` が異なる**。この数は #409 doc に記載が無く、OUT を `(path, page, rowStartTokenRaw, codeRaw)` で group_by して `titleRaw` の distinct 数を数えた jq 集計（本書作成時と S1-A で独立に 82 / 77 / 17 page を再現）。名称が異なる = 別 node とは断定しない（[未解決]）。
  - [観察] BS-02: 項 010・030 が 組織 040 配下と 060 配下で再出現し名称も異なる。BS-03: 左右で項 030〜150 が再出現（CEN 上 13 key、GT なし）。BS-04 の項 050 は 900 の後に戻るが同 page 内では重複していない。組織 090 / 項 090（BS-03）、組織 020 / 項 020（BS-07）は token が異なる同 code。
- **parent relation は token だけで決まるか**: 観察者 4 名とも「token・code だけでは決まらず、行順が必要。再出現する項の同一性には直前の組織の文脈が要る」と記録。直前 unit が marker の request 937 件は全て（項）（[事実] OUT。組織・会計・勘定・所管の直後に request が来る例 0）。

## 6. Request row parentage

rule 化しない。観察のみ。

- **親の手がかり [観察]**: 同 column 内の直前の（項）という行順だけ（全 sample）。request 行内に親を指す token は無く、`NN-NN` code は項 code と対応しない（BS-02/06）。要求番号は項ごとに振り直されず連番（BS-01: 1〜27、BS-06: 1〜45）。観察者は「番号から親を推測しない」制約下で連番を親決定の根拠にしなかった。
- **直前 marker だけで足りるか**: 足りるのは項の直後の request（BS-01 要求25〜27 ほか）。複数 request が 1 項に従う場合（BS-03 項050→75,76、BS-04 項240→35,36、BS-08 項763→149〜176）は 2 つ目以降の直前 unit は request で、「直近の marker」という順序文脈が要る。右 column 先頭・page 先頭の request は直前 marker が同 column / page 内に無く足りない（BS-01/03/06/07/08）。
- **column transition**: 右先頭の request の親が左末尾の項かは「継続に見える」が token が無く AMBIGUOUS または CROSS_COLUMN_DEPENDENT（BS-01/03/06/08）。
- **fragment attachment**: 名称 identity に影響し、親には影響しないように見える（全観察者）。BS-02 では 項 030 の fragment owner が census 上曖昧（H3）だが、視覚上は組織 040 配下の側が所有と明らか。
- **page 先頭の request**: 親 marker を伴わない（BS-07 の 42, 43、BS-08 の 128）。ページ内に親が無い。
- **ページ列値の一致 [観察]**: 項と最初の子 request のページ値が同じ（BS-03 項020/287 と要求72/287、BS-04 556/556 ほか、BS-08 434/434・485/485・492/492）。後続 request では異なる値（BS-04 671, 740, 772）。BS-07 は項 280/686 と要求 43/684 で近接のみ。親決定の根拠としては使わない。
- **circled request number [観察]**: 視覚で丸囲みの番号があり、A 層 token では plain digit。committed GT の `requestNumberCircledVisual` と一致（BS-01 の 1、BS-02 の 38・46、BS-06 の 1。BS-05 は無し。BS-03 の 91 は GT 無しで観察者は判読不確実）。観察者記録と A 層の並びから読むと BS-01/02/03/06 では、組織の後の最初の項の最初の request に付くが、BS-05 の同位置の request 1 は丸囲みでない。意味は NOT_OBSERVABLE_FROM_A_LAYER。解釈しない。

## 7. 関係候補の分類表

分類は parser rule ではなく観察された依存の種類の記録（§4.2 の表を依存の種類で整理）。

| 分類 | 観察された relation |
|---|---|
| DIRECTLY_OBSERVABLE | 右 column が空であること（視覚のみ）。BS-04 の項090→要求50（観察者の分類。同形の他の項→request は ORDER_DEPENDENT と記録されており、基準が揃っていない → §12） |
| DERIVABLE_FROM_EXPLICIT_MARKERS | marker の種別（5 形式）。組織 090 と項 090 の区別。会計→所管→組織→項 の「種別の序列」自体 |
| ORDER_DEPENDENT | 要求→直前の項、項→直前の組織、所管→会計、再出現する項の同一性（直前の組織との組） |
| LAYOUT_DEPENDENT | 総表/明細表/定員表の位置（インデントのみ）。fragment の所有（折返し行の位置） |
| CROSS_COLUMN_DEPENDENT | 右 column 先頭 request の親（BS-01/03/06/08）。左末尾の子なしの項と右先頭 request の接続（BS-03/08） |
| PAGE_CONTEXT_DEPENDENT | page 先頭の request の親（BS-07/08）。左右で再出現する項の同一性（BS-03） |
| AMBIGUOUS | 右先頭 request と左末尾の項の接続の確定（BS-01）。勘定と後続の項の包含・scope（BS-04）。総表/明細表/定員表の位置。項 789 の子の有無（BS-08） |
| NOT_OBSERVABLE_FROM_A_LAYER | 項の組織所属（BS-03 左、BS-07 右）。page 先頭 request の親（BS-08）。ページ表題と 会計 の対応。丸囲みの意味。末尾の項の後続。PAGE_ABSTAINED page の全関係 |

## 8. Ambiguity inventory

| 項目 | 観察 |
|---|---|
| duplicate semantic marker | 観察された（BS-02: 2 key、BS-03: 13 key。CEN は 82 key / 17 page） |
| missing parent marker | 観察された（BS-03 左の項に組織なし、BS-07 の項 440〜620、BS-07 左先頭の request 42/43、BS-08 の 128） |
| page starts mid-hierarchy | 観察された（BS-03, 04, 07, 08。BS-04 は項から、BS-07/08 は request から） |
| column transition | 観察された（BS-01/03/04/06/07/08。継続を明示する token は無い） |
| heading interruption | **観察されず**（階層の途中に見出し行が挟まる例の記録なし。総表/明細表は先頭、定員表は末尾） |
| fragment / continuation | fragment は観察された（§4.6）。page をまたぐ continuation は 1 page 観察では確認不能 |
| A 層 abstention | 観察された（BS-04/08 の page、BS-01/05 の unit） |
| inherited structure | sample の INHERITED 5 page（02/03/04/07/08）のうち 03/04/07/08 は、会計・組織などの上位 marker が page 内（または column 内）に欠ける。BS-02 は組織から始まる。DIRECT/INHERITED の定義は §12 |
| repeated codes | 観察された（§5。項 code、request の `NN-NN`） |
| unknown marker / kind | 新しい marker 形式は観察されず。見出し行の種類は未決（§4.1） |
| circled request number | 観察された（§6。A 層 token に無い） |
| 総表/明細表/定員表 行の位置 | 観察者が AMBIGUOUS とした（BS-01/05/06）。会計より前（総表/明細表）と末尾（定員表）にあり、最左インデント |
| 定員表行の階層位置 | BS-01 は右枠末尾（項906/要求27の後）、BS-05 は左枠最終行。最上位に見えるが token は無い（AMBIGUOUS） |
| 所管と組織の同名 | BS-01: 所管 31 復興庁 / 組織 010 復興庁 が同名で 2 node（意味は不明）。ページ表題の所管名（農林水産省）と所管 31（復興庁）は不一致 |

## 9. Candidate semantic model

schema を freeze しない。事前の想定を置かず、観察された順序関係から。

**Observed（8 page で見えたこと）**

- 5 形式の marker と marker なしの request 行。marker 同士の並び（この 8 page）: 会計 → 所管 → 組織 → 項（BS-01/05）、組織 → 項（BS-02/06）、項 … 組織 → 項（BS-03/07。組織が column 途中）、項 → 勘定 → 項（BS-04）。
- request は 項 marker の後に並ぶ。request の直前 unit が marker なら項（OUT 937 件）。
- 組織・会計・所管・勘定の直後に request が来る例は A 層出力に無い。
- 項 code は同 page 内で再出現し得る（別の組織の下、BS-02）。
- scope の終了 token は無い。column 境界・page 境界を跨ぐ継続の明示 token も無い。

**Inferred（観察者または本書の読み。確認されていない）**

- 項は直前の組織の下、request は直前の項の下に置かれて見える（行順・インデント）。
- 会計 → 所管 → 組織 の包含順に見える（BS-01/05。コード体系の説明は page に無い）。
- 右 column 先頭の request は左 column 末尾の項の続きに見える（要求番号が連続）。

**Unresolved**

- 勘定の位置づけ（項の上位か同格か、scope）。会計・所管・勘定・組織の相互関係の一般形（観察は 8 page のみ。勘定は BS-04 のみ）。
- column・page 境界での context の継続 / reset。page 先頭 request の親。
- 総表/明細表/定員表・ページ表題の位置。所管と組織が同名の意味。
- 同 code の項の同一性の規準。丸囲み番号の意味。

## 10. Failure-isolation targets

次工程で failure isolation すべき semantic 問題。順序は descriptive（観察 sample での出現の広がり）で優先度の判断ではない。mechanical census = A 層 committed artifact から機械的に数えられるか、visual GT = 最終的に目視 GT が要るか。

| # | observed phenomenon | why it matters | source evidence | potential safety failure | mechanical census | visual GT |
|---|---|---|---|---|---|---|
| T1 | column 先頭の request が同 column に先行 marker を持たない | 親が column 跨ぎの context に依存 | BS-01/03/06/08、OUT の RIGHT group 先頭 unit は request 25 / 項 10（35 page） | 右先頭 request を誤った項（または親なし）に付ける | 可（SPLIT page の RIGHT 先頭 kind） | 要（継続の真値） |
| T2 | page 先頭が request で始まり親が page 内に無い | page 外 context が必要 | BS-07/08、OUT で request 先頭 13 page（全て INHERITED） | 親を持たない request に推測で親を付ける | 可（13 page） | 要（前 page と合わせた真値） |
| T3 | 同 page 内の (項, code) 再出現と組織文脈 | 項 code 単体が一意 key でない | BS-02/03、CEN 82 key / 17 page、77 key で名称が異なる | 別 node の項を同一視、または fragment owner の取り違え | 可（CEN 既存） | 要（同一性の真値。dev34 は GT なし） |
| T4 | 項に組織が page 内で与えられない | 組織所属が A 層から導けない | BS-03 左、BS-07 右、OUT で組織 marker が無い page 30 | 組織所属を意味知識で補完 | 可（page 内の組織 marker 有無） | 要 |
| T5 | 勘定・会計・所管の位置づけと scope | 5 形式の相互関係が未確定 | BS-04（勘定）、OUT の marker 初出順 7 種（会計→勘定→項 13 page、会計→所管→組織→項 8 page、項→勘定 1 page） | 勘定下の項を誤って組織の下に置く | 可（順序パターンの計数のみ） | 要（包含関係の真値） |
| T6 | 総表/明細表/定員表（marker なし見出し）の種別と位置、TITLE と ABSTAINED の kind 分裂 | 階層の外か内か不明 | BS-01/05/06、OUT の UNKNOWN_ABSTAINED 26 unit（全て `概算要求定員表` 形）、TITLE 454 | 見出し行を項の子に取り込む／落とす | 可（kind・位置） | 要 |
| T7 | ページ表題（`9101 …特別会計（農林水産省）`）と 会計 marker の対応 | 会計 code と表題 code が別体系に見える | BS-01/05、header zone の TITLE | 表題を会計 node として扱う | 部分的（header zone の TITLE 文字列） | 要 |
| T8 | PAGE_ABSTAINED page に視覚上は階層がある | B 層は page 全体が不明 | BS-04/08、OUT の 3 page | 前後 page の context で補完／abstain を黙って落とす | 可（3 page） | 要（GT があるのは first23 の 2 page（BS-04 を含む）。残る 1 page は BS-08 で GT なし） |
| T9 | UNSPLIT page の「右が空」を A 層が保証しない | 右 column の内容欠落を見逃す | BS-02/05（GT blank 31 page）、dev34 の UNSPLIT 13 は GT なし | 右 column の内容を空と決めつける | 可（UNSPLIT 44） | 要（dev34 の 13 page） |
| T10 | fragment の所有と名称 identity | 名称完結と owner 一意性 | BS-02 の項 030（H3）、BS-01/03/06/07 | 同一 key で owner を取り違える。header zone の tokenless continuation の omission（Family B） | 部分的（#409 / #406 が既存） | 要（#409 の限界参照） |
| T11 | 順序依存の判定で `sourceOrder` と物理順が異なる（SPLIT page） | order dependent の前提が崩れる | BS-06、OUT で SPLIT 35 page と件数一致（集合の同一性は未突合） | LEFT/RIGHT/UNSPLIT の連結順で親を取り違える | 可 | 不要に近い（出力順の機械的確認で足りる可能性。[未解決]） |
| T12 | circled request number は A 層 token に無い | 意味が不明なまま落ちる | §6、committed GT 45/795 | 意味を推測して補完 | GT 側のみ可 | 要（意味の確認は A 層範囲外） |

## 11. No solution selection

stack parser・state machine・nearest preceding marker・indentation parser・tree builder・parent code lookup などは、観察から「候補として見える」ものはあるが、**hypothesis にしておらず、実装案として選んでいない**。これらのいずれも選定・設計・評価していない。観察者の「直前の項に見える」は観察された依存の記録で、規則の提案ではない。

## 12. 観察の限界と unresolved

- 8 page の exploratory 観察で、prevalence・一般性を主張しない。sample は規則で選んだが無作為ではない。観察者間の一貫性は検証していない（1 page 1 名）。
- DIRECT / INHERITED の定義文は #389〜#392 に無い（最も近い記述は `20261007_2355_Budget_Request_PR3A_Cover_TOC_Structure_Failure_Isolation.md` の「DIRECT = explicit-title start、INHERITED = continuation」）。new25 の direct 22 / inherited 3（#410 §4）と全 82 page の classifierSource 集計（DIRECT 55 / INHERITED 27）の対応は未照合。
- dev34 の右 column の真値（GT なし）。BS-03/07/08 は GT なしで視覚観察のみ。dev34 の parser 出力は visual 照合なし。
- S1-A が挙げた 12 の UNRESOLVED のうち B 層に関わるもの: request 番号の振り方の単位（項単位か組織単位か。非減少性のみ観測）／同一 page で同じ項 code が複数回現れる理由と所属組織の対応（CEN `precedingOrgCode` の全件 null 率は未集計）／PAGE_ABSTAINED 3 page の内容／OTHER_CODE 14 unit の階層位置／UNKNOWN_ABSTAINED 26 unit と GT の PLAIN_ROW の対応／UNSPLIT 44 page の header zone・右側の有無／`precedingOrgCode` の導出規則。`（事項）` が依頼文で想定された対象は A 層 evidence に無く、request row との対応は doc に記述なし。
- **UNRESOLVED_CONFLICT（軽微。reviewer 記録内の不整合。fixture には記録どおり保持）**:
  1. R1 BS-01 `pageLayout` は右枠を「9行（要求番号付8, 項1, plain1）」と書くが、同 reviewer の O1（右 request 7）、O2（要求21〜27）、A 層出力（RIGHT: request 7 / 項 1 / UNKNOWN_ABSTAINED 1 = 9 unit）は 7。`pageLayout` の「8」は reviewer 記録内の内部不整合で、記録は修正せずそのまま保持した（O1・O2・A 層出力の 7 と食い違う）。
  2. R4 BS-04 は 項090→要求50 を DIRECTLY_OBSERVABLE、同形の 項→request を ORDER_DEPENDENT と分類。同じ関係に別の分類が付いた。
- 転記の改変: R3 の `cropReason`（BS-03/07）に含まれていた一時 render file の場所の断片（`; render=…`）のみを除去した（`visual-observations.json` の `transcription` に記載）。reviewer の観察内容は改変していない。
- 重大な UNRESOLVED_CONFLICT（A 層 evidence と reviewer 観察の食い違い）: 検出されず。照合した範囲は marker / request の件数（BS-01/02/03/05/06/07 で reviewer 記録と A 層 unit 数が一致）、BS-04 の GT 38 行、circled の有無（GT と 4 page で一致）。

## 13. Claim boundary

- production claim なし。semantic schema の決定ではない。GT でも formal evaluation でもない。
- A 層の変更を示唆しない（§2 の freeze state は研究 sequencing の記録）。A1/A2/B/C を再開しない。
- 本書の観察は 8 page の exploratory 観察であり、prevalence や一般性の推定、B 層 GO の判断を含まない。
- sample として観察した page は blind でなくなり、後続の held-out として使わない。
