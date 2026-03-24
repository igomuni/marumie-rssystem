# /sankey Global View 事前計算の最適化

## 目的

スライダーのレベルごとに全列（府省庁・事業・支出先）が正しく入れ替わる事前計算レイアウトを、実用的な時間（数分以内）で生成できるようにする。

## 問題

### 現在の不具合: 支出先ノードが表示されない

`buildSankeyForLevel`（支出先列のみ差し替え方式）では、レベル0のトップ事業に紐づくプロジェクト参照しか `allRecipients` に含まれていない。下位の支出先は別の事業に紐づいているため、リンクが0本 → ノードがフィルタアウトされる。

### d3-sankey の列シフト問題

支出先ノードがないと、d3-sankey の `sankeyJustify` アライメントが事業ノードを最右列に押し出す。これは d3-sankey の仕様（下流リンクのないノードを右端に配置）。

### パフォーマンス問題

`generateSankeyData` を全レベル（~1,042回）呼ぶと、`selectData` 内の以下の処理が毎回繰り返される:

| 処理 | 計算量 | レベル依存 |
|------|--------|-----------|
| 1. 府省庁選択 | O(37) | なし（共通） |
| 2. 事業フィルタ | O(5,003) | なし（共通） |
| 3. 支出先ランキング計算 | O(26,823 × projects) | なし（共通） |
| 4. 支出先スライス | O(1) | **レベルごとに異なる** |
| 5. 貢献事業の選択 | O(5,003 × spendings) | **レベルごとに異なる** |
| 6. その他事業の集計 | O(ministries) | **レベルごとに異なる** |

処理1-3は全レベルで同一の結果を返す。処理4-6のみがレベルに依存する。

## 設計

### アプローチ: `selectData` を2段階に分離

`selectData` を「共通計算」と「レベル依存計算」に分離する。

#### Phase 1: 共通計算（1回のみ実行）

```
selectGlobalBase(data, { limit, drilldownLevel })
  → topMinistries
  → projectsFromSelectedMinistries
  → allRecipients（ランキング済み、全件）
  → recipientSpendingMap
  → otherMinistriesBudget / otherMinistriesSpending
```

#### Phase 2: レベル依存計算（レベルごとに実行）

```
selectGlobalLevel(base, { spendingOffset, spendingLimit })
  → topSpendings（スライス）
  → topProjects（貢献事業の選択）
  → otherProjectsBudgetByMinistry
  → otherProjectsSpendingByMinistry
  → otherSpendingsByProject
  → otherNamedSpendingByProject
```

### ビルドスクリプトのフロー

```
1. selectGlobalBase() を1回呼ぶ（~3秒）
2. for level in 0..totalLevels:
     a. selectGlobalLevel(base, level) でデータ選択（~数ms）
     b. buildSankeyData(selection) でノード・リンク構築（~数ms）
     c. computeLayout() で d3-sankey レイアウト計算（~数ms）
     d. 結果を levels[level] に格納
3. JSON出力
```

### 既存コードへの影響

`selectData` を直接分割するのではなく、**ビルドスクリプト専用の関数を新設**する。

理由:
- `selectData` は既にMinistry/Project/Spending Viewでも使われており、分割するとリスクが高い
- ビルドスクリプトはGlobal Viewのみが対象
- 既存の `generateSankeyData` のAPIコールパスは変更しない

### 新設する関数

`scripts/compute-sankey-global-layout.ts` 内に以下の関数を実装:

1. **`computeGlobalBase()`** — 共通計算。`selectData` のGlobal View部分（L500-590）を抽出
2. **`computeGlobalLevel()`** — レベル依存計算。`selectData` のL622-726を抽出
3. **`buildGlobalSankeyNodes()`** — `buildSankeyData` のGlobal View固有パスを抽出

これらはスクリプト内のローカル関数とし、`app/lib/` には追加しない（レイヤー設計ルール: `scripts/` にUIやAPIロジック禁止）。

### 処理5の最適化: 逆引きインデックス

現在の「各事業の支出先への支出額計算」は、事業ごとに全支出先をスキャンしている（O(N×M)）。

事前に「支出先ID → [(projectId, amount)]」の逆引きマップを構築することで O(N+M) に削減:

```
spendingToProjects: Map<spendingId, Array<{projectId, amount}>>

for spending in data.spendings:
  for project in spending.projects:
    spendingToProjects[spending.spendingId].push({projectId, amount})
```

これにより、レベルごとの貢献事業計算が:
- Before: 5,003事業 × 26,823支出先のネストループ
- After: 10支出先 × 平均projects数のルックアップ

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `scripts/compute-sankey-global-layout.ts` | 共通計算分離 + 逆引きインデックス + レベル別データ生成 |

**変更なし**: `app/lib/sankey-generator.ts`, `client/components/SankeyGlobalView.tsx`, `app/sankey/page.tsx`
（前回のコミットでの変更をそのまま維持）

## レイヤー設計ルール適合チェック

- `scripts/`: CSV/JSON処理のみ。新設関数はスクリプト内ローカル
- `app/lib/`: 変更なし
- `client/components/`: 変更なし
