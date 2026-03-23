# /sankey Global View 自前SVG移行計画

## 目的

ユーザーがスライダー等のインタラクション操作をした際に、nivo の SVG 全再構築による描画遅延を解消するため。React.memo による差分更新で、変更のないノード・リンクの再描画をスキップできるようにする。

## スコープ

- **対象**: Global View の Sankey 描画を nivo → 自前SVG（/sankey2方式）に置き換え
- **対象外**: Ministry / Project / Spending View（引き続き nivo を使用）
- **nivo 依存**: `/sankey` 以外（`/mof-budget-overview` 等）でも使用しているため、パッケージ自体は残す

## 現状分析

### nivo が提供している機能（Global View で使用中）

| 機能 | nivo の実装 | 自前SVG での代替 |
|------|-----------|-----------------|
| ノード配置（x, y 座標計算） | nivo 内部で d3-sankey を使用 | API レスポンスの nodes/links から自前計算、または既存 `sankey-generator.ts` にレイアウト計算を追加 |
| リンク描画（ベジェ曲線） | nivo 内部で path 生成 | SVG `<path>` に d3-sankey の `sankeyLinkHorizontal` を直接使用 |
| ノード描画 | SVG `<rect>` | SVG `<rect>` + React.memo |
| ラベル描画 | カスタムレイヤーで `<text>` | SVG `<text>` または `<foreignObject>`（/sankey2方式） |
| ホバーハイライト | `nodeHoverOthersOpacity: 0.35` | state + opacity 制御 |
| ツールチップ | nivo HTML overlay | HTML div overlay（既存のツールチップJSXをそのまま流用） |
| クリックハンドラ | `onClick` prop | SVG 要素の `onClick`（既存の `handleNodeClick` をそのまま流用） |
| ノードソート | `sort="input"` | データ順序をそのまま描画 |

### 最大の課題: レイアウト計算

nivo は内部で d3-sankey を使ってノードの x, y 座標とリンクのパスを計算している。自前SVG移行ではこの計算を自分で行う必要がある。

**選択肢:**

1. **d3-sankey を直接使用**: `d3-sankey` パッケージを import してレイアウト計算し、結果を SVG で描画
2. **サーバー側でレイアウト計算**: `sankey-generator.ts` で座標も計算してAPIレスポンスに含める（/sankey2 の `compute-sankey2-layout.ts` と同じアプローチ）

→ **選択肢1を採用**: クライアント側で d3-sankey を使い、nivo と同等のレイアウトを維持する。サーバー側変更が不要で、既存APIレスポンス（nodes + links）をそのまま使える。

## 設計

### コンポーネント構成

```
app/sankey/page.tsx
  └─ viewState.mode === 'global'
       ? <SankeyGlobalView />  ← 新規（自前SVG）
       : <ResponsiveSankey />  ← 既存（nivo、Ministry/Project/Spending用）
```

### SankeyGlobalView コンポーネント

`client/components/SankeyGlobalView.tsx` を新規作成。

**入力:**
- `data`: API レスポンスの `sankey`（`{ nodes: SankeyNode[], links: SankeyLink[] }`）
- `onNodeClick`: 既存の `handleNodeClick`
- `formatCurrency`: 既存の金額フォーマット関数

**内部処理:**
1. `useMemo` で d3-sankey レイアウトを計算（nodes に x0, x1, y0, y1 を付与、links にパスを付与）
2. SVG `<g>` 内にリンク→ノード→ラベルの順で描画
3. React.memo でノード・リンクをメモ化

**サブコンポーネント:**

| コンポーネント | 役割 |
|--------------|------|
| `MemoSankeyNode` | 単一ノードの `<rect>` + ホバー/クリック |
| `MemoSankeyLink` | 単一リンクの `<path>` |
| `SankeyLabels` | ノードラベル（金額 + 名前、既存カスタムレイヤーのロジックを移植） |

### ホバーハイライト

- `hoveredNodeId` state を管理
- ホバー中ノードに接続しているリンク・ノードは通常の opacity
- それ以外は `opacity: 0.35`（nivo の `nodeHoverOthersOpacity` と同じ値）
- 接続判定: `links` から source/target の隣接マップを事前構築

### ツールチップ

既存の `nodeTooltip` / `linkTooltip` の JSX をそのまま流用。SVG の上に absolute 配置の HTML div として重ねる。マウス座標から位置を計算。

### スライダー連携の改善

自前SVG移行により、スライダー操作時の描画が高速化される理由:
- API レスポンス受信後、d3-sankey レイアウトは `useMemo` で再計算（軽量）
- **変更のないノード（府省庁・事業列）は React.memo でスキップ**
- 変更のある支出先ノード・リンクのみ DOM 更新

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `client/components/SankeyGlobalView.tsx`（新規） | 自前SVG描画コンポーネント |
| `app/sankey/page.tsx` | Global View 時に `SankeyGlobalView` を使用、それ以外は既存 nivo を維持 |
| `package.json` | `d3-sankey` + `@types/d3-sankey` を追加 |

## ロードマップ

### Step 1: d3-sankey でレイアウト計算の検証

- `d3-sankey` をインストール
- 既存の API レスポンス（nodes + links）を d3-sankey に渡してレイアウト計算
- nivo と同等の座標が得られることを確認

### Step 2: SankeyGlobalView 基本描画

- ノード（`<rect>`）+ リンク（`<path>`）+ ラベル（`<text>`）の静的描画
- 既存の色分けロジック（緑=予算、赤=支出、グレー=その他）を移植
- 固定サイズ（800px高）での表示

### Step 3: インタラクション実装

- ノードクリック: 既存 `handleNodeClick` を接続
- ホバーハイライト: 隣接ノード・リンクの opacity 制御
- ツールチップ: 既存のツールチップ JSX を HTML overlay として配置

### Step 4: page.tsx の条件分岐

- `viewState.mode === 'global'` で `SankeyGlobalView` を使用
- それ以外のビューでは既存 `ResponsiveSankey` を維持
- スライダーとの連携動作を確認

### Step 5: 動作確認・調整

- nivo との見た目の差分を確認・調整
- スライダー操作時のパフォーマンスを確認
- `npm run lint` + `npx tsc --noEmit`

## レイヤー設計ルール適合チェック

- `scripts/`: 変更なし
- `app/lib/`: 変更なし（既存の sankey-generator.ts はそのまま）
- `app/api/`: 変更なし
- `client/components/`: 再利用可能UI。直接APIコールなし
- `app/sankey/page.tsx`: 描画コンポーネントの切り替えのみ
