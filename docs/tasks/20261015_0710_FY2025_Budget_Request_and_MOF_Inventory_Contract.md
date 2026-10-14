# FY2025 概算要求（TOC・総表・明細表）と MOF の基礎 inventory — 契約

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。記述だけで、仮説・判定・閾値は無い。照合・昇格・分類はしない。
背景: ここ数回の作業で「答えを出すスクリプト」は増えたが、「いまどのデータを何件持っているか」を固定した中間成果物が薄く、たとえば TOC の項の総数を即答できなかった（ChatGPT の指摘、ユーザー経由）。142 行の昇格条件を設計する前に、主要データの件数と分布を、スクリプトを再実行しなくても追える形で固定する。

## 方針
- inventory は恒久的な中間成果物（次の工程の source of truth の候補）として、`tests/fixtures/budget-request-inventory/2025/` に CSV と JSON で凍結する。集計の値は `summary.json`、明細は CSV。
- 件数の数え方（定義）は、数える前にここで決める。どの定義の数かを、`summary.json` のキー名に残す。
- 入力は凍結値と照合し、1つでも違えば何も出さずに STOP する。2回実行して出力が同一であること。

## 入力（凍結値）
- TOC: `data/work/budget-request-csv/2025/toc`（`output-hashes.json` `481e44e4…`）
- 総表: `…/total-table`（`output-manifest.json` `9fb163ae…`）
- 明細表: `…/detail-table`（`output-manifest.json` `0bdeeb37…`）
- 項の候補: `tests/fixtures/detail-table-toc-total-sections/2025/section-candidates.csv`（`cd5ea2ae…`）
- 明細表×MOF（#461）: `…/detail-table-mof-match`（`output-manifest.json` `5b17a565…`）
- 確認済みの項×MOF（#466）: `tests/fixtures/detail-table-mof-section-match/2025/triple-match.csv`（`2be288bc…`）
- MOF: `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（`9c0a878b…`、一般会計・当初予算）と、`public/data/mof-jikou-2025.json.gz`（`634a4166…`、全会計・当初と補正）。MOF の「目」はこの worktree の FY2025 のデータに無いので対象外。

## 成果物と定義
1. **`toc-entries.csv`**（TOC の全行）: `source, csv_row, role, code, name, request_no, page_ref, ctx_shokan, ctx_kaikei, ctx_kanjo, ctx_soshiki`。
   - `role`: 区分欄の先頭の `（組織）（項）（会計）（勘定）（所管）` のいずれか。印が無く要求番号があれば `事項`。それ以外は `other`（表題など）。
   - `code`・`name`: 印を除いた区分欄から、先頭のコード（数字とハイフン）と残りの名称（空白を除く）。
   - `ctx_*`: その行より前で最後に出た所管・会計・勘定・組織の名称。所管または会計が出たら組織と勘定を、勘定が出たら組織を消す（#463 の試作と同じ）。
2. **`by-source.csv`**（source ごとの台帳、131 PDF）: TOC の role 別行数、総表の row_type 別行数、明細表の row_type 別行数、明細表の DETAIL 行の範囲別（一般会計・特別会計・CONTEXT なし）の行数、項の候補の status 別の件数。
3. **`detail-items.csv`**（明細表の全 DETAIL 行、1,869 行）: `source, row_index, scope, ministry, code, name, request_no, source_page, zero_amount, request_same_name_rows, confirmed_section_code, confirmed_section_name, section_status, x_section_agrees, k2_status, mof_same_name_records`。
   - `scope`: `general` / `special` / `no_context`。`ministry`: 一般会計のとき、CONTEXT の2桁の所管の名称。
   - `zero_amount`: 事項の行から次の DETAIL 行の直前までの行の、前年度予算額と要求額がすべて空欄か 0。
   - `request_same_name_rows`: 一般会計で、同じ所管・同じ事項名の DETAIL 行の数（自分を含む）。特別会計・CONTEXT なしは空。
   - `confirmed_section_*`・`section_status`: #465 の項の候補（TOC＋総表）。`x_section_agrees`: 明細表の X（#452 の規則）と一致するか（#465 の定義）。
   - `k2_status`: #461 の status。`mof_same_name_records`: 一般会計で、MOF の同じ所管・同じ事項名の記録の数。
4. **`mof-sections.csv`**（MOF の項、一般会計・当初予算）: `ministry, organization, sectionCode, sectionName, jikou_records`。
5. **`summary.json`**: 次の件数を、定義つきで。
   - TOC: role 別の行数。項の件数は3つの定義で出す（行数 / `(source, ctx, code, name)` の一意 / `(code, name)` の一意）。
   - 総表: row_type 別の件数。明細表: row_type 別の件数、DETAIL の範囲別の件数。
   - 段階の残り方: TOC の事項 → 総表の DETAIL → 明細表の DETAIL → 項の候補あり → X と一致、の件数。
   - 同名事項の重複: 概算要求（一般会計）の同じ所管・事項名の行数の分布（1 / 2 / 3+）と、MOF の同じ所管・事項名の記録数の分布。
   - 金額ゼロの事項: 範囲別の件数と、#461 の status 別の件数。
   - MOF: 所管・組織・項（3つの定義）・事項の件数、会計別・予算種別（当初・補正）別の事項数。

## 範囲外
- 項の昇格条件・分類・照合の変更。MOF の目。FY2024 の inventory（必要になれば同じスクリプトに `--year` を足す）。
