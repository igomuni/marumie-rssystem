# Pipeline V2 RS — public publish仕様

## 目的

Pipeline V2の巨大なNormalized/Derived中間生成物をVercelへ直接配置せず、ブラウザが必要とする配信用データだけを `public/data/v2` に生成する。

## レイヤー

```text
RAW (~54 MB zip)
  ↓
Normalized (~1.6 GB; local only)
  ↓
Derived (~179 MB; local only)
  ↓ publish
public/data/v2 (~30.5 MiB Core / ~53.7 MiB Full)
```

## 標準: Core

Coreを本番の標準publish profileとする。

```text
public/data/v2/rs/review-2025/
├── manifest.json
├── index.json
└── projects/{projectId}.json
```

### index.json
一覧・検索に必要な最小情報を保持する。

- projectId
- projectName
- ministry
- bureau
- startYear / endYear
- officialProjectUrl
- funding graph summary（node/edge数、cycle等）

### projects/{projectId}.json
詳細画面でPID選択後にオンデマンド取得する。

- project basic metadata
- budget summaries
- compact funding graph

## Optional: Full

`--include-contracts` 指定時のみ、PID JSONへ個別契約を追加する。

契約情報をUIで表示しない段階ではCoreを採用し、不要なデプロイ容量・転送量を増やさない。

## 2025実測

| profile | logical bytes | MiB | file count | tar+gzip参考値 |
|---|---:|---:|---:|---:|
| Core | 31,988,309 | 30.51 | 5,800 | 約6.6 MiB |
| Full | 56,271,960 | 53.67 | 5,800 | 約11 MiB |

Core最大PID JSONは約24.8KB。`index.json` は約1.30MB。

## デプロイ原則

- `normalized/` と `derived/` はpublicへコピーしない。
- Git/Vercel上のデプロイ評価は `public/data/v2` のサイズを基準にする。
- UI初期表示で全PID詳細を取得しない。
- 一覧/検索はindex、詳細表示時だけ `projects/{PID}.json` を取得する。
- 公式原典へのURLはPID JSON/indexに保持する。
- provenance/raw evidenceはNormalized側を正本とし、publicではUIに必要な情報だけcompact化する。
- Funding Graphの意味をpublish段階で変更しない。cycle、multiple root、orphan等の意味論はDerivedのまま保持する。

## 本体Pipelineへの移植条件

1. build前またはデータ更新ジョブでpublishを明示的に実行できること。
2. public成果物は決定的に再生成可能であること。
3. manifestにschemaVersion / reviewYear / projectCount / profileを記録すること。
4. PID単位のURLを安定させること。
5. Core/Fullの選択をコード変更なしのオプションで切り替えられること。
6. publicサイズをCI/validationで計測し、意図しない急増を検知できるようにすること。

## 今後の最適化候補

現時点では30.5MiBで十分現実的なので、過剰な最適化は行わない。必要になった場合のみ以下を検討する。

- indexの検索専用縮小
- 省庁別index分割
- dictionary化
- contractsの別endpoint/別JSON化
- review yearを跨ぐ共通metadataの重複除去
