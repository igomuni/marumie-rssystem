# FY2025 の TOC・総表 CSV（入口の年度化だけ）— preregistration

状態: **契約（実装・実行の前に固定）。** 結果は別の task doc に書く。項の特定（TOC＋総表）・明細表の X との照合・MOF との照合はしない。
前提: 項の特定の主軸を TOC＋総表に切り替える（#463、ユーザーの合意）。FY2025 の corpus は #455（131 PDF、corpusDigest `520dd9c6…`）、plain text は #459（zip `11909d76…`）。

## 変えてよいもの（入口の I/O だけ。いずれも `--year=`、既定 2024）
1. `build-budget-request-raw-text.ts`: 対象年度の manifest、出力先、fixture の場所、manifest ファイルの hash 対象（`fy{year}-budget-request-manifest.ts`）。代表頁の一覧は FY2024 固有なので、2024 以外では空にする。
2. `build-budget-request-page-classification.ts`: 入出力の場所。2024 以外では、raw text の digest を凍結値の定数ではなく、その年度の凍結済み raw-text manifest から取る。空白頁の目視分類（Phase A）は FY2024 にしか無いので、2024 以外では空とする（空白頁はすべて `UNRESOLVED_EMPTY`）。v0〜v2 の conformance 照合は FY2024 の候補 fixture だけが対象なので、2024 以外では省略する。総頁数の固定値（9,899）は、その年度の raw-text manifest の頁数で照合する。
3. `analyze-budget-request-cover-toc-structure.ts`: 入出力の場所と、凍結 digest の取り方（2 と同じ考え方）。2024 以外では `structure-inventory.json` だけを出す（development sample の選定と目視の記録は FY2024 の作業記録なので出さない）。
4. `build-budget-request-toc-pdf-native-csv.ts`: 変更しない（`--inventory` と `--out-dir` で年度を切り替えられる）。
5. `build-budget-request-total-table-csv.ts`: 明細表（#459）と同じ年度化（zip の entry、診断用 manifest、既定の出力先、scope 文字列）。2025 の診断用 manifest は `tests/fixtures/budget-request-plain-text/2025/plain-text-manifest.json`。

## 変えないもの
- `scripts/pipeline-v2/lib/` は1文字も変えない。頁分類・TOC・総表の規則、総表の `HEADER_VOCABULARY` の「６年度」もそのまま。
- FY2025 向けの例外・特別処理を足さない。PDF の追加・削除・差し替えをしない。

## 回帰条件（FY2024。FY2025 を実行する前にすべて満たす）
- raw text: 隔離した出力先で、`corpusDigestSha256` が凍結値 `7c6d2dce…` と一致し、文書ごとの artifact hash と頁 text hash が凍結 manifest と一致する。
- 頁分類: `corpusClassificationDigestSha256` が凍結値 `39464fc7…` と一致し、conformance の不一致が 0。
- 構造一覧: `structure-inventory.json` が凍結 fixture（`d2b2311c…`）とバイト単位で同じ。
- TOC: 凍結 inventory からの出力の `output-hashes.json` が既存（`17430e42…`）とバイト単位で同じ。
- 総表: 既存 zip からの `output-manifest.json` が既存（`804ecec5…`）とバイト単位で同じ。
- 1つでも満たさなければ STOP（FY2025 は実行しない）。

## FY2025 の実行と決定性
- 各段を2回、別の出力先で実行し、出力が一致すること。前段の1回目の出力を凍結して後段の入力にする。
- **STOP:** 実行不能（throw）、入力の凍結値との不一致、lib のコード変更が必要、非決定的な出力。

## 記述してよいもの（評価ではない）
- raw text の状態別件数、頁分類の頁種別ごとの件数、TOC の頁数・entry 数・unresolved、総表の行種別・unresolved・算術診断。
- 「６年度」の影響: 総表の表頭の行が `TABLE_HEADER` 以外に分類された件数と、表頭の終わりが取れなかった頁の数。結果を見て規則を変えない（変えるなら別の事前登録）。

## 凍結するもの
- FY2025 の raw-text manifest、頁分類の manifest、`structure-inventory.json`、TOC の `output-hashes.json`、総表の `output-manifest.json`（いずれも `tests/fixtures/` に commit）。
