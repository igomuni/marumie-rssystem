# 概算要求 hierarchy / record detection failure isolation — 結果

事前登録: `20261005_0730_Budget_Request_Hierarchy_Failure_Isolation_Preregistration.md`（Commit A `fa797a9`、doc SHA-256 `0841ed5b…484d`）。実験は Commit A の後（B `a3ff781`）。判定規則・指標は結果を見た後に変更していない。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `HIERARCHY_MAJOR_CAUSAL_FACTOR`（規則 3）。** 8 PDF の hierarchy 区間に限った paired 診断であり、74 PDF 全体へ一般化せず、回復件数も推計しない。

## 条件

- paired_evaluable 8 PDF / 1,403 pages / logical row 候補 51,869（除外 0）。ON control（baseline と同条件）は 8/8 PDF でバイト一致・field 一致（7,973 records）。OFF は同一ページ範囲を hierarchy=null の 1 区間で実行。
- join: 7,973 / 7,973、unjoinable 0、duplicate 0、ページ集合一致。ON・OFF とも再実行で artifact 不変（transition `b5283cdf…acd`、inventory `98d1b2b3…5540`）。
- 全 frozen 入力（baseline 各 artifact・P1 matcher・FieldResolver・MOF jikou・manifest・prereg）の hash は評価 script 内で照合済み。

## 観測（paired、実測）

recordKind 遷移（ON 行 → OFF 列、join 全 unit）:

| ON \ OFF | request | detail_line | unclassified | 他 |
|---|---:|---:|---:|---:|
| organization（20） | 0 | 0 | **20** | 0 |
| item（97） | 0 | 0 | **97** | 0 |
| request（274） | 274 | 0 | 0 | 0 |
| detail_line（6,504） | 0 | 5,237 | **1,267** | 0 |
| unclassified（1,078） | 0 | 0 | 1,078 | 0 |

- H1: ON item 97 件は全件 OFF で unclassified（item 0 件、7 PDF・7 省庁。こども家庭庁は ON でも item 0）。
- H2: ON で非 unclassified だった 1,384 件（org 20・item 97・detail_line 1,267）が OFF で unclassified。OFF の unclassified 2,462 件（ON 1,078 の約 2.3 倍）のうち新規 1,384、ON から残存 1,078。request は全件 request のまま（request は hierarchy に依存しない）。
- H3: ON で request だった 274 件の親の項: `resolved_item→not_observed` 158、`resolved_non_item→not_observed` 69、`unresolved→not_observed` 47。OFF では request の親 status が全件 `not_observed`。
- H4（一般会計 request 235 件、P1 matcher 無修正）:

| 段階 | ON | OFF |
|---|---:|---:|
| request | 235 | 235 |
| 名称あり | 216 | 216 |
| 親 item resolved（item 種別） | 103 | 0 |
| 親 MOF exact_unique（comparable） | 101 | 0 |
| jikou exact_unique | 98 | 0 |

- 名称 status: 7,973 unit すべてで ON と OFF が同一（changed 0）。`continuation_ambiguous` 838/838、`no_name_token` 146/146、`column_layout_unobserved` は paired 区間で 0/0。→ 名称の失敗は hierarchy とは別の問題として切り分けられた（hierarchy を外しても名称側は動かない）。

PDF 別・省庁別の遷移は `transition-evaluation.json`（`perPdf`、`byPublisher`）に保存。item 損失は 環境17・農水8・経産30・文科19・厚労14・国交8・防衛1。

## `parent_item_not_item_kind` 68 件（baseline 一般会計）

68 件はすべて paired population 内（こども家庭庁 20・環境省 20・防衛省 27・経産 1）。ON での親 record の種別は organization 13・unclassified 55。OFF では全件 `not_observed`（解消ではなく観測不能になる）。ON でも 68 件が残るため、hierarchy 有りでも残る独立の failure class（親 node の kind 判定: item でない行を親に解決している）として保持する。修正はしていない。

## baseline `unclassified` 15,304 件の inventory（既存 metadata のみ）

- hierarchy 区間 1,078（7.0%）／null hierarchy 区間 14,226（93.0%）。省庁別は厚労 4,742・国交 2,481・文科 1,545・外務 1,159・総務 946・農水 930・環境 760・防衛 542 が上位（PDF 72 本に分布）。
- name failure との重なり（unclassified 内）: null 区間 resolved 7,966・continuation_ambiguous 3,283・no_name_token 1,299・column_layout_unobserved 1,623・corroborated でない 55／hierarchy 区間 resolved 433・continuation_ambiguous 516・no_name_token 126・他 3。null 区間は名称側の失敗と大きく重なるが、paired の結果から名称 status は hierarchy では動かない。
- 同一区間内で前後の行が detail_line / unclassified / request のいずれか、という構成（null 区間: detail_line|detail_line 3,845・unclassified|unclassified 2,929 ほか）。OFF の unclassified 2,462 も同種の構成。
- unclassified の割合（record 内）: baseline の null 区間 14,226 / 41,486 = 34.3%、74 PDF 全体 9,409 / 30,054 = 31.3%、paired の OFF 2,462 / 7,973 = 30.9%、ON 13.5%（1,078 / 7,973）。

## 74 PDF への接続（観測・実験的証拠・解釈を分ける）

- 観測（baseline）: hierarchy 契約のない 74 PDF（成功 66）には item・organization が 0 件、request の親は全件 `not_observed`（2,968 件）、unclassified 9,409 件。
- 実験的証拠（paired、8 PDF の hierarchy 区間）: hierarchy を外すと item 97→0、organization 20→0、plain code の detail_line の 19% が unclassified へ、request の親の項は全件 `not_observed`、一般会計 comparable 101→0。名称 status は不変。
- 解釈: 74 PDF で item・organization が 0 件で親が全件 `not_observed` という観測は、paired で hierarchy を外したときの挙動（Phase A のコード機構の予測どおり）と整合する。ただし 74 PDF に hierarchy を実際に付与した場合の回復件数は本実験では分からず、推計しない。ON でも unclassified 1,078（13.5%）、親が item 種別でない 68 件、名称失敗（continuation_ambiguous・no_name_token）が残る。

## 注意（判定の読み方）

`I`・`P` の大きさは Phase A のとおりコード上の構造から必然的に大きくなる量であり、本診断は「実データでその規模がどれだけか」と「名称側が動かないこと」を実測した。判定規則 3 の条件はすべて満たした（I=97>R=0、X=1,384>Y=1,078、P=158>0、C_on=101>C_off=0、I・P ともに 7 PDF・7 省庁）。X>Y は 1,384 対 1,078 と接近しており、規則上の判定は変わらないが、unclassified の主因が hierarchy 除去だと言い切れる強さではない（ON でも 1,078 が残る）。

## 次の候補（実装しない）

次は DocumentHierarchy の full-corpus 化の設計・preregistration。併せて hierarchy 有りでも残る 3 系統（名称 continuation/no_name_token、親 kind 判定 68 件、ON の unclassified 1,078）を、hierarchy 付与後の baseline 再評価で別 failure class として分離する。rotate=90（8 PDF）は独立のまま。

## 検証

tsc エラー 0・lint エラー 0・vitest 121 files / 1,440 tests pass。OFF 再実行・評価再実行で artifact 不変。raw PDF は runner が manifest hash を照合。

今回は full-corpus baseline 後の failure isolation として、既存 hierarchy 契約を持つ同一 PDF population の hierarchy ON/OFF paired diagnostic を行った。DocumentHierarchy の full-corpus 追加、FieldResolver / recordKind / name resolution / rotate 対応、baseline 後の精度改善は行っていない。
