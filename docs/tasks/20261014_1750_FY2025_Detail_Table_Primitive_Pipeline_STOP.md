# FY2025 明細表 primitive pipeline の無変更適用 — STOP（コード変更が必要）

状態: STOP（実行していない。出力なし）。結論: **FY2024 の plain text → 明細表 CSV pipeline は、コードを変えずには FY2025 に適用できない。** 入口が FY2024 に固定されていることに加え、parser の規則自体にも年度の文字列（「６年度」）が入っている。事前に決めた STOP 条件（「コード変更が必要」）に当たるので、ここで研究判断に戻す。MOF との照合は何も計算していない。

## 分かったこと（コードを読んだ結果。FY2025 の PDF は書式を1頁見ただけ）
1. **入口（I/O）が FY2024 固定**
   - `build-budget-request-plain-text.ts`: `getBudgetRequestManifest(2024)` を直書き。入力の検証に FY2024 の凍結 raw-text manifest（`tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json`）を使う。この manifest は PDF hash・頁数・**頁ごとの text hash** を持ち、件数が違えば throw する。FY2025 版の凍結物は無い。出力先も `.../2024`。
   - `build-budget-request-detail-table-csv.ts`: zip の entry パターン `budget-request-plain-text/2024/*.txt`、同じ FY2024 raw-text manifest、出力先 `.../2024/detail-table` を直書き。引数で変えられるのは zip と出力先だけ。
2. **parser の規則に年度の文字列がある**（`lib/budget-request-detail-table.ts`）
   - `HEADER_VOCABULARY`（表頭の行を `TABLE_HEADER` と判定する正規表現）が「６年度」を含む。CSV の列名も `６年度概算要求額`。
   - FY2025 の表頭は「要求番号｜事項｜前年度予算額｜**７年度**概算要求額｜対前年度比較増△減｜備考」（防衛省の PDF の148頁で確認）。このままだと、FY2025 の表頭の行は `TABLE_HEADER` にならない。その行が何として扱われるか、header window（#446）に影響するかは、実行していないので分からない。
   - 明細表の頁の判定（`DETAIL_HEADER_SIGNATURE`: 事項・前年度・比較増・備考・予算額・概算要求額）と、列の境界の判定には年度が入っていない。
   - 総表の parser（`lib/budget-request-total-table.ts`）にも同じ「６年度」がある（今回の経路では使わない見込み）。

## 選択肢（研究判断。どれも未着手）
- **A. 入口の年度だけ引数にする（parser は1文字も変えない）。**
  - 対象年度の manifest を引数で選び、PDF の検証には #455 の corpus 凍結を使う。頁ごとの text hash は、FY2025 では新しく作って凍結する。
  - FY2024 の回帰: 引数を FY2024 にしたときの出力が、凍結済み `output-manifest.json`（`7989885b…`）とバイト単位で同じであること。
  - 「６年度」は残したまま FY2025 に適用し、表頭の行がどう扱われるかを primitive の記述統計として観測する。結果を見てから規則は変えない。
  - 「primitive の規則を変えない」原則に最も忠実。
- **B. A に加えて、年度の文字列を一般化する**（例: `[０-９]+年度`、または対象年度から作る）。
  - parser の規則の変更になるので、FY2025 を見る前に事前登録し、FY2024 で出力が変わらないこと（同じ回帰条件）を確かめる。
  - FY2025 の表頭を見たうえでの変更なので、厳密には FY2025 を見た後の調整にあたる。ただし年度の数字だけで、表の内容には関わらない。
- **C. FY2025 の validation は見送り、別の hold-out（FY2024 内の別所管など）を検討する。**

推奨: **A。** 「６年度」の影響は、MOF 照合の前に primitive の件数（`TABLE_HEADER` やどの分類にも入らない行の数など）で観測できる。致命的だと分かってから、B を新しい事前登録として扱えばよい。
