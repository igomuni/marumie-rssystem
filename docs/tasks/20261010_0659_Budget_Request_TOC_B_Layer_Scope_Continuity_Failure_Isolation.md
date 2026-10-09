# TOC B 層 Scope Continuity Failure Isolation（mechanical census のみ・parent resolver ではない）

出典略記: 「#411 doc」= `20261010_0627_Budget_Request_TOC_B_Layer_Problem_Observation.md`、「#410」= `20261010_0003_Budget_Request_TOC_A_Layer_Research_Status_Consolidation.md`、OUT = `tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-h1-output.json`、ST = 同 dir の `full-corpus-status.json`、CEN = 本書の fixture `tests/fixtures/budget-request-toc-b-layer-scope-continuity-failure-isolation/2024/census.json`、H1.ts = `scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts`。

## 1. Objective と位置づけ

- #411 doc §10 の failure-isolation target のうち scope continuity（T1・T2・T4・T8・T9・T11 の機械的に数えられる部分）を、**「ACTIVE_ITEM_CONTEXT_CANDIDATE がどの境界まで observable か」を数える census** として実施する。
- parent resolver・stack / state machine・nearest preceding ITEM を親とする規則・cross-column / cross-page carry は **実装・採用・推奨しない**。semantic schema は決めない。preregistration・GT・formal evaluation は作らない。A 層（parser・row assembly・right-band・fragment attachment）・evaluator・GT・#395 protocol・A 層の frozen / post-hoc artifact は変更しない。
- A 層 freeze state は #410・#411 doc §2 に従い維持する（`TOC_A_LAYER_RESEARCH_FREEZE_WITH_KNOWN_LIMITATIONS` は研究 sequencing の記録で production claim ではない）。
- 意味を推測して埋めない。数えるのは A 層 provenance から機械的に言えること（行の kind・code・lineIndex・column）だけ。

## 2. Source of truth と入力境界

- 入力は commit 済み A 層出力 OUT（sha256 `7d31dbb5…2316`、実行時に照合）と ST（partition・pageState の突合）、#411 の observation fixture（sample 8 page の整合確認のみ）。
- **raw-text・PDF・`data/` は使わない**（committed parser 出力で足りるため）。PDF の視覚確認は行わない。
- 外部の事前調査メモ（中間資料）の事実は、OUT・H1.ts・#411 fixture に当たって再確認した（§3）。メモ自体は source of truth にしていない。

## 3. 順序の根拠（再確認した結果）

| 問い | 使える evidence | 結果 |
|---|---|---|
| 同一 column 内の物理順 | `provenance.lineIndex`（`sourceOrder` は H1.ts:147-148 で column ごとの counter、push は lineIndex 昇順ループ内） | CEN `orderingEvidence`: page×stream 149 group（LEFT 35 / RIGHT 35 / PAGE 44 / HEADER 35）で **lineIndex 厳密増加 149/149**、`sourceOrder`＝0..n-1 の連番 149/149 |
| LEFT↔RIGHT の順序 | なし。A 層は読み順を主張しない（preregistration の `notUsed`／`rejected`、H1.ts:259-261 のコメント「出力順 = (column, lineIndex)」） | **`ORDER_NOT_ESTABLISHED`**。SPLIT 35 page 全てで LEFT と RIGHT の lineIndex 範囲が重なる（35/35）。`sourceOrder` は column 別で衝突する |
| 出力配列順 | (column rank, lineIndex)。lineIndex 順と一致しない | SPLIT 35/35 で不一致、UNSPLIT 44 は 0。**配列順・`sourceOrder` 順・LEFT→RIGHT を semantic sequence として使わない** |
| header zone（SPLIT の UNSPLIT 行）と body | lineIndex のみ | 3 行（2 page）が body の lineIndex 範囲に挟まる。header stream は item 分析の対象外（全て TITLE_OR_HEADING） |
| UNSPLIT page | page-local の lineIndex 順（column 情報なし） | 44 page は単一 stream。「右 column が空」とは仮定しない |
| PAGE_ABSTAINED | なし（units 0） | `NO_A_LAYER_SEMANTIC_EVIDENCE` |
| page 間 | `physicalPage` の連続のみ。A 層に継続の主張なし | census は前ページから補完しない。隣接 page の存在だけを `priorPageInCorpus` に記録（carry ではない） |

`ORDER_NOT_ESTABLISHED` の範囲: SPLIT page の LEFT unit と RIGHT unit の任意の組（35 page）。「どちらがページ先頭か」「左末尾の後に右先頭が続くか」はこの census では主張しない（視覚由来の読み順は #411 doc の観察にのみ存在）。

## 4. 用語

- **ITEM** = （項）marker。**REQUEST** = REQUEST_NUMBER_ROW。
- **ACTIVE_ITEM_CONTEXT_CANDIDATE** = 当該 REQUEST より、同一 stream 内の物理順（lineIndex 昇順）で前にある最も近い ITEM。**真の parent を意味しない**。本書は「parent」という語を B 層の関係の名に使わない。
- **interruption 候補** = 組織・会計・勘定・所管 marker、TITLE_OR_HEADING、OTHER_CODE、UNKNOWN_ABSTAINED。これらが scope を切るとは決めない。
- **stream** = 順序が確立できる単位。SPLIT: LEFT・RIGHT（と item 分析対象外の HEADER）。UNSPLIT: PAGE。

## 5. Census 定義（実行前に helper のコード定数／コメントで固定。結果を見て調整していない）

定義の正本は `scripts/pipeline-v2/lib/budget-request-toc-b-scope-continuity.ts` 冒頭コメント。要約:

- **Q1** REQUEST ごとの同一 stream 内 nearest preceding ITEM と、その間の marker 列・interruption 候補（gap）。
- **Q2** SPLIT の RIGHT stream で、RIGHT 内の先行 ITEM が無い REQUEST。先頭 semantic row（REQUEST / MARKER）が REQUEST か、left stream 末尾 4 semantic row の kind／code（順序は主張せず記述のみ）、left の ITEM 有無、RIGHT 先頭 ITEM までの heading 有無。
- **Q3** stream 内で最初の REQUEST より前に ITEM が無い。UNSPLIT は PAGE stream。SPLIT は LEFT 先頭・RIGHT 先頭を別々に数え、どちらがページ先頭かを主張しない。前ページから補完しない。
- **Q4** ITEM → 続く連続 REQUEST 列 → 終端（最初の非 REQUEST 行の kind／STREAM_END）。ITEM が scope を reset するとは決めない。
- **Q5** ITEM と REQUEST の間（gap）に入る interruption 候補の種別。
- **Population**（重複可・exclusive にしない）:
  - P1 = SPLIT page で、同一 column stream に先行 ITEM を持つ REQUEST が 1 件以上
  - P2 = SPLIT page の RIGHT stream に、RIGHT 内で先行 ITEM の無い REQUEST が 1 件以上
  - P3 = ITEM に先行されない REQUEST が stream 内の最初の REQUEST である stream を持つ page（UNSPLIT は PAGE stream＝`P3_PAGE`。SPLIT は `P3_LEFT`／`P3_RIGHT`。P3_RIGHT と P2 は定義上同一集合）
  - P4 = SPLIT page で、ある column に先行 ITEM の無い REQUEST があり、かつ他方 column に ITEM がある（ITEM は page 内にあるが column をまたぐ順序が `ORDER_NOT_ESTABLISHED`）
  - P5 = 非 abstain page で explicit ITEM 数 0
  - P6 = `P6_PAGE_ABSTAINED`（PAGE_ABSTAINED）／`P6_UNSPLIT_COLUMN`（UNSPLIT の column 依存の問いは `COLUMN_CONTEXT_NOT_AVAILABLE`）
- **failure family の機械的ラベル**（semantic rule ではない）: P1 → SAME_COLUMN_CONTEXT_AVAILABLE、P2 → COLUMN_BOUNDARY_CONTEXT_MISSING、P3 → PAGE_BOUNDARY_CONTEXT_MISSING、P4 → ORDER_AMBIGUOUS、P5 → ITEM_FREE_PAGE、P6_PAGE_ABSTAINED → A_LAYER_UNAVAILABLE。
- 実行の位置づけ: POST_HOC・探索的。#411 の sample 8 page は blind でないが、本 census は 82 page 全件を機械的に数えるだけで held-out 評価ではない。

## 6. Corpus accounting

- 82 page（55 PDF）。partition: DEVELOPMENT_EXPLORED 34 / FIRST_HELDOUT_POSTHOC 23 / NEW_HELDOUT_POSTHOC 25。
- A 層 state: ASSEMBLED_SPLIT 35（DIRECT 20 / INHERITED 15）、ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE 44（DIRECT 35 / INHERITED 9）、PAGE_ABSTAINED 3（INHERITED 3）。
- unit 3,119（ITEM 963 / REQUEST 1,519 / 他 marker 143 = 組織 79・会計 27・勘定 27・所管 10 / 他 TITLE・OTHER_CODE・UNKNOWN_ABSTAINED）。ST と OUT は 82 page 全てで pageState・unit 数が一致（実行時に STOP 条件として検査）。
- 隣接する前 page が corpus に存在する page: 27（27 件とも前 page は SPLIT 26／PAGE_ABSTAINED 1）。census はこれを carry に使わない。

## 7. P1〜P6 の結果（全 82 page）

| | all82 | SPLIT 35 | UNSPLIT 44 | ABSTAINED 3 | dev34 | first23 | new25 |
|---|---|---|---|---|---|---|---|
| P1 | 35 | 35 | – | – | 20 | 9 | 6 |
| P2 | 25 | 25 | – | – | 16 | 5 | 4 |
| P3（計） | 32 | 26 | 6 | – | 20 | 7 | 5 |
| 　P3_LEFT | 7 | 7 | – | – | | | |
| 　P3_RIGHT | 25 | 25 | – | – | | | |
| 　P3_PAGE（UNSPLIT） | 6 | – | 6 | – | | | |
| P4 | 26 | 26 | – | – | 17 | 5 | 4 |
| P5 | 0 | 0 | 0 | – | 0 | 0 | 0 |
| P6 | 47 | – | 44 | 3 | 14 | 14 | 19 |
| 　P6_PAGE_ABSTAINED | 3 | | | 3 | | | |
| 　P6_UNSPLIT_COLUMN | 44 | | 44 | | | | |

重複（CEN `tallies.all82.overlapMatrix`）: P1 のみ 9／P1+P2+P3+P4 25／P1+P3+P4 1／P3+P6 6／P6 のみ 41。重複しない page は無い（none 0）。SPLIT 35 page は全て P1。P2 の 25 page は全て P3_RIGHT・P4 と同一。P3_LEFT のみ（RIGHT は該当しない）1 page、LEFT・RIGHT 両方 6 page。

Q 別の主要数値:

- **Q1（SPLIT 同一 column）**: REQUEST 1,232 のうち、同一 column に先行 ITEM がある 1,168（35 page）、ない 64（LEFT 11＋RIGHT 53）。SPLIT では先行 ITEM がある 1,168 件全てで gap が空（間に非 REQUEST 行なし）。UNSPLIT の page-local は 276 件に先行 ITEM あり（gap が空 274）、11 件なし。
- **Q2（右 column 先頭の request）**: 25 page／REQUEST 53 件（1 件 17 page・2 件 5・3 件 1・4 件 1・19 件 1 page）。右の先頭 semantic row が REQUEST: 25/25。left column に ITEM が存在: 25/25。right に ITEM が無い page: 0。right の先頭 ITEM までに heading／OTHER／UNKNOWN の interruption: 0 page。left stream 末尾の最後の semantic row の kind は ITEM 17 page／REQUEST 8 page（記述のみ。DIRECT/ITEM 9・DIRECT/REQUEST 5・INHERITED/ITEM 8・INHERITED/REQUEST 3）。
- **Q3（stream 先頭の request）**: UNSPLIT 6 page／REQUEST 11（全て INHERITED）。SPLIT は LEFT 先頭 7 page／11 件、RIGHT 先頭 25 page／53 件、いずれか 26 page（DIRECT 14／INHERITED 12）、両方 6 page。最初の explicit marker は RIGHT 先頭 request の page 25 のうち 22 が項・2 が組織・1 が勘定（UNSPLIT 6 page は項 5・組織 1）。P3 の 32 page のうち前 page が corpus にある page は 18。
- **Q4（ITEM の後）**: ITEM の後の連続 REQUEST 列の終端は、次の ITEM 798／STREAM_END 87／組織 36／UNKNOWN_ABSTAINED 25（定員表行）／勘定 13／OTHER_CODE 2／所管 2。SPLIT では request が 0 件の ITEM が 26。
- **Q5（interruption）**: 先行 ITEM と REQUEST の間（gap）に非 REQUEST 行がある REQUEST は **2 件のみ**で、いずれも OTHER_CODE（UNSPLIT の jinji `900024096.pdf` p3 の 1 page）。SPLIT page では 0。組織・会計・勘定・所管 marker／TITLE_OR_HEADING／UNKNOWN_ABSTAINED が ITEM と後続 REQUEST の間に入る例は 0。TITLE_OR_HEADING は ITEM と後続 REQUEST の間には現れず、stream の最初の ITEM より前に 308 行ある。UNKNOWN_ABSTAINED と組織は ITEM→REQUEST 列の**終端**として現れる（Q4）。これらが scope を切るかは決めない。

## 8. #411 との整合

#411 の sample 8 page（BS-01〜BS-08）について、#411 doc §5・§6 と `visual-observations.json` が述べる scope continuity 上の事実を 27 項目の check にして CEN `validation411` に保存した。**27/27 合致、UNRESOLVED_CONFLICT 0**。主な内容: BS-01 右先頭 request 21・左末尾 項901・右の項の直後に request 25〜27・右末尾に定員表行／BS-02 UNSPLIT・先頭組織040・末尾 項080→request 50／BS-03 左先頭 項020・左末尾 項180（request なし）・右先頭 request 90 の次行が 組織090／BS-04・BS-08 PAGE_ABSTAINED（stream なし）／BS-05 項155→request 1→定員表行／BS-06 左末尾 項028→request 22・右先頭 request 23・右末尾 項072／BS-07 左先頭 request 42・43（先行 ITEM なし）・右先頭 項440・右末尾 項020。

初回実行で 5 check が不合格になったが、原因は helper 内の kind 表記（`REQUEST_NUMBER_ROW` と `REQUEST` の表記差）で、データの食い違いではなかったため、表記を `REQUEST` に統一して再実行した（census の定義・集計方法は不変）。

## 9. Safety implications（可能性の記述。実際の発生を断定しない）

B 層が推測で context を継承した場合に起こり得ること。census は発生を確認していない。

| population | 推測継承した場合に起こり得ること |
|---|---|
| P1 | 同一 column の nearest preceding ITEM を採ると、同一 項 code が別 組織の下に再出現する page（CEN で項 code の重複を持つ page は 16。#411 doc §5 の観察と対応）で wrong parent／cross-organization attribution の可能性。gap が空であることは attribution の正しさを保証しない |
| P2 | 右先頭 request に左 column の項を carry すると、wrong parent attribution、さらに左右の間で 組織／会計／勘定が変わっていれば cross-organization／cross-account attribution の可能性。carry しなければ親無しの request が残る（silent semantic attachment の逆側のリスク）。左右の順序は `ORDER_NOT_ESTABLISHED` |
| P3 | 前 page の末尾 ITEM を carry すると cross-page の wrong parent の可能性（前 page が corpus にあるのは 32 page 中 18、そのうち abstain の page がある）。carry しなければ page 先頭 request が親無しで残る |
| P4 | page 内に ITEM はあるが column 間順序が確立できないため、どの ITEM を採っても silent semantic attachment になり得る |
| P5 | 該当 0 page。ITEM が page に無い場合の補完は census 範囲外 |
| P6 | PAGE_ABSTAINED は A 層 evidence が無く、PDF で階層が見えても machine evidence に転記しない。補完すると silent attachment。UNSPLIT は column 依存の問いに答える evidence が無く、right blank を仮定すると右 column の内容欠落を見逃す可能性 |

## 10. Visual review

**実施していない**。mechanical census が成立し、census の目的（context 候補の observable 範囲を数える）に視覚は不要だったため。PDF は見ていない。

census だけでは「右先頭 request の context が左 column から継続するのか」自体は分からない（A 層が読み順を主張せず、census も継続を主張しないため）。これを知るための **visual review candidate**（提案のみ・未実施・未選定）:

- exact question: 「右 column 先頭の request（群）は、同一 page 内の左 column のどの marker 行の続きか、それとも page 内に context を持たないか。判断に使った視覚手がかりは何か」
- candidate population: P2 の 25 page から #411 sample（BS-01・03・06）を除いた 22 page。
- sample selection rule（実施する場合に事前固定）: 層は (classifierSource) × (left stream 末尾の最後の semantic row の kind) の 4 層（DIRECT/ITEM・DIRECT/REQUEST・INHERITED/ITEM・INHERITED/REQUEST）。各層から (localPdfPath, physicalPage) の辞書順先頭 1 page、合計 4 page。さらに `rightRequestsBeforeFirstItem` が大きい順（同点は辞書順）に、選択済みを除く 2 page を足して最大 6 page。無作為標本ではなく prevalence は推定しない。

## 11. Outcome（最終選択はしない）

census の事実がどの位置づけを支持し、何を支持しないか。

- **S0（same-column ですら context 候補が不安定）**: 支持しない。SPLIT の REQUEST 1,232 のうち 1,168（94.8%）に同一 column の先行 ITEM があり、gap が空なのは 1,168 全件。全 corpus（SPLIT＋UNSPLIT の 1,444 件）でも ITEM と REQUEST の間の interruption は 2 件（UNSPLIT の OTHER_CODE のみ）。ただし「機械的に安定して観測できる」ことと「その ITEM が正しい文脈であること」は別で、後者は census では確認していない（項 code の重複 16 page）。
- **S1（same-column は機械的に安定で、主問題は column boundary）**: same-column 側は上記の通り支持する。column boundary 側は、SPLIT 35 page 中 25 page（71%）で右 column の先頭 request が右内に先行 ITEM を持たず（53 件・SPLIT の REQUEST の 4.3%）、全 25 page で左 column に ITEM が存在し、順序は `ORDER_NOT_ESTABLISHED`。
- **S2（column 内・間は比較的説明可能で、主問題は page boundary）**: column 間は説明可能になっていない（`ORDER_NOT_ESTABLISHED`）ので、前半は支持しない。page 境界には、UNSPLIT 6 page／11 件（page-local で確定的）と、LEFT 先頭 7 page／11 件がある。件数は column boundary の 53 件より小さい。
- **S3（複数境界が同程度に未解決）**: column boundary（25 page／53 件）と page boundary（UNSPLIT 6＋LEFT 先頭 7 page、各 11 件。重複あり）は件数の規模が異なるが、重複（P3_RIGHT＝P2）があり排他的に比べられない。それとは別に、P6 の 47 page（UNSPLIT 44＋abstain 3）は column 情報／evidence が無く境界の問い自体に答えられない。
- **SV（視覚 evidence が必要）**: 継続の真値は A 層にも GT にも無いので、継続が正しいかを問う部分は mechanical census では決まらない。§10 の candidate が対応する。

上記は census の事実の整理で、どれを選ぶかは決めていない。

## 12. POTENTIAL_HYPOTHESIS_DIRECTION（列挙のみ・実装しない・選ばない）

stack、state machine、nearest preceding ITEM、cross-column carry、cross-page carry、indentation 利用、tree builder。いずれも本書では実装・選定・評価していない。

## 13. Claim boundary

- parent resolver ではない。ACTIVE_ITEM_CONTEXT_CANDIDATE は真の親の主張ではない。
- semantic schema の決定ではない。GT でも formal evaluation でも preregistration でもない。
- A 層（parser・evaluator・GT・#395 protocol・既存 fixture）を変更しない。A 層の挙動を評価・擁護もしない。
- 82 page の post-hoc 機械的 census で、production claim・prevalence の一般化・B 層 GO の判断を含まない。

## 14. Unresolved

- 継続の真値（左末尾 → 右先頭、page 境界）は A 層・GT に無く、visual review も実施していない。
- `lineIndex` が PDF の縦位置と厳密に対応するか（raw 行番号であることまでは確認済み。座標対応は未検証）。
- CEN の項 code 重複 16 page で、nearest preceding ITEM が正しい所属組織を持つか（組織 marker の有無は census で別途数えていない）。
- PAGE_ABSTAINED 3 page の内容、OTHER_CODE 14 unit（jinji 1 page）の階層位置。
- 各 PDF の TOC が corpus で完結しているか（前後 page の欠落）。

## 15. Next research question（仮説ではない）

- 右 column 先頭 request 群（P2・25 page）について、「同 page 左 column のどこかに context があるか」を視覚 evidence でどう確定できるか（§10 の candidate が対応）。
- 項 code が重複する 16 page で、同一 code の再出現が組織の違いで区別できるか（組織 marker の位置の census）。
