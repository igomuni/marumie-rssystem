# Budget Request TOC A層 Family B — header zone tokenless の frozen sample visual failure isolation

**exploratory。GT ではない。** parser・H1・evaluator・GT・preregistration は変更していない。閾値・rule・仮説は設定していない。

## 1. Objective / 研究質問

#406 census が見つけた「header zone の E 以右 tokenless text」candidate（SPLIT 35 page・91 行、うち flag 条件を満たすのは H2/H7 の 2 行）は、視覚上 何であるか。H2/H7 型 continuation と、それ以外（column heading・title・ページ番号様の数字）は、視覚上および census の機械特徴の上で どう違って見えるか。

## 2. 順序

1. Phase 1: sample 選定を census.json の機械特徴だけで行い、manifest を freeze（commit `218cf34`、`review-sample-manifest.json` sha256 `d4afe8153e5b77379ce7ad6578c4060a670ddbbda69b97c50d25f375697ab01a`）。**PDF は見ていない。**
2. Phase 2: freeze 後に blind reviewer 3 名が視覚観察。**freeze 後の sample 差し替え・追加なし。**
3. Phase 3（本 doc）: 観察を保存、unblind して機械特徴と記述的に比較。

## 3. sample 設計と選定手順

手順は `scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-visual-sample.ts` のヘッダコメントに固定。要約:

- 母集団: #406 census の candidate 行。anchor 2（H2・訂正後 H7）＋ control 10。
- stratum: A=trigger あり＋current attachment あり / B=trigger あり＋attachment なし / C=trigger なし＋attachment あり / D=trigger なし＋attachment なし。各 stratum から control 2 件＋余剰 2 枠。
- control は stratum 内の正規化特徴（distanceToHeaderEnd・offsetFromE・rightTextChars 等）の centroid に最も近い行と、それから最も遠い行を取る**機械的 variation 最大化**（無作為抽出ではない）。anchor ページと重複ページは除外。
- 順序は (localPdfPath, physicalPage, lineIndex) の辞書順で FB-01..FB-12。

## 4. 12 samples（Phase 3 での unblind。reviewer には非開示）

| id | pdf（basename）| page | stratum | partition | role |
|---|---|---|---|---|---|
| FB-01 | 20230907_policies_budget_04.pdf | 3 | A | DEVELOPMENT_EXPLORED | control |
| FB-02 | env 000157010.pdf | 3 | A | DEVELOPMENT_EXPLORED | control |
| FB-03 | maff 230901-2.pdf | 3 | A | FIRST_HELDOUT_POSTHOC | **anchor H2** |
| FB-04 | maff 230901-2.pdf | 5 | C | DEVELOPMENT_EXPLORED | control |
| FB-05 | maff 230901-6.pdf | 3 | B | NEW_HELDOUT_POSTHOC | control |
| FB-06 | mext 20230914-mxt_kaikesou01-000031817_01.pdf | 4 | C | DEVELOPMENT_EXPLORED | control |
| FB-07 | mext 20230914-mxt_kaikesou01-000031817_01.pdf | 5 | D | DEVELOPMENT_EXPLORED | control |
| FB-08 | 05-1b-01.pdf | 5 | C | FIRST_HELDOUT_POSTHOC | control |
| FB-09 | 05-2b-01.pdf | 3 | B | NEW_HELDOUT_POSTHOC | control |
| FB-10 | 001630995.pdf | 4 | D | DEVELOPMENT_EXPLORED | control |
| FB-11 | 2024ippan_2.pdf | 2 | A | DEVELOPMENT_EXPLORED | **anchor H7** |
| FB-12 | ippankaikei.pdf | 2 | A | FIRST_HELDOUT_POSTHOC | control |

完全な path は manifest の `localPdfPath`。

## 5. visual review 手順

- blind: reviewer には locator（pdf・page・lineIndex・charStart・右 text の位置）のみを渡し、stratum・anchor/control の別・partition・機械特徴・仮説は非開示。
- 分担: R1=FB-01/04/07/10、R2=FB-02/05/08/11、R3=FB-03/06/09/12。
- visualRole は CONTINUATION / COLUMN_HEADING / HEADER_OR_TITLE / OTHER / AMBIGUOUS / UNREADABLE から選択。CONTINUATION のみ rowRelation・ownerVisual を記録。
- render 条件（dpi 等）は reviewer ファイルに記録がなく**不明**（UNRESOLVED）。renderFiles の `/tmp` パスは再現不能のため fixture から除去。
- 安全規則: 観察の記録のみ。解釈・rule の提案・他 sample との比較はしない。
- 保存: `tests/fixtures/budget-request-toc-header-tokenless-visual-failure-isolation/2024/visual-review-observations.json`（reviewer の記録をそのまま保持。誤字も未修正）。

## 6. 12 件の観察

| id | visualRole | visibleText（要旨）| 主な physicalObservations | confidence |
|---|---|---|---|---|
| FB-01 | COLUMN_HEADING | 右半分見出し 要求番号/区 分/ページ | 見出し帯内、罫線で囲まれ、左半分と同一見出し | high |
| FB-02 | OTHER | 「1」（枠外右上の小さな数字）| 外枠上辺の外、直前行なし、列見出しと非対応 | high |
| FB-03 | **CONTINUATION** | 「に必要な経費」| owner req18 の 2 行目。owner 本文開始位置と左端が揃い、1 行目の直下に詰まる。罫線の交差なし | high |
| FB-04 | OTHER | 「3」（枠外右上）| 外枠上辺の外、見出し帯の上 | high |
| FB-05 | COLUMN_HEADING | 要求番号/区 分/ページ（右半分）| 見出し帯内、上下を罫線で囲まれる | high |
| FB-06 | COLUMN_HEADING | 要求番号/区 分/ページ ×2（ページ上端に「2」）| 見出し帯、左右に同じ見出し | high |
| FB-07 | OTHER | 「3」（枠外右上）| 外枠上辺の外、見出し帯の上 | high |
| FB-08 | COLUMN_HEADING | 「要求/番号」（2 行積みセルの「号」）| 見出しセルの一部、枠内、縦罫線で区切られる | high |
| FB-09 | OTHER | 「1」（枠外右上）| 外枠上辺の外、タイトルとは別段 | high |
| FB-10 | COLUMN_HEADING | 要求番号/区 分/ページ（右半分）。枠上左に「2」| 見出し帯内 | high |
| FB-11 | **CONTINUATION** | 「に必要な経費」| owner req23（page 94）の 2 行目。1 行目と左端が揃い、次行 24 より 1 行目に近い。ownership は詰まり具合のみで判断 | medium |
| FB-12 | HEADER_OR_TITLE | 「令 和 ６ 年 度 歳 出 概 算 要 求 額 目 次」の末尾「次」| タイトル帯内、字間の広いタイトルの最終字 | high |

AMBIGUOUS / UNREADABLE は 0 件。詳細な physicalObservations（8 項目）は fixture を参照。

## 7. H2 / H7 anchor 整合

- FB-03（H2）: 視覚上 CONTINUATION「に必要な経費」、owner は右列の req18（01-65 農業経営安定事業等の財源の…繰入れ、page 115）で一意。#404 の記録（H2 req18 の continuation）と**矛盾なし**。reviewer は同 page の req23 にも別の折返し行があると注記しており、これは #404 の「continuation 3 件（req18/19/23）」と整合する。
- FB-11（H7）: 視覚上 CONTINUATION、owner は右列の req23（41-20 公債等に係る…繰入れ、page 94）で一意。#404 の訂正後の最終観測（req23 の 2 行目に row-start token なし、owner 一意）と**矛盾なし**。比較は訂正後のみ（初回「req23 のみ」は不使用）。H7 には訂正後 req18 の continuation もあるが、本 sample の locator は req23 側を指し、req18 側の確認は本 review の対象外。
- anchor 2 件とも blind の reviewer が CONTINUATION と観察した（anchor であることは非開示）。

## 8. role totals（reviewer ファイルから再集計、fixture と一致）

| visualRole | 件数 | sample |
|---|---|---|
| CONTINUATION | 2 | FB-03, FB-11 |
| COLUMN_HEADING | 5 | FB-01, 05, 06, 08, 10 |
| OTHER（ページ番号様の単独数字）| 4 | FB-02, 04, 07, 09 |
| HEADER_OR_TITLE | 1 | FB-12 |
| AMBIGUOUS / UNREADABLE | 0 | — |

## 9. continuation と controls の記述的比較（manifest の機械特徴）

| id | role | stratum | distToHdrEnd | offsetFromE | leftBlank | rightChars | candOnPage | position | precTrigDist | primary |
|---|---|---|---|---|---|---|---|---|---|---|
| FB-03 | CONT | A | 1 | 11 | true | 6 | 4 | 7 | 1 | AFTER_TRIGGER |
| FB-11 | CONT | A | 1 | 11 | true | 6 | 4 | 6 | 1 | AFTER_TRIGGER |
| FB-01 | COLHEAD | A | 4 | 20 | false | 19 | 3 | 3 | — | WITHOUT_TRIGGER_CONTEXT |
| FB-02 | OTHER | A | 7 | 52 | true | 1 | 3 | 0 | — | 同上 |
| FB-04 | OTHER | C | 3 | 55 | true | 1 | 3 | 0 | — | 同上 |
| FB-05 | COLHEAD | B | 4 | 24 | false | 23 | 3 | 3 | — | 同上 |
| FB-06 | COLHEAD | C | 2 | 20 | false | 36 | 1 | 1 | — | 同上 |
| FB-07 | OTHER | D | 3 | 48 | true | 1 | 3 | 0 | — | 同上 |
| FB-08 | COLHEAD | C | 1 | 0 | false | 1 | 3 | 2 | — | 同上 |
| FB-09 | OTHER | B | 7 | 49 | true | 1 | 3 | 0 | — | 同上 |
| FB-10 | COLHEAD | D | 2 | 20 | false | 30 | 1 | 1 | — | 同上 |
| FB-12 | TITLE | A | 6 | 0 | false | 1 | 3 | 1 | — | 同上 |

全 12 件で wholeLineTitleInOutput=true・pageRefTokenless=false・pageState=ASSEMBLED_SPLIT。

観察された事実（記述のみ）:

- CONTINUATION 2/2 で leftBlank=true・offsetFromE=11・rightTextChars=6・distanceToHeaderEnd=1・candidatesOnPage=4・precedingTriggerDistance=1・primary=AFTER_TRIGGER。non-continuation 10 件は offsetFromE=11 でも rightTextChars=6 でも candidatesOnPage=4 でもなく、precedingTriggerDistance は全て null、primary は全て WITHOUT_TRIGGER_CONTEXT だった。ただし CONTINUATION 2 件は anchor 選定条件（既存 flag）で選ばれた H2/H7 そのものであり、precedingTriggerDistance・primary は flag の定義に由来するため、この一致は独立な観察ではない。
- leftBlank=true は non-continuation 10 件中 4 件（FB-02/04/07/09、いずれもページ番号様の数字）にもあった。
- distanceToHeaderEnd=1 は non-continuation 10 件中 1 件（FB-08、COLUMN_HEADING「号」、offsetFromE=0・leftBlank=false）にもあった。
- rightTextChars=1 は non-continuation 6 件（OTHER 4、FB-08、FB-12）にあった。
- COLUMN_HEADING 5 件は leftBlank=false（5/5）。HEADER_OR_TITLE 1 件も leftBlank=false。
- stratum A の 5 件は CONTINUATION 2・COLUMN_HEADING 1・OTHER 1・HEADER_OR_TITLE 1 と視覚 role が混在した。trigger 無し stratum（C・D）の 5 件に CONTINUATION は 0。

**prevalence は推定できない。** positive は既知の H2/H7 の 2 件のみ、controls は機械的 variation 最大化で選んだもので無作為抽出ではないため、91 行（anchor 除き 89 行）中の continuation の割合は本 sample から言えない。

## 10. candidate discriminators（観察された feature と counterexample。rule ではない）

| 観察された feature | CONT で | counterexample（non-continuation）|
|---|---|---|
| leftBlank=true | 2/2 | 4/10（ページ番号様の数字 FB-02/04/07/09）|
| distanceToHeaderEnd=1 | 2/2 | 1/10（FB-08 COLUMN_HEADING）|
| offsetFromE=11 | 2/2 | 0/10 |
| rightTextChars=6 | 2/2 | 0/10（ただし同一文言「に必要な経費」由来の可能性）|
| candidatesOnPage=4 | 2/2 | 0/10 |
| precedingTriggerDistance=1 | 2/2 | 0/10（flag 定義と重複）|

offsetFromE=11・rightTextChars=6 は 2 件とも同じ text「に必要な経費」に由来し、独立な 2 観測とは言えない。「候補として観察された」に留め、検証していない。

## 11. 解釈

- FACT: manifest hash は不変。観察は 12/12 で manifest と 1:1。role totals は上表。H2・H7 anchor は #404 と矛盾しない。
- FACT: 非 anchor の 10 件はいずれも CONTINUATION ではなく、COLUMN_HEADING 5・ページ番号様の数字 4・タイトル 1 だった（reviewer の観察）。
- OBSERVATION: 「header zone の tokenless text」は視覚上 少なくとも 4 種（continuation・column heading・ページ番号様の数字・title 末尾字）を含む。
- OBSERVATION: 上表の feature のうち、CONT 2 件を non-continuation 10 件から全て分ける機械特徴は offsetFromE=11・rightTextChars=6・candidatesOnPage=4 などで観察されたが、いずれも n=2 かつ同一文言由来。
- HYPOTHESIS_CANDIDATE（候補として観察されたのみ・未検証）: leftBlank と他特徴の組、distanceToHeaderEnd と他特徴の組が continuation 側に偏る可能性。FB-02/04/07/09 と FB-08 が単独 feature の counterexample になっている。
- UNRESOLVED: §12。

## 12. unresolved

- positive が既知の H2/H7 の 2 件のみ、かつ同種 text。他の continuation 形（別文言・別位置）の見え方は不明。
- controls は無作為ではない（variation 最大化）。candidate 行 91 行（anchor 除き 89）のうち未レビューは 79 行で、その性質は不明。
- 新 held-out 由来の FB-05・FB-09（NEW_HELDOUT_POSTHOC）は本 review で目視済みになった。以後 §14 の扱い。
- FB-11 は ownership を詰まり具合のみで判断（confidence medium）。
- render 条件（dpi 等）は記録なし。
- H7 の req18 側 continuation は本 review の対象外。

## 13. 研究 outcome の位置づけ（最終選択はしない）

- Outcome A（明瞭な distinction）: 支持されうる点 = non-continuation 10 件が視覚的に全て continuation でなく、一部機械特徴が 2 件と 10 件で重ならなかった。支持されない点 = n=2・同文言・anchor が選定条件に由来する feature があるため、distinction の一般性は示せない。
- Outcome B（一部の特徴はあるが分離不能）: 支持される点 = leftBlank・distanceToHeaderEnd=1 には counterexample がある（単独 feature では分離不能）。
- Outcome C（visual でも曖昧）: 支持されない。AMBIGUOUS/UNREADABLE は 0 件、confidence は 11 件 high・1 件 medium。
- 最終的な位置づけの選択は行わない。

## 14. sample membership と contamination 境界

上記 12 page（§4）は本 review で目視済みのため、**今後 Family B の新規 held-out として扱わない。** 特に FB-05（maff 230901-6 p3）・FB-09（05-2b-01 p3）は NEW_HELDOUT_POSTHOC だったが、本 review により held-out 資格を失う。FB-03・FB-08・FB-12 は FIRST_HELDOUT_POSTHOC、他は DEVELOPMENT_EXPLORED（FB-11 も同）。

## 15. claim boundary

exploratory。GT ではない。held-out 評価に使用しない。sample は先に freeze して PDF を見ずに選び、freeze 後に差し替えていない。言えるのは §9・§11 の記述的観察まで。「feature X なら continuation」「閾値」「rule」は言えない。

## 16. next research question（仮説ではない）

header zone の tokenless text の視覚的な種別（continuation・column heading・ページ番号様の数字・title）は、census の candidate 91 行ではどのような分布か。H2/H7 以外の continuation は存在するか。

## 17. 実施しないこと

GT 作成・preregistration・parser/H1/evaluator の変更・formal evaluation・sample の事後差し替え/追加は行っていない。

## 18. 実行環境メモ

Phase 3 では PDF を開いていない。fixture は `/tmp` の reviewer ファイル 3 本から決定的に生成（2 回生成で sha256 一致）。test は `scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-visual-review.test.ts`（data/work・PDF 不要）。
