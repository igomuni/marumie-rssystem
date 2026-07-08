---
description: 大きなデータファイル（public/data・data/）の中身を確認・集計する
---

## 目的

`public/data/*.json`（展開後 283MB、graph 単体で 96MB）や `data/`（CSV・houjin.db 1GB）を **Read で開くと1回で数万トークンになる**ため、settings.json の deny で拒否している。中身の確認・集計は以下の作法で行う。

## 第一選択: dev サーバーの API

`npm run dev` が起動していれば、集計・検索・絞り込みは API で済むことが多い:

```bash
curl -s 'http://localhost:3000/api/sankey/query?...'   # 絞り込み+summary（仕様: docs/api-guide.md）
curl -s 'http://localhost:3000/api/search/projects?q=...'
curl -s 'http://localhost:3000/api/quality?year=2024&...'
```

- API 仕様の正典は [docs/api-guide.md](../../docs/api-guide.md)、探索の作法（0件時の緩め方・データの罠）は [docs/agent-playbook.md](../../docs/agent-playbook.md)
- 応答は `| jq` で必要な部分だけに絞ってから読む

## 第二選択: jq / node ワンライナー（API にない集計）

**全体を出力しない**のが原則。構造確認 → 絞り込み → 集計の順で:

```bash
# 構造確認（キー・先頭要素のみ）
jq 'keys' public/data/sankey-svg-2024-graph.json
jq '.nodes[0]' public/data/sankey-svg-2024-graph.json

# 件数・合計などの集計
jq '[.edges[].value] | add' public/data/sankey-svg-2024-graph.json
jq '[.nodes[] | select(.type=="ministry")] | length' ...

# .gz を展開せずに直読み
gunzip -c public/data/subcontracts-2024.json.gz | jq -c '.projects[:3]'

# jq で書きにくい処理は node --eval
node -e 'const d=require("./public/data/xxx.json"); console.log(/* 絞った結果だけ */)'
```

## houjin.db（法人番号 SQLite・1GB）

```bash
sqlite3 data/houjin.db '.schema'                          # スキーマ確認
sqlite3 data/houjin.db "SELECT ... LIMIT 10"              # SELECT のみ。必ず LIMIT
```

## CSV（data/download/）

ヘッダ・数行の確認は `head -3 file.csv`（Shift-JIS は `iconv -f SHIFT_JIS -t UTF-8 file.csv | head -3`）。全行処理は `scripts/` のパイプラインに実装する（レイヤー規約）。

## 禁止事項

- Read ツールでのデータファイル読込（deny 済み。`cat` での全文出力も同罪）
- クランプなしの出力（`head` / `LIMIT` / jq のスライスを必ず挟む）
