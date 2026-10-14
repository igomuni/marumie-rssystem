# FY2025 の TOC・総表 CSV（入口の年度化だけ）— 結果

状態: **一部 STOP。** 入口の年度化と FY2024 の回帰はすべて通過した。FY2025 は raw text・頁分類・構造一覧まで凍結できた。しかし **TOC CSV**（回転頁が1つあり、全体が書き出されない）と **総表 CSV**（総表の頁を1枚も見つけられない）は、事前登録の STOP 条件（lib の変更が必要）に当たった。項の特定・照合はしていない。

事前登録: `docs/tasks/20261014_2058_FY2025_TOC_Total_Table_CSV_Preregistration.md`（commit `c0890e6`）。

## 入口の変更（lib の差分 0）
- `build-budget-request-raw-text.ts`、`build-budget-request-page-classification.ts`、`analyze-budget-request-cover-toc-structure.ts`、`build-budget-request-total-table-csv.ts` に `--year=`（既定 2024）を追加した。
- 事前登録に無かった追加が2点ある（どちらも I/O だけ）:
  - 頁分類: 凍結先のディレクトリを作る1行（FY2024 では既にあったため不要だった）。
  - 構造一覧: `structure-inventory.json` を `data/work/budget-request-cover-toc-structure/{year}/` にも常に書く（`--freeze-fixture` なしでは書き出さない作りだったため、FY2024 の回帰を比べられなかった）。
- `build-budget-request-toc-pdf-native-csv.ts` は変えていない。

## FY2024 の回帰（すべて通過）

| 段 | 比較 | 結果 |
|---|---|---|
| raw text | 文書ごとの記録・corpus digest `7c6d2dce…` | 一致 |
| 頁分類 | digest `39464fc7…`・conformance の不一致・作業ファイル | 一致・0・同一 |
| 構造一覧 | 凍結 fixture `d2b2311c…` | バイト単位で同じ |
| TOC | `output-hashes.json` `17430e42…` | バイト単位で同じ |
| 総表 | `output-manifest.json` `804ecec5…` | バイト単位で同じ |

- raw text の `manifestFiles` のうち `budget-request-manifest.ts` の hash だけが凍結値と違う。これは #454 で FY2025 の import を足したときにファイルが変わったためで、今回の変更とは関係しない（`fy2024-budget-request-manifest.ts` の hash と、抽出結果はすべて一致）。

## FY2025

| 段 | 結果 | 凍結値 |
|---|---|---|
| raw text | 131 PDF / 9,586 頁、すべて EXTRACTED。2回同一 | `tests/fixtures/budget-request-raw-text/2025/raw-text-manifest.json` `a4506a89…`（corpus digest `8b5fff1b…`） |
| 頁分類 | 目次 84・表紙 71・総表 173・明細表 9,051・定員表 59 ほか。text の無い頁 135（Phase A が無いので、すべて UNRESOLVED_EMPTY）、UNRESOLVED 6。2回同一 | `…/page-classification/2025/…-manifest.json` `56a4c7b1…`（digest `9e42df5d…`） |
| 構造一覧 | 目次 84 頁（56 PDF）、表紙 71。2回同一 | `…/cover-toc-structure/2025/structure-inventory.json` `8bb8634d…` |
| **TOC CSV** | **STOP。** 宮内庁 `r07-03.pdf` の目次頁（3頁）が90度回転していて、lib が「回転ページは未対応」として throw する。runner は1本でも失敗すると何も書き出さない。ほかの55本ではエラーは出ていない | なし |
| **総表 CSV** | **STOP（実質）。** 実行は通ったが、総表の頁が0頁・0行。lib の総表頁の判定（`TOTAL_TABLE_HEADER_SIGNATURE`）が「６年度概算要求額」を必須の語にしているため、FY2025（「７年度」）の頁は1枚も総表と判定されない。2回同一 | なし（凍結しない） |

- 単体テスト（頁分類・構造一覧・総表・TOC、16 ファイル 121 件）は通過。lint のエラーは 0。

## 判断が要ること
1. **総表:** 年度の文字列を一般化する（`TOTAL_TABLE_HEADER_SIGNATURE`・`HEADER_VOCABULARY`・列名の「６年度」を、対象年度から作るか `[０-９]+年度` にする）。lib の規則の変更（案 B）なので、FY2025 の総表を見る前に事前登録し、FY2024 で出力がバイト単位で変わらないことを回帰条件にする。明細表の `HEADER_VOCABULARY` も同じ扱いにするかは、あわせて決める。
2. **TOC:** (a) runner に「処理できなかった source を記録して、残りを書き出す」選択肢を足す（I/O の変更。FY2024 はエラー 0 なので出力は変わらない。宮内庁の1本は未変換として残る）か、(b) lib で回転頁に対応する（規則の変更）。推奨は (a)。
