# FieldResolver v0 Golden Samples

Contract は `20261003_0648_FieldResolver_v0_Contract.md`。FieldResolver 本体は実装しない。Golden は評価専用で、FieldResolver の inference より先に固定する。この文書は段階的に書く（棚卸し・再利用判定 → 観測・coverage matrix → 検証・freeze）。**現在: 棚卸しと再利用判定まで（commit 1）。**

## 1. asset inventory（既存資産の棚卸し）

| asset | documents / pages | fields | visual human-confirmed? | source refs? | reusable for FieldResolver GT? |
| --- | --- | --- | --- | --- | --- |
| `tests/fixtures/budget-request-extraction/2024/golden-samples.json` | METI p9 / MHLW p1268・p1555 / MEXT p876（4 locator） | locator のみ（`groundTruthStatus: pending-human-review`） | — | canonicalUrl + 物理ページ | **locator として再利用**（値は無い） |
| `…/human-observations.json` | METI p9 / MHLW p1268・p1555（MEXT p876 は無し） | 6件: text 断片と位置（x, y）だけ | 過去に人間が目視・座標確認（ファイルの note より） | x, y（SourceToken bbox の xMin / yMin と同じ座標系） | **位置のアンカーとして部分的に再利用**（§2） |
| SourceToken / TableGeometry / LogicalRow の fixture・テスト | 合成データ + 実PDFの golden test（ローカル原本があれば実行） | 観測のみ（rawText・bbox・行構成）。値の正解ではない | — | あり（SourceToken.index 等） | **GT としては使えない**（出力の観測。入力として使う側） |
| hierarchy GT 8文書（`*-toc-hierarchy-gt*.json`） | MHLW・METI・MEXT・環境省・農水省復興特会・MLIT復興特会・防衛省・こども家庭庁 | 組織・項・要求の名称・コード・親・開始頁（目次由来） | 目次の機械転記（視覚確認ではない） | 目次ページ | **field GT には使えない**（金額・符号・blank を持たない）。hierarchy の入力状態の参考のみ |
| hierarchy artifacts（`data/work/…`、gitignore・再生成可能） | METI 9–106、MHLW 1555–1700、MEXT 1045–1339 ほか | `nodes[]`・`edges[]`・`hierarchyResolutionContext`・`headerCollisionObservation` | — | あり（sourceRowRefs・sourceTokenRefs） | **FieldResolver の入力**（GT ではない）。hierarchy-dependent field の入力状態の根拠 |
| extraction / semantic candidate の既存テスト | 合成・golden | 観測・候補（金額group・signObservation など） | — | あり | **GT としては使えない**（候補の観測。正解ではない） |
| docs に記録された人間視認値 | `docs/data-pipeline-v2.md` 等 | 手法・観測の記述（個別の金額の正解値は無い） | — | — | 再利用できる値は無い |

結論: **金額・符号・blank・備考・差額の Golden として使える既存資産は無い**。`human-observations.json` は、対象行の text の位置を示すアンカーとしてだけ部分的に使える。足りない分は、新規の視覚観測で作る（既存の extraction 出力や抽出テキストをコピーして正解にしない）。

## 2. `human-observations.json` の再利用判定

| observation | visual human-confirmed? | exact page? | exact target? | raw field value? | blank 区別? | sign 観測? | provenance は十分? | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| METI p9 `01-95`（x 65.569, y 131.93） | ○（過去に人間が目視・座標確認） | ○（物理p9） | ○（要求 `01-95` の行） | code の text のみ | ✗ | ✗ | 位置（x, y）のみ | **partial**: code・行のアンカーとして再利用 |
| METI p9 `経済産業本省一般行政`（x 89.726, y 131.93） | 同上 | ○ | ○ | name の先頭断片のみ（折返し名称の全体ではない） | ✗ | ✗ | 位置のみ | **partial**: name の行アンカー |
| METI p9 `（要求要旨）`（x 469.336, y 131.93） | 同上 | ○ | ○ | ラベルのみ（本文なし） | ✗ | ✗ | 位置のみ | **partial**: remark_text 候補の位置アンカー |
| MHLW p1268 `020`（x 58.667, y 111.099） | 同上 | ○ | ○（項 `020` の行） | code のみ | ✗ | ✗ | 位置のみ | **partial**: code・行のアンカー |
| MHLW p1555 `01-95`（x 65.569, y 423.567） | 同上 | ○ | ○（要求 186 の行） | code のみ | ✗ | ✗ | 位置のみ | **partial**: code・行のアンカー |
| MHLW p1555 `（要求要旨）`（x 469.336, y 451.342） | 同上 | ○ | ○ | ラベルのみ | ✗ | ✗ | 位置のみ | **partial**: remark_text 候補の位置アンカー |

- **金額GTとして十分か**: ✗（金額の値が1件も無い）。**符号GT**: ✗。**blank/null GT**: ✗。**備考GT**: ✗（ラベルの位置のみ）。
- **visual observation か extracted text 由来か**: ファイルの note によると「人間が過去にPDF原本で目視・座標確認した値」（visual + 座標）。ただし値は text 断片と位置だけで、field の値ではない。
- 使い方: Golden の `humanAnchors` として、位置（x, y）をそのまま参照・移植してよい（上の5〜6件）。それ以外の field（金額・符号・blank・差額・備考・MEXT p876 の全て）は、**新規の視覚観測**で作る。既存値から Golden を推測して埋めない。

## 3. selected documents / pages（8ページ・20 target）

fixture: `tests/fixtures/budget-request-field-resolver/v0/golden.json`。hierarchy GT の8文書へ機械的に広げず、**field の挙動の多様性**を優先した。既存4 page family を核に、field-level の境界を補う4ページを加えた。

| sample | 文書・物理ページ（印字） | tier | target | なぜこのサンプルか |
| --- | --- | --- | --- | --- |
| `meti-ippan-p9` | METI `ippan_o.pdf` p9（経（本） 5） | normal | 5 | 通常の要求行（3金額）、右側の要求要旨、組織行、明示の△（差額）・0（差額）、全て空欄の行、単位表記が印字されるページ |
| `meti-ippan-p10` | METI p10（6 経（本）） | boundary-sign | 1 | **要求額の欄そのもの**の△、備考内の `△27人`（金額の符号ではない記号） |
| `meti-ippan-p96` | METI p96（92 経（中）） | boundary-blank-zero | 4 | 前年度が**空欄**で要求額・差額がある行（blank ≠ 0）、明示の `0 / 0 / 0`、全て空欄、備考欄の数字（補助）が空欄を埋めない |
| `meti-ippan-p105` | METI p105（経（中） 101） | boundary-hierarchy-risk | 2 | 項 `063`（level_gap + strong header の親）と要求 `05-60`（ページ末で金額が次ページ） |
| `mhlw-ippan-p1268` | MHLW `05-1b-01.pdf` p1268（1260 厚（ハ）） | moderate | 1 | 左の項 `020`（金額は空欄）と、右の3つの補助領域（積算・5年度表・罫線表。△を含む） |
| `mhlw-ippan-p1555` | MHLW p1555（厚（地） 1547） | extreme | 3 | 組織行・項（空欄）・要求（3金額）。項と要求の間の大きな表を要求へ attach しない |
| `mext-detail-p876` | MEXT `…000031817_03.pdf` p876（884 文（本）） | structured-remark | 2 | 備考欄が自由記述＋構造化された積算表。積算の `計` が左の金額と同額（根拠にしない）。差額が明示の `0` |
| `cfa-general-p136` | こども家庭庁 `…budget_04.pdf` p136（132 内（こ）） | boundary-hierarchy-risk | 2 | 要求の差額が△、項 `085`（resolved だが親が strong header）、要求→項は safe・要求→組織は risky |

## 4. field coverage matrix

`TBD` は残していない。実PDFに適切な例が見つからなかったものは **NOT FOUND IN CURRENT GOLDEN SET** と明示する（v0 PoC の評価対象外）。

| behavior | sample / target |
| --- | --- |
| normal 3 amounts（通常の要求行） | `meti-p9-req01-95`、`mhlw-p1555-req186`、組織行 `meti-p9-org010`・`mhlw-p1555-org070` |
| right-side request-summary text | `meti-p9-req01-95`（remark_text の参照のみ） |
| auxiliary historical table（5年度表） | `mhlw-p1268-item020`、`mhlw-p1555-item010`・`mhlw-p1555-req186` |
| large breakdown | `mhlw-p1268-item020`（積算表）、`mext-p876-line015` |
| intervening table | `mhlw-p1555-req186`（上部の表を要求に attach しない） |
| structured remark table | `mext-p876-line015`・`mext-p876-line-honorarium` |
| explicit sign（difference） | `meti-p9-line-02-0200-sign`、`cfa-p136-req17` |
| explicit sign（requested） | `meti-p10-line-003-signed-request` |
| 記号だが金額の符号ではない（`△27人`） | `meti-p10-line-003-signed-request`（`mustNotUseAsSign`） |
| amount present but no sign symbol | 大半の金額 field（`sign.status = not_observed`） |
| blank（空欄）と explicit zero の対比 | `meti-p96-line-03-0300-blank-prev`・`meti-p96-line-05-0100-explicit-zero`・`meti-p96-line-1360-blank-all`、`meti-p9-line-001-blank`・`meti-p9-line-03-0200-zero-diff` |
| 補助領域の数字が空欄を埋めない | `meti-p96-line-1010-aux-number`、`mhlw-p1268-item020`、`mext-p876-line-honorarium` |
| wrapped name / continuation | `meti-p9-req01-95`・`meti-p96-line-05-0100`（3行）・`meti-p105-req49`（3行）ほか多数 |
| ページに単位表記がある／ない | `meti-ippan-p9`（resolved）／他の7ページ（not_observed。他ページから推定しない） |
| **missing difference（前年度・要求額はあるが差額が表示されない）** | **NOT FOUND IN CURRENT GOLDEN SET**（METI p9–p106 の明細を機械的に走査したが確実な例が無く、目視では見つからなかった。v0 PoC の評価対象外） |
| hierarchy: safe | `meti-p9-req01-95`、`mhlw-p1555-item010`・`mhlw-p1555-req186` |
| hierarchy: explicitly unresolved（root。row-local は解決可） | `meti-p9-org010`、`mhlw-p1555-org070` |
| hierarchy: level_gap（+ strong header） | `meti-p105-item063` |
| hierarchy: resolved + strong header risk | `cfa-p136-item085`、`cfa-p136-req17`（要求→組織の合成） |
| single-organization の B placement が発火するページ | **NOT FOUND IN CURRENT GOLDEN SET**（B placement は hierarchy 内部の決定で、field レベルの挙動としては固有の値がない。こども家庭庁は single-organization だが B は発火しない） |
| 1–3桁の page reference | **v0 の対象外**（総表ページの field は deferred） |

## 5. negative / boundary coverage

- **sign**: 明示の △（差額・要求額）が見える例、金額はあるが sign が見えない例（大半）、sign に見えるが金額の符号ではない記号（`△27人`）。
- **blank**: 視覚的に空欄の amount（項・要求の見出し行、前年度だけの空欄、全て空欄）、explicit zero（差額・前年度・3列とも）。
- **difference**: 差額が表示される例。表示されない例は NOT FOUND。
- **auxiliary**: 右側に表・テキストがあるが core row に attach すべきでない例（MHLW p1268・p1555、MEXT p876、METI p96・p10）。
- **hierarchy risk**: `level_gap`（`meti-p105-item063`）、`resolved + strong header`（`cfa-p136-item085`、`cfa-p136-req17`）、explicitly unresolved の root（組織行）。いずれも hierarchy-dependent な association を確定しないケース。row-local field は解決可。

## 6. hierarchy-risk coverage

hierarchy-dependent field の期待値は **Contract §9 の policy から導いた**もの（視覚の真値ではない。fixture の `derivedFrom` に明記）。hierarchy の入力状態は、凍結済みの DocumentHierarchy B-only artifact の状態を `hierarchy.inputState` に記録した（再生成可能な派生の入力）。

| target | 入力状態 | parentItemAssociation | parentOrganizationAssociation |
| --- | --- | --- | --- |
| `meti-p9-req01-95` | safe | resolved（項 010 経済産業本省共通費） | resolved（組織 010 経済産業本省） |
| `mhlw-p1555-req186` | safe | resolved（項 010 地方厚生局共通費） | resolved（組織 070 地方厚生局） |
| `mhlw-p1555-item010` | safe | not_applicable | resolved（組織 070） |
| `meti-p105-req49` | safe（edge）／合成は risky | resolved（項 063） | **not_resolved**（項→組織が level_gap + strong header） |
| `meti-p105-item063` | level_gap + strong header 親 | not_applicable | **not_resolved** |
| `cfa-p136-req17` | safe（edge）／合成は risky | resolved（項 085） | **not_resolved**（項 085 の親が strong header） |
| `cfa-p136-item085` | resolved + strong header 親 | not_applicable | **not_resolved** |
| 組織行（`meti-p9-org010`・`mhlw-p1555-org070`） | 明示的な unresolved（root） | not_applicable | not_applicable |
| MHLW p1268・MEXT p876・METI の明細行（目） | hierarchy artifact なし／対象外 | outside_v0_scope / not_applicable | outside_v0_scope / not_applicable |

`not_resolved` は `unresolved` または `ambiguous`（どちらも許容）。`resolved` を返したら false resolve（safety failure）。

## 7. source association GT

各 target に `expectedSourceClass`（code=same_row、name=same_row_or_continuation、3 amount と各 sign=same_row）と、補助領域の記述（`auxiliary[].class` と `expectedAttachToAmountFields: none`）を持たせた。位置は、既存の人間確認アンカー（METI p9・MHLW p1268・p1555 の `humanAnchors`。x, y は SourceToken と同じ座標系）と、描画画像からの視覚推定（`approxYPt`、±8pt。`locatorMethod` に明記）。列の band（`columnBandsPt`）は共通の帳票の視覚推定。同じ数字がページ上に複数あっても、値一致だけでは exact としない（`meti-p96-line-1010-aux-number`・`mext-p876-line-honorarium` が該当）。

## 8. observation method（観測方法・限界）

- 各ページを `pdftoppm` で画像に描画（全体130dpi、読み取りにくい行は220dpiの切り抜き）し、**アシスタント（AI）が視覚で読み取った**。**人間による視認ではない**。`humanReview: pending`。
- 値は描画した画像だけから読み、抽出テキスト・隣接値の計算・一般知識・過去の会話の値は使っていない。読み取れない値は記録していない。確度が下がるものは `observationConfidence: medium`（MEXT p876 の名称の全角記号）。
- ページの選定には、p96・p105・p136 で**抽出結果を探索の補助**として使った（候補ページの発見だけ）。値は描画画像から読んだ。
- 既存の人間確認（`human-observations.json`）は位置のアンカーとして参照した。値の真値としては使っていない。

## 9. GT contamination boundary

Golden は **FieldResolver の inference より先に**固定する。Golden の作成時に将来の FieldResolver の出力を見ていない（FieldResolver は未実装）。既存の extraction 出力を正解としてコピーしていない。Golden は evaluator / test からだけ読み、将来の inference コードから import しない（Contract §14。fixture integrity のテストで確認する）。

## 10. known gaps（現時点）

- 視覚確認がAIによるもので、**人間のレビューが未実施**（レビューで値が変われば、PoC の前に別 commit で訂正する）。
- 「差額が表示されない行」は NOT FOUND。
- hierarchy-dependent field の評価は、凍結済み hierarchy artifact がある5ページだけ。MHLW p1268・MEXT p876 は対象外。
- Golden は小さい（8ページ・20 target）。他省庁・他の書式の多様性は未検証。
- 要求番号（丸数字）・remark の本文・総表ページ・ページ跨ぎの continuation は v0 の対象外。

## 11. fixture validation と freeze

- 検証コード（最小）: `scripts/pipeline-v2/lib/budget-request-field-resolver-golden.ts`（schema・status 語彙・amount の整合・blank に値が無いこと・explicit zero・name の normalized と rawLines の整合・auxiliary が amount に attach しないこと・hierarchy の期待の整合・provenance・coverage）。テスト `budget-request-field-resolver-golden.test.ts`（20件）: 実 fixture が検証を通ること、必須の挙動が全てカバーされていること、NOT FOUND が明示され値を作っていないこと、不正な fixture（重複 ID・不正 status・blank が数値を持つ・evidence なしの resolved・不整合な normalized・auxiliary が attach・hierarchy の期待の不備・provenance の欠落）を拒否すること、推論側が Golden を参照しないこと。**FieldResolver の inference のテスト・コードは無い。**
- **freeze 宣言**: Golden fixture（`tests/fixtures/budget-request-field-resolver/v0/golden.json`）・Contract・評価方針（Contract §15–16）は、この commit（`git log` の `Golden freeze`）で固定する。FieldResolver の PoC 実装は、この commit の後から始める。以降、PoC の結果を見て Golden を追加・変更しない（人間レビューで値の誤りが見つかった場合は、PoC より前に別 commit で訂正を記録する）。
- 状態: inference implementation = **なし**。DocumentHierarchy は CLOSED のまま（A3・B+A2 の再評価・B の再調整・header 規則の再設計・Future Experiment C は行っていない）。
