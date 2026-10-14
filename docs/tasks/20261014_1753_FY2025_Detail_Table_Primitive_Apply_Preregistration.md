# FY2025 明細表 primitive の適用（案 A: 入口の年度だけ引数化）— preregistration

状態: **契約（実装・実行の前に固定）。** 結果は別の task doc に書く。MOF との照合（J1 候補数、`sectionName == X` / `X_anchor`、K3、O）は一切計算しない。
前提: #458（無変更では適用できないので STOP）で、ユーザーが案 A を選んだ。入力は #455 の FY2025 corpus（131 PDF、corpusDigest `520dd9c6…`）。

## 変えてよいもの（入口の I/O だけ）
- `build-budget-request-plain-text.ts`: `--year=`（既定 2024）。2024 の挙動は今と同じ（FY2024 manifest、凍結 raw-text manifest の PDF hash・頁数・頁 text hash で検証）。2025 は FY2025 manifest の PDF を、#455 の `pdf-corpus-freeze.json` の SHA-256・頁数で検証する。頁 text hash の凍結物は無いので、検証せずに作り、`plain-text-manifest.json`（PDF ごとの localPdfPath・pdfSha256・pageCount・status・pageTextSha256）として出力し、凍結する。
- `build-budget-request-detail-table-csv.ts`: `--year=`（既定 2024）。zip の entry パターン、整合性の診断に使う manifest、既定の出力先、`summary.json` の scope 文字列を年度から決める。2024 のときは今と同じ値（scope 文字列もバイト単位で同じ）になるようにする。
- 上の仕様書（`docs/budget-request-detail-table-csv.md` など）の使い方の記述。

## 変えないもの
- `lib/budget-request-detail-table.ts`・`lib/budget-request-plain-text.ts` を含む lib は1文字も変えない。「６年度」（`HEADER_VOCABULARY`・CSV 列名）もそのまま残す。
- FY2025 向けの source 例外・特別処理を足さない。PDF の追加・削除・差し替えをしない。
- no-text・明細表なし・unresolved が出ても、それを理由に直さない（観測として残す）。

## 回帰条件（FY2024、FY2025 を実行する前に確かめる）
- plain text: `--year=2024` を隔離した出力先で実行し、凍結 raw-text manifest の頁 text hash の検証（スクリプト内の throw）を全頁で通ること。
- 明細表 CSV: 既存の `data/work/budget-request-plain-text.zip` を同じ引数文字列で与え、隔離した出力先に作った `output-manifest.json` が、凍結値 `7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e` とバイト単位で同じであること。
- 満たさなければ STOP（FY2025 は実行しない）。

## FY2025 の実行と決定性
- plain text を2回、別の出力先に作り、txt の集合と bytes が一致すること。
- 1回目の出力から zip を1つ作って凍結し（SHA-256 を記録）、その zip に明細表 CSV を2回、別の出力先で実行して、`output-manifest.json` が一致すること。
- **STOP:** 実行不能（throw）、入力の凍結値との不一致、lib のコード変更が必要、非決定的な出力。

## 記述してよいもの（評価ではない）
- source ごとの処理の成否、頁数、明細表の頁の数、no-text の source、`lineClassCounts`（`TABLE_HEADER` の数を含む）、行種別・parse status の件数、unresolved の理由別件数、算術診断の件数。
- 「６年度」の影響は、FY2025 の表頭の行が `TABLE_HEADER` 以外の何に分類されたかの件数として記述する。結果を見てから規則を変えない。変えるなら新しい事前登録とする（案 B）。

## 凍結するもの
- FY2025 の `plain-text-manifest.json`（`tests/fixtures/` に commit）、zip の SHA-256、明細表の `output-manifest.json`（commit）とその SHA-256。
