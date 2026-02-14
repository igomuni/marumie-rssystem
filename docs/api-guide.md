# API Guide

`/api/sankey` エンドポイントの仕様。

---

## GET /api/sankey

動的に Sankey データを生成して返す。

### クエリパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `offset` | number | 0 | 府省庁ページネーション（グローバルビューのみ） |
| `limit` | number | 3 | 表示する府省庁数（TopN） |
| `projectLimit` | number | 3 | 府省庁ごとの事業数（TopN） |
| `spendingLimit` | number | 3 | 事業ごとの支出先数（TopN） |
| `ministryName` | string | — | 府省庁ビュー：絞り込む府省庁名 |
| `projectName` | string | — | 事業ビュー：絞り込む事業名 |
| `recipientName` | string | — | 支出先ビュー：絞り込む支出先名 |

### ビュータイプの判定ロジック

```
recipientName あり → presetType: 'spending'
projectName あり   → presetType: 'project'
ministryName あり  → presetType: 'ministry'
それ以外           → presetType: 'global'
```

### レスポンス（RS2024PresetData）

```typescript
{
  metadata: {
    generatedAt: string          // ISO8601
    fiscalYear: 2024
    presetType: 'global' | 'ministry' | 'project' | 'spending'
    filterSettings: {
      topMinistries: number
      topProjects: number
      topSpendings: number
      sortBy: string
    }
    summary: {
      totalMinistries: number    // 全府省庁数
      totalProjects: number      // 全事業数
      totalSpendings: number     // 全支出先数
      selectedMinistries: number // 選択された府省庁数
      selectedProjects: number   // 選択された事業数
      selectedSpendings: number  // 選択された支出先数
      totalBudget: number        // 全体予算（1円単位）
      selectedBudget: number     // 選択範囲の予算（1円単位）
      coverageRate: number       // カバレッジ率（%）
    }
  },
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
  }
}
```

### サーバー側処理（sankey-generator.ts）

1. `rs2024-structured.json` を読み込み（メモリキャッシュ）
2. ビュータイプとフィルタに基づいてデータを選択
3. Sankey ノードとリンクを構築
4. カバレッジ統計を含むメタデータを生成
5. JSON で返却

### URLとビューの対応

| URL | ビュータイプ |
|-----|-------------|
| `/api/sankey` | global（全府省庁 Top3） |
| `/api/sankey?offset=3` | global（次の府省庁ページ） |
| `/api/sankey?ministryName=厚生労働省&limit=5` | ministry |
| `/api/sankey?ministryName=厚生労働省&projectName=事業名` | project |
| `/api/sankey?recipientName=支出先名` | spending |
