# 概算要求 明細表 × MOF 事項の突合（J1 単一 + K2）

明細表 CSV（[budget-request-detail-table-csv.md](budget-request-detail-table-csv.md)）の DETAIL 行（`NN‑NN 事項名`）を、MOF 予算書の事項（一般会計・当初予算）に対応付ける。採用するのは、名前の exact な一致が1候補で、かつ source から取った項がその候補の項と exact に一致したものだけ。正規化・金額・コード・部分一致・source 固有の例外は使わない。

- 実装: `scripts/pipeline-v2/lib/budget-request-detail-table-mof-match.ts`（pure）、`scripts/pipeline-v2/build-budget-request-detail-table-mof-match.ts`（runner）
- テスト: `scripts/pipeline-v2/lib/budget-request-detail-table-mof-match.test.ts`

```bash
npx tsx scripts/pipeline-v2/build-budget-request-detail-table-mof-match.ts --year=2025 --mof=<jikou.jsonl> [--detail=<dir>] [--out=<dir>]
# 既定: data/work/budget-request-csv/{year}/detail-table → data/work/budget-request-csv/{year}/detail-table-mof-match/
```

`--mof` は、1行1事項の JSONL で `ministry`・`organization`・`sectionCode`・`sectionName`・`jikouName`・`col4Raw` を持つもの。FY2024 は V2 の `data/normalized/mof/fy2024/budget-jikou.jsonl`。FY2025 は V1 `public/data/mof-jikou-2025.json.gz` を `scripts/research/mof-v1-jikou-adapter.py emit 2025` で写した `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（この adapter は FY2024 で V2 と全件一致することを確認済み）。明細表の source CSV は、`output-manifest.json` と集合・SHA-256 が一致しなければ止まる。

## 規則

1. **対象:** source の最初の CONTEXT 行が `NN 〇〇所管`（2桁）の source。CONTEXT が無い source、4桁で始まる CONTEXT（特別会計）、それ以外の形の CONTEXT は対象外。DETAIL の `事項` が `NN‑NN 名称` に合わない行も対象外。
2. **J1:** `(所管名, 事項名)` が MOF の `(ministry, jikouName)` と exact に一致する事項を候補とする（正規化しない）。
3. **X（項）:** DETAIL の直前の行が CODE3/CODE2 の `NN[N] 名称` なら、その名称（immediate X）。無ければ、同じ source を上に戻り、immediate X を持つ直近の先行 DETAIL の X を持ち越す（anchor carry）。X を探すときに MOF は見ない。
4. **K2:** J1 の候補のうち `sectionName == X` のもの。

| status | 条件 | MOF の列 |
|---|---|---|
| `K2_SUPPORTED` | J1 が1候補、X あり、その候補の `sectionName == X` | 出力する |
| `UNRESOLVED_SECTION_MISMATCH` | J1 が1候補で `sectionName != X` | 空（J1 だけで採用しない） |
| `UNRESOLVED_NO_X` | J1 が1候補で X が取れない | 空 |
| `AMBIGUOUS_J1_MULTI` | J1 が2候補以上 | 空。`k2_candidates` は diagnostic で、1でも採用しない |
| `UNRESOLVED_J1_NO_CANDIDATE` | J1 が0候補 | 空 |
| `OUT_OF_SCOPE_*` | 規則1の対象外（理由別） | 空 |

## 根拠と限界

- K2 の anchor carry は FY2024 で着想した規則（development: 216/220）。その後、FY2025 で一度だけ held-out 検証した（306/311 = 98.39%、Wilson 95% 区間 96.3〜99.3%、事前に決めた 95% の閾値を通過）。immediate X の行は FY2025 で 670/675。
- 検証したのは「X と sectionName の exact 一致」まで。J1（所管・事項名の exact）の対応付け自体が正しいことは検証していない。`K2_SUPPORTED` は「J1 の単一候補を、項の文脈で確認した」という意味で、正解が確定したという意味ではない。
- J1 複数の行で、K2 によって1候補に絞れる行（FY2025 は 224 行中 147 行）は、まだ resolution としては検証していない。採用するなら別の検証が要る。
- 特別会計・CONTEXT の無い source・J1 0候補には、何も対応付けない。

## 出力

- `matches.csv`: DETAIL 行ごとに1行。列は `source, row_index, source_page, 頁, detail_code, detail_name, ministry, x_source, x, j1_candidates, k2_candidates, status, mof_organization, mof_sectionCode, mof_sectionName, mof_jikouName, mof_col4Raw`。
- `summary.json`: 入力の hash、status 別の件数、`AMBIGUOUS_J1_MULTI` の K2 diagnostic（X の取り方 × 候補数）。
- `output-manifest.json`: 上の2ファイルの SHA-256。

| 年度 | DETAIL | K2_SUPPORTED | SECTION_MISMATCH | AMBIGUOUS | NO_CANDIDATE | 対象外（CONTEXT なし / 特別会計） |
|---|---:|---:|---:|---:|---:|---|
| FY2024 | 1,641 | 687 | 7 | 215 | 73 | 213 / 446 |
| FY2025 | 1,869 | 976 | 10 | 224 | 75 | 101 / 483 |
