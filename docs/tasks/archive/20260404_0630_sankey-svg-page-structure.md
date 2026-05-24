# /sankey-svg page.tsx 現在の構成

> 作成日: 2026-04-04  
> 更新日: 2026-04-04（PR #125 リファクタリング後）  
> 対象ファイル: `app/sankey-svg/page.tsx`（約1171行、リファクタリング前: 1646行）  
> 目的: Issue #116 コンポーネント分割に向けた現状把握

---

## ファイル全体の構成（PR #125 リファクタリング後）

純粋ロジック・型・定数を3ファイルに抽出済み:

```text
types/sankey-svg.ts                  ← 型定義（RawNode, RawEdge, GraphData, LayoutNode, LayoutLink）
app/lib/sankey-svg-constants.ts      ← 定数 + 純粋関数（COL_MAP, MARGIN, getNodeColor, ribbonPath, formatYen 等）
app/lib/sankey-svg-filter.ts         ← フィルタ・レイアウトエンジン（filterTopN, computeLayout）
app/sankey-svg/page.tsx              ← コンポーネント本体（~1171行）
    ├── Imports（3ファイルから）
    └── RealDataSankeyPage コンポーネント
        ├── State
        ├── Refs
        ├── Handlers・Callbacks
        └── JSX
```

---

## Types

| 型名 | 用途 |
|---|---|
| `RawNode` | graphData から取得するノード |
| `RawEdge` | graphData から取得するエッジ |
| `GraphData` | API レスポンス |
| `LayoutNode` | RawNode + レイアウト座標・リンク |
| `LayoutLink` | レイアウト計算後のエッジ（座標付き） |

---

## モジュールレベル関数

| 関数 | 行 | 説明 |
|---|---|---|
| `getColumn` | 72 | ノードタイプ → 列番号 |
| `sortPriority` | 76 | ノードの描画順（集約ノードを末尾に） |
| `getNodeColor` | 103 | ノードタイプ → fill色 |
| `getLinkColor` | 108 | リンク target タイプ → stroke色 |
| `filterTopN` | 116 | graphData を TopN でフィルタ。`pinnedProjectId` でTopN+1強制追加 |
| `computeLayout` | 351 | フィルタ済みノード/エッジ → 座標計算 |
| `ribbonPath` | 464 | リンクの SVG path 文字列生成 |
| `formatYen` | 477 | 金額 → 兆/億/円フォーマット |

---

## State 一覧

### データ

| state | 型 | 初期値 | 説明 |
|---|---|---|---|
| `graphData` | `GraphData \| null` | null | API から取得したグラフデータ |
| `loading` | boolean | true | データ取得中フラグ |
| `error` | `string \| null` | null | エラーメッセージ |

### TopN / ウィンドウ設定

| state | 型 | 初期値 | 説明 |
|---|---|---|---|
| `topMinistry` | number | 37 | TopN省庁数 |
| `topProject` | number | 100 | TopN事業数 |
| `topRecipient` | number | 100 | 支出先ウィンドウサイズ |
| `recipientOffset` | number | 0 | 支出先ウィンドウ開始位置 |
| `pinnedProjectId` | `string \| null` | null | TopN外から強制追加する事業ID |

### ホバー / インタラクション

| state | 型 | 説明 |
|---|---|---|
| `hoveredLink` | `LayoutLink \| null` | ホバー中のリンク |
| `hoveredNode` | `LayoutNode \| null` | ホバー中のノード |
| `hoveredColIndex` | `number \| null` | ホバー中の列ヘッダー番号 |
| `mousePos` | `{x,y}` | マウス座標（DOM tooltip 位置） |
| `showSettings` | boolean | 設定ポップオーバー表示フラグ |

### ズーム / パン

| state | 型 | 説明 |
|---|---|---|
| `zoom` | number | 現在のズーム倍率 |
| `pan` | `{x,y}` | 現在のパン位置 |
| `isPanning` | boolean | パン操作中フラグ |
| `baseZoom` | number | fit-to-view 時の基準ズーム（1000% = baseZoom×10） |
| `isEditingZoom` | boolean | Zoom% 数値入力モード |
| `zoomInputValue` | string | Zoom% 入力バッファ |

### ビューポート

| state | 型 | 説明 |
|---|---|---|
| `svgWidth` | number | SVG コンテナ幅（ResizeObserver） |
| `svgHeight` | number | SVG コンテナ高さ（ResizeObserver） |

### サイドパネル / 選択

| state | 型 | 説明 |
|---|---|---|
| `selectedNodeId` | `string \| null` | 選択中ノードID |
| `isPanelCollapsed` | boolean | サイドパネル折りたたみ状態 |
| `inDisplayCount` | number | 流入元リスト表示件数（初期8） |
| `outDisplayCount` | number | 流出先リスト表示件数（初期8） |

### 検索

| state | 型 | 説明 |
|---|---|---|
| `searchQuery` | string | 検索入力値 |
| `debouncedQuery` | string | 150ms デバウンス後の値 |
| `showSearchResults` | boolean | ドロップダウン表示フラグ |

### オフセット入力

| state | 型 | 説明 |
|---|---|---|
| `isEditingOffset` | boolean | オフセット数値入力モード |
| `offsetInputValue` | string | オフセット入力バッファ |

---

## Refs

| ref | 型 | 説明 |
|---|---|---|
| `containerRef` | `HTMLDivElement` | SVG コンテナ（ResizeObserver・pan・viewport） |
| `svgRef` | `SVGSVGElement` | SVG 要素 |
| `searchInputRef` | `HTMLInputElement` | 検索入力欄 |
| `minimapRef` | `HTMLCanvasElement` | ミニマップ Canvas |
| `minimapDragging` | boolean | ミニマップドラッグ中 |
| `layoutRef` | `{contentW, contentH}` | 最後に計算したレイアウトサイズ（resetView 用） |
| `initialCentered` | boolean | 初期表示センタリング済みフラグ |
| `panStart` | `{x,y}` | パン開始マウス座標 |
| `panOrigin` | `{x,y}` | パン開始 pan 値 |
| `didPanRef` | boolean | パン操作判定（3px 以上移動でクリック無効） |
| `offsetRepeatRef` | `setInterval handle` | オフセットリピートボタンのインターバル |
| `pendingFocusId` | `string \| null` | 次のレイアウト更新後にフォーカスすべきノードID |

---

## useMemo 一覧

| 名前 | 依存 | 出力 |
|---|---|---|
| `filtered` | graphData, topMinistry, topProject, topRecipient, recipientOffset, pinnedProjectId | フィルタ済みノード/エッジ + totalRecipientCount |
| `layout` | filtered, svgWidth, svgHeight | 座標付き LayoutNode/Link |
| `selectedNode` | selectedNodeId, layout, graphData | 選択ノード（layout fallback → graphData） |
| `selectedNodeInLayout` | selectedNode, layout | 選択ノードが現在のレイアウトに存在するか |
| `connectedNodeIds` | selectedNode, selectedNodeInLayout | 選択ノードの1ホップ接続IDセット |
| `allRecipientRanks` | graphData | 支出先のグローバル順位 Map |
| `selectedNodeAllConnections` | selectedNode, selectedNodeInLayout, layout, graphData | 全接続エッジ（集約なし）の流入/流出 |
| `searchResults` | graphData, debouncedQuery | 検索候補リスト（最大50件） |

---

## Callbacks 一覧

| 名前 | 説明 |
|---|---|
| `stopOffsetRepeat` | オフセットリピートインターバルを停止 |
| `handleWheel` | ホイールズーム |
| `handleMouseDown` | パン開始 |
| `handleMouseMove` | パン移動 |
| `handleMouseUp` | パン終了 |
| `resetView` | 初期ビューポートへリセット（baseZoom 更新） |
| `resetViewport` | 全体表示ズーム（baseZoom 更新） |
| `minimapNavigate` | ミニマップクリック → パン |
| `selectNode` | ノード選択・パネル開閉・ピン解除 |
| `focusOnNode` | 指定 LayoutNode にズーム/パン（最小ラベル可視ズーム） |
| `handleConnectionClick` | パネル/検索からのノード選択（オフセットジャンプ・ピン留め・フォーカス） |
| `handleNodeClick` | SVG ノード rect クリック → selectNode |
| `handleSearchSelect` | 検索ドロップダウン選択 → handleConnectionClick |
| `focusOnSelectedNode` | 選択ノードにズームフォーカス（Focusボタン用） |
| `focusOnNeighborhood` | 選択ノード+1ホップ全体にフィット（FitActiveボタン用） |
| `applyZoom` | ズームボタン/スライダーから倍率適用 |

---

## JSX 構成（レンダリング）

```text
<div> (ルートコンテナ)
├── <div> SVGコンテナ (containerRef)
│   ├── <svg> (svgRef)
│   │   ├── Backdrop rect (背景クリックで deselect)
│   │   ├── 列ラベル (column labels + totals)
│   │   ├── Links (ribbonPath)
│   │   ├── Label clip regions
│   │   └── Nodes (rect + text label)
│   ├── <canvas> Minimap
│   ├── DOM tooltip — リンクホバー
│   ├── DOM tooltip — ノードホバー（mini）
│   └── DOM tooltip — 列ラベルホバー
│
├── Left side panel (position: fixed, left: 0)
│   ├── Collapse/expand トグルボタン（右端）
│   ├── Close ボタン（右上）
│   └── Panel content
│       ├── Header（ノード名・金額・種別バッジ・省庁名）
│       ├── 流入元リスト（段階展開）
│       └── 流出先リスト（段階展開）
│
├── Search box (position: absolute, top-left, zIndex:15)
│   ├── 検索入力 + アイコン
│   └── Dropdown（候補リスト / 結果なし表示）
│
├── Offset slider (position: absolute, top-right)
│   ├── 支出先ラベル
│   ├── 開始位置表示 / 数値入力
│   ├── 〜N位 表示
│   ├── <input type="range">
│   ├── /総件数 表示
│   ├── UpDown リピートボタン（↑↓）
│   └── リセットボタン（←）
│
├── Settings button (position: absolute, top-right)
│   └── SettingsPopover
│       ├── TopN省庁スライダー
│       ├── TopN事業スライダー
│       └── TopN支出先スライダー
│
└── Zoom controls (position: absolute, bottom-right)
    ├── Zoom +/- ボタン + スライダー + Zoom%入力
    ├── FitScreen ボタン (fullscreen)
    └── [選択中のみ] FitActive + Focus ボタン
```

---

## コンポーネント分割候補（Issue #116）

| コンポーネント名 | 対応 JSX | 受け取る主な props |
|---|---|---|
| `NodeTooltip` | DOM tooltip（ノード・リンク・列ラベル） | hoveredNode, hoveredLink, hoveredColIndex, mousePos, filtered |
| `SidePanelNode` | Left side panel | selectedNode, selectedNodeInLayout, isPanelCollapsed, setIsPanelCollapsed, selectNode, handleConnectionClick, inDisplayCount, outDisplayCount, selectedNodeAllConnections |
| `SearchBox` | Search box + dropdown | searchQuery, setSearchQuery, showSearchResults, setShowSearchResults, searchResults, handleSearchSelect, searchInputRef |
| `OffsetSlider` | Offset slider | recipientOffset, setRecipientOffset, filtered, offsetRepeatRef, stopOffsetRepeat, isEditingOffset, setIsEditingOffset, offsetInputValue, setOffsetInputValue |
| `SettingsPopover` | Settings button + popover | showSettings, setShowSettings, topMinistry/Project/Recipient の get/set |
| `ZoomControls` | Zoom controls | zoom, baseZoom, applyZoom, resetViewport, isEditingZoom, zoomInputValue, selectedNodeInLayout, focusOnSelectedNode, focusOnNeighborhood |

### 分割時の注意点

- **props が多い**: `SidePanelNode` は selectedNodeAllConnections など重い useMemo の結果を渡す必要がある
- **ref の受け渡し**: `searchInputRef`、`offsetRepeatRef` は `forwardRef` または直接 props
- **コールバックの安定性**: `handleConnectionClick` は多くの state に依存しており、子コンポーネントに渡すと再生成のたびに再レンダー誘発の懸念

---

## 関連

- Issue: igomuni/marumie-rssystem#116
- 実装ファイル: `app/sankey-svg/page.tsx`
- 配置先候補: `client/components/SankeySvg/`
