# Pipeline V2 — RS Derived 先行調査 / Sonnet引継ぎ

## 入力
- 最新TypeScript Normalize成果物: `pipeline-v2-normalized-latest.tar.gz`
- 展開後サイズ: normalized 約3.0GB / derived MOF 約78MB
- RS review years: 2024 / 2025 / 2026（2026はreview-sheets中心のpartial snapshot）

## Derivedで固定してよい責務
1. project-level core summary
2. context aggregation（policy/law, subsidy, related project, logic model, evaluation, notes）
3. spending/funding graph
4. graph diagnostics（cycle / orphan / duplicate relation / rootless）
5. public用index projection

Normalizeの原典忠実データをDerivedで破壊しない。特にfunding relationはtree化・dedupeしない。

## Funding graph semantics
- node identity: `(reviewYear, projectId, blockId)`
- `fromResponsibleOrganization=true` または `sourceBlockId=null` は責任組織root → block のedge
- block-to-block relationは入力行をそのままedge化
- duplicate edgeは保持し、Derived diagnosticsで重複pair数を別途算出
- cycleは許容し、`hasCycle=true` として保持
- rootから到達不能なblockは `orphanBlockIds` として保持
- rootが0でも不正として捨てない

## FY2025 stress acceptance（最新TS Normalizeから実測）
| PID | blocks | relations | roots | cycle | orphans | duplicate pairs | indirect |
|---:|---:|---:|---:|:---:|---:|---:|---:|
| 1 | 8 | 8 | 8 | false | 0 | 0 | 2 |
| 4 | 2 | 2 | 2 | false | 0 | 0 | 0 |
| 142 | 33 | 40 | 3 | false | 0 | 0 | 0 |
| 500 | 10 | 18 | 9 | false | 0 | 0 | 0 |
| 1406 | 5 | 5 | 1 | false | 2 | 0 | 0 |
| 1409 | 4 | 5 | 1 | **true** | 0 | 0 | 0 |
| 2776 | 2 | 1 | **0** | false | 2 | 0 | 0 |
| 333 | 6 | 5 | 2 | false | 4 | 0 | 0 |
| 3339 | 30 | 0 | 0 | false | **30** | 0 | 0 |
| 747 | 28 | 52 | 5 | false | 0 | **21** | 1 |
| 1082 | **55** | 55 | **55** | false | 0 | 0 | 0 |
| 4162 | 10 | 10 | 5 | false | 0 | 0 | **12** |

この表を`derive-rs`のacceptance fixtureとして固定する。

## Project counts
- review-2024: 5,669 projects
- review-2025: 5,798 projects
- review-2026 partial: 2,579 project IDs（review-sheets由来を含む）

2026はfunding/block/contractが0であることを「存在しない」と解釈しない。`completeness: partial` / `sourceAvailability` をmanifestで明示する。

## Public indexの先行実測
project-level indexに以下だけを投影:
- projectId / projectName / ministry / bureau
- officialProjectUrl
- budget event type別集計
- context dataset件数
- funding diagnostics/counts

実測:
- 2024: raw 4,194,274 bytes → gzip **425,064 bytes**
- 2025: raw 4,333,637 bytes → gzip **464,099 bytes**
- 2026 partial: raw 1,131,035 bytes → gzip **144,554 bytes**

一覧filter/sort用の情報をindexに含めれば、旧Budget Flowのように一覧表示のためdetail shardを全読込する必要はない。

## Funding detail publishの先行実測（FY2025）
`sha256(projectId)[0:2]` による256 shardで、block + relation + indirect expenseだけを格納。
- shard数: 256
- gzip論理合計: **1,025,897 bytes（約1.0MB）**
- 最大単一shard: **7,583 bytes**

したがってfunding graphは256 shard方式で十分軽量。1 PID 1 file方式にする必要はない。

## derive-rs.ts 推奨出力
```
data/derived/rs/review-{year}/
  project-index.jsonl
  project-core.jsonl
  project-context.jsonl
  project-spending.jsonl
  funding-graph-diagnostics.jsonl
  manifest.json
```

`project-spending`にはraw recipient/contractを丸ごと複製する必要はなく、public projectionとローカルDerivedを分ける。Derived側でprovenance参照IDを保持する。

## 実装順
1. `derive-rs.ts`: project grouping + funding graph + diagnostics
2. stress fixture 12 PIDをテスト
3. project core/context aggregation
4. `derive-integrated.ts`: MOF↔RS linkage
5. `validate-v2.ts`: Python参照件数 + stress + MOF settlement acceptance
6. `publish-v2.ts`: manifest/index/core/context/spending shards
7. `pipeline:v2:derive`, `pipeline:v2:validate`, `pipeline:v2:publish` の正式入口を追加
8. legacy入口は最終撤去

## 注意
- `0`, `false`, `null` をcompact処理で混同しない。
- duplicate relationをdedupeしない。
- rootless / orphan / cycleを「修復」しない。
- 2026 partialをcomplete snapshotとして扱わない。
- review sheetのofficialProjectUrlをcore/public indexへ優先的に投影する。
