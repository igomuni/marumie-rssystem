# 概算要求 総表 raw text → CSV（v0）

令和6年度歳出概算要求額総表を、PDF から生成済みの plain text（pdftotext 出力、Form Feed でページ区切り）から deterministic に CSV 化する。LLM・OCR・他資料による補完は行わない。

- 実装: `scripts/pipeline-v2/lib/budget-request-total-table.ts`（pure）、`scripts/pipeline-v2/build-budget-request-total-table-csv.ts`（runner）
- テスト: `scripts/pipeline-v2/lib/budget-request-total-table.test.ts`、fixture は `tests/fixtures/budget-request-total-table/2024/`（原文の物理行を抜粋。出典は `excerpts.json`）

```bash
npx tsx scripts/pipeline-v2/build-budget-request-total-table-csv.ts [zipPath] [outputDir]
# 既定: data/work/budget-request-plain-text.zip → data/work/budget-request-csv/2024/total-table/
```

## 原則

- raw text に存在する値だけを抽出する。`△` を補完しない、空欄を `0` にしない、他列・他行・他ページから値を補わない。
- 判断できない行は main CSV に入れず `unresolved.csv` に理由付きで残す。
- 行種別 `HIER` / `CODE3` / `DETAIL` / `TOTAL` は物理文法であり、所管・会計・組織・項などへの意味付けはしない（同じ3桁コードが異なる階層に現れる。例: 環境省の `010 地域脱炭素推進体制強化費` と字下げの深い `010 地域脱炭素推進体制強化事務費`）。

## 文法

### ページとブロック

- **総表ページ**: 空白を除去したページ本文に、`前年度予算額` `６年度概算要求額` `一般行政経費` `その他の経費` `対前年度` `比較` `増△減` `明細書` `頁数` の9要素がすべて含まれるページ。タイトル `令和６年度歳出概算要求額総表` は目次・表紙にも出るため、判定には使わない（タイトルのみのページは `titleOnlyPages` として記録する）。
- **ブロック**: 連続する総表ページの並びを1ブロックとする。総表でないページを挟んだら別ブロックになる（例: 内閣府 `cao…__0` は組織ごとに表紙と総表が交互に並ぶ）。`table_block_id = <slug>#b<n>`。

### ページ内の行分類

1. **ヘッダ領域**: ページ先頭から、最初の数値行より前にある最後の表頭行（`(A)/(B)` の行）までの範囲。ここに出てよいのは次のクラスだけで、それ以外は `UNKNOWN_HEADER_ZONE_LINE` とする。
   - `PAGE_LABEL`: ページ最初の非空行で、空白除去後に `数字* 非数字{0,3} 数字*` の形（例: `文 1` `2 文` `復興特 1` `6`）
   - `TABLE_TITLE`
   - `UNIT`: `(単位:千円)`
   - `TABLE_HEADER`: 空白除去後が表頭語彙（`要求` `番号` `区分` `前年度予算額` `６年度概算要求額` `一般行政経費` `その他の経費` `計` `対前年度` `比較` `明細書` `増△減` `（Ｂ−Ａ）` `頁数` `(A)` `(B)`）だけで構成される行
   - `CONTEXT`: 2〜4桁コードで始まる所管・会計行（例: `24 文部科学省所管`、`9101 東日本大震災復興特別会計（…）`）。行としては出力せず、`summary.json` のブロック情報に残す。
2. **本文**: 次の順に判定する。空行は継続行の連続を切る。
   - 末尾数値列あり → 行頭（head）を判定。どれにも当たらなければ `UNMATCHED_NUMERIC_HEAD`
   - 末尾数値列はないが ASCII 数値トークンを含む → `MALFORMED_NUMERIC_TAIL`
   - それ以外 → 継続行の条件を満たせば `CONTINUATION`、満たさなければ `AMBIGUOUS_CONTINUATION` / `UNKNOWN_NON_NUMERIC_ROW`

### 末尾数値列

符号付き金額7セル＋任意の明細書頁を、行末に固定して読む。

```text
SIGNED_AMOUNT = (△)? \s* ([0-9]{1,3}(,[0-9]{3})+ | [0-9]+)
DETAIL_PAGE   = [^\s0-9,△] \s* [0-9]+  |  [0-9]+        # 例: 131, エ 9, 電 19, 原 1
TAIL          = SIGNED_AMOUNT (\s+ SIGNED_AMOUNT){6} (\s+ DETAIL_PAGE)? \s*$
```

- `△` は差額列に限らず、どのセルにも付きうる（例: `定員合理化に伴う経費` の前年度・要求額）。各セルを `*_sign_raw` / `*_amount_raw` に分けて保持する。
- 数値トークンが9個以上並ぶ行（head が数字で終わる）は `NUMERIC_TAIL_AMBIGUOUS_HEAD_ENDS_WITH_NUMBER` とする。
- **残る曖昧さ**: 数値トークンが8個のときは「7セル＋頁」と読む。名称が ASCII 数字で終わる「頁なしの行」とはテキストだけでは区別できない。FY2024 では名称中の ASCII 数字が0件（数字は全角）で、検算の不一致も0件のため、この読み方で列ずれは起きていない。

### 行頭（判定順）

| 順 | row_type | 文法 |
|---|---|---|
| 1 | `TOTAL` | 空白除去後が `組織計` / `所管計` / `会計計` |
| 2 | `DETAIL` | `<要求番号 [0-9]+> <NN‑NN> <名称>`（ハイフンは異体字を許容し、`code_raw` は原文のまま。FY2024 は全件 U+2011） |
| 3 | `CODE3` | `<[0-9]{3}> <名称>` |
| 4 | `HIER` | `<[0-9]{1,2}> <名称>` |

3桁の要求番号を持つ DETAIL を CODE3 と誤判定しないよう、DETAIL を CODE3 より先に判定する。`parse_status` は、頁の有無が行種別の想定（TOTAL は頁なし、それ以外は頁あり）と食い違う場合に `PARSED_UNEXPECTED_DETAIL_PAGE_PRESENCE` とする。

### 継続行

次をすべて満たす行を、直前の論理行の名称に連結する。

- 直前の物理行が `DETAIL` / `CODE3` の行、またはその継続行である（空行・ページ境界・HIER/TOTAL を挟まない）
- 字下げ（先頭の空白文字数）が、親行の名称の開始列と完全に一致する
- ASCII 数値トークンを含まない

`name_raw` は親行の名称と継続行（それぞれ前後の空白を除いたもの）を `\n` で連結した文字列、`name_compact` はそこから空白（半角・全角）をすべて除いて連結した文字列。`source_line_start` / `source_line_end` は、その論理行を構成するファイル内の物理行（1始まり）を指す。

## 出力（`data/work/budget-request-csv/2024/total-table/`）

| ファイル | 内容 |
|---|---|
| `total-table.csv` | 全 source の論理行（source のファイル名順、行順） |
| `sources/<slug>.csv` | 総表ブロックを持つ source ごとの CSV（同じ列構成） |
| `unresolved.csv` | `source_file, source_page, source_line_start, source_line_end, table_block_id, raw_text, reason` |
| `line-audit.csv` | 総表ページの非空物理行すべてのクラス（取りこぼしがないことの証跡） |
| `arithmetic-diagnostics.csv` | 検算（一般＋その他＝計、要求計−前年計＝増減、`△` を負として計算）の不一致。抽出値は書き換えない |
| `summary.json` | 件数集計、source 別・ブロック別の内訳、凍結 manifest とのページハッシュ照合結果 |
| `output-manifest.json` | 上記ファイルの SHA-256（決定性の確認用） |

main CSV の列: `source_file, source_page, source_line_start, source_line_end, table_block_id, row_index, row_type, request_no_raw, code_raw, name_raw, name_compact, {previous_general, previous_other, previous_total, request_general, request_other, request_total, difference}_{sign_raw, amount_raw}, detail_page_raw, parse_status`。`row_index` はブロック内の1始まりの連番。金額はカンマを含む原文表記のまま。

## 既知の後段課題（v0 の対象外）

- 同一の総表が別 source に重複して掲載されている（環境省と経済産業省のエネルギー対策特別会計2勘定）。`total-table.csv` は source 単位で出力するため、重複を除いていない。
- `CONTEXT` 行（所管・会計）と HIER/CODE3/DETAIL の意味的な階層の再構成。
- 金額の数値化（符号付き整数への変換）。
