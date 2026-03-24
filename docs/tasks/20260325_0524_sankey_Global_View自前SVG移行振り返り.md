# /sankey Global View 自前SVG移行 振り返り

## 概要

`/sankey` Global View を nivo ベースの描画から **自前SVG + 事前計算レイアウト** 方式へ移行する試みを実施。
スライダー操作の即座反映（16ms）は達成したが、**d3-sankey のレイアウト問題**が未解決のためマージ保留。

## ブランチ

`feature/sankey-global-custom-svg`（5 commits）

## 実施内容

### Phase 1: nivo → d3-sankey + React.memo（`e606829`）

- nivo の `ResponsiveSankey` を排除し、`d3-sankey` で直接レイアウト計算
- `SankeyGlobalView.tsx` を新規作成（MemoNode / MemoLink で個別メモ化）
- **結果**: 描画自体は動作するが、スライダー操作ごとに API + レイアウト再計算が走り遅い

### Phase 2: 全ページプリフェッチ（`fe1a465`）

- 起動時に全レベル（0〜1042）のデータを API から一括取得しキャッシュ
- スライダー操作時はキャッシュからO(1)参照 + d3-sankeyレイアウト計算のみ
- **結果**: API待ちは解消したが、レイアウト計算（~50ms/レベル）が残る

### Phase 3: クライアント側支出先入替（`723c938`）

- レベル0のベースレイアウト（ministry/project列）を固定し、支出先ノードのみ動的入替
- **問題発覚**: `allRecipients` がレベル0の `topProjectIds` に基づくプロジェクト参照しか持たないため、下位支出先のリンクが生成できず空欄になる

### Phase 4: ビルド時事前計算（`5708410`）— 最終形

- `scripts/compute-sankey-global-layout.ts` で全1042レベルを事前計算
- `GlobalBaseCache` + 逆引きインデックス（`projectToSpendings`）で `selectData` のO(N^2)を解消
- `buildSankeyData` 内の `fullData.budgets.find()` を `projectId → ministry` ルックアップMapで置換
- **結果**: 全1042レベルを **7.2秒** で生成、35MB JSON（gzip 7.3MB）
- クライアントは起動時に1回フェッチ → スライダーはO(1)参照で即座描画

## 未解決の問題: d3-sankey `sankeyJustify` レイアウト崩れ

### 症状

特定のスライダーレベルで支出先ノードが少ない（または0個）になった場合、d3-sankey の `sankeyJustify` アルゴリズムが**下流リンクを持たないノードを最右列に押し出す**。

具体的には:
- 事業→支出先ブロックノードが支出先列に移動してしまう
- 省庁→事業リンクの配置も連鎖的に崩れる

### 原因

d3-sankey の `sankeyJustify` は「下流リンクがないノード = 最終列に配置」というヒューリスティックを持つ。
これは一般的なSankeyでは合理的だが、本アプリの「固定4列構造（省庁→事業→支出先ブロック→支出先）」では期待と異なる動作になる。

### 検討した対策

| 対策 | 評価 |
|------|------|
| `sankeyLeft` に変更 | 左寄せになり別の崩れが発生 |
| 不可視ダミーノード追加 | 列構造は維持できるがリンク計算が複雑化 |
| d3-sankey の `computeNodeDepths` を上書き | 列を固定割り当てできるが、d3-sankey内部APIへの依存が大きい |
| **自前レイアウトエンジン** | d3-sankey を完全排除し列位置を明示指定。最も確実だが工数大 |

### 推奨次ステップ

1. **自前レイアウトエンジンの検討**: `/sankey2` の `compute-sankey2-layout.ts` は既に自前でx座標を列ごとに固定割り当てしている。同様のアプローチを `/sankey` Global View にも適用すれば d3-sankey 依存を排除できる
2. **ダミーノード方式の試行**: 工数が少ないため先に試す価値あり。各列に不可視ノードを配置し、d3-sankey に列構造を強制する

## 成果物

| ファイル | 役割 |
|---------|------|
| `client/components/SankeyGlobalView.tsx` | 自前SVG描画コンポーネント（570行） |
| `scripts/compute-sankey-global-layout.ts` | ビルド時レイアウト計算（265行） |
| `public/data/sankey-global-layout.json.gz` | 事前計算済みレイアウト（7.3MB） |
| `app/lib/sankey-generator.ts` | GlobalBaseCache + 逆引きインデックス最適化 |
| `types/preset.ts` | `GlobalLayoutData` / `LevelLayout` 型定義 |

## パフォーマンス改善の記録

| 段階 | 全1042レベル生成時間 |
|------|---------------------|
| 初回実装（毎回フル計算） | 45分以上（推定） |
| GlobalBaseCache導入 | ~400秒（1.5s/level × 100で中断） |
| buildSankeyData最適化（budgets.find→Map） | **7.2秒**（0.007s/level） |

## 学び

- **d3-sankey は固定列構造と相性が悪い**: `sankeyJustify` のヒューリスティックが列の意味的な固定を壊す。固定列が必要なら自前レイアウトが安全
- **事前計算 + O(1)参照は正しいアーキテクチャ**: 7.2秒のビルドコストで1042レベル全てが即座に表示可能になった
- **逆引きインデックスの効果は絶大**: `selectData` + `buildSankeyData` の両方で O(N^2) → O(N) 化し、600倍の高速化を実現
