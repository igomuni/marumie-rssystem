# Budget Request TOC A層 Family B — header zone tokenless の independent positive discovery（visual review）

**exploratory。GT ではない。** parser・H1・evaluator・GT・preregistration は変更していない。閾値・rule・仮説は設定していない。

## 1. Objective / 研究質問

- 主: #407 で確認済みの H2/H7 以外に、未レビューの Family B candidate 行（header zone の E 以右 tokenless text）の中に、視覚上の continuation は存在するか。
- 副: 新たな continuation があった場合、H2/H7 と同じ機械特徴を持つか。

## 2. 前提

- #407 は squash merge されたため、freeze commit `218cf34`・観察 commit `a393493` は main の ancestor ではなく、branch `research/budget-request-toc-header-tokenless-visual-failure-isolation` に保存されている。main の tree は `a393493` と同一。ユーザーは branch 保存による代替を明示的に受け入れた。
- 本 PR は squash せず commit 順序（freeze → review）を保存すべき研究 PR。

## 3. 順序

1. Commit 1（`9eff9e0`）: sample を census.json の機械特徴だけで選定し manifest を freeze（sha256 `18c745a126c65981336e408aa69369416247670f5c56461e0266cd9724660018`）。**PDF・#407 の visual 結果は見ていない。**
2. Phase 2: freeze 後に blind reviewer 4 名が視覚観察。**sample の差し替え・追加なし。**
3. Commit 2（本 doc）: 観察の保存と unblind 後の記述的比較。Phase 3 では PDF を開いていない。

## 4. 母集団と選定

- eligible 79 行 / 33 page = census mechanical candidate 91 − H2 − H7 − #407 controls 10（行単位の除外）。
- partition 別（manifest の eligibleSummary）:

| partition | 行数 | page 数 |
|---|---|---|
| DEVELOPMENT_EXPLORED | 43 | 18 |
| FIRST_HELDOUT_POSTHOC | 22 | 9 |
| NEW_HELDOUT_POSTHOC | 14 | 6 |

- 1 page あたり行数分布: 1 行 4 page / 2 行 12 page / 3 行 17 page。
- **anti-overfit**: 選定には census の機械特徴の feature-space coverage だけを使った。PDF・#407 の visual 結果・H2/H7 の視覚的性質（文言「に必要な経費」等）は使っていない。
- 選定 algorithm（要約。手順は `scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-positive-discovery-sample.ts` のヘッダ）: 特徴 9 次元（distanceToHeaderEnd・nearestTrigger・offsetFromE・leftBlank?0:1・rightTextChars・candidatesOnPage・hasTrigger・hasAttachment・lineIndex）を eligible 全体で min-max、同等重み・Euclid 距離。seed = centroid から最遠。partition ごと 5 件以上を保証し（farthest-first）、残り枠は全体 farthest-first。1 sample / page。tie は (localPdfPath, physicalPage, lineIndex) 辞書順。sampleSize 20。
- これは diversity sample であり無作為抽出ではない。

## 5. 20 samples

| id | pdf（basename）| page | partition |
|---|---|---|---|
| PD-01 | 000157010.pdf | 3 | DEVELOPMENT_EXPLORED |
| PD-02 | 000157012.pdf | 3 | DEVELOPMENT_EXPLORED |
| PD-03 | 230901-2.pdf | 3 | FIRST_HELDOUT_POSTHOC |
| PD-04 | 230901-2.pdf | 4 | NEW_HELDOUT_POSTHOC |
| PD-05 | 230901-2.pdf | 5 | DEVELOPMENT_EXPLORED |
| PD-06 | 230901-4.pdf | 3 | NEW_HELDOUT_POSTHOC |
| PD-07 | eneju_o.pdf | 3 | DEVELOPMENT_EXPLORED |
| PD-08 | ippan_o.pdf | 3 | DEVELOPMENT_EXPLORED |
| PD-09 | 20230914-mxt_kaikesou01-000031817_01.pdf | 3 | DEVELOPMENT_EXPLORED |
| PD-10 | 20230914-mxt_kaikesou01-000031817_01.pdf | 5 | DEVELOPMENT_EXPLORED |
| PD-11 | 05-1b-01.pdf | 3 | NEW_HELDOUT_POSTHOC |
| PD-12 | 05-1b-01.pdf | 5 | FIRST_HELDOUT_POSTHOC |
| PD-13 | 05-1b-01.pdf | 6 | FIRST_HELDOUT_POSTHOC |
| PD-14 | 05-1b-01.pdf | 7 | DEVELOPMENT_EXPLORED |
| PD-15 | 05-2b-01.pdf | 3 | NEW_HELDOUT_POSTHOC |
| PD-16 | 001630393.pdf | 3 | NEW_HELDOUT_POSTHOC |
| PD-17 | 001630995.pdf | 5 | FIRST_HELDOUT_POSTHOC |
| PD-18 | 001630995.pdf | 8 | DEVELOPMENT_EXPLORED |
| PD-19 | 2024ippan_2.pdf | 2 | DEVELOPMENT_EXPLORED |
| PD-20 | 2023_fukkochougaisansaisyutsu.pdf | 4 | FIRST_HELDOUT_POSTHOC |

- partition: DEVELOPMENT_EXPLORED 10 / FIRST_HELDOUT_POSTHOC 5 / NEW_HELDOUT_POSTHOC 5。unique page 20（1 sample / page）。
- PD-03 は H2 anchor（maff 230901-2 p3）と、PD-19 は H7 anchor（2024ippan_2 p2）と**同じ page の別行**（lineIndex が異なる）。
- #407 の sample 12 件と page を共有するのは 7 page: PD-01（FB-02）・PD-03（FB-03/H2）・PD-05（FB-04）・PD-10（FB-07）・PD-12（FB-08）・PD-15（FB-09）・PD-19（FB-11/H7）。いずれも別行。
- 全 20 件: pageState=ASSEMBLED_SPLIT、wholeLineTitleInOutput=true、pageRefTokenless=false、primary=HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT。page に既知 flag があるのは PD-03・PD-19 のみ（pageKnownFlag=true、行の knownFlagMatch=false）。

## 6. visual review 手順

- blind: reviewer には locator（pdf・page・lineIndex・charStart・右 text の位置）のみ。partition・機械特徴・anchor との関係・#407 の結果・仮説は非開示。
- 担当: R1=PD-01/05/09/13/17、R2=PD-02/06/10/14/18、R3=PD-03/07/11/15/19、R4=PD-04/08/12/16/20。
- render 条件: 全 20 件 110dpi・全 page・crop なし（reviewer が各要素に記録、fixture に保持）。
- visualRole は CONTINUATION / COLUMN_HEADING / HEADER_OR_TITLE / OTHER / AMBIGUOUS / UNREADABLE から選択。CONTINUATION のみ rowRelation・ownerVisual を記録する設計。
- 安全規則: 観察の記録のみ。解釈・rule 提案・他 sample との比較はしない。
- second review 不要の根拠: needsSecondReview=true が 0 件、AMBIGUOUS/UNREADABLE が 0 件、CONTINUATION が 0 件で owner 判定を要する sample がなかった。
- 保存: `tests/fixtures/budget-request-toc-header-tokenless-positive-discovery/2024/visual-review-observations.json`（reviewer の記録をそのまま保持。要約・誤字修正なし）。

## 7. 20 件の観察

| id | visualRole | visibleText（要旨）| 主な観察 | confidence |
|---|---|---|---|---|
| PD-01 | HEADER_OR_TITLE | 「令和６年度歳出概算要求額目次」の末尾「次」| 字間の広い中央タイトルの最終字 | high |
| PD-02 | HEADER_OR_TITLE | 同タイトル（「額 目 次」が tail）| 表の行ではない。owner/continuation 関係なし | high |
| PD-03 | HEADER_OR_TITLE | 同タイトル（「額 目 次」が tail）| 中央タイトルの tail。list row ではない | high |
| PD-04 | COLUMN_HEADING | 要求番号 / 区 分 / ページ（右ブロック）| 右半分の見出し。「ページ」セルが縁でやや欠ける | high |
| PD-05 | COLUMN_HEADING | 右半分の 要求(番号) / 区 分 / ページ | 積み字「要求/番号」が 110dpi で小さいが判読可 | medium |
| PD-06 | COLUMN_HEADING | 右半分の 要求/番号(積み) / 区 分 / ページ | 見出し帯の右半分と一致。continuation ではない | high |
| PD-07 | COLUMN_HEADING | 右半分の 区 分 / ページ（左に 要求番号）| 右側の見出しセル群。左半分も同じ見出し | high |
| PD-08 | COLUMN_HEADING | 要求番号 / 区 分 / ページ（右ブロック）| タイトルブロック下の右半分見出し | high |
| PD-09 | COLUMN_HEADING | 右半分の 要求(番号) / 区 分 / ページ | 右半分見出しセルと一致 | high |
| PD-10 | COLUMN_HEADING | 右半分の 要求/番号, 区 分, ページ（枠上に「3」）| 見出し帯の右半分。continuation ではない | high |
| PD-11 | OTHER | 「1」（枠外右上の小さな数字）| タイトルブロックの上、数字と位置のみ観察 | high |
| PD-12 | OTHER | 「3」（枠外右上）| 表枠の外、ページ番号様。見出し・タイトル・行継続のいずれでもない | high |
| PD-13 | COLUMN_HEADING | 「号」（積み「要求/番号」の下段）| locator は「号」のみ。render だけから判断 | medium |
| PD-14 | COLUMN_HEADING | 「号」（積み「要求/番号」の下段）| どちらの半分かは 110dpi で独立に証明できず、最寄りの右半分セルと対応付け | medium |
| PD-15 | HEADER_OR_TITLE | 同タイトルの tail「目 次」| 中央タイトルの tail | high |
| PD-16 | OTHER | 「1」（枠外右上）| ページ番号様、表内容ではない | high |
| PD-17 | OTHER | 「3」（枠外右上）| ページ番号として見える、同一行に他 text なし | high |
| PD-18 | COLUMN_HEADING | 右半分の 要求/番号, 区 分, ページ（枠上左に「6」）| 見出し帯の右半分 | high |
| PD-19 | COLUMN_HEADING | 区 分 / ページ（右半分見出し）| 見出しセル。タイトル「令和6年度歳出概算要求額目次」・「23 財務省所管」が上 | high |
| PD-20 | COLUMN_HEADING | 要求番号 / 区 分 / ページ（右ブロック）| 右半分見出し。continuation ではない | high |

medium 3 件の理由（reviewer の記録）: PD-05 = 積み字が 110dpi で小さい（判読は可）、PD-13 = locator が「号」だけで render のみから判断、PD-14 = 「号」の所属半分が 110dpi で独立に証明できない。いずれも needsSecondReview=false、role は COLUMN_HEADING。

## 8. role totals（reviewer ファイルから再集計、fixture と一致）

| visualRole | 件数 | sample |
|---|---|---|
| CONTINUATION | **0** | — |
| COLUMN_HEADING | 12 | PD-04, 05, 06, 07, 08, 09, 10, 13, 14, 18, 19, 20 |
| HEADER_OR_TITLE | 4 | PD-01, 02, 03, 15 |
| OTHER（枠外のページ番号様の単独数字）| 4 | PD-11, 12, 16, 17 |
| AMBIGUOUS / UNREADABLE | 0 | — |

confidence: high 17 / medium 3（PD-05, 13, 14）。needsSecondReview: 0 件。

## 9. unblind 後の記述的比較

### 9.1 manifest の機械特徴と visualRole

| id | role | distToHdrEnd | offsetFromE | leftBlank | rightChars | candOnPage | hasTrigger | partition |
|---|---|---|---|---|---|---|---|---|
| PD-01 | TITLE | 6 | 0 | false | 1 | 3 | true | DEV |
| PD-02 | TITLE | 6 | 1 | false | 5 | 2 | true | DEV |
| PD-03 | TITLE | 7 | 1 | false | 5 | 4 | true | FIRST |
| PD-15 | TITLE | 6 | 1 | false | 3 | 3 | true | NEW |
| PD-04 | COLHEAD | 2 | 23 | false | 29 | 1 | false | NEW |
| PD-05 | COLHEAD | 2 | 0 | false | 55 | 3 | false | DEV |
| PD-06 | COLHEAD | 4 | 20 | false | 19 | 3 | true | NEW |
| PD-07 | COLHEAD | 4 | 21 | false | 31 | 2 | true | DEV |
| PD-08 | COLHEAD | 4 | 20 | false | 32 | 3 | true | DEV |
| PD-09 | COLHEAD | 4 | 20 | false | 29 | 3 | true | DEV |
| PD-10 | COLHEAD | 2 | 0 | false | 48 | 3 | false | DEV |
| PD-13 | COLHEAD | 1 | 0 | false | 1 | 2 | false | FIRST |
| PD-14 | COLHEAD | 1 | 0 | false | 1 | 3 | false | DEV |
| PD-18 | COLHEAD | 2 | 0 | false | 47 | 2 | false | DEV |
| PD-19 | COLHEAD | 4 | 20 | false | 32 | 4 | true | DEV |
| PD-20 | COLHEAD | 2 | 20 | false | 32 | 1 | false | FIRST |
| PD-11 | OTHER | 7 | 46 | true | 1 | 3 | true | NEW |
| PD-12 | OTHER | 3 | 54 | true | 1 | 3 | false | FIRST |
| PD-16 | OTHER | 7 | 47 | true | 1 | 3 | true | NEW |
| PD-17 | OTHER | 3 | 48 | true | 1 | 3 | false | FIRST |

観察された事実（記述のみ）:

- leftBlank=true は 4 件で、全て OTHER（ページ番号様の数字）。他 role の 16 件は leftBlank=false。
- HEADER_OR_TITLE 4 件は全て distanceToHeaderEnd 6〜7・offsetFromE 0〜1 で、hasTrigger=true。
- COLUMN_HEADING 12 件は rightTextChars が 1〜55 と幅広く、offsetFromE は 0・20・21・23 のいずれか。
- partition 別に見ても CONTINUATION は 0（DEV 10 / FIRST 5 / NEW 5 のどれにもなし）。

### 9.2 #407 positive（H2: FB-03、H7: FB-11）との比較

#407 positive の機械特徴は offsetFromE=11・rightTextChars=6・leftBlank=true・candidatesOnPage=4（distanceToHeaderEnd=1）。manifest から再集計した新 20 件の結果:

| 特徴 | 該当した新 sample | visualRole |
|---|---|---|
| offsetFromE=11 | 0 件 | — |
| rightTextChars=6 | 0 件 | — |
| leftBlank=true | 4 件（PD-11, 12, 16, 17）| 全て OTHER |
| candidatesOnPage=4 | 2 件（PD-03, PD-19）| HEADER_OR_TITLE / COLUMN_HEADING |
| 4 つ全て | **0 件** | — |

- 4 特徴を全て持つ新 sample は 0 件。いずれか 1 つ以上を持つものは leftBlank 4 件と candidatesOnPage 2 件で、重複はなく、全て CONTINUATION ではなかった（上記 visualRole）。
- distanceToHeaderEnd=1 は PD-13・PD-14（COLUMN_HEADING）。
- PD-03・PD-19 は H2/H7 と同じ page の別行で、その page には既知 flag があるが、これらの行自体は HEADER_OR_TITLE / COLUMN_HEADING と観察された。

### 9.3 #407 の non-continuation 10 件との比較

#407 の non-continuation 10 件は COLUMN_HEADING 5・OTHER（ページ番号様の数字）4・HEADER_OR_TITLE 1。新 20 件でも同種の役割（COLUMN_HEADING 12・HEADER_OR_TITLE 4・OTHER 4）が再現した。新 20 件に、これら 3 種以外の role（AMBIGUOUS/UNREADABLE を含む）はなかった。#407 でも OTHER は全て leftBlank=true の数字だったが、新 20 件でも OTHER 4 件が leftBlank=true の数字であった（事実の記述のみ）。

## 10. outcome の整理（最終選択はしない）

- **Outcome P0（新 continuation 0）**: 新 CONTINUATION は 0 件。
- P1（新 continuation >= 1 かつ H2/H7 とは異なる mechanical morphology が存在 → Family B に一般化可能性あり、次は positive taxonomy / deeper failure isolation 候補）・P2（新 continuation >= 1 かつ H2/H7 と同じ特徴群に集中 → candidate hypothesis 形成可能性あり、ただし即 preregistration には進まない）・PA（AMBIGUOUS が多い → visual semantics 自体の安全性再検討）は、観察上 CONTINUATION が 0 件、AMBIGUOUS/UNREADABLE が 0 件、second review 0 件のため、いずれも支持される根拠がない。
- P0 の含意（指示書の定義）: positive evidence remains H2/H7 only。Family B automation hypothesis は弱い。defer 候補。
- **Documentation transcription error correction**: 本 doc の初版は P1/P2 の説明を実行契約と逆に記載していた（P1 を「H2/H7 と同型」、P2 を「別型」と誤記）。実行契約自体は正しく、visual result は P0 で P1/P2 は選択されていない。したがって research decision・result への影響はなく、上記は定義の転記訂正のみである。
- 限界: 20 件は diversity sample で無作為ではなく、母集団 79 行のうち 20 行しか見ていない。prevalence・failure rate・expected recall は推定できない。「0 件だから positive は存在しない」「corpus に continuation はほぼ無い」とは言えない。

## 11. 解釈

- FACT: manifest hash は不変。観察は 20/20 で manifest と 1:1。role totals は §8。render は全件 110dpi・全 page・crop なし。
- FACT: 新 20 件は CONTINUATION を含まず、COLUMN_HEADING 12・HEADER_OR_TITLE 4・ページ番号様の数字 4 だった（reviewer の観察）。
- OBSERVATION: #407 で見えた non-continuation の 3 種の役割は、別 page・別 PDF の新 sample でも再現した。H2/H7 と同じ機械特徴の組を持つ新 sample はなかった。
- HYPOTHESIS_CANDIDATE: 作らない（20 件の結果から仮説・閾値を作らない）。
- UNRESOLVED: §12。

## 12. unresolved

- 未レビューの 59 行（79 − 20）の性質は不明。
- 20 件は無作為ではなく、feature-space の coverage 最大化で選んだ。
- reviewer の medium 3 件（PD-05, 13, 14）は 110dpi での判読限界に由来する。second review は行っていない。
- 同一 reviewer 内の判定の一貫性、reviewer 間の一致は検証していない（担当 sample が重複しないため）。
- H2/H7 型と異なる continuation 形が 59 行の中にあるかは不明。

## 13. sample membership と contamination 境界

本 review で目視した 20 件の pdf/page は、今後 Family B の new held-out として使わない。特に FIRST_HELDOUT_POSTHOC 5 件・NEW_HELDOUT_POSTHOC 5 件は held-out 資格を失う。#407 の 12 page と合わせ、目視済みの page は Family B 関連の評価に使わない。

## 14. claim boundary

exploratory。GT ではない。formal evaluation ではない。sample は PDF を見ずに freeze し、freeze 後に差し替えていない。言えるのは §8・§9 の記述的観察まで。「feature X なら continuation」「閾値」「rule」は言えず、prevalence も言えない。

## 15. next research question（仮説ではない）

未レビューの 59 行には、H2/H7 以外の visual continuation が存在するか。存在する場合、その視覚的な形は H2/H7 と同型か。

## 16. 実施しないこと

GT 作成・preregistration・parser/H1/evaluator の変更・formal evaluation・prevalence の主張・sample の事後差し替え/追加は行っていない。

## 17. 実行環境メモ

Phase 3 では PDF を開いていない。fixture は `/tmp` の reviewer ファイル 4 本から決定的に生成（2 回生成で sha256 一致）。test は `scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-positive-discovery-review.test.ts`（data/work・PDF 不要）。
