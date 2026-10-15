# tests/fixtures と scripts の棚卸し — 結果

状態: 契約（同名 Contract）どおり数えて凍結した。結論: **fixtures は 75 ディレクトリ・約 46.6MB、scripts は 368 本・約 3.8MB。参照元（コード・テスト・docs/*.md）が 1 つもないものは fixtures 5 ディレクトリ（約 1.5MB）、scripts 145 本（約 1.4MB）。ただし scripts の「参照なし」は、CLI として直接実行する入口 script が自然に該当するため、「不要」を意味しない。**

成果物: `docs/inventory/repo-artifacts/{fixtures.csv, scripts.csv, summary.json}`（取得時の git HEAD は `summary.json`）。判定はしていない。

## fixtures

| 系列 | ディレクトリ | サイズ | 参照元なし |
|---|---:|---:|---|
| budget-request-* | 62 | 37.3MB | 4 ディレクトリ・1.5MB |
| mof / detail-table-mof | 11 | 8.6MB | 1（`detail-table-mof-x-anchor-validation`、2KB） |
| detail-table 他 | 1 | 0.7MB | 0 |
| その他 | 1 | 0.04MB | 0 |

参照元なしの 5 つ: `budget-request-inventory`（945KB。task doc の参照 2、最終更新は 2026-10-15）、`budget-request-toc-line-token-order-failure-isolation`（272KB、task doc の参照なし）、`budget-request-toc-line-token-order-p4-audit`（5KB）、`budget-request-toc-source-correspondence-anchor`（286KB）、`detail-table-mof-x-anchor-validation`（2KB）。大きいのは `budget-request-layout-hierarchy-inventory`（約 6.8MB）、`budget-request-full-corpus-baseline`（約 6.6MB）、`mof-archive-csv`（約 3.9MB）など。

## scripts

| 場所 | 本数 | 参照元なし |
|---|---:|---:|
| `scripts/` 直下 | 46 | 15 |
| `scripts/pipeline-v2/` | 143 | 90 |
| `scripts/pipeline-v2/lib/`（`validation/` 含む） | 129 | 0 |
| `scripts/research/` | 49 | 39 |
| `scripts/dev/` | 1 | 1 |

- 参照元なし 145 本のうち、task doc には言及があるもの 65、どこにも言及がないもの 80。
- 参照元なし 145 本の最終 commit は、2026-10 が 129 本、2026-09 が 6 本、2026-07〜08 が 10 本。直近の研究系列の一回限りの script が多い。
- `lib/` は import で参照されるため 0。入口 script（`npx tsx …` で直接実行するもの）は、コードから参照されないのが普通なので、「参照なし＝未使用」とは言えない。

## 使い方の注意
- 参照は名前の文字列一致で数えている。短い一般語は過大に、動的に作る名前は過小に数える（契約に記載）。
- この表は判定の材料。残す・消すは、系列ごとに「最終成果物と、それを作る script だけ残す」基準で、ユーザーが表を見て決める。
