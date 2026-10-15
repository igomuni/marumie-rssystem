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

項・目は公式 CSV（`DL{帳票ID}.zip` の `b.csv`）から、事項は XML から作る。項と事項は、項の（コード・名称）の集合が一致し、項ごとの合計も一致することを確認済み（FY2024・FY2025 の両会計）。

## 列の読み方

- 金額はすべて**千円のまま**（円換算しない）。`△` は負（`-` で出力）。空欄は 0 ではない（前年度の列がない勘定は空欄）。
- 年度の文字は列名に入る（`令和6年度` / `令和7年度`）。一般会計の事項・項・目は `要求額`、特別会計は `予定額`。公式 CSV 由来の列名は元の表記のまま（例: 提出時の項は `…要求額の合計` で `(千円)` なし）。
- `jikou-*`: `source_file` `source_row` `source_page` で XML の行に戻れる。説明欄は含めない。
- `jikou-special`: `組織` は復興庁（東日本大震災復興）の 1 ファイルだけ埋まる。そのファイルでは `所管` はファイル内の所管の行（復興庁・総務省・財務省）で、公式 CSV の `共管所管名`・`共管組織名` と同じ組になる。他は目次の所管。
- `jikou-general`: `主要経費別分類コード` は 2 桁のコードで、意味は付けていない。

## 作り方

```bash
# 項・目（公式 CSV から）
python3 -I scripts/research/build-mof-archive-kou-moku-csv.py <out-root>
# 事項（一般会計）。第1引数は 2024 | 2025 | 2025_teishutsu
npx tsx scripts/pipeline-v2/build-mof-jikou-csv.ts <version> <out-dir>
# 事項（特別会計）
npx tsx scripts/pipeline-v2/build-mof-jikou-special-csv.ts <version> <out-dir>
# 整合の確認
python3 -I scripts/research/check-mof-archive-csv-consistency.py
```

parser は `scripts/pipeline-v2/lib/` にある。一般会計は `mof-budget-xml-items.ts`（FY2024 専用で、評価 artifact の hash で凍結。変更しない）と、その複製に帳票ごとの値（帳票 ID・DOCTYPE・年度の文字）を渡せるようにした `mof-budget-xml-items-general.ts`。特別会計は `mof-budget-xml-special-items.ts`。入力は凍結した source set（XML の SHA-256 の一覧）で、想定外の構造は例外にする（silent skip なし）。

## 他の fixtures ディレクトリ（作成の根拠・中間成果物。正ではない）

| ディレクトリ | 中身 |
|---|---|
| `mof-xml-structure-inventory/` | 全 XML の構造の記述（ファイルごとの SHA-256・見出し・行の列構成・目次の chain） |
| `mof-xml-parser-general/` | 一般会計 FY2025 の source set と実行記録（`jikou-general.csv` は `mof-archive-csv/` の複製） |
| `mof-xml-parser-special/` | 特別会計の source set と実行記録・確認結果（`jikou-special.csv` は `mof-archive-csv/` の複製） |
| `mof-special-row-classes/`、`mof-special-item-starts/` | 特別会計の行の種類の実例と、項の開始行の確認 |
| `mof-budget-xml-parser-v0/` | 一般会計 FY2024 の parser v0 の凍結 fixture（source set・reference projection・評価） |

複製の CSV を直接読む処理は、正の置き場（`mof-archive-csv/`）に切り替えてよい。
