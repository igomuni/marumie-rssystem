# /sankey Global View → /sankey2 方式移行計画

## 目的

ユーザーがスライダーで支出先の表示範囲を変更した際に、全列（府省庁・事業・支出先）が動的に入れ替わるインタラクションを **即座（16ms以内）** に実現するため。

現在の SVG + d3-sankey 方式では、ノード入れ替えのたびにレイアウト全体を再計算する必要があり、スライダー操作に数百msの遅延が発生する。/sankey2 方式（事前計算レイアウト + SVG描画）に移行することで、ランタイムのレイアウト計算をゼロにする。

## 現状の課題

| 項目 | 現在の実装（SVG + d3-sankey） | 問題 |
|------|---------------------------|------|
| レイアウト計算 | スライダー操作のたびに d3-sankey で全ノード再計算 | 数百msの遅延 |
| 描画更新 | React.memo で差分更新 | レイアウト計算がボトルネックで効果限定的 |
| データ取得 | API + クライアント側生成のハイブリッド | 複雑で保守困難 |
| 全列入れ替え | 未実装（支出先列のみ差し替え） | 本来やりたいことができない |

## /sankey2 方式の核心

/sankey2 は以下の2段階パイプラインで動作する:

1. **ビルド時**: 全ノード・全エッジの座標を事前計算し、JSONに保存
2. **ランタイム**: クライアントはJSONから座標を読み、表示対象のノード・エッジだけをSVGに描画

ランタイムにレイアウト計算が一切ない。表示対象の切り替え = 配列のフィルタリングのみ。

## 設計

### アプローチ: スライダーレベル別の事前計算レイアウト

Global View のスライダーは「支出先の表示範囲」を10件ずつページングする。各レベル（ページ）に応じて表示する府省庁・事業・支出先が変わる。

**事前計算の単位**: スライダーの各レベル（0, 1, 2, ...）ごとに、表示すべきノード・リンクとその座標を計算してJSONに格納する。

### データパイプライン

```
[既存] sankey-generator.ts (selectData + buildSankeyData)
    ↓ レベルごとにノード・リンクを生成
[新規] compute-sankey-global-layout.ts
    ↓ 各レベルのノード・リンクに座標を付与
[出力] sankey-global-layout.json(.gz)
```

### レイアウト計算方式

/sankey2 はツリーマップ（面積ベース）のレイアウトだが、/sankey の Global View は**列ベースの Sankey レイアウト**（左から右への流れ）。

レイアウト計算には2つの選択肢がある:

#### 選択肢A: d3-sankey をビルド時に実行

- 現在クライアントで行っている d3-sankey のレイアウト計算を、ビルドスクリプトで全レベル分実行
- 出力: 各レベルの `{ nodes: [{id, x0, x1, y0, y1, ...}], links: [{source, target, path, width, ...}] }`
- メリット: 現在の見た目をそのまま維持、実装が最もシンプル
- デメリット: レベル間でノード位置が大きく変わる可能性（アニメーションなしだとジャンプ感）

#### 選択肢B: 固定列 + 可変高さの自前レイアウト

- 府省庁・事業・支出先の3列（+集約ノード）の x 座標を固定
- 各ノードの y 座標と高さを金額比例で計算（d3-sankey 不使用）
- リンクはベジェ曲線で接続
- メリット: レイアウトロジックを完全制御、レベル間の遷移を安定化しやすい
- デメリット: 実装コスト高、d3-sankey の最適配置アルゴリズムを再実装する必要

→ **選択肢A を推奨**。見た目の変更を最小限にし、実装リスクを抑える。

### 出力データ構造

```
sankey-global-layout.json:
{
  "metadata": {
    "totalLevels": 2683,        // 総レベル数（ceil(26823/10)）
    "recipientsPerLevel": 10,
    "totalRecipients": 26823
  },
  "levels": {
    "0": {
      "nodes": [
        { "id": "ministry-budget-1", "name": "...", "type": "ministry-budget",
          "x0": 0, "x1": 44, "y0": 100, "y1": 300, "value": 12345678,
          "details": { ... } },
        ...
      ],
      "links": [
        { "source": "ministry-budget-1", "target": "project-budget-123",
          "value": 5000000, "path": "M0,150C200,150,200,200,400,200",
          "details": { ... } },
        ...
      ]
    },
    "1": { ... },
    ...
  }
}
```

### ファイルサイズの見積もり

- 各レベル: 約50〜100ノード + 100〜200リンク（座標付き）≒ 約30KB/レベル
- 総レベル数: ~2,683（26,823件 / 10件）
- 合計: ~80MB（非圧縮）、~8MB（gzip）
- 既存の sankey2-layout.json（~45MB gzip）と同程度

### 最適化: 共通ノードの差分格納

多くのレベルで府省庁ノードは共通。差分格納で大幅にサイズを削減できる:

```
{
  "baseNodes": [ ... ],        // 全レベル共通のノード（府省庁等）
  "levels": {
    "0": {
      "nodes": [ ... ],        // このレベル固有のノード（支出先等）のみ
      "links": [ ... ],
      "removedNodeIds": [ ... ] // baseNodesから除外するID（もしあれば）
    }
  }
}
```

→ ただし全列入れ替えが要件なので、レベルによって府省庁・事業も変わる可能性あり。初回は差分格納なしで実装し、サイズが問題になったら最適化する。

### クライアント側コンポーネント

```
app/sankey/page.tsx
  └─ viewState.mode === 'global'
       ? <SankeyGlobalView />   ← 改修（事前計算レイアウトを描画）
       : <ResponsiveSankey />   ← 既存（nivo、Ministry/Project/Spending用）
```

**SankeyGlobalView の変更点**:

1. データソース変更: d3-sankey レイアウト計算 → 事前計算JSONからレベル別データを取得
2. スライダー操作: `levels[level]` を参照するだけ（計算なし）
3. 描画ロジック: 既存のSVG描画（MemoNode, MemoLink）をそのまま活用

### データ読み込み戦略

sankey-global-layout.json は ~8MB(gz) あるため、全レベルを一括読み込みするとメモリ消費が大きい。

#### 方式: レベル別の遅延読み込み + キャッシュ

- JSONを1ファイルにまとめるのではなく、レベルごとに分割ファイルを生成
- または、1ファイルだがクライアントで全読み込みしてメモリに保持（8MBなら許容範囲）

→ **1ファイル全読み込みを推奨**。8MB(gz)はモダンブラウザで問題なく、レベル切り替えが完全に即座になる。分割ファイルだとフェッチ待ちが発生する。

### スライダー操作時のフロー

```
ユーザーがスライダーを操作
  ↓
spendingDrilldownLevel が変更
  ↓
levels[level] からノード・リンクを取得（O(1)参照）
  ↓
SVG描画更新（React.memoで差分のみ）
  ↓
即座に表示（レイアウト計算なし）
```

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `scripts/compute-sankey-global-layout.ts`（新規） | 全レベルの事前計算レイアウト生成スクリプト |
| `client/components/SankeyGlobalView.tsx` | d3-sankey → 事前計算レイアウト参照に変更 |
| `app/sankey/page.tsx` | データ読み込みを事前計算JSON方式に変更 |
| `package.json` | scripts に `compute-sankey-global-layout` を追加 |

**変更不要**:
- `app/lib/sankey-generator.ts` — ビルドスクリプトから呼び出して使用（既存ロジックを流用）
- `app/api/sankey/route.ts` — Global View以外のビューでは引き続き使用
- `types/preset.ts` — 既存の型をビルドスクリプトでも使用

## ロードマップ

### Step 1: ビルドスクリプト作成

- `scripts/compute-sankey-global-layout.ts` を新規作成
- 既存の `sankey-generator.ts` の `selectData` + `buildSankeyData` を呼び出し、全レベル分のノード・リンクを生成
- 各レベルのデータに d3-sankey でレイアウト座標を付与
- `public/data/sankey-global-layout.json` に出力

### Step 2: SankeyGlobalView の改修

- d3-sankey のランタイム計算を削除
- 事前計算JSONからレベル別データを参照して描画
- 既存のSVG描画ロジック（MemoNode, MemoLink, ホバー, ツールチップ）はそのまま

### Step 3: page.tsx のデータ読み込み変更

- Global View 初期化時に `sankey-global-layout.json` を一括読み込み
- スライダー操作時は `levels[level]` を参照するだけに簡素化
- `buildGlobalSankeyForLevel`（クライアント側生成ロジック）を削除

### Step 4: パイプライン統合

- `package.json` に `compute-sankey-global-layout` スクリプトを追加
- `compress-data` で `.gz` 化
- `prebuild` で自動展開されることを確認

### Step 5: 動作確認・調整

- スライダー操作の即座性を確認
- nivo との見た目の差分を確認・調整
- `npm run lint` + `npx tsc --noEmit`

## レイヤー設計ルール適合チェック

- `scripts/`: CSV/JSON処理のみ。UIやAPIロジックなし
- `app/lib/`: ビルドスクリプトからの呼び出し用。HTTP・React禁止を維持
- `app/api/`: Global View 以外のビューで引き続き使用
- `client/components/`: 再利用可能UI。直接APIコールなし
- `app/sankey/page.tsx`: 状態管理・データ読み込み・レイアウトのみ

## 検討事項

### 全列入れ替えの実現方法

現在のサーバー側ロジック（`selectData`）は、`spendingDrilldownLevel` に応じて表示する事業・府省庁を動的に選択している。レベル0ではTopN事業のみ、レベル1以降では該当支出先に紐づく全事業が表示される。この既存ロジックをビルドスクリプトでレベルごとに実行することで、全列入れ替えを実現する。

### d3-sankey パッケージの扱い

- ビルドスクリプトで使用（事前計算用）
- クライアント側では不要になる（`SankeyGlobalView` から削除可能）
- ただし Ministry/Project/Spending View の nivo が内部で使用しているため、パッケージ自体は残す
