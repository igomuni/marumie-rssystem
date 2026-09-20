# Pipeline V2 — MOF + RS 統合 / public 配信まで 最終仕様

作成日: 2026-09-20
対象リポジトリ: `igomuni/marumie-rssystem`
基準ブランチ: `main`

## 1. 目的

Pipeline V2 を、MOF と RS の raw 原本取得から UI が読む `public` 配信用成果物まで、一貫した責務境界で構成する。

```text
SOURCE / RAW
    ↓
NORMALIZED
    ↓
DERIVED
    ↓
VALIDATION
    ↓
PUBLISH
    ↓
public/data/v2
    ↓
UI / browser
```

V1 は既存画面の互換性・V2 の独立検算基準として維持する。V2 の生成に V1 成果物を必須入力としない。

---

## 2. main の現状確認

現在の `main` には次の2系統が並存している。

### 2.1 TypeScript Pipeline V2

```text
scripts/pipeline-v2/download-*
    ↓
normalize-mof.ts / normalize-rs.ts
    ↓
build-identities.ts / build-links.ts
    ↓
validate.ts
```

`package.json` 上も `pipeline:v2:validate` までで、正式な publish ステージは存在しない。

### 2.2 Budget Flow 表示用の独立 adapter

```text
data/pipeline-v2-full-output.zip
    ↓
scripts/generate-budget-flow.py
    ↓
public/budget-flow-v2/
```

この adapter は独立参照 ZIP を入力とし、さらに V1 の `public/data/mof-budget-{year}.json.gz` を比較用途に読む。TypeScript V2 の `data/derived` から直接 public を作る構造ではない。

### 2.3 現状 public の問題

現在の Budget Flow は年度 index と ID 先頭1桁による16 shardを読むが、一覧で当初成立額による filter/sort を行うため、クライアントが実質的に全 shard を順次読む。

今後は一覧で必要な金額・状態を index に持たせ、detail shard は選択時だけ取得する。

---

## 3. 最終ディレクトリ構造

```text
data/
├─ download/
│  ├─ mof.go.jp/
│  │  ├─ archive/{year}/...
│  │  └─ account/fy{year}/...
│  └─ rssystem.go.jp/
│     ├─ download-csv/{reviewYear}/...
│     └─ sheets/{reviewYear}/...
│
├─ normalized/
│  ├─ mof/fy{fiscalYear}/...
│  └─ rs/review-{reviewYear}/...
│
├─ derived/
│  ├─ mof/fy{fiscalYear}/...
│  ├─ rs/review-{reviewYear}/...
│  └─ links/
│     └─ mof-rs-review-{reviewYear}-fy{fiscalYear}.*
│
└─ validation/
   ├─ report.*
   └─ public-report.json

public/
└─ data/
   └─ v2/
      ├─ manifest.json
      ├─ mof/
      ├─ rs/
      └─ links/
```

`data/normalized` と `data/derived` はローカル生成物であり、Vercel デプロイ対象にしない。

---

## 4. 年度軸

### MOF

- `fiscalYear`: 予算年度

### RS

- `reviewYear`: RS のレビュー提出・スナップショット年度
- `fiscalYear`: 各 budget 行が指す予算年度

MOF↔RS link は必ず2軸を明記する。

```text
review-2025-fy2024
review-2025-fy2025
```

`year=2025` のような単一軸だけで link を表現しない。

---

## 5. MOF の identity

MOF は「項」と「目」を別レベルとして扱う。

```text
MOF Section / 項
  └─ MOF Item / 目
```

### Section identity

年度 + 次を完全一致で使用する。

- accountType
- ministry
- organization
- specialAccount
- subAccount
- agency
- sectionCode
- sectionName

`sectionCode` 単独を canonical identity にしない。

### Item identity

Section identity + 原典の item natural key / item name を使用する。

### ID

順番依存の連番 ID は public の安定 ID に使用しない。入力内容から SHA-256 ベースで決定論的に生成する。

---

## 6. RS Normalized

2024/2025 download-csv の15系統を原則すべて取り込む。

主な normalized product:

```text
organizations
projects
policies-laws
subsidy-rules
project-relations
budget-summaries
budget-items
logic-model-nodes
logic-model-observations
logic-model-relations
evaluations
spending-blocks
recipients
contracts
funding-relations
indirect-expenses
expense-uses
multi-year-contracts
notes
review-sheets
```

### 重要ルール

- `4` と `000004` は canonical project ID では同一にする。
- raw 表記は normalized evidence に残す。
- blank と explicit `0` を区別する。
- `予備費等` は normalized 時点で `reserve` と断定しない。
- 5-1 の金額なし block summary を捨てない。
- 5-2 は一般有向グラフとして扱う。

許容する構造:

- cycle
- fan-out / fan-in
- multiple roots
- ministry 以外の root
- disconnected components
- orphan block
- duplicate edge evidence
- 同一主体名の複数 block

---

## 7. Derived

### 7.1 MOF derived

- Budget Event
- stage 間 identity relations
- submitted → enacted amendment
- initial → supplementary → settlement の evidence relation

### 7.2 RS derived

- funding graph
- semantic edges
- graph metrics
- budget events

### 7.3 Integrated derived

```text
MOF Item
    ↓ exact structured key
RS Project
```

出力名に reviewYear と fiscalYear を両方含める。

---

## 8. MOF の「補正後 → 決算予算額」の gap

現行 structured data だけでは、補正後予算額から決算側の歳出予算額へ移る途中の原因を常に分類できるとは限らない。

例: デジタル庁「情報通信技術調達等適正・効率化推進費」FY2024

```text
当初予算                  480,327,293,000
補正増減                  205,412,304,000
補正後                    685,739,597,000
決算書の歳出予算額        176,048,747,050
差                         -509,690,849,950
```

この差は RS の `予備費等（合計）` とも一致するが、public / derived では根拠なしに `transfer` と断定しない。

public index/detail には次を持たせる。

```text
unresolvedPreSettlementDeltaYen
stageGaps[]
```

`stageGaps[].classification = "unresolved"` とし、将来 MOF の公式移替表を relation source として取り込んだ時点で解決する。

これにより UI で `transfer = 0` を「移替がなかった」と誤解させずに済む。

---

## 9. public 配信構造

### 9.1 Top manifest

```text
public/data/v2/manifest.json
```

含めるもの:

- schemaVersion
- publishSchemaVersion
- available fiscalYears
- available reviewYears
- available link pairs
- compression
- sharding
- product size summary

UI 側に年度をハードコードしない。

### 9.2 MOF

```text
public/data/v2/mof/fy2024/
├─ manifest.json
├─ index.json.gz
└─ sections/
   ├─ 00.json.gz
   ├─ 01.json.gz
   └─ ... ff.json.gz
```

#### MOF index

一覧/filter/sort に必要なものを全て index に入れる。

主な項目:

- section identity
- shard
- itemCount / eventCount
- stages
- initialSubmittedYen
- initialEnactedYen
- initialYen（enacted優先）
- supplementDeltaYen
- settlementBudgetYen
- currentBudgetYen
- spentYen
- carryoverOutYen
- unusedYen
- unresolvedPreSettlementDeltaYen
- RS link count / project count

これにより一覧金額のために detail shard 全件をロードしない。

### 9.3 RS

```text
public/data/v2/rs/review-2025/
├─ manifest.json
├─ index.json.gz
├─ core/00..ff.json.gz
├─ context/00..ff.json.gz
└─ spending/00..ff.json.gz
```

#### core

通常の事業詳細を開いた時に読む。

- project basic info
- project-level budget summaries
- funding graph
- MOF link references

#### context

必要なタブを開いた時だけ読む。

- detailed budget items
- policy / measure / law / plan
- subsidy rules
- related projects
- logic model
- evaluations
- notes

#### spending

支出先タブを開いた時だけ読む。

- recipients
- contracts
- expense uses
- multi-year contracts
- indirect expenses

### 9.4 Link product

```text
public/data/v2/links/review-2025-fy2024/
├─ manifest.json
└─ links.json.gz
```

link は MOF section IDs と RS project IDs の両方を持つ。

---

## 10. Sharding

detail は256 shard。

```text
00 ... ff
```

理由:

- 1 PID 1 file にすると review-2025 だけで約5,800ファイルになる。
- 16 shard は detail が大きくなった場合に粗すぎる。
- 256 shard では今回の実測で数十 KiB / shard 程度。

RS は `sha256("rs-project:" + projectId)` の先頭2 hexを index に `shard` として保存する。
MOF section は stable ID 自体の先頭2 hexを使う。

クライアント側で hash 計算を必須にせず、index に shard を明記する。

---

## 11. Gzip と build

public V2 は `.json.gz` を正本とする。

- Git に raw JSON を置かない。
- build 時に全 V2 を展開しない。
- ブラウザ側 helper で gzip JSON を展開する。

現行 `next.config.ts` が `public/data/**` を server function tracing から除外している方針は維持する。

`data/server/**` へ V2 static data をコピーしない。

### .gitignore 修正が必要

現行は root-level の `public/data/*.gz` だけを例外許可しているため、次のような nested V2 product を明示的に許可する。

```gitignore
!/public/data/v2/
!/public/data/v2/**/
!/public/data/v2/**/*.json.gz
!/public/data/v2/**/manifest.json
!/public/data/v2/manifest.json
```

---

## 12. Pipeline commands

最終的には次を提供する。

```text
pipeline:v2:download
pipeline:v2:normalize
pipeline:v2:derive
pipeline:v2:validate
pipeline:v2:publish
pipeline:v2
```

内部では個別実行も可能にする。

```text
normalize:mof
normalize:rs

derive:mof
derive:rs
derive:links

validate:mof
validate:rs
validate:links
validate:public

publish:mof
publish:rs
publish:links
```

build / Vercel deploy 時に政府サイトへアクセスしない。

---

## 13. 実測結果

今回の独立参照実装で、次を実際に public 生成した。

### source / local intermediate

- MOF FY2024 / FY2025
- RS review-2025: download-csv 15系統
- RS review-2026: 手元に存在する sheets-only

RS normalized/derived は GB 級まで膨らむが、ローカル生成物なのでデプロイサイズには影響しない。

### public/data/v2

| Product | compressed/static size |
|---|---:|
| MOF FY2024 + FY2025 | 約 5.64 MiB |
| Links review2025×FY2024/FY2025 | 約 0.32 MiB |
| RS 2025 index | 約 0.68 MiB |
| RS 2025 core | 約 9.65 MiB |
| RS 2025 context | 約 17.83 MiB |
| RS 2025 spending | 約 10.82 MiB |
| RS 2026 sheets-only | 約 0.46 MiB |
| **public/data/v2 total** | **約 45.4 MiB** |

ファイル数: **1,546**
最大単一ファイル: **約 696 KiB**
1 MiB 超の static file: **0件**

public validation: **PASS**

### 初期ロードに必要な index

MOF/RS の全 index + top manifest 合計はおよそ **1 MiB**。
実際には画面に必要な年度 index のみ読むため、通常はさらに小さい。

---

## 14. stress regression

少なくとも以下を継続 fixture とする。

- PID 1: 通常直接支出
- PID 4: 大規模 adjustment / 省庁移替系
- PID 12: 再委託
- PID 1409: cycle
- PID 2776: ministry root 欠落
- PID 142: 多階層 + fan-out/fan-in
- PID 500: 複数府省への分岐と自治体への合流
- PID 1406: 外部資金源
- PID 3339: orphan blocks
- PID 333: disconnected components
- PID 18: 同一主体の複数 block
- PID 747: duplicate relation evidence
- PID 1082: fan-out 55
- PID 4162: indirect expenses
- PID 1675: multiple roots + repeated actor

---

## 15. main への移行順序

### Phase 1 — Pipeline 側だけ統合

- RS 15 CSV Normalized を移植
- MOF section/item identity を整理
- derive:rs funding graph を移植
- link の reviewYear × fiscalYear 化
- publish 実装
- public validation 実装

V1/UIは変更しない。

### Phase 2 — Budget Flow を public/data/v2 へ切替

現行:

```text
/budget-flow → public/budget-flow-v2
```

を、

```text
/budget-flow → public/data/v2/mof + rs + links
```

へ切り替える。

ここで一覧の全shard先読みを廃止する。

### Phase 3 — compatibility artifact 廃止

新UIの検証完了後:

- `public/budget-flow-v2`
- `generate-budget-flow.py` の画面専用 adapter

を compatibility 用途から外す。

### Phase 4 — V1 は比較基準として残す

既存 Integrated Sankey などは当面そのまま残す。V2 publish の入力にはしない。

---

## 16. ChatGPT / Codex の役割分担

データ側は ChatGPT 実行環境で次まで検証可能。

```text
原典調査
→ semantic design
→ pipeline reference implementation
→ full data execution
→ validation
→ public schema / size measurement
```

Codex の5時間枠は主に次へ使用する。

```text
TypeScript本体への統合
UI component実装
interaction調整
visual polish
E2E
```

これにより Codex の時間枠を UI/統合作業へ集中できる。
