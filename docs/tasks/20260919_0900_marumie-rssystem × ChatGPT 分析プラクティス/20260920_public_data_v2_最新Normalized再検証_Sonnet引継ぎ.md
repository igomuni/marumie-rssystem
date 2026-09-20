# Pipeline V2 public/data/v2 最新Normalized再検証（Sonnet引継ぎ）

日時: 2026-09-20
入力: `pipeline-v2-normalized-latest.tar.gz`（Sonnet TypeScript Normalize 全15 CSV + review-sheets 完了版）

## 結論

既存の `public/data/v2` 設計（MOF / RS / links のproduct分離、RS index + 256 shard lazy detail）は維持してよい。
最新Normalizedを直接使った再計測でも、一覧indexとFunding Graphは十分小さい。

## 最新Normalizedからの実測

### RS index

一覧/filter/sortに必要な project basic info / officialProjectUrl / budget aggregate / context counts / funding diagnostics をproject単位に集約してgzip。

| reviewYear | projects | raw index | gzip index |
|---|---:|---:|---:|
| 2024 | 5,669 | 4.19 MB | 425,064 bytes (0.405 MiB) |
| 2025 | 5,798 | 4.33 MB | 464,099 bytes (0.443 MiB) |
| 2026 partial | 2,579 | 1.13 MB | 144,554 bytes (0.138 MiB) |

2026はreview-sheets由来のみ。spending/funding graph未公開を0件と解釈せず、manifestでpartialを明示すること。

### Funding Graph 256 shard

projectIdのSHA-256先頭2桁で `00..ff` の256 shardへ分割。

| reviewYear | shards | gzip total | max shard |
|---|---:|---:|---:|
| 2024 | 256 | 988,181 bytes (0.942 MiB) | 7,213 bytes |
| 2025 | 256 | 1,026,056 bytes (0.979 MiB) | 7,580 bytes |

したがって一覧ではindexだけを取得し、事業選択後に該当shardを1つ読む構成で十分軽い。

## 既存full public参照実装の実測

以前生成したfull `public/data/v2` は 47,609,795 bytes（45.40 MiB）。内訳:

- MOF: 5,912,733 bytes (5.64 MiB)
- links: 337,447 bytes (0.32 MiB)
- RS: 41,357,882 bytes (39.44 MiB)

最新NormalizeはPython参照実装と全件数一致しているため、public projectionのフィールドセットを維持した場合、full publicは引き続き概ね45–50 MiBレンジと見込める。
ただしデプロイ/初期転送の評価では「全public総量」と「1画面で読む量」を分離すること。通常一覧の初期転送はreview-2025 index約0.44 MiB（gzip）で済む。

## 推奨最終構造

```
public/data/v2/
├─ manifest.json
├─ mof/
│  └─ fy{year}/
│     ├─ manifest.json
│     ├─ index.json.gz
│     └─ sections/00..ff.json.gz
├─ rs/
│  └─ review-{year}/
│     ├─ manifest.json
│     ├─ index.json.gz
│     ├─ core/00..ff.json.gz
│     ├─ context/00..ff.json.gz
│     └─ spending/00..ff.json.gz
└─ links/
   └─ review-{reviewYear}-fy{fiscalYear}/
      ├─ manifest.json
      └─ links.json.gz
```

Funding Graphはcoreへ含めてもよい。今回単独計測でFY2025全件gzip約0.98 MiB、最大shard約7.6 KiBなので容量上の問題はない。

## manifest必須項目

Top:
- schemaVersion
- publishSchemaVersion
- generatedAt
- availableFiscalYears
- availableReviewYears
- availableLinkPairs
- compression
- shardStrategy
- productSizes

RS year manifest:
- reviewYear
- completeness: `full | partial`
- sourceAvailability.downloadCsv
- sourceAvailability.reviewSheets
- sourceAvailability.spending
- sourceAvailability.fundingGraph
- projectCount
- shardCount
- indexBytes / indexGzipBytes

2026例:

```json
{
  "reviewYear": 2026,
  "completeness": "partial",
  "sourceAvailability": {
    "downloadCsv": false,
    "reviewSheets": true,
    "spending": false,
    "fundingGraph": false
  },
  "projectCount": 2579
}
```

## Publish acceptance

1. indexだけで一覧表示、検索、filter、sortに必要な情報が揃う。
2. UIが一覧表示のためにdetail shardを全取得しない。
3. project選択後のdetailは該当256 shardのみ取得する。
4. 2026 partialを「0件」と表示しない。
5. PID 1409 cycle、2776 rootなし、333 orphan、747 duplicate relation等のgraph diagnosticsがpublish後も失われない。
6. `false` / `0` / `null` をcompact処理で同一視しない。
7. MOF↔RS linkは1:1を仮定せずlink groupを保持する。
8. V1成果物をV2 publishの必須入力にしない。

## Sonnet再開時の実装順

1. `derive-rs.ts`
2. `derive-integrated.ts`
3. `validate-v2.ts`
4. `publish-v2.ts`
5. `package.json`を `derive:mof -> derive:rs -> derive:integrated -> validate -> publish` に統合
6. UI readerを `/public/data/v2` に切替
7. 旧 `public/budget-flow-v2` adapterを撤去

