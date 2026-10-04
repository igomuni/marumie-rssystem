# MOF Pipeline V2 FY2024 General Account XML Item Parser v0 Preregistration

2026-10-04。FY2024 一般会計 当初予算 `202411001` 専用の事項 parser v0 について、**実装前に**入力契約・抽出規則・fail-closed・oracle・評価指標・GO/STOP を固定する。**production parser は実装していない。** 本書の規則・fixture・判定基準は、parser の結果を見たあとに変更しない。

## 1. Research question

FY2024 一般会計 当初予算 `202411001` の frozen XML source set から、事項 record を **視覚推論なし・推測なしで deterministic に再構成できるか**。

## 2. Scope

対象は `FY2024 / 一般会計 / 当初予算 / 202411001` のみ。特別会計・政府関係機関・補正予算・決算・FY2024 以外・別 document id・別 DTD は対象外で、一般化を主張しない。

## 3. Frozen source set（P0 再確認済み）

- raw XML 328 件（合計 11,621,700 bytes）。menu 列挙集合と過不足なく一致、SHA-256 は inventory（`tests/fixtures/mof-budget-xml-inventory/2024/202411001-source-inventory.json`、commit `ad198c6`）と PR #369 の provenance に一致。再計算して不一致 0。
- 対象（事項表）94 ファイル、対象外 234 ファイル。期待行数: 事項行 1,256・項の開始行 784・組織計行 88・説明のみ行 32。structural fingerprint は事項表 94 ファイルで 9 種、未分類 variant 0。
- source-set artifact: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-source-set.json`（SHA-256 `62df90fb32caf5997ecb2772eb0c84da66789b635eb1bc024743cf6a8da2afe3`）。94 ファイルの SHA-256・fingerprint・組織・目次 chain・行数と、対象外 234 ファイルの SHA-256・`title_for_list` を持つ（既存 inventory の file 別 hash と照合済みのため hash 自体は複製せず再利用、parser 用に対象/対象外の区分と行数だけを追加）。

## 4. Input contract

- 入力: raw XML の bytes、filename、document id `202411001`、menu 由来の祖先 chain（secondary check 用）。
- decode: Shift_JIS（fatal、置換なし）。XML 宣言 `encoding="Shift_JIS"`、root `budget`、DOCTYPE `DOCTYPE budget SYSTEM "../dtd/202401.dtd"`（完全一致）。
- file-level context: `title_for_list`（root 直下に 1 つ、CDATA 文字が完全一致）と `running_title`（同 1 つ）。
- unknown な構造を「似ているから」処理する fallback は無い。

## 5. Fail-closed（silent skip 禁止）

| 条件 | 扱い |
|---|---|
| decode 不能・malformed XML・root/encoding/DOCTYPE 不一致 | **hard failure**（例外。部分出力なし） |
| frozen source set（filename+SHA-256）に無いファイル／document id が 202411001 でない | **unsupported**（明示的な結果。事項は出さず、件数に計上） |
| `title_for_list` が対象と異なる（source set 内の 234 件） | **not_target**（事項表として扱わない。失敗ではない。silent skip ではなく結果に計上） |
| 対象ファイルで table が 1 つでない・header 不一致・必要列欠落 | hard failure |
| 未知の行（後述 5 種以外）・空セルを持つ行・同一行同一列の重複セル | hard failure |
| 事項行で currentItem が未定義（孤児）／項コードだけ・項名だけ／項コード重複／項コードが 3 桁数字でない | hard failure |
| col4 が 2 桁数字でない／必須金額（col6・8・10）が欠落・空・文法外 | hard failure |
| 組織の primary と secondary が不一致 | hard failure |
| 対象セル内の想定外の子要素・非 CDATA の文字・未知の gaiji・qt の中身 | hard failure |
| 文書順が (頁,行) の昇順でない | hard failure |

v0 の出力 field に nullable なものは無い（不明な値を null で埋めない）。説明（col11）は出力しない（対象外。欠落ではない）。

## 6. 事項表 identification rule

`title_for_list` の CDATA 文字が **`〔組織別事項別内訳〕` に完全一致**する 94 ファイルだけ（先頭・末尾の空白なし。`trim` で一致させない）。「事項」の語を含むだけの表は対象外: 繰越明許費要求書・国庫債務負担行為要求書（見出しに「事項」を持つが別の表）、予定経費要求書、継続費、データセル内に「事項」を含む表など（source set の `nonTargets` 234 件で固定）。対象ファイルは `body/table` を 1 つだけ持ち、header は列開始番号ごとに次の（空白除去後の）文字列と完全一致する: 1=組織, 2=項, 4=事項, 6=令和6年度, 8=前年度, 10=比較増△減額(千円), 11=説明、下位見出し 6=要求額, 7=(千円), 8=予算額, 9=(千円)。

## 7. 行の分類と事項行

データ行は clm の id `p{頁}-{行}.{n}-{列}.{n}`（頁・行の組を行キーとする）でまとめる。許可する行は次の 5 種のみ。
1. 組織＋項＋事項行（列 1,2,3,4,5,6,8,10,11。各ファイルの先頭行）
2. 項＋事項行（列 2,3,4,5,6,8,10,11）
3. 事項のみ行（列 4,5,6,8,10,11）
4. 組織計行（列 4.2,6,8,10。「…計」。**事項として出力しない**）
5. 説明のみ行（列 11 のみ。**出力しない**）

事項行 = 列 5.1 が空でない行（1〜3）。列 1〜10 のセルは単一の `<p>` を持つ（列 11 だけ複数 `<p>` を持つので解釈しない）。

## 8. 組織 context rule（1 つの規則）

- **primary**: 各ファイルの先頭データ行の列 1.1 の文字（連結後・無加工）。
- **secondary（整合 check のみ）**: `running_title` の組織部分（`{所管}所管` + 半角スペース 2 つ + 組織 の形ならその後ろ、形がなければ全体＝皇室費）、および menu の祖先 chain の要素のどれかが組織と完全一致すること。
- 不一致は hard failure。推測で解決しない。94 ファイルで primary と secondary は全件一致（皇室費の `running_title` は「皇室費」のみで所管の語がない。所管は v0 では出力しない）。

## 9. 項 recognition / carry-forward

- 項の開始行 = 列 2.1（項コード）と 3.1（項名）が**両方**ある行。コードは 3 桁数字、片方だけは failure。
- `currentItem` はファイルの先頭で未定義。項の開始行で更新。事項行は `currentItem` に所属する。頁・行をまたいで引き継ぐ（頁境界でも項は再掲されない。先頭行は必ず項の開始行）。項切替は項の開始行の出現のみ。同一項の再掲はなく、項コードがファイル内で重複したら failure。
- 項コードの大小・昇順を前提にしない（25 ファイルで昇順でない）。名称の類似・V1・PDF から所属を補完しない。事項行で `currentItem` が未定義なら failure（孤児 0 が acceptance）。
- 位置づけ: **XML の明示された親子 tree ではなく、文書順と帳票構造から deterministic に復元する間接的な hierarchy**。

## 10. 名称の復元（事項名・項名・組織名に共通）

- source は clm 内の `<p>` の `<l>` 群。`<l>` の子を文書順に走査し、**CDATA の文字**と **`gaiji` の子文字**だけを連結する。`<l>` 間は区切りなしで連結（固定幅の折返しで行の区切りに意味はない）。空白・改行の追加や `trim` はしない（観測: 先頭末尾・字間の空白 0）。
- raw 表現: `lines`（`<l>` ごとの文字列の配列）と、連結した `text`。production normalization はこの phase で決めない。
- 想定外の子要素・非 CDATA の非空白文字・空の `gaiji` は failure。XML entity は tokenizer が復号する（対象セルでは entity 出現は想定外の形が無いことだけを確認）。

## 11. gaiji / qt

- **gaiji**: `<gaiji code="1508"><![CDATA[填]]></gaiji>` の形（事項名 2 件。子文字あり）。子文字を採用し、`code` と子文字を `gaiji: [{code, text}]` として保持。`code` 以外の属性・子文字なし・(1508,填) 以外の組は v0 では未知として failure。見た目や一般知識から文字を推測しない。
- **qt**: 空要素 `<qt></qt>`（意味は XML 未定義で**意味付けしない**）。文字には寄与しない（空文字）。出現数を `qtCount` として保持。属性・子を持つ qt は failure。観測は事項名 11 件・項名 11 件（同じ 11 行。「令和<qt/>2<qt/>年度…」の形）。

## 12. 金額 field

header の語から、各列を次に固定する。

| 列 | header（XML の語） | v0 の field |
|---|---|---|
| 6 | 令和6年度 / 要求額 / (千円) | `amountsRaw.col6`、`amountsThousandYen.col6` |
| 8 | 前年度 / 予算額 / (千円) | col8 |
| 10 | 比較増△減額(千円) | col10 |

raw はセルの連結後の文字列（無加工）。文法: `0` または `正整数（3 桁カンマ区切り）`、col10 のみ `△ `（△＋半角スペース）接頭辞を許可（負）。`△ 0`・`△` を col6/8 に置く形・空白・非数値・空は failure。変換は「千円」のまま整数（円への換算はしない）。blank → 0 にしない／差額計算で補完しない（col10 と col6−col8 の整合の算術検算も v0 では行わない）／符号を他列から補わない。col6・8・10 は必須（欠落は failure）。

## 13. Code field

- 項コード: 列 2.1 の raw 3 桁文字列（先頭の 0 を保持）→ `itemCode`。
- col4 の 2 桁: 列 4.1 の raw 2 桁文字列 → **semantic-neutral な `col4Raw`**。意味（主要経費別分類コード等）は XML に明示がなく、v0 では付けない。「事項コード」「事業コード」「official item id」等の名前も付けない。
- 概算要求 PDF の `NN-NN` との対応は検証しない。

## 14. Fixture / oracle

V1 の 1,256 件・`mof-jikou-2024.json` は oracle に使わない。parser 実装前に raw XML だけから research script で生成して凍結する。
- **reference projection**: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-reference-projection.json`（SHA-256 `e6335aceb0c7d69888206cada038dcb03db5e25f7c2a10a8d5ae6104c2d615d9`）。1,256 件。field: file・row・page・rowNo（locator）、organization、itemCode、itemName（＋lines・qtCount・gaiji）、requestName（＋lines・qtCount・gaiji）、itemStartsInThisRow、col4Raw、amountsRaw、amountsThousandYen。**production parser とは独立の research extraction であり、独立 human GT でも未知 population での正解保証でもない。**
- **hand-checked fixture**: `tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-hand-checked-fixture.json`（SHA-256 `664f0fbee2470311831db9dfbe53cd6e315a0e1f549767612d159b862d408fd1`）。29 行。選択規則（事後に選べない）: gaiji 全件／qt 全件／fingerprint ごとの辞書順先頭ファイルの先頭行／頁境界で項が再掲されない行の先頭 3 件／2 つ目のファイル先頭行／複数行・1 行の事項名の先頭／col10 が △・0、col6・col8 が 0 の先頭。各行に raw clm 断片を添え、AI が原文と目視照合した（独立 human GT ではない）。
- 生成 script: `scripts/pipeline-v2/project-mof-budget-xml-reference.ts`・`freeze-mof-budget-xml-hand-fixture.ts`（commit `a9a14b9`）。`--check` で再生成が commit 済み artifact と byte 一致することを確認済み。**parser 実装後に再生成して期待値を変えない。**

## 15. Evaluation metrics（実装後・frozen 条件）

- Structural: 94/94 の対象を認識、234 件を事項表と誤認しない（not_target）、unsupported・malformed を silent success にしない。
- Record coverage: expected 1,256・emitted・missing・extra・duplicate。
- Field exactness（reference projection と）: organization、itemCode、itemName、requestName、amountsRaw、amountsThousandYen、col4Raw、provenance（file・row・page・rowNo と file の SHA-256）、qtCount・gaiji。
- Hierarchy: 事項→項 assignment exact、orphan、ambiguous。
- Special: gaiji 2 件・qt 11 件（事項名・項名）が事前登録の挙動と一致。fail-closed の test が通る。

## 16. GO / STOP / INCONCLUSIVE

- **GO**: source-set integrity 一致／94/94 認識／1,256/1,256 出力／missing・extra・duplicate・orphan・ambiguous が 0／上記の必須 field が reference projection と **100% exact**／gaiji・qt・fingerprint の期待挙動を全件満たす／fail-closed test が通る。
- **STOP**: 上記を 1 件でも満たさない。
- **INCONCLUSIVE**: raw source・frozen artifact・locator・oracle 自体に問題が見つかり、parser の成否を評価できない。この場合 GT / reference projection を書き換えて GO にしない。原因を保存して止める。
- 100% exactness を要求できない field はない（全 field を primary acceptance に含める。説明 col11 は出力対象外）。

## 17. Claim boundary

GO で言えるのは「FY2024 一般会計 当初予算 `202411001` の frozen XML source set に対し、事前登録した規則で事項 record を deterministic に再構成できた」まで。特別会計・補正予算・他年度・全 MOF XML への一般化、col4 code の意味の確定、PDF との対応、概算要求 PDF との match key の確立は主張しない。

## 18. Held-out / generalization

v0 が GO になったあと、別 phase で fresh held-out population（特別会計・補正予算など）を、parser の出力を見る前に凍結する。今回は対象 XML を先に解析して rule を合わせない。

## 19. Explicit non-goals

production parser、production normalized schema（`MofBudgetItemRecord`・`subItem = 目`）の変更、事項の production data model・hierarchy generator への追加、PDF×MOF 照合、fuzzy matching、col4 の意味推定、PDF `NN-NN` とのコード対応検証、特別会計・補正予算・他年度の解析、FieldResolver 変更、H2、PR 作成。出力 field 名は research-neutral（reference projection と同一）で、production schema 名ではない。

## 20. Observations used（source evidence）

事項表 94 ファイルの header は全件同一、行分類は上記 5 種のみ（未分類 0）、先頭行の列 1 と running_title の組織部分が 94/94 一致、目次 chain に組織が 94/94 含まれる、項コードは 3 桁・ファイル内重複 0・25 ファイルで昇順でない、金額は 3 列とも 1,256/1,256 で空なし（col6・col8 は `N`、col10 は `N` または `△ N`。0 は col6 54・col8 14・col10 56 行）、名称の複数 `<l>`（事項名 1,250/1,256）、字間・先頭末尾の空白 0、列 1〜10 のセルは単一 `<p>`（列 11 のみ複数 `<p>`）。
