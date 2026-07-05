# API Guide

全 API エンドポイントの仕様。

## 共通規約

- 全金額は **1円単位**（`metadata.unit: "JPY"`）
- 全応答に `metadata.notes`（データ留意事項）を同梱
- `year` パラメータ: `"2024"`（デフォルト）または `"2025"`。対象外は 400
- 関連リンク（`links.*`）は相対URLで返す（ホスト非依存）

---

## GET /api/sankey/query

> **ローカル実験フェーズ**: Vercel 上（`VERCEL=1` 環境）では機能・理由を明かさない素の 404 を返す（環境変数 `SANKEY_QUERY_API_ENABLED=1` で明示的に有効化した場合を除く）。`npm run dev` のローカル環境では常に利用できる。

`/sankey-svg` のフィルタ条件を構造化クエリ（`SankeyQuery`）として受け取り、フィルタ適用後のサマリ（と必要なら Sankey データ本体）を返す。**AIエージェントがフィルタ条件を組み立て → 結果を検証 → `links.webView` を人間に提示する**自律ループの中核API。ページ側とフィルタロジック・グラフデータを共有しており、`links.webView` を開くと同一条件のサンキー図が表示される。

### クエリパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `q` | string(JSON) | — | `SankeyQuery` のJSON（URLエンコード）。**推奨形式** |
| `detail` | string | `"summary"` | `"summary"` = 件数・金額のみ / `"full"` = TopN集約後の nodes/edges も返す |
| `year` | string | `"2024"` | `q.year` 未指定時の年度 |
| （短縮形） | — | — | `q` の代わりに `/sankey-svg` と同じ短縮URLパラメータ（後述の対応表）も受理 |

### SankeyQuery スキーマ（型定義: `types/sankey-query.ts`）

```json
{
  "year": "2024",
  "filter": {
    "projectName": { "query": "再エネ|再生可能エネルギー", "regex": true },
    "recipientName": { "query": "電力", "regex": false },
    "ministries": ["経済産業省", "環境省"],
    "budget": { "min": 1000000000, "max": null },
    "spending": { "min": null, "max": null },
    "accountCategories": ["general", "special", "both", "none"]
  },
  "view": {
    "topMinistry": 37, "topProject": 50, "topRecipient": 50,
    "pin": { "projectId": null, "recipientId": null, "ministryName": null },
    "focusRelated": false,
    "offset": { "target": "project", "recipient": 0, "project": 0 },
    "projectSortBy": "budget",
    "showAggProject": true, "showAggRecipient": true,
    "scaleBudgetToVisible": true
  }
}
```

- 全フィールド optional。省略時は `/sankey-svg` の初期表示と同じ既定値
- `filter` = どのノードを残すか（条件は AND 結合）。`view` = どう見せるか（TopN集約・ピン等）。通常は `filter` だけ指定すれば足りる
- 金額は1円単位。名前フィルタの `regex: false` は大文字小文字無視の部分一致、`regex: true` は正規表現（フラグ `i`、128文字以内）
- `ministries` は府省庁名の完全一致リスト
- `accountCategories`: `general`（一般会計）/ `special`（特別会計）/ `both` / `none`（区分情報なし）。省略 or 全4種 = フィルタなし
- 上限: `topMinistry` ≤ 37、`topProject` / `topRecipient` ≤ 300

### レスポンス

```json
{
  "metadata": {
    "year": 2024, "unit": "JPY", "notes": ["..."],
    "appliedQuery": { "（既定値補完後の SankeyQuery。省略時の解釈を確認できる）": "..." },
    "detail": "summary", "filterActive": true
  },
  "summary": {
    "projects": {
      "count": 15,
      "budgetTotal": 224800000000,
      "spendingTotal": 85900000000,
      "top": [{ "id": "project-spending-706", "projectId": 706, "name": "...", "ministry": "...", "budget": 0, "spending": 0 }]
    },
    "recipients": { "count": 65, "top": [{ "id": "r-...", "name": "...", "inflow": 0 }] },
    "ministries": { "count": 2, "names": ["環境省", "経済産業省"] }
  },
  "sankey": { "（detail=full のみ）nodes/edges/totalProjectCount/totalRecipientCount": "..." },
  "links": {
    "webView": "/sankey-svg?yr=2024&fp=1&fnp=...&fnpr=1&fmb=10億",
    "docs": "..."
  }
}
```

- `summary` はフィルタ適用後の**全マッチ**の集計（TopN集約前）。`top` は各10件
- `summary.projects.spendingTotal` は「残存事業 → 残存支出先」エッジの合計。支出先フィルタ使用時は事業の総支出より小さくなる
- `detail=full` の `sankey.nodes/edges` は TopN 集約後（= 図に描画される内容そのもの）
- 不正なクエリ（正規表現エラー・min>max・未知の会計区分等）は 400 で `details: string[]` に修正方法を返す

### AIエージェントの利用手順

1. 要求を `SankeyQuery` に翻訳し `detail=summary` で実行
2. `summary` の件数・金額で絞り込み過不足を判断し、条件を調整して再実行（0件 → 条件を緩める。語彙探索には `/api/search/projects` / `/api/search/recipients` を併用）
3. 確定したら `links.webView` の URL をユーザーに提示する

### /sankey-svg URLパラメータ対応表（短縮形）

`links.webView` が使用する。短縮形パラメータでこのAPIを直接呼ぶこともできる。

| 短縮キー | SankeyQuery フィールド | 備考 |
|---------|----------------------|------|
| `fnp` / `fnpr` | `filter.projectName.query` / `.regex` | `fnpr=1` で正規表現 |
| `fnr` / `fnrr` | `filter.recipientName.query` / `.regex` | 同上 |
| `fm`（複数可） | `filter.ministries[]` | 府省庁名 |
| `fmb` / `fxb` | `filter.budget.min` / `.max` | 金額テキスト（`10億`, `1兆` 等） |
| `fms` / `fxs` | `filter.spending.min` / `.max` | 同上 |
| `ac` | `filter.accountCategories` | `g`/`s`/`b`/`n` の連結（例: `ac=g`） |
| `tm` / `tp` / `tr` | `view.topMinistry` / `topProject` / `topRecipient` | |
| `pp` / `pr` / `pm` | `view.pin.projectId` / `recipientId` / `ministryName` | `pp` はノードID形式（`project-spending-<pid>`）、`pr` は `r-<支出先名>` |
| `fr` | `view.focusRelated` | `1` でON |
| `ro` / `po` / `ot` | `view.offset.recipient` / `.project` / `.target` | `ot=r` or `p` |
| `ps` | `view.projectSortBy` | `s` = spending |
| `ar` / `ap` / `sb` | `view.showAggRecipient` / `showAggProject` / `scaleBudgetToVisible` | `0` でOFF |
| `yr` | `year` | |
| `fp` | —（フィルタパネル表示） | webView では常に `1` |

### 実装（レイヤー）

- Domain: `app/lib/sankey-query.ts`（クエリ正規化・除外集合構築・サマリ・URL変換。`/sankey-svg` ページと共有）
- Loader: `app/lib/api/sankey-graph-loader.ts`（`sankey-svg-{year}-graph.json` のメモリキャッシュ）
- TopN集約: `app/lib/sankey-svg-filter.ts` の `filterTopN`（ページと同一関数）

---

## GET /api/search/projects

事業名の部分一致検索。

**クエリパラメータ**: `q`（必須）、`year`、`limit`（デフォルト20・上限100）、`offset`、`sort`（`budget` | `spending`）

**レスポンス**: `items[]`（pid・事業名・府省庁・予算/執行額・再委託有無）+ 各itemに `links`（`detail` / `subcontracts` / `sankeyView` 等）、`links.next` でページネーション。

---

## GET /api/search/recipients

支出先名の検索（recipient-index の正規化キーに対して）。

**クエリパラメータ**: `q`（必須）、`year`、`limit`（デフォルト20・上限100）

**レスポンス**: `items[]`（key・支出先名・法人番号・直接/再委託受注の件数と金額・事業数）+ 各itemに `links.recipient` / `links.sankeyView`。

---

## GET /api/recipients/[key]

支出先の逆引き詳細（府省庁横断の受注構造）。

**パスパラメータ**: `key` = 法人番号13桁 または `name:正規化名`

**クエリパラメータ**: `year`、`limit`（appearances の件数。デフォルト50・上限200）

**レスポンス**: `recipient`（name・corporateNumber・aliases・totals・byMinistry・appearances[]）。存在しないキーは 404 + 検索APIへの hint。直接受注と再委託受注の合算は二重計上になるため常に分離して扱うこと。

---

## GET /api/sankey/mof-overview

財務省（MOF）予算全体ビュー用の Sankey データを返す。

**クエリパラメータ**: なし

**データソース**: `public/data/mof-budget-overview-2023.json`（サーバープロセス内にタイムベースキャッシュ、TTL=1時間）

---

## GET /api/quality-scores

事業別品質スコア一覧を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |
| `pids` | string | — | 予算事業IDのカンマ区切り（最大300件）。指定時は該当事業のみの軽量プロジェクションを返す |

**レスポンス**:

- `pids` 未指定: `QualityScoresResponse`（全事業の `items` と `summary`。約7MB、`/quality` ページ用）
- `pids` 指定: `{ metadata, items }`。`items` は軽量プロジェクション（`pid`/`name`/`ministry`/`totalScore`/AI軸5種/`effectiveLevel`/`effectiveReason`/`aiSource` + `links`）。`metadata.missingPids` に見つからなかったIDを返す。エージェントが数事業のスコアを数KBで取得する用途

**注意**: 品質スコアは報告の**形式品質**（特定可能性・説明性・成果設計の明確さ）を測るもので、資金経路の透明性そのものではない（`metadata.notes` に同梱）。

**データソース**: `public/data/project-quality-scores-{year}.json`

---

## GET /api/quality-scores/[pid]

単一事業の品質スコア（軽量プロジェクション）を返す。サイドパネル表示・エージェント探索用。

**パスパラメータ**: `pid`（予算事業ID）

**クエリパラメータ**: `year`（`"2024"` | `"2025"`、デフォルト `"2024"`）

**レスポンス**: `{ metadata, score, links }`。`score` は上記軽量プロジェクションと同形。存在しない pid は 404 + 検索APIへの hint。

---

## GET /api/quality-scores/recipients

事業の支出先明細（品質詳細ダイアログ用）を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `pid` | string | **必須** | 予算事業ID |
| `year` | string | `"2024"` | 対象年度 |

**データソース**: `public/data/project-quality-recipients-{year}.json`

**レスポンス**: `RecipientRow[]`（支出先行ごとの品質情報）

フィールド名は短縮形（JSONサイズ削減）:

| フィールド | 意味 |
|-----------|------|
| `n` | 支出先名 |
| `b` | 支出先ブロック番号 |
| `s` | 判定ステータス（`valid`/`gov`/`supp`/`invalid`/`unknown`） |
| `c` | 法人番号記入あり |
| `o` | 不透明キーワードにマッチ |
| `a2` | 個別支出額（null=空欄） |
| `r` | ルートブロック（直接支出）か |
| `chain` | ブロック委託チェーン（例: `"組織→A→B"`） |
| `d` | 委託深度 |
| `role` | 事業を行う上での役割 |
| `cc` | 契約概要 |

---

## GET /api/project-details/[projectId]

事業詳細情報（事業概要・実施方法等）を返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/rs{year}-project-details.json`

---

## GET /api/subcontracts/[projectId]

再委託構造データを返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/subcontracts-{year}.json`

**レスポンス**: `SubcontractGraph`（ブロックノード・エッジ・支出先情報）
