# 総表の年度の文字列の一般化と、TOC の source エラーの扱い — preregistration（#464 の追補）

状態: **契約（実装・実行の前に固定）。** 結果は #464 の結果 doc に追記する。FY2025 の総表の中身はまだ見ていない（#464 では総表の頁が0頁だったことしか分かっていない）。
前提: #464 で TOC と総表が STOP した。ユーザーが lib の変更を許可した。

## 1. 総表の lib（`lib/budget-request-total-table.ts`）
年度の数字が「６」で直書きされている3か所だけを、年度に依存しない形にする。ほかの規則は変えない。
- 頁の判定 `TOTAL_TABLE_HEADER_SIGNATURE`: 必須の語「６年度概算要求額」を、正規表現 `[０-９]{1,2}年度概算要求額` に合うこと、に変える（空白を除いた頁の text に対して）。
- 表頭の語彙 `HEADER_VOCABULARY`: `６年度概算要求額` を `[０-９]{1,2}年度概算要求額` に変える。
- 表題 `TOTAL_TABLE_TITLE`: `[６6]` を `[０-９0-9]{1,2}` に変える。
- CSV の列名: `６年度概算要求額_…` の「６」を、`renderRowsCsv` などの引数（既定「６」）で渡せるようにする。runner は年度から全角の数字（2025 → 「７」）を作って渡す。
- 回帰条件: FY2024 の総表の `output-manifest.json` が既存（`804ecec5…`）とバイト単位で同じ。既存の単体テストがそのまま通る。満たさなければ STOP。
- 明細表の lib は変えない（FY2025 の明細表 CSV は #459 で凍結され、#460・#461 の入力になっているため）。

## 2. TOC の runner（`build-budget-request-toc-pdf-native-csv.ts`）
- `--allow-source-errors` を足す（既定はオフ）。オンのときは、処理できなかった source を `source-errors.csv`（`localPdfPath, message`）に書き、`output-hashes.json` にも含め、残りの source の成果物を書き出す。オフのときの挙動は今と同じ。
- lib（回転頁）は変えない。FY2025 の宮内庁 `r07-03.pdf` は未変換として残す。
- 回帰条件: FY2024（オプションなし）の `output-hashes.json` が既存（`17430e42…`）とバイト単位で同じ。

## 3. FY2025 の実行
- TOC: `--allow-source-errors` で2回実行し、出力が同一であること。source エラーは宮内庁の1本だけであること（ほかに出たら STOP）。
- 総表: 2回実行し、出力が同一であること。
- 記述してよいもの: TOC の頁数・entry 数・unresolved、総表の頁数・行種別・unresolved・算術診断。結果を見て規則を変えない。
- 凍結: TOC の `output-hashes.json`、総表の `output-manifest.json`（`tests/fixtures/` に commit）。
