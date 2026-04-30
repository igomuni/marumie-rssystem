---
allowed-tools: Bash(npm run normalize:*), Bash(npm run generate-structured:*), Bash(npm run generate-project-details:*), Bash(npm run generate-sankey2:*), Bash(npm run compute-sankey2-layout:*), Bash(npm run generate-sankey-svg:*), Bash(npm run score-quality:*), Bash(npm run compress-data:*), Bash(ls:*), Read
description: データパイプライン・CSV処理・JSON生成の実装を行う
---

## タスク

1. 以下を読み込み、データパイプラインの全体像を把握する：
   - [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) — パイプライン詳細仕様

2. ユーザーの指示に従って実装・調査を行う。

## キーファイル

| File | Purpose |
|------|---------|
| `scripts/normalize_csv.py` | CSV正規化（neologdn による表記ゆれ修正） |
| `scripts/generate-structured-json.ts` | rs2024-structured.json 生成 |
| `scripts/generate-project-details.ts` | rs2024-project-details.json 生成 |
| `scripts/generate-sankey2-data.ts` | sankey2-graph.json 生成（5-1/5-2 CSVから） |
| `scripts/compute-sankey2-layout.ts` | sankey2-layout.json 生成（座標計算） |
| `scripts/generate-sankey-svg-data.ts` | sankey-svg-graph.json 生成 |
| `scripts/score-project-quality.py` | 事業別品質スコア生成 |

## データ所在地

| 種別 | パス |
|------|------|
| Source CSV | `data/download/RS_2024/`（rssystem.go.jp から手動DL） |
| Normalized CSV | `data/year_2024/`（自動生成、.gitignore） |
| Structured JSON | `public/data/rs2024-structured.json`（~96MB、.gitignore） |
| Compressed JSON | `public/data/rs2024-structured.json.gz`（~11MB、Git管理） |
| Sankey2 Graph | `public/data/sankey2-graph.json(.gz)` |
| Sankey2 Layout | `public/data/sankey2-layout.json(.gz)` |
| SVG Graph | `public/data/sankey-svg-2024-graph.json(.gz)` |
| Subcontracts | `public/data/subcontracts-2024.json(.gz)` |

## パイプラインコマンド

```bash
# 基本パイプライン（CSVファイル更新後）
npm run normalize              # CSV正規化（要: pip3 install neologdn）
npm run generate-structured    # rs2024-structured.json 生成（~96MB）
npm run compress-data          # Gzip圧縮（全データファイル）

# Sankey2パイプライン
npm run generate-sankey2       # sankey2-graph.json 生成（~25MB）
npm run compute-sankey2-layout # sankey2-layout.json 生成（~45MB）

# SVG Sankeyパイプライン
npm run generate-sankey-svg         # 2024年度
npm run generate-sankey-svg-2025    # 2025年度

# 品質スコア
npm run score-quality          # 2024年度
npm run score-quality-2025     # 2025年度

# 法人番号照合データ（オプション・初回のみ）
# 事前に data/download/houjin-bangou/ に国税庁ZIPを配置
npm run build-houjin-db        # ZIP → SQLite（~1GB・約44秒）
npm run build-houjin-lookup    # SQLite → data/houjin-lookup.json
```

## レイヤー設計ルール

- `scripts/` はCSV処理・JSON生成のみ。UIロジック・APIロジック禁止
- 生成した `.json` は必ず `npm run compress-data` で `.gz` を更新してから Git に積む
- `.json` 本体は `.gitignore` 対象、`.json.gz` のみGit管理

## 関連ドキュメント

- パイプライン詳細: [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md)
- 状態確認: `python3 scripts/check-project-state.py`
