# FY2024 概算要求 TOC A 層 — Human Review 7 page の Failure Isolation（read-only・実装なし）

観測: `tests/fixtures/budget-request-toc-human-review-failure-isolation/2024/observations.json`（生成 `scripts/pipeline-v2/analyze-budget-request-toc-human-review-isolation.ts`）。

**human observation と raw / parser / evaluation の対応付けのみ。** parser・H1・GT・preregistration・評価 contract・threshold・tolerance・min evidence・`data/download/` は変更していない。「ページ番号を使えば直る」「罫線を使えば直る」「min evidence を 1 にすれば直る」等の仮定は置かない。新しい visual 確認は行っていない（H7 の食い違いは human 再確認待ちの UNRESOLVED）。#403 の保存出力は 7 page 全てで再現できた（現行 H1・evaluator は #403 時点と同一）。

> 前提メモ: #403 は本書作成時点で未 merge のため、本 branch は #403 の branch を土台にしている。

## 1. 7 page の対応表（human → raw → parser → evaluation）

| id | page | human | machine（#403 出力） | 対応の結論 | mechanism status |
|---|---|---|---|---|---|
| H1 | jinji p3 | 右 column 空。request ① と request 番号なしの構造行 | UNSPLIT。evidence 0（request token 4 件は全て行頭）。OTHER_CODE あり。末尾の「令和６年度概算要求定員表 93」は `FRAGMENT_WITH_PAGE_REF` で abstain | 目視と整合（右空は evidence 0 と一致） | OBSERVED（整合） |
| H2 | maff 230901-2 p3 | continuation 3 件（req18/19/23）、owner は一意 | SPLIT（E=55、evidence 5・spread 0）。attach 2 件（req19, req23）。GT fragment 3：correct 2 / incorrect 1 | 差は req18 の continuation（§3） | MECHANISTICALLY_EXPLAINED |
| H3 | meti ippan_o p4 | 右空、continuation 5 件、owner 一意 | UNSPLIT（evidence 0）。attach 5 件。GT 5：correct 4 / unresolved 2 | 5 件の owner は GT owner と key 一致。1 件は評価側の duplicate-key 規則で判定不能（§4） | MECHANISTICALLY_EXPLAINED |
| H4 | mhlw 05-2b-01 p4 | 右列は `(項)090` と `50` の 2 行のみ | PAGE_ABSTAINED（`RIGHT_EVIDENCE_INSUFFICIENT`）。evidence 1 | min evidence 2 に対し 1 件（§5） | MECHANISTICALLY_EXPLAINED |
| H5 | mlit 001630995 p6 | 右列 request 約 30 件・左端一直線 | PAGE_ABSTAINED。evidence 1（request token 50 件中 49 件が行頭＝右のみの raw line） | 約 30 件の右列 request は evidence に数えられない（§5） | MECHANISTICALLY_EXPLAINED |
| H6 | mod gaisanyoukyu p4 | 右列は request 67 の 1 行のみ | PAGE_ABSTAINED。evidence 1 | H4 と同型（§5） | MECHANISTICALLY_EXPLAINED |
| H7 | mof 2024ippan_2 p2 | 初回記録: req23 が 2 物理行（continuation 1 件のみ）→ **訂正（§11）: req18 と req23 の 2 件**。罫線の観察は visual のみ | SPLIT（E=55、evidence 3）。attach 1 件（owner は req18・line 62）。header zone の line 8 は whole-line TITLE。GT なし | machine の attach（req18）は訂正後の human observation（req18 の continuation）と整合。header zone の line 8 は req23 の continuation（§6, §11） | MECHANISTICALLY_EXPLAINED（human 訂正により、食い違いは human review 時の見落としと確定） |

## 2. Investigation A — page-number handling（コード根拠: `budget-request-toc-row-assembly.ts`）

| # | 問い | 回答 | 根拠 |
|---|---|---|---|
| 1 | 認識/抽出 | **YES** | `TRAILING_PAGEREF`（L21）を `classify` の `ref = TRAILING_PAGEREF.exec(trimmed)`（L167）で segment 末尾から抽出し `pageRefRaw` に raw 保持。OTHER_CODE は PAGEREF を pattern に含む（L14, L182） |
| 2 | row 分類 | **NO（OTHER_CODE のみ YES）** | REQUEST / MARKER は行頭 token の pattern だけで決まる（L172〜L180）。page ref は分類に使われない。OTHER_CODE は page ref を必須部品とする |
| 3 | **logical row の終端 evidence** | **NO** | 終端判定のコードは存在しない。row は raw line（segment）単位で、page ref の有無で row が閉じる／継続するという処理はない |
| 4 | fragment 候補の検出 | **YES（除外条件として）** | 行頭が row-start でも数字でもない segment が末尾に page ref を持つと `abst('FRAGMENT_WITH_PAGE_REF')`（L185）。持たなければ fragment 候補 |
| 5 | fragment owner の決定 | **NO** | owner は同 column の直前の RESOLVED row（`owner[col]`、L190〜L200）。page ref は関与しない |
| 6 | right band E の推定 | **INDIRECTLY** | evidence の正規表現 `\d{1,4}(\s+)(REQUEST_TOKEN)`（L22）は request token の直前に「数字 + 空白」を要求する。この数字は通常、左 row の末尾 page ref。右のみの raw line（左が空）の request token はこの条件も「先頭 token でない」条件（L98）も満たさず数えられない |
| 7 | 左 page 番号と右 row-start token が同一 raw line の場合 | **INDIRECTLY（明示的な区別なし）** | 上記の正規表現が「token 直前の数字群」を左の page ref とみなす暗黙の前提。E は token の開始 index（L98）で、分割は `line[0:E]` / `line[E:]` |
| 8 | page ref の有無と `FRAGMENT_WITH_PAGE_REF` | 末尾 page ref **あり** → abstain、**なし** → fragment 候補 | L185。全 corpus で 26 件（「…定員表 N」行） |

## 3. Investigation B — H2 の fragment 対応

| visual fragment | raw line | parser candidate? | parser owner | GT owner | result | reason |
|---|---|---|---|---|---|---|
| req18 continuation | line 10（右 segment「に必要な経費」） | **No**（whole-line の `TITLE_OR_HEADING`/UNSPLIT として出力） | なし | Q18 | **not represented**（evaluator: `OMITTED_SILENTLY_FRAGMENT`） | line 10 は最初の row-start 行（line 11 の「（組織）010」）より前＝header zone。header zone の行は分割されず whole-line TITLE（L141-L142, L205-L209）。H1 は row-start token のない行を分割しない（#398 の既知の二次限界） |
| req19 continuation | line 15（右 segment、chars 66–72） | Yes | Q19（line 14） | Q19 | **attached correctly** | 同 column の直前 RESOLVED row |
| req23 continuation | line 32（chars 66–73） | Yes | Q23（line 31） | Q23 | **attached correctly** | 同上 |

human 3 と machine 2 の差 = req18 の continuation が header zone に入って fragment 候補にならなかったこと。

## 4. Investigation C — H3 の 5 fragment

| # | raw line | parser owner | GT owner | evaluation |
|---|---|---|---|---|
| 1 | 11 | req41（line 10） | req41 | CORRECT |
| 2 | 16 | 項 030（line 15） | 項 030（LEFT:10） | **UNRESOLVED**（`AMBIGUOUS_OWNER_GROUP`） |
| 3 | 19 | req43（line 18） | req43 | CORRECT |
| 4 | 22 | 項 040（line 21） | 項 040 | CORRECT |
| 5 | 25 | req44（line 24） | req44 | CORRECT |

wrong は 0。#2 は、この page に marker key `(項) 030` が 2 つあり（資源エネルギー庁と中小企業庁）、#395 の「owner の key group が 1:1 でなければ UNRESOLVED」規則に当たるため。parser 側の owner は人間の見立てと一致している。evaluator は同一の物理 fragment を GT 側と parser 側で 1 件ずつ計 2 件の unresolved に数えている（accounting 上の事実）。

## 5. Investigation D — PAGE_ABSTAINED 3 page（H4 / H5 / H6）

| | H4 | H5 | H6 |
|---|---|---|---|
| request token（全件 / evidence に数えた） | 20 / 1 | 50 / 1 | 23 / 1 |
| evidence の raw line・char index | line 6・51（`50 01-98`） | line 4・53（`147 05-95`） | line 4・57（`67 15-35`） |
| 他の右 request token | なし（右 column に request row が 1 件のみ） | **30 件が index 55**（全て右のみの raw line。token が行頭で、直前の数字もない） | なし |
| candidate E / spread | 51 / 0 | 53 / 0（evidence 1 件のため） | 57 / 0 |
| tolerance | 適用されない（件数 1 で、L136 の分岐より前に page abstain） | 同左 | 同左 |
| **exact condition** | evidence 件数 = 1（`starts.length === 1`、L136） | 同左 | 同左 |
| page 番号の干渉 | evidence の 1 件は左 row の page ref（`556` 等）が直前にある行に限られる | 左 row と同一 raw line の右 row だけが数えられる | 同左 |
| `(項)` 等の構造行 | marker 右候補は 1 件（L4 の `(項)090`）。band 用 evidence には使わない（marker は band に使わない） | marker 右候補 0（右の `(項)` 行は右のみの raw line） | 0 |
| 罫線情報 | 利用不可（入力は text のみ） | 同左 | 同左 |

**H5 の機構**: pdftotext の layout では右 column の row が左と別の raw line（左が空白）に出る行が大半で、request token の直前に数字がなく、かつ token が行頭の token になる。evidence の条件（L22 の直前の数字＋空白、L98 の「先頭 token でない」）はどちらもこの形を除外する。左 row と同一行になった line 4 の 1 件だけが数えられ、件数 1 → `RIGHT_EVIDENCE_INSUFFICIENT`。H4/H6 は右 column に request row 自体が 1 件しかなく、件数 1 のまま。**H4/H6 は min evidence=2 で説明できる**（H5 は min evidence ではなく evidence 抽出条件で説明される）。観測のみ: H5 の request token の開始 index は 53（1 件）と 55（30 件）。

## 6. Investigation E — H7

1. machine の fragment attachment は **visual req23 の continuation ではない**。attach は owner req18（line 61）の左 column の continuation「な経費」（line 62）。
2. `KNOWN_TOKENLESS_FRAGMENT_RELEVANT` を発生させた raw line は **line 8（右 segment「に必要な経費」）**で、header zone の whole-line TITLE。これは human が見た req23 の continuation（line 7 の `23 41-20 …` の続き）と同じ raw line と整合する。
3. したがって「machine の attach（line 62）」と「flag の根拠（line 8）」は別物。前者は req18 の 2 行目、後者は req23 の 2 行目。
4. ~~UNRESOLVED: human は continuation を req23 の 1 件のみと報告したが、raw には req18 の 2 行目もある~~ → **解消（§11）**: 追加の人間目視で req18 の「な経費」も continuation と確認され、最初の human review 時の見落としと確定した（初回記録は誤りだったが、履歴として本文に残す）。
5. 下部の水平罫線は current algorithm の入力ではない（入力は text のみ）。

## 7. 罫線 / geometry

`TocPageInput`（L41–L50）は `text` と `nonEmptyLines` のみ。current algorithm（#393 / H1）は**罫線も座標も利用していない**。人間が H4/H6 で使った中央罫線は algorithm の入力にならない（事実の確認のみ。罫線を使うべきとは言っていない）。

## 8. failure-family table

| family | pages | 観測 | mechanism status |
|---|---|---|---|
| F1 右 column の request-kind evidence が 1 件 | H4, H6 | evidence 件数 1 → page abstain | MECHANISTICALLY_EXPLAINED（L136） |
| F2 右のみの raw line の request token が evidence に数えられない | H5 | 30 件の右 request が evidence 0、数えられたのは 1 件 | MECHANISTICALLY_EXPLAINED（L22 / L98） |
| F3 header zone の tokenless continuation が whole-line TITLE に入る | H2（req18）, H7（req23） | fragment 候補にならない | MECHANISTICALLY_EXPLAINED（L141-L142, L205-L209）。#398 の既知の二次限界と同型 |
| F4 duplicate marker key による評価側の判定不能 | H3 | 1 fragment が unresolved（計 2 件に数える accounting） | MECHANISTICALLY_EXPLAINED（#395 の group 規則） |
| F5 human と raw の食い違い | H7 | 初回記録は req23 のみ、raw には req18 の 2 行目もあった | **RESOLVED（§11）**: human review 時の見落としと確定（追加の人間目視で訂正） |
| F6 目視と整合する正常観測 | H1, H3 の UNSPLIT | 右 column 空と evidence 0 が一致 | OBSERVED（整合） |

## 9. 最終報告で答える質問

1. **logical-row 末尾判定に page 番号を使っているか**: 使っていない（NO）。fragment 候補の除外（L185）と E の evidence 抽出の前提（L22）に間接的に関わるだけ。
2. **H2 の差**: req18 の continuation（line 10）が header zone の whole-line TITLE になり fragment として表現されなかった。req19 / req23 は正しく attach。
3. **H3 の wrong / unresolved**: wrong 0。unresolved 1 件（owner が項 030）は duplicate key group（n=2, m=2）による評価側の判定不能。parser の owner は一致。
4. **H4/H6 は min-evidence=2 で説明できるか**: できる（各 evidence 1 件）。
5. **H5**: 右 column の約 30 件の request token は右のみの raw line にあり、行頭 token かつ直前の数字がないため evidence に数えられず、数えられた 1 件のみ（L22 / L98）。
6. **H7 の flag と req23**: flag の根拠 line 8 は req23 の continuation と整合。machine の attach は別（req18 の 2 行目・line 62）で、訂正後の human observation（req18 の continuation）とも整合する。
7. **罫線 geometry**: 利用していない。
8. **残った UNRESOLVED**: なし（H7 の食い違いは §11 の human 訂正で解消）。

## 10. Next

この unit では hypothesis・preregistration・実装へ進まない。結果のレビューは user と ChatGPT が行う。

## 11. Post-review human correction（H7）

追加の人間による PDF 原本の目視確認（assistant は新しい visual 確認をしていない）により、初回の human review 記録「tokenless 名称 continuation は request 23 の 1 件のみ」は**誤り**と判明し、撤回された（初回記録は上記 §1・§6 に履歴として残してある）。

- 訂正後: H7 の tokenless 名称 continuation は少なくとも 2 件。(1) **request 18** の 2 行目「な経費」: owner は人間に一意で、raw line 62（左 column）・parser の attach（owner req18）と整合。(2) **request 23**: 2 行目に row-start token なし、owner は人間に一意、continuation の開始位置は request 23 の名称開始位置とほぼ一致（前回確認どおり）。
- 原因: 最初の human review 時の見落とし。PDF 側の ambiguity や raw representation loss ではない。
- 影響: 直前の H7 の UNRESOLVED（human と raw の食い違い）は解消。本訂正が直接影響する H7 の記述（§1 の H7 行・§6 の項 4・§8 の F5・§9 の回答 6 と 8）だけを更新した。他の page の観察・mechanism status・failure-family の分類は変更していない。
- 変更していないもの: machine 出力（#403 の保存出力）・GT・frozen evaluation artifact・parser・評価 contract。`observations.json` には `postReviewHumanCorrection` を追記した（既存の観測値は不変）。
