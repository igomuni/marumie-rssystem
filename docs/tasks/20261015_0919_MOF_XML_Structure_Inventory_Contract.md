# MOF 予算書 XML の構造 inventory（parser 一般化の前段）— 契約

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。記述だけで、parser は通さない。仮説・閾値は無い。
背景: ユーザーが、事項の parser v0（FY2024 の一般会計に固定）の一般化を指示した（#471 の次）。新しい XML（FY2024 の特別会計、FY2025 の一般会計・特別会計の提出時と成立後）の構造をまだ見ていない状態で、規則を事前登録するのは無理があるので、先に構造の inventory を固定する（「研究の前に inventory」の方針）。parser の規則と列は、この結果を見たあとの別の事前登録で決める。

## 対象（`data/download/mof.go.jp/archive/` 内の XML の帳票）
| 帳票 | 場所 | 位置づけ |
|---|---|---|
| FY2024 一般会計 `202411001` | `2024/2024/{html,xml}` | 基準（parser v0 の対象。inventory の読み取りが、既知の値と合うことの確認に使う） |
| FY2024 特別会計 `202412001` | `2024/2024/{html,xml}` | 新規 |
| FY2025 一般会計 `202511001` 成立後（修正成立） | `2025/2025/{html,xml}` | 新規 |
| FY2025 特別会計 `202512001` 成立後 | `2025/2025/{html,xml}` | 新規 |
| FY2025 一般会計 `202511001` 提出時 | `2025/2025_teishutsu/{html,xml}` | 新規 |
| FY2025 特別会計 `202512001` 提出時 | `2025/2025_teishutsu/{html,xml}` | 新規 |

取得は `download-mof-archive.ts --xml=` による。取得スクリプトの provenance は、FY2025 の提出時と成立後で保存先が衝突する（同じ帳票 ID）ため、各帳票の全ファイル（目次 HTML・Main HTML・XML）の SHA-256 を、取得後に自分で数えて残す。

## 成果物（`tests/fixtures/mof-xml-structure-inventory/`）
1. **`files.csv`**（XML ファイルごと）: `document, version, file, sha256, bytes, encoding_declared, doctype, root, title_for_list, running_title, table_count, header_signature, row_class_signature`。
   - `header_signature`: `<header>` の `clm` の `id` の「行番号・列開始番号」と、空白を除いたテキストを、`行.列=テキスト` で `;` でつないだもの。
   - `row_class_signature`: データ行（`p頁-行.n`）ごとの列の集合（`列.m` の列番号をソートして `,` でつないだもの）の種類と件数（`集合:件数` を `|` でつないだもの）。
2. **`summary.json`**: 帳票ごとに、ファイル数、`title_for_list` の種類と件数、DOCTYPE の種類、`header_signature` の種類と件数（どの `title_for_list` のファイルか）、`row_class_signature` の種類の集合と、行の件数の合計。
3. **`menu-chains.csv`**（帳票ごとの目次）: `document, version, file, chain`（`readMenuAncestorChains` と同じ規則での祖先の列。`>` でつなぐ）。事項の表が属する所管・組織・会計・勘定の階層を見るため。
4. **`documents.json`**: 帳票ごとの Main HTML・目次 HTML の SHA-256、ファイル数、合計バイト数。

## 方法と確認
- 読み取りは、parser とは独立の簡単な読み取り（正規表現）で行い、XML の中身を解釈しない。
- 基準の確認: FY2024 一般会計について、表題が `〔組織別事項別内訳〕` のファイルが 94、その他が 234、事項表の行が parser v0 の出力（事項 1,256、項の開始 784、小計 88、説明だけの行 32）と合う範囲の件数になること。合わなければ、読み取りが間違っている（STOP）。
- 2回実行して出力が同一であること。

## 範囲外
- parser の一般化（別の事前登録）、事項の CSV、`b.csv` との照合、政府関係機関・補正・決算。
