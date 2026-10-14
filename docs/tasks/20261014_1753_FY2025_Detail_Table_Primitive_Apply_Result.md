# FY2025 明細表 primitive の適用（案 A）— 結果

状態: 結果（事前登録 `2324096` どおり）。結論: **STOP 条件に当たらず、FY2025 の明細表 primitive corpus を凍結した。** FY2024 の回帰はバイト単位で一致した。FY2025 は plain text・明細表 CSV とも2回の実行で同一の出力。lib は変えていない。MOF との照合は何も計算していない。

事前登録: `docs/tasks/20261014_1753_FY2025_Detail_Table_Primitive_Apply_Preregistration.md`。前提は #458（STOP と案の提示）。

## コードの変更（入口の I/O だけ）
- `build-budget-request-plain-text.ts`: `--year=`（既定 2024）。2024 以外は #455 の `pdf-corpus-freeze.json` で PDF hash と頁数を検証し、`plain-text-manifest.json` を出力する。
- `build-budget-request-detail-table-csv.ts`: `--year=`（既定 2024）。zip の entry、診断用 manifest、既定の出力先、scope 文字列だけを年度から決める。
- `docs/budget-request-detail-table-csv.md` に使い方を追記した。`scripts/pipeline-v2/lib/` の差分は 0。

## FY2024 の回帰（FY2025 の前に実行）
- plain text `--year=2024`: 82 PDF / 9,899 頁。凍結 raw-text manifest の頁 text hash の検証を全頁で通った。
- 明細表 CSV（既存 zip、隔離した出力先）: `output-manifest.json` は `7989885b…`。凍結値とバイト単位で同じ。`--year=2024` を明示した場合も同じ。

## FY2025 の実行
- plain text: 2回とも 131 PDF / 9,586 頁で、出力ディレクトリは完全に一致。131本すべて EXTRACTED（text 層なしは 0）。
- zip: `data/work/budget-request-plain-text-2025.zip`（txt 131 entry）SHA-256 `11909d768c38c025c70178755dea1f84280e85c124575f380af3e786a28889f2`。
- 明細表 CSV: 同じ zip に2回実行し、出力ディレクトリは完全に一致。整合性の診断は MATCH 131。

## 凍結値
- `tests/fixtures/budget-request-pdf-corpus/2025/pdf-corpus-freeze.json`（入力、#455）
- `tests/fixtures/budget-request-plain-text/2025/plain-text-manifest.json` SHA-256 `a87d7ef34d2dd34023ecc78d76086471c13b444bc8c74752e06ef819de4ce2b5`
- `tests/fixtures/budget-request-detail-table-csv/2025/output-manifest.json` SHA-256 `0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7`。CSV の本体は `data/work/budget-request-csv/2025/detail-table/`（git 管理外）にあり、この manifest の hash で照合する。

## 記述統計（評価ではない。FY2024 は参考）

| 項目 | FY2024 | FY2025 |
|---|---:|---:|
| source / 明細表のある source / 明細表なし | 82 / 73 / 9 | 131 / 123 / 8 |
| text 層なしの source | 2 | 0 |
| 明細表の頁 / 表頭の境界が取れない頁 | 8,585 / 11 | 9,055 / 12 |
| 論理行 / 継続行を持つ行 | 47,693 / 17,379 | 53,303 / 19,169 |
| DETAIL / CODE3 / CODE2 | 1,641 / 10,899 / 1,923 | 1,869 / 12,147 / 1,943 |
| PARSED / 表頭の窓で配置 / 頁端で配置 | 46,941 / 140 / 612 | 52,525 / 196 / 582 |
| `TABLE_HEADER` | 17,148 | 9,043 |
| unresolved（計） | 2,217 | 10,766 |
| うち `UNKNOWN_HEADER_ZONE_LINE` | 0 | 9,043 |
| unresolved（`UNKNOWN_HEADER_ZONE_LINE` を除く） | 2,217 | 1,723 |
| 算術の不一致行 | 0 | 0 |

- 「６年度」の影響: FY2025 の表頭は2行のうち1行が「７年度」を含み、その行が `TABLE_HEADER` にならず、`UNKNOWN_HEADER_ZONE_LINE`（9,043）として unresolved に入った。表頭の行の総数（9,043 + 9,043）は頁数とほぼ同じ比率で、FY2024 と同じ形。この影響は記述としてだけ残し、規則は変えていない。
- この影響が、DETAIL 行の抽出や金額の配置にまで及んでいるかは、本 Task の範囲では判定していない（行の正しさの評価はしていない）。

## 次（ユーザーの GO が要る）
- 凍結した FY2025 明細表 primitive、MOF canonical artifact（`9c0a878b…`、#457）、#452 で固定した規則（immediate X と anchor carry）で、X anchor validation を1回だけ実行する。その前に、validation の集計と提示の仕方を事前登録する。
