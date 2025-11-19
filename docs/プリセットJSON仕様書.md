# RS2024 プリセットJSON仕様書

## 概要

初期表示用の軽量なプリセットJSONファイルを生成する。サンキー図の初期表示を高速化するため、事前にTop3フィルタリングを適用したデータを提供する。

5列サンキー図構造により、予算総計 → 府省庁（予算）→ 事業（予算）→ 事業（支出）→ 支出先の全体フローを可視化する。

## データソース

`public/data/rs2024-structured.json` - 構造化済みの完全データ（約110MB）

## 出力ファイル

### Top3プリセット
- ファイル名: `public/data/rs2024-preset-top3.json`
- ファイルサイズ: 約29KB
- ノード数: 45
- リンク数: 61
- カバー率: 約50%（73.58兆円 / 146.63兆円）

## データ構造

### トップレベル構造

```typescript
interface RS2024PresetData {
  metadata: PresetMetadata;
  sankey: SankeyData;
}
```

### 1. プリセットメタデータ (PresetMetadata)

```typescript
interface PresetMetadata {
  generatedAt: string;           // ISO 8601形式の生成日時
  fiscalYear: number;             // 会計年度（2024）
  presetType: string;             // プリセットタイプ（例: "top3"）
  sourceFile: string;             // 元データファイル名

  // フィルタリング設定
  filterSettings: {
    topMinistries: number;        // 府省庁のTop件数（3）
    topProjects: number;          // 事業のTop件数（3）
    topSpendings: number;         // 支出先のTop件数（3）
    sortBy: 'budget' | 'spending'; // ソート基準（'budget'）
  };

  // 統計サマリ
  summary: {
    totalMinistries: number;      // 元データの総府省庁数
    totalProjects: number;         // 元データの総事業数
    totalSpendings: number;        // 元データの総支出先数
    selectedMinistries: number;    // 選択された府省庁数（3 + その他）
    selectedProjects: number;      // 選択された事業数（9 + その他）
    selectedSpendings: number;     // 選択された支出先数（17 + その他 + その他の支出先）
    totalBudget: number;           // 元データの総予算額
    selectedBudget: number;        // 選択されたデータの総予算額
    coverageRate: number;          // カバー率（%、0-100）
  };
}
```

### 2. サンキーデータ (SankeyData)

```typescript
interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}
```

### 3. サンキーノード (SankeyNode)

```typescript
interface SankeyNode {
  id: string;                     // ノードの一意識別子
  name: string;                   // ノード表示名
  type: 'ministry-budget' | 'project-budget' | 'project-spending' | 'recipient' | 'other';
  value: number;                  // ノードの値（予算額または支出額、円）
  originalId?: number;            // 元データのID
  details?: MinistryNodeDetails | ProjectBudgetNodeDetails |
            ProjectSpendingNodeDetails | RecipientNodeDetails;
}
```

#### ノードタイプ

- **`ministry-budget`**: 府省庁（予算）ノード（列1）
- **`project-budget`**: 事業（予算）ノード（列2）
- **`project-spending`**: 事業（支出）ノード（列3）
- **`recipient`**: 支出先ノード（列4）
- **`other`**: その他ノード（集約ノード）

#### 府省庁ノードの詳細 (MinistryNodeDetails)

```typescript
interface MinistryNodeDetails {
  projectCount: number;           // 事業数
  bureauCount: number;            // 局・庁数
}
```

#### 事業（予算）ノードの詳細 (ProjectBudgetNodeDetails)

```typescript
interface ProjectBudgetNodeDetails {
  ministry: string;               // 所属府省庁
  bureau: string;                 // 所属局・庁
  fiscalYear: number;             // 会計年度
  initialBudget: number;          // 当初予算(合計)
  supplementaryBudget: number;    // 補正予算(合計)
  carryoverBudget: number;        // 前年度からの繰越し(合計)
  reserveFund: number;            // 予備費等(合計)
  totalBudget: number;            // 計(歳出予算現額合計)
  executedAmount: number;         // 執行額(合計)
  carryoverToNext: number;        // 翌年度への繰越し(合計)
  accountCategory: string;        // 会計区分（一般会計、特別会計）
}
```

#### 事業（支出）ノードの詳細 (ProjectSpendingNodeDetails)

```typescript
interface ProjectSpendingNodeDetails {
  ministry: string;               // 所属府省庁
  bureau: string;                 // 所属局・庁
  fiscalYear: number;             // 会計年度
  executionRate: number;          // 執行率（%）
  spendingCount: number;          // 支出先数
}
```

#### 支出先ノードの詳細 (RecipientNodeDetails)

```typescript
interface RecipientNodeDetails {
  corporateNumber: string;        // 法人番号
  location: string;               // 所在地
  projectCount: number;           // 支出元事業数
}
```

### 4. サンキーリンク (SankeyLink)

```typescript
interface SankeyLink {
  source: string;                 // 送信元ノードID
  target: string;                 // 送信先ノードID
  value: number;                  // リンクの値（金額、円）
  details?: {
    contractMethod?: string;      // 契約方式
    blockName?: string;           // 支出先ブロック名
  };
}
```

## 5列サンキー図構造

```
列0: 予算総計 (budget-total)
  ↓
列1: 府省庁（予算）
  - ministry-budget-{id} (Top3府省庁)
  - ministry-budget-other (その他の府省庁)
  ↓
列2: 事業（予算）
  - project-budget-{id} (各府省庁のTop3事業)
  - project-budget-other-{ministryId} (その他の事業)
  ↓
列3: 事業（支出）
  - project-spending-{id} (列2と同じ事業の支出ビュー)
  ↓
列4: 支出先
  - recipient-{id} (各事業のTop3支出先)
  - recipient-other-named (支出先名が「その他」のもの全体)
  - recipient-other-aggregated (その他の支出先)
```

## Top3再帰選択アルゴリズム

### ステップ1: Top3府省庁を選択

予算額（totalBudget）でソートし、上位3府省庁を選択。

```typescript
const topMinistries = data.budgetTree.ministries
  .sort((a, b) => b.totalBudget - a.totalBudget)
  .slice(0, 3);

// その他の府省庁の予算合計を計算
const otherMinistriesBudget = data.budgetTree.ministries
  .slice(3)
  .reduce((sum, m) => sum + m.totalBudget, 0);
```

### ステップ2: 各府省庁のTop3事業を選択

各府省庁ごとに、所属する全事業を予算額でソートし上位3件を選択。

```typescript
for (const ministry of topMinistries) {
  const ministryProjects = data.budgets
    .filter(p => p.ministry === ministry.name);

  const top3Projects = ministryProjects
    .sort((a, b) => b.totalBudget - a.totalBudget)
    .slice(0, 3);

  // その他の事業の予算合計を計算
  const otherBudget = ministryProjects
    .slice(3)
    .reduce((sum, p) => sum + p.totalBudget, 0);
}
```

### ステップ3: 全事業から支出先名「その他」への支出を集計

TopNフィルタリングの前に、全事業から支出先名が「その他」である支出を抽出し、集計する。

```typescript
const otherNamedSpendingByProject = new Map<number, number>();

for (const project of data.budgets) {
  const otherNamedSpendings = data.spendings
    .filter(s => project.spendingIds.includes(s.spendingId))
    .filter(s => s.spendingName === 'その他');

  const otherNamedTotal = otherNamedSpendings.reduce((sum, s) => {
    const projectSpending = s.projects.find(p => p.projectId === project.projectId);
    return sum + (projectSpending?.amount || 0);
  }, 0);

  if (otherNamedTotal > 0) {
    otherNamedSpendingByProject.set(project.projectId, otherNamedTotal);
  }
}
```

### ステップ4: 各Top3事業のTop3支出先を選択（「その他」を除く）

各事業ごとに、「その他」を除外した支出先を支出額でソートし上位3件を選択。

```typescript
for (const project of topProjects) {
  const projectSpendings = data.spendings
    .filter(s => project.spendingIds.includes(s.spendingId))
    .filter(s => s.spendingName !== 'その他')  // 「その他」を除外
    .map(s => {
      const projectSpending = s.projects.find(p => p.projectId === project.projectId);
      return {
        spending: s,
        amountFromThisProject: projectSpending?.amount || 0,
      };
    });

  const top3Spendings = projectSpendings
    .sort((a, b) => b.amountFromThisProject - a.amountFromThisProject)
    .slice(0, 3);

  // その他の支出先の合計（「その他」という名前のものは含まない）
  const otherSpendingTotal = projectSpendings
    .slice(3)
    .reduce((sum, ps) => sum + ps.amountFromThisProject, 0);
}
```

## 「その他」ノードと「その他の支出先」ノードの分離

### 設計原則

1. **「その他」ノード (`recipient-other-named`)**
   - 支出先名が「その他」である全事業からの支出を集約
   - 約26兆円
   - 独立した最終ノード

2. **「その他の支出先」ノード (`recipient-other-aggregated`)**
   - TopN以外の支出先への支出
   - その他の事業（予算）からの予算額（「その他」支出を除く）
   - その他の府省庁の予算額（「その他」支出を除く）
   - 約51兆円
   - 独立した最終ノード

3. **両者の関係**
   - 相互にリンクは存在しない
   - それぞれが独立した最終ノード

### 「その他」ノードへのリンク

```typescript
// Top3事業（支出）→ 「その他」ノード
for (const [projectId, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
  if (topProjectIds.has(projectId)) {
    links.push({
      source: `project-spending-${projectId}`,
      target: 'recipient-other-named',
      value: otherNamedAmount,
    });
  }
}

// その他の事業（予算）→ 「その他」ノード
for (const [ministryId, amount] of otherProjectsOtherNamedByMinistry.entries()) {
  links.push({
    source: `project-budget-other-${ministryId}`,
    target: 'recipient-other-named',
    value: amount,
  });
}

// その他の府省庁 → 「その他」ノード
if (otherMinistriesOtherNamedAmount > 0) {
  links.push({
    source: 'ministry-budget-other',
    target: 'recipient-other-named',
    value: otherMinistriesOtherNamedAmount,
  });
}
```

### 「その他の支出先」ノードへのリンク

```typescript
// その他の事業（予算）→ その他の支出先（「その他」支出を除く）
for (const ministry of topMinistries) {
  const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
  const otherNamedAmount = otherProjectsOtherNamedByMinistry.get(ministry.name);
  const adjustedBudget = otherBudget - otherNamedAmount;

  if (adjustedBudget > 0) {
    links.push({
      source: `project-budget-other-${ministry.id}`,
      target: 'recipient-other-aggregated',
      value: adjustedBudget,
    });
  }
}

// その他の府省庁 → その他の支出先（「その他」支出を除く）
const adjustedOtherMinistriesBudget = otherMinistriesBudget - otherMinistriesOtherNamedAmount;
if (adjustedOtherMinistriesBudget > 0) {
  links.push({
    source: 'ministry-budget-other',
    target: 'recipient-other-aggregated',
    value: adjustedOtherMinistriesBudget,
  });
}

// Top3事業（支出）→ その他の支出先（TopN以外）
for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
  if (otherAmount > 0) {
    links.push({
      source: `project-spending-${projectId}`,
      target: 'recipient-other-aggregated',
      value: otherAmount,
    });
  }
}
```

## ノードの並び順

Nivoの`sort="input"`を使用して配列の順序を保持する。

### 列4: 支出先ノードの順序

```typescript
const recipientNodes = [
  ...regularRecipients,      // 1. 通常の受取先（TopN）
  otherNamedRecipient,       // 2. 「その他」ノード
  aggregatedOther,           // 3. 「その他の支出先」ノード
];
```

## 生成スクリプト

`scripts/generate-preset-json.ts`

### 主要関数

1. **`selectTop3`**: Top3再帰選択アルゴリズムの実装
   - Top3府省庁を選択
   - 各府省庁のTop3事業を選択
   - 全事業から「その他」支出先への支出を集計
   - 各事業のTop3支出先を選択（「その他」を除く）

2. **`calculateOtherProjectsOtherNamedByMinistry`**: 各府省庁のTop3以外の事業からの「その他」支出を集計

3. **`calculateOtherMinistriesOtherNamed`**: その他の府省庁からの「その他」支出を集計

4. **`buildSankeyData`**: サンキー図データ構築
   - ノード生成（5列構造）
   - リンク生成
   - 「その他」ノードと「その他の支出先」ノードの分離

## 可視化での利用

### Next.js App Router

`app/sankey/page.tsx` でプリセットJSONを読み込み、Nivoサンキー図で可視化。

```typescript
const response = await fetch(`/data/rs2024-preset-top3.json?v=${timestamp}`);
const json: RS2024PresetData = await response.json();
```

### 色分け

- **予算ベース（緑系）**: `ministry-budget`, `project-budget`
- **支出ベース（赤系）**: `project-spending`, `recipient`
- **その他（グレー）**: 名前が「その他」で始まるノード

### ツールチップ

- ノードタイプに応じた詳細情報を表示
- 予算内訳（当初予算、補正予算、繰越等）
- 支出先情報（法人番号、所在地等）

## パフォーマンス

- ファイルサイズ: 約29KB（構造化JSONの約110MBから大幅削減）
- 初期表示時間: < 100ms
- カバー率: 約50%（主要な予算・支出の流れを追跡可能）

## 今後の拡張

- Top5, Top10プリセットの追加
- 動的TopNフィルタリング（完全データからクライアントサイドで生成）
- 事業カテゴリ別フィルタリング
- 年度比較機能
