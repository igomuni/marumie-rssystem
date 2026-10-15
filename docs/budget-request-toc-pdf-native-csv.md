# 概算要求 目次（TOC）PDF → CSV（PDF-native v0）

概算要求書の目次ページ（`要求番号 / 区分 / ページ` の表）を、PDF の text layer（pdf.js の SourceToken と位置）だけから CSV にする。Raw Text（pdftotext 出力）・OCR・他資料は使わない。**根拠が揃った項目だけを出し、判断できないものは捨てずに `unresolved.csv` へ理由付きで残す**（全ページを完走させることを目的にしない）。

- 実装: `scripts/pipeline-v2/lib/budget-request-toc-pdf-native-csv.ts`（pure）、`scripts/pipeline-v2/build-budget-request-toc-pdf-native-csv.ts`（runner）
- テスト: `scripts/pipeline-v2/lib/budget-request-toc-pdf-native-csv.test.ts`（合成 token のコード検証。意味の正しさを示すものではない）
- 旧 TOC v0（`budget-request-plain-text-csv.ts`、Raw Text 由来）とは独立。置き換えもしていない。

```bash
npx tsx scripts/pipeline-v2/build-budget-request-toc-pdf-native-csv.ts \
  --source-root=<data/download に相当するディレクトリ> [--out-dir=<出力先>] [--inventory=<structure-inventory.json>] [--allow-source-errors]
# npm run pipeline:v2:build:budget-request-toc-pdf-native-csv -- --source-root=... --out-dir=...
```

既定では、処理できない PDF が1本でもあれば何も書き出さない。`--allow-source-errors` を付けると、その PDF を `source-errors.csv`（`localPdfPath, message`）に記録し、残りの PDF の成果物を書き出す。FY2025 では宮内庁 `r07-03.pdf` の目次頁が90度回転していて未対応のため、このオプションで実行している。年度ごとの入力は `--inventory=tests/fixtures/budget-request-cover-toc-structure/{year}/structure-inventory.json` で切り替える。

- 入力集合: 既定は `tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json` の `classifierPageType=TOC`（82物理ページ・55 PDF）。`localPdfPath` の先頭 `data/download/` を `--source-root` に読み替える。リポジトリルートから実行する（ソースハッシュを相対パスで記録するため）。
- PDF は読み取り専用。SHA-256 が inventory と一致しない PDF が1つでもあれば、成果物を書かずに停止する。`--out-dir` が `--source-root` の中なら停止する。
- 経過時間は標準出力のみで、成果物に入れない。同じ入力・同じコードなら成果物はバイト一致する。

`--out-dir` を省略すると、実行ディレクトリからの相対パス `tests/fixtures/budget-request-csv/2024/toc/` に出力する。任意の出力先を明示指定することもできる。

## 出力

| ファイル | 内容 |
|---|---|
| `sources/<slug>.csv` | main CSV。列は `要求番号,区分,ページ` のみ。PDF ごと（ページ順 → 左列 → 右列、列内は上から下）。slug は `deterministicPdfSlug`（`data/download/` を除き `/`→`__`） |
| `entry-provenance.csv` | main CSV の各行の根拠。`entry_id`、`csv_row`（その source CSV の行番号、1始まり）、`pdf_sha256`、`physical_page`、`pdfjs_version`、`extraction_options_id`、`side`、`row_id`、`shape`、要求番号/区分/ページ参照を構成した item の index |
| `unresolved.csv` | 出さなかったものの audit。`kind`、`side`、`item_indexes`（x 昇順）、`raw_texts_json`（原文）、保留の場合は `candidate_owner_row_id`（候補にすぎない）、`detail` |
| `token-ledger.csv` | 全 item（pdf.js の text item。空白のみ・空文字を含む）の行き先: `BLANK` / `HEADER_ZONE` / `ENTRY` / `UNRESOLVED` と理由、`entry_id` / `audit_id` |
| `page-summary.csv`, `sources.csv` | ページ別・PDF別の件数、列の根拠の有無、物理行数 |
| `summary.json`, `output-hashes.json` | 件数・パラメータ・入力ハッシュ（inventory、各 PDF の SHA-256、コードの SHA-256）・出力ハッシュ |

**item の識別**: `(PDF SHA-256, 物理ページ, pdf.js 版, 抽出オプションID, pdf.js が返した text item の index)`。抽出オプションIDは `pdfjs-5.4.296-disableNormalization-true-cmaps-standardfonts-verbosity0-v1`（P6 の occurrence tuple と同じ綴り。P6 の 17 ページ・6,655 item について、この抽出で (PDF, ページ, index) ごとの text と transform が完全に一致することを確認した）。index は抽出器・版・オプション内の識別で、PDF の永続的な glyph ID ではない。

ID: `row_id = R-<sha8>-p<page>-<l|r><列内の行番号>`、`entry_id = E-…`（同じ形）、`audit_id = A-<sha8>-p<page>-<連番>`。

## 方法

1. **列の根拠**: ヘッダ帯の `要求` がちょうど2個（同じ高さ）、`ページ` がちょうど2個で、左から `要求,ページ,要求,ページ` の順のときだけ列を確定する。境界 = 左の `ページ` の右端と右の `要求` の左端の中点。満たさないページは、本文を左右に分けられないので全 item を `NO_COLUMN_EVIDENCE` にする（物理行ごとに audit。意味上の項目ではない）。
2. **見出し帯の棄却**: ヘッダ帯（`要求 番号 区 分 ページ`）の下端以上にある item は `HEADER_ZONE`（表題・ノンブル・所管名など）。タイトルとページ番号を近接だけで組にしない。
3. **列分離を先に**: 本文 item を境界で左右に分け、列ごとに TableGeometry の `clusterPhysicalRows`（y のみで行を作る既存 API）で物理行にする。左右の同じ高さの item は別の行になる。境界をまたぐ item は `COLUMN_STRADDLE` にし、**同じ高さ（行クラスタリングと同じ許容差）の左右の行も出さない**（またぐ item が区分の一部かもしれないため）。幾何行は意味上の項目ではない。
4. **行内の並び**: pdf.js の返却順は読み順ではないので、`bbox.xMin` 昇順（同値は index 昇順）。
5. **ページ参照**: ヘッダ `ページ` の右端揃いの帯にある item だけ。帯に1 item（`^(エ|電|原|国\(国\)|国)[ \t]?\d{1,4}$` または数字のみ）、または 接頭辞 item + 数字 item（隣接）。接頭辞の綴りは原文のまま連結する（別 item なら `エ` + `12` → `エ12`、1 item の `国(国)13` や `国 1` はそのまま）。帯に解釈できない item が混ざる行は `PAGE_REF_AMBIGUOUS`。
6. **要求番号**: 先頭の数字のみ item で、中心がヘッダ `要求` の中心付近にあるもの。ほかは所管階層などを解決しない。
7. **区分**: 要求番号・ページ参照以外の item。`（組織）（項）…` 見出しとコード（`NN-NN`、3桁、見出し直後の数字）は前後に ASCII 空白1個、タイトル item 同士は原文のまま連結（空白のみの item は使わない。タイトル内の空白は item の中にあればそのまま残る）。
8. **出す条件**: 列が確定、ページ参照が1つ、区分にタイトル文字列があり、構造（要求番号・見出し・コードのいずれか、または 番号なしの `タイトル + ページ` 型）がある。
9. **継続の保留**: 折り返しタイトルの続き（要求番号・コード・ページ参照を持たない行）が前の行の続きだと独立に裏付ける根拠は PDF の位置だけからは得られないので、**結合しない**。
   - ページ付きの行の次の行が断片行 → その行を出さず `HOLD_INCOMPLETE_TITLE`（断片行は `UNOWNED_FRAGMENT`。互いを `candidate_owner_row_id` に記録。所有関係の判断ではない）。
   - ページ付きの行の次の行が、番号のない `NO_PAGE_REF` / `NO_TITLE_TEXT` 行 → その行も `HOLD_INCOMPLETE_TITLE`（続きが見かけ上コード/見出しで始まる場合）。番号を持つ次の行なら保留しない。
   - 番号・コードのない `タイトル + ページ` 行の直前が、断片行、または未完の構造行（`NO_PAGE_REF` / `NO_TITLE_TEXT`。ページ参照が折り返しの最終行にある場合）→ `HOLD_POSSIBLE_CONTINUATION_TAIL`。
   - ページ参照だけの行は `PAGE_REF_WITHOUT_TITLE`、構造行でページ参照がない行は `NO_PAGE_REF`（ページ参照が少し高さのずれた別の行に出る場合を含む。近接では組にしない）。

しきい値はすべてページの fontSize 中央値に対する相対値で、`summary.json` の `parameters` に残す。

## FY2024 の実際の適用範囲（82ページ・55 PDF）

| | |
|---|---|
| 入力 | 82ページ / 55 PDF。全 PDF の SHA-256 が inventory と一致 |
| 列の根拠 | 82 / 82 ページで確定（`要求` 見出しが2個、`ページ` が2個） |
| item | 26,317（空白・空文字 12,859、見出し帯 1,835、entry 11,327、unresolved 296） |
| main CSV の行 | 2,864（`NUMBERED` 1,563、`MARKER` 1,151、`TITLE_PAGE` 136、`CODE` 14） |
| unresolved の audit | 116（`UNOWNED_FRAGMENT` 57、`HOLD_INCOMPLETE_TITLE` 56、`PAGE_REF_WITHOUT_TITLE` 2、`NO_PAGE_REF` 1）。27ページ・18 PDF に現れる |
| 物理行（列ごと） | 左 1,956 / 右 1,024（意味上の項目数ではない） |

これは**パーサの出力の件数**で、正解率・再現率ではない。held-out 評価はしていない。

## 限界（読む前に）

- **意味の正しさは未検証**。コードのテスト（合成 token）は通っているが、PDF の全項目が正しいかは検証していない。実 PDF の数ページを目視で突き合わせただけである。
- 折り返しで2行になったタイトルは**出ない**（今回 56 件）。続き行の特定は別の根拠が要る。`unresolved.csv` の候補は所有関係の判断ではない。
- ページ参照が行の高さと数 pt ずれて別の物理行になるページ（NDL p2 など）は、`PAGE_REF_WITHOUT_TITLE` と `NO_PAGE_REF` になり、近くのタイトルとは組にしない。取りこぼしになる。
- 要求番号が空の行（見出し行・表紙型の `タイトル + ページ` 行）は正常な行で、要求番号を補わない。
- 見出し（組織/項）の階層・所管の親子関係は解決しない。区分の文字列は pdf.js が返した文字の連結で、空白のみの item の位置に実際の空白があったかは区別しない。
- 回転ページは未対応（SourceToken の制約）。ヘッダの形（`要求,ページ,要求,ページ` の2段組）以外の目次様式は対象外で、その場合は列の根拠なしとして全 item が unresolved になる。
- 過去の Raw Text コーパスは使っていない。provenance は PDF の SHA-256・物理ページ・pdf.js の item index だけである。
