# MOF 予算書アーカイブ由来の CSV（項・目・事項）

財務省の予算書アーカイブ（`data/download/mof.go.jp/archive/`）の原本から作った、素朴な CSV（原本の形のまま、人間が確認できる形）の一覧と作り方。

## 正の置き場

**`tests/fixtures/mof-archive-csv/{2024,2025,2025_teishutsu}/`** が唯一の正。各版に次の 6 ファイルがある（`manifest.json` に全ファイルの SHA-256）。

- `2024` = 令和6年度 当初予算（予算書）、`2025` = 令和7年度 成立後、`2025_teishutsu` = 令和7年度 提出時。

| ファイル | 単位 | 由来 | 行数 (2024 / 2025 / 2025_teishutsu) |
|---|---|---|---|
| `kou-general.csv` | 一般会計の項 | 公式 CSV（歳出）を項で集計 | 784 / 806 / 806 |
| `kou-special.csv` | 特別会計の項 | 同上 | 250 / 254 / 254 |
| `moku-general.csv` | 一般会計の目 | 公式 CSV（歳出） | 6,718 / 6,780 / 6,780 |
| `moku-special.csv` | 特別会計の目 | 同上 | 1,225 / 1,250 / 1,250 |
| `jikou-general.csv` | 一般会計の事項 | 予算書 XML（事項別内訳） | 1,256 / 1,287 / 1,287 |
| `jikou-special.csv` | 特別会計の事項 | 予算書 XML（歳出事項別内訳） | 360 / 365 / 365 |

項・目は公式 CSV（`DL{帳票ID}.zip` の `b.csv`）から、事項は XML から作る。項と事項は、項の（コード・名称）の集合が一致し、項ごとの合計も一致することを作成時に確認した（FY2024・FY2025 の両会計）。

## 列の読み方

- 金額はすべて**千円のまま**（円換算しない）。`△` は負（`-` で出力）。空欄は 0 ではない（前年度の列がない勘定は空欄）。
- 年度の文字は列名に入る（`令和6年度` / `令和7年度`）。一般会計の事項・項・目は `要求額`、特別会計は `予定額`。公式 CSV 由来の列名は元の表記のまま（例: 提出時の項は `…要求額の合計` で `(千円)` なし）。
- `jikou-*`: `source_file` `source_row` `source_page` で XML の行に戻れる。説明欄は含めない。
- `jikou-special`: `組織` は復興庁（東日本大震災復興）の 1 ファイルだけ埋まる。そのファイルでは `所管` はファイル内の所管の行（復興庁・総務省・財務省）で、公式 CSV の `共管所管名`・`共管組織名` と同じ組になる。他は目次の所管。
- `jikou-general`: `主要経費別分類コード` は 2 桁のコードで、意味は付けていない。

## 作り方

入力はすべて `data/download/mof.go.jp/archive/`（取得は `scripts/pipeline-v2/download-mof-archive.ts`）。出力は再生成して正の CSV とバイト単位で一致する。

```bash
# <version> は 2024 | 2025 | 2025_teishutsu
# 項・目（公式 CSV から）
npx tsx scripts/pipeline-v2/build-mof-archive-kou-moku-csv.ts <version> <out-dir>
# 事項（一般会計／特別会計）
npx tsx scripts/pipeline-v2/build-mof-jikou-csv.ts <version> <out-dir>
npx tsx scripts/pipeline-v2/build-mof-jikou-special-csv.ts <version> <out-dir>
```

事項の parser は `scripts/pipeline-v2/lib/` にある。
- 一般会計: `mof-budget-xml-items.ts`（FY2024 専用。評価 artifact の source hash で固定されているため変更しない）と、その複製に帳票ごとの値（帳票 ID・DOCTYPE・年度の文字）を渡せるようにした `mof-budget-xml-items-general.ts`。
- 特別会計: `mof-budget-xml-special-items.ts`。
- 入力境界は凍結した source set（XML の SHA-256 の一覧）。FY2024 の一般会計は `tests/fixtures/mof-budget-xml-parser-v0/2024/`、それ以外は `tests/fixtures/mof-xml-parser-general/`・`mof-xml-parser-special/`。想定外の構造は例外にし、silent skip しない。

### 特別会計 parser の行の文法

`歳出事項別内訳` のデータ行を、列の集合の完全一致で受理する（`1.4` / `3.2` は `1.1` / `3.1` の列位置の変種）。

| 行の種類 | 列の集合 |
|---|---|
| 項の開始行 | `{1.1\|1.4, 2.1, 3.1\|3.2, 4.1, 5.1, 7.1, 9.1, 11.1}`（項コード・項名・分類コード・事項名・予定額・前年度・比較増△減額・説明） |
| 事項の続き行 | `{3.1\|3.2, 4.1, 5.1, 7.1, 9.1, 11.1}` |
| 説明の続き行 | `{11.1}`（数えるだけ） |
| 所管・組織の行 | `{1.1}`、`{1.3}`、`{1.3, 5.1, 7.1, 9.1}`（復興庁のファイルだけ。header が `所管・組織・項`） |
| 前年度なしの項の開始行 | `{1.1, 2.1, 3.1, 4.1, 5.1, 7.1}`（新勘定のファイルだけ。`7.1` は説明） |

- 説明欄（`11.1`）は読まない。入れ子の表（食糧管理勘定）は無視し、後ろの行まで読む。
- 前年度の列がない行は、前年度・比較増△減額を空欄にする（0 にしない）。
- 上記以外の列の集合・header は例外で止める。所管・特別会計・勘定は、目次の祖先 chain（`…所管 > {特別会計} > 甲号歳入歳出予定計算書 > ({勘定}) > 歳出 事項別内訳`）から取る。
