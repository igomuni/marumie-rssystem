# 概算要求 表紙（Cover）→ CSV

概算要求書の表紙（文書の先頭ページ）を CSV にする。表紙には、所管・会計の見出し（`05 内閣所管（内閣官房）`、`9101 東日本大震災復興特別会計（内閣）`）、表題（`令和６年度歳出概算要求書`）、目次の行（総表・明細表の開始ページ、（組織）または（会計）の行と開始ページ）がある。TOC（項・事項を含む目次）とは別のページ。

- 実装: `scripts/pipeline-v2/build-budget-request-cover-csv.ts`。読み取りは凍結済みの Cover 構造 parser（`scripts/pipeline-v2/lib/budget-request-cover-structure.ts`）。値の補完・推測はしない。
- 入力: plain text（`data/work/budget-request-plain-text/{year}/`）。表紙のページは、Cover／TOC の構造 inventory（`tests/fixtures/budget-request-cover-toc-structure/{year}/structure-inventory.json`）の COVER 分類。
- 出力（git 管理）: `tests/fixtures/budget-request-csv/{year}/cover/`。

```bash
npx tsx scripts/pipeline-v2/build-budget-request-cover-csv.ts <2024|2025> [outDir] [inputDir]
```

## 出力
| ファイル | 内容 |
|---|---|
| `sources/{slug}.csv` | PDF ごとの表紙の行。列: `source_page`（物理ページ）, `entry_index`, `kind`, `ordinal`, `marker`, `code`, `name`, `page_ref`, `status` |
| `unclassified.csv` | どの項目にも分類できなかった行（現在は 0 行） |
| `summary.json` | 表紙のページ数・行数・状態の件数 |

`kind`: `HEADER`（所管・会計の見出し。`code` が先頭の番号、`name` が残り）、`TITLE`（表題）、`SECTION`（`1. …総表`、`2. …明細表` など。`ordinal`＝`1.`、`name`＝ラベル、`page_ref`＝印刷ページ）、`SCOPE`（`（組織）010 内閣官房`、`（会計）01 …`。`marker`＝`（組織）`など、`code`＝番号、`name`、`page_ref`）。`name` は空白（均等割付）を除いて出力する。

## 現在の結果
| | FY2024 | FY2025 |
|---|---:|---:|
| 表紙のページ（PDF） | 69（59） | 71（61） |
| 行 | 413 | 434 |
| 種類 | HEADER 69、TITLE 69、SECTION 163、SCOPE 112（組織 83、会計 29） | HEADER 71、TITLE 71、SECTION 170、SCOPE 122（組織 89、会計 33） |
| 状態 | 全ページ RESOLVED、未分類の行 0 | 同左 |

- 表紙の SCOPE（組織・会計）の行は、同じ PDF に TOC がある場合、その TOC の（組織）／（会計）の見出しと**全件一致**した（FY2024 98／98、FY2025 106／106）。
- 内閣官房・内閣府の表紙には、TOC がなく、表紙に（組織）または（会計）の行だけがある（項・事項の行はない）。

## 表紙・目次の CSV までの作り方（plain text 入力）
頁分類と構造 inventory（表紙・目次のページ）は、plain text（`pdftotext -layout -enc UTF-8` の出力。ページの境目は form feed）から page 単位の入力を作る。かつては同じ出力をページごとの JSONL に分けた Raw Text を別に作っていたが、廃止した（全年度で、頁分類のダイジェストと構造 inventory の `summary`・`perPdf`・`pages` が Raw Text 入力と一致することを確かめてから削除した。ページごとのハッシュも、FY2024 の 9,899 頁・FY2025 の 9,586 頁とも plain text と一致）。

```bash
npx tsx scripts/pipeline-v2/build-budget-request-plain-text.ts --year=<年度>      # plain-text-manifest.json も data/work に出る。git 管理は tests/fixtures/budget-request-plain-text/{年度}/
npx tsx scripts/pipeline-v2/build-budget-request-page-classification.ts --year=<年度> --freeze-fixture
npx tsx scripts/pipeline-v2/analyze-budget-request-cover-toc-structure.ts --year=<年度> --freeze-fixture
npx tsx scripts/pipeline-v2/build-budget-request-cover-csv.ts <年度>
```

入力は、`tests/fixtures/budget-request-plain-text/{年度}/plain-text-manifest.json`（git 管理）と `data/work/budget-request-plain-text/{年度}/`。PDF の集合と SHA-256・頁数は `tests/fixtures/budget-request-pdf-corpus/{年度}/pdf-corpus-freeze.json` が決める。後から取得した PDF は、この記録の `documents` に `addedAfterFreeze` つきで追記して（`frozenInput` の件数・頁数・ダイジェストを更新して）、plain text 以降を作り直す。FY2024 の頁分類は、Raw Text の時代の凍結ダイジェスト（`39464fc7…`、82 PDF）から、142 PDF（凍結後の 60 PDF を統合）の新しいダイジェストになった。
