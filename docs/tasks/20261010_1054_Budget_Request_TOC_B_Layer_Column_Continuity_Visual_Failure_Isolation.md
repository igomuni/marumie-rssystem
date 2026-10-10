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

---

## 10. Phase 2/3: 視覚 review 方法（§8 の予定の実施結果）

- 観察 fixture: `tests/fixtures/budget-request-toc-b-layer-column-continuity-visual-failure-isolation/2024/visual-observations.json`（探索的・`notGroundTruth: true`）。reviewer 記録は 12 判定すべてそのまま保持（要約・書き換えなし。除去した断片は 0）。
- sample は Commit 1（d5ba559、manifest SHA-256 `50fc4d46…`）で PDF を見る前に freeze 済み。観察後に差し替え・追加していない。manifest hash は不変を再確認。
- blind: reviewer への配布物は blind locator のみ。**独立 2 判定**（primary 1 + second 1 / sample）。reviewer は互いの出力を読んでいない。
- render: 全 12 判定が `pdftoppm` 110dpi・full page・crop なし（reviewer ファイルの renderConditions で確認）。再 render なし。
- 担当割: primary = P1（CC-01, 02）／P2（CC-03, 04）／P3（CC-05, 06）、second = S1（CC-06, 01）／S2（CC-02, 03）／S3（CC-04, 05）。
- 安全規則（reviewer 指示）: 左 column 最終 ITEM を親とする読み・ページ欄の数値一致・名称類似による補完を採用しない。視覚的に結べるものだけを記録する。
- 判定 enum: UNIQUE_PAGE_LOCAL_CONTINUATION / AMBIGUOUS_PAGE_LOCAL_CONTINUATION / NO_PAGE_LOCAL_CONTEXT / EXPLICIT_RESET / UNREADABLE。

## 11. Per-sample 結果

全 sample で target REQUEST 群の視覚範囲は locator と一致、右 column の target 群の**上**に marker・見出し・継続表示は無く、左右 column は二重縦罫線で分かれるのみ。**全 12 判定で targetContext = null**。confidence は 12 判定すべて medium。

| sample | primary | second | target 群（視覚） | 右 column 最初の explicit marker（target の直下＝後） |
|---|---|---|---|---|
| CC-01 | P1 AMBIGUOUS | S1 AMBIGUOUS | 19 の 1 件 | （項）110 こども政策推進費 |
| CC-02 | P1 AMBIGUOUS | S2 AMBIGUOUS | 15 の 1 件 | （項）130 環境保健対策推進費 |
| CC-03 | P2 NO_PAGE_LOCAL_CONTEXT | S2 AMBIGUOUS | 103 の 1 件 | （組織）040 スポーツ庁 |
| CC-04 | P2 NO_PAGE_LOCAL_CONTEXT | S3 NO_PAGE_LOCAL_CONTEXT | 197 の 1 件 | （項）015 都道府県労働局施設費 |
| CC-05 | P3 AMBIGUOUS | S3 NO_PAGE_LOCAL_CONTEXT | 101〜119 の 19 件（間に marker・罫線・見出しなし） | （項）395 北海道総合開発推進費（119 の後） |
| CC-06 | P3 AMBIGUOUS | S1 AMBIGUOUS | 23〜25 の 3 件 | （項）090 貨幣製造及信用秩序制度等企画立案費（25 の後） |

- page-local marker 数（reviewer 記録）: CC-01 14（左 11/右 3）、CC-02 22、CC-03 22、CC-04 24、CC-05 18、CC-06 19（P3）／14（S1。右 column marker は target の下のみ列挙）。一覧は fixture の `pageLocalMarkers`。reviewer 間で列挙範囲が異なる（CC-06）が、そのまま保存。
- interruption / reset 証拠: 12 判定すべて「target の上に reset を示す見出し・継続表示・新 marker なし」。target の**後**に始まる marker（上表右端）は target の新 context 開始とは見なされていない（reviewer の記述）。CC-03 では S2 が「target の後に（組織）040 が始まる」と記述、P2 は「新しい組織の開始に見えるが 103 自体より下」と記述。CC-05 の S3 は「（項）395 が新 context 開始かは視覚上の明示では示されない」と記述。
- candidateContexts: AMBIGUOUS の reviewer は左 column の marker 群（最終 ITEM を含む）を「候補だが視覚的に選べない」として列挙。NO_PAGE_LOCAL_CONTEXT の reviewer は左 column 末尾の marker を「column をまたぐ視覚的連結が無い」ため候補として採用せず。
- unreadable: 判定 enum としての UNREADABLE は 0。S2（CC-02）が左 column の長い折返し名称の一部を「読みづらいが判定に影響なし」と記述、P1（CC-02）も同旨の notes。

## 12. Reviewer agreement

- 一致 4（CC-01, 02, 04, 06）／不一致 2（CC-03, CC-05）。
- CC-03: P2 = NO_PAGE_LOCAL_CONTEXT、S2 = AMBIGUOUS。CC-05: P3 = AMBIGUOUS、S3 = NO_PAGE_LOCAL_CONTEXT。
- 不一致の中身は reviewer の記述どおり、AMBIGUOUS（page 内に marker が見え、複数あり選べない）と NO_PAGE_LOCAL_CONTEXT（target に視覚的に結べる marker が無い）という**隣接区分の差**。どちらの判定も「一意に続く context は視覚で特定できない」点では同じで、UNIQUE を主張した判定は 12 中 0。
- 不一致は多数決・推測で解消していない。fixture に両判定を保存（`agreement.resolution = NOT_RESOLVED`）。

## 13. Outcome counts

reviewer 判定ごと（12）:

| UNIQUE | AMBIGUOUS | NO_PAGE_LOCAL_CONTEXT | EXPLICIT_RESET | UNREADABLE |
|---|---|---|---|---|
| 0 | 8 | 4 | 0 | 0 |

sample ごと: AMBIGUOUS 2/2 が CC-01, 02, 06、NO_CONTEXT 2/2 が CC-04、1/1 割れが CC-03, 05。

## 14. Post-hoc mechanical comparison（review 終了後の unblind）

source は #412 census（SHA-256 `c86db487…`）。**descriptive な比較であり rule ではない**。「左 ITEM 数」は左 stream 内の ITEM marker 数（census の `streams[LEFT].items`）、「他の左 ITEM」はその最終 ITEM を除いた数。

| sample | 左 stream 末尾の semantic | 左の最終 ITEM（以降の REQUEST 数） | 左 ITEM 数 / 他の左 ITEM | 右 leading REQUEST 数 | 右の最初の ITEM |
|---|---|---|---|---|---|
| CC-01 | REQUEST 18 | 095（1） | 10 / 9 | 1 | 110 |
| CC-02 | ITEM 120 | 120（0） | 13 / 12 | 1 | 130 |
| CC-03 | ITEM 150 | 150（0） | 15 / 14 | 1 | 010 |
| CC-04 | REQUEST 196 | 010（2） | 11 / 10 | 1 | 015 |
| CC-05 | REQUEST 100 | 376（14） | 9 / 8 | 19 | 395 |
| CC-06 | REQUEST 22 | 080（6） | 7 / 6 | 3 | 090 |

- 左の最終 ITEM は census 上は全 sample で一意に定義できるが、reviewer はどの sample でも視覚的にそれを target の context と結べていない。
- **UNIQUE が 0 件なので、「visual target が left-column final ITEM と一致するか」の数え上げは 0 件中 0 件で成立しない**。この「一致する／しない」の判断を AMBIGUOUS／NO_CONTEXT の sample に推測で当てはめていない。
- 参考（reviewer 記録と census の整合）: CC-01 の左 marker 数（項 10＋組織 1）、CC-02 の左 項 13 は census と一致。

## 15. Outcome の整理（最終選択はしない）

| 区分 | 内容 | 証拠の支持 |
|---|---|---|
| C0 | UNIQUE 0 → page-local visual evidence でも column continuity を解決できない | **支持される**: 6 sample・12 判定で UNIQUE 0。ただし 6 page の exploratory 標本の範囲 |
| C1 | UNIQUE あり・target パターン一定せず | 支持されない（UNIQUE が無い） |
| C2 | UNIQUE 複数・同一 mechanical discriminator と整合 | 支持されない（UNIQUE が無い） |
| C3 | explicit reset／new context が存在 | 支持されない（EXPLICIT_RESET 0。target の**後**の marker は reviewer により新 context 開始の明示とは扱われていない） |
| CA | reviewer disagreement・ambiguity が支配的 | **部分的に支持**: AMBIGUOUS 8／12。不一致は 2 sample だが、すべて AMBIGUOUS と NO_CONTEXT の隣接差で、「一意でない」点は一致 |

これは証拠の整理であり、最終選択も次の研究判断も行わない。

## 16. CANDIDATE_HYPOTHESIS_DIRECTION（列挙のみ）

- 方向の例: `left final ITEM → right leading REQUEST`（読み順 LEFT→RIGHT を前提にした継続）。
- これを rule として freeze しない・実装しない・preregistration に進まない。UNIQUE が 0 件なので、この方向を視覚で支持する観察は無く、否定する観察も無い（視覚では結べない、が観察結果）。単なる direction の列挙であり、仮説の確認・棄却ではない。

## 17. 観察の限界

- 6 page・exploratory・非無作為。prevalence の推定ではない。
- primary と second は同一モデル系の reviewer である可能性があり、人間の独立 judgment とは限らない。
- target が 1 件の sample が 4 件、19 件の outlier（CC-05）が 1 件、3 件が 1 件（CC-06）。
- partition は DEVELOPMENT_EXPLORED 5 / FIRST_HELDOUT_POSTHOC 1 / NEW_HELDOUT_POSTHOC 0 の偏り。
- reviewer 自身が AMBIGUOUS と NO_PAGE_LOCAL_CONTEXT の境界を judgment call と記述している（P3、S1）。
- 110dpi full page のみ。crop・再 render なし。
- 視覚観察は「column 間の視覚的連結の有無」であり、論理的な親子関係の正否ではない。

## 18. 更新された unresolved と next research question（仮説ではない）

- UNRESOLVED: 右 column 先頭 REQUEST 群の context が、視覚以外の（page をまたぐ・stream 順などの）情報でどこまで観測可能か。今回の 6 page では page-local 視覚証拠で一意に定まらなかった。
- UNRESOLVED: AMBIGUOUS と NO_PAGE_LOCAL_CONTEXT の境界定義が reviewer 間で揺れている（2 件）。
- Question: UNIQUE が 0 件であることは、母集団全体（22 page）でも同様か。標本を広げる意味があるか、または視覚以外の観察軸が必要か。
- Question: 隣接区分（AMBIGUOUS／NO_CONTEXT）の差を今後の観察で区別する必要があるか。

## 19. Phase 2/3 の claim boundary

- 6 page の exploratory 観察。ground truth・resolver・rule・preregistration・prevalence の根拠にしない。
- parser・A 層・evaluator・GT・#412 census・既存 fixture は変更していない。manifest は不変。
