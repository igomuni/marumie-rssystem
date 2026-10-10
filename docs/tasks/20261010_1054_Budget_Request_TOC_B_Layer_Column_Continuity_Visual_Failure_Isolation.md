# TOC B 層 Column Continuity Visual Failure Isolation（Phase 1: sample freeze・pre-review）

出典略記: 「#412 doc」= `20261010_0659_Budget_Request_TOC_B_Layer_Scope_Continuity_Failure_Isolation.md`、「#411 doc」= `20261010_0627_Budget_Request_TOC_B_Layer_Problem_Observation.md`。本 doc はこの Commit では **pre-review の節のみ**。視覚観察の結果は書かない。

## 1. 目的と研究質問

#412 が mechanical に切り出した P2（右 column の先頭 semantic row が REQUEST で、右 column 内にそれ以前の ITEM が無い page・25 page／53 REQUEST）について、次を failure-isolate する。

- 右 column 先頭の REQUEST 群は、同一 page 左 column のどの explicit marker context の続きに視覚的に一意に読めるのか。それとも page-local の視覚 evidence だけでは決められないのか。判断に使った視覚手がかりは何か。

resolver・rule・仮説は作らない。GT・held-out・prevalence 推定でもない exploratory な visual failure isolation。標本は無作為ではない。

## 2. 順序条件

1. **Phase 1（本 Commit）**: sample を #412 census だけから選定し manifest を freeze。PDF は見ない。
2. **Phase 2**: freeze 後にのみ視覚観察。独立 2 reviewer。
3. 順序は freeze → visual。**squash 禁止**（freeze Commit を履歴に残す）。freeze 後に sample・規則を変更しない。

## 3. 母集団

- P2 = 25 page。#411 で視覚観察済みの BS-01（maff 230901-4.pdf p3）・BS-03（maff 230901-2.pdf p5）・BS-06（mhlw 24syokan/dl/05-1b-01.pdf p3）を除外（3 page、いずれも P2 に含まれる）。**eligible = 22 page**。#411 の視覚結論は読まず selection にも使っていない。
- eligible の構成:

| 軸 | 内訳 |
|----|------|
| partition | DEVELOPMENT_EXPLORED 15 / FIRST_HELDOUT_POSTHOC 5 / NEW_HELDOUT_POSTHOC 2 |
| classifierSource | DIRECT 12 / INHERITED 10 |
| left stream 末尾 semantic row の kind | ITEM 15 / REQUEST 7 |
| 層（source × 末尾 kind） | DIRECT/ITEM 8 / DIRECT/REQUEST 4 / INHERITED/ITEM 7 / INHERITED/REQUEST 3 |
| 右先頭 REQUEST 数（rightRequestsBeforeFirstItem） | 1: 15 page / 2: 5 / 3: 1 / 19: 1 |

## 4. 選定規則（census を見る前に helper 冒頭コメントで固定・結果を見て調整していない）

#412 doc §10 の提案を変更せず実装。正本は `scripts/pipeline-v2/lib/budget-request-toc-b-column-continuity-sample.ts` 冒頭コメント（algorithm `column-continuity-visual-sample/v1`）。

- 層 = classifierSource × left stream 末尾の最後の semantic row の kind（census `q2.leftTail` の最後の要素）の 4 層。各層から (localPdfPath, physicalPage) 辞書順で先頭 1 page。
- 追加 2 page = 層選択済みを除く eligible 全体から、右先頭 REQUEST 数（census `q2.rightRequestsBeforeFirstItem`）の降順、同点は辞書順。
- 合計最大 6 page、重複なし。層が空でも他の層で補わない。
- 解釈の固定: 辞書順は localPdfPath を UTF-16 code unit の文字列比較、次に physicalPage 数値昇順。「右先頭 REQUEST 数」は census の定義どおり **右 column の最初の ITEM より前の REQUEST 数**。sample ID は選ばれた page を辞書順に並べて CC-01.. と採番（層・選定順を示唆しない）。
- visual content・semantic continuation の見込み・既知の観察による手選びはしていない。

## 5. 選定結果

| ID | PDF（data/download/ 配下） | page | partition | source | left 末尾 | 右先頭 REQUEST | stratum |
|----|------|------|------|------|------|------|------|
| CC-01 | cfa.go.jp/…/20230907_policies_budget_04.pdf | 3 | DEVELOPMENT_EXPLORED | DIRECT | REQUEST | 1 | DIRECT/REQUEST |
| CC-02 | env.go.jp/content/000157010.pdf | 3 | DEVELOPMENT_EXPLORED | DIRECT | ITEM | 1 | DIRECT/ITEM |
| CC-03 | mext.go.jp/content/20230914-mxt_kaikesou01-000031817_01.pdf | 5 | DEVELOPMENT_EXPLORED | INHERITED | ITEM | 1 | INHERITED/ITEM |
| CC-04 | mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf | 7 | DEVELOPMENT_EXPLORED | INHERITED | REQUEST | 1 | INHERITED/REQUEST |
| CC-05 | mlit.go.jp/page/content/001630995.pdf | 5 | FIRST_HELDOUT_POSTHOC | INHERITED | REQUEST | 19 | TOP_RIGHT_REQUESTS |
| CC-06 | mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf | 2 | DEVELOPMENT_EXPLORED | DIRECT | REQUEST | 3 | TOP_RIGHT_REQUESTS |

4 層すべて充足（欠けた層なし）。partition は DEVELOPMENT_EXPLORED 5 / FIRST_HELDOUT_POSTHOC 1（NEW_HELDOUT_POSTHOC は eligible に 2 page あるが選ばれず）。#411 overlap = 0。

## 6. Freeze artifact

- `tests/fixtures/budget-request-toc-b-layer-column-continuity-visual-failure-isolation/2024/review-sample-manifest.json`
- manifest SHA-256: `50fc4d46e6d207bae1e9e014211433bf04a3c554bda85a01f41ea65ac475fac8`（同一入力で 3 回生成して一致）
- source census SHA-256: `c86db4878927403ee8419ced5e623b262730b33ddb26c69b5a847e562001a978`（#412）
- 生成: `npx tsx scripts/pipeline-v2/analyze-budget-request-toc-b-column-continuity-sample.ts --freeze-fixture`

## 7. PDF 未閲覧の宣言

本 Phase では PDF を開かず、render・pdftotext・OCR・raw-text も使っていない。`data/download` にもアクセスしていない。入力は committed の census・parser 出力・#411 sample の identity のみ。

## 8. Visual review 手順（予定・Phase 2）

- reviewer への配布物は blind locator（PDF 論理パス・physicalPage・右 column 先頭 REQUEST 群の要求番号／名称抜粋／lineIndex のみ。stratum・classifierSource・左 column 情報は含めない）。locator は repo に入れない。
- 独立 2 reviewer が互いの結果を見ずに観察。taxonomy は Phase 2 の冒頭で、観察前に固定する（例: 左 column の特定 marker に一意に続く／複数候補で決まらない／page 内に context が無い／判断不能、と各判断の視覚手がかり）。
- Phase 2 の結果・taxonomy の最終形は別 Commit。

## 9. Claim boundary

- 22 page からの最大 6 page の exploratory 標本。prevalence・一般化・resolver の根拠・GT としては使わない。
- 選定は census の機械的フィールドのみ。#411 の視覚結論は使っていない。
- A 層 freeze state・parser・evaluator は変更しない。
