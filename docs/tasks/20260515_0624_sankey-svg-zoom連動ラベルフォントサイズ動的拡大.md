# sankey-svg：zoom 連動ラベルフォントサイズ動的拡大

作成日: 2026-05-15 06:24 (Asia/Tokyo)
対象: [app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx)

## 目的

ズームインしたとき、拡大されたノード rect に対してラベルが小さいまま（固定画面サイズ）で密度差が強調されすぎる問題を解消する。ズームインするほどノードが大きく見えるので、ラベルもノードの表示高さに収まる範囲でスケールアップし、読みやすさとバランスを改善する。

---

## スコープ（今回の変更範囲）

- **zoom > baseZoom（ズームイン）のときのみ** フォントサイズを拡大する
- **zoom ≤ baseZoom（初期状態・ズームアウト）** は既存の挙動を維持（変更なし）
- 列ごとではなく **ノードごと** に上限を設ける（ノードの高さに余裕を持って収まる範囲）
- ラベルの y 位置補正は `topShift` ロジックで対応（既存の仕組みを拡張）

---

## 現状の実装

### フォントサイズ

すべてのノードラベルで固定：

```text
fontSize = mapLabelFontPx / zoom   (SVG units)
```

画面上では常に `mapLabelFontPx` px に見える（zoom に関わらず不変）。

### topShift（小ノードへの位置補正）

[app/sankey-svg/page.tsx:1093](../../app/sankey-svg/page.tsx#L1093) の `nodeShiftInfo` useMemo 内：

```ts
topShift = h * zoom < mapLabelSlotPx
         ? Math.max(0, mapLabelSlotPx / zoom - h)
         : 0
```

ノードの表示高さがラベルスロット未満のとき、ノードを下にずらして「スロット高分の上余白」を確保する。
ラベルは `y = topShift + h / 2`（`dominantBaseline="middle"`）で配置 → ラベルの中点 = ノードの中点。

### ラベルの y 座標

```text
y = topShift + h / 2
```

`dominantBaseline="middle"` なのでこの値がテキストの中央。
topShift が 0 のとき → ノードの中点にラベルの中点が来る。
topShift > 0 のとき（ノード < スロット）→ `topShift = slotH/zoom - h` なので `y = slotH/zoom - h/2`、ここでもラベルの中点 = ノードの中点が維持される。

---

## 変更設計

### フォントサイズ計算の変更

ノードごとに `colFontPx` を計算し、`fontSize = colFontPx / zoom` に変える。

```text
// zoom ≤ baseZoom: 変更なし
colFontPx = mapLabelFontPx

// zoom > baseZoom: ノードごとに拡大上限を決定
zoomedMax    = mapLabelFontPx × min(zoom / baseZoom, ZOOM_FONT_MAX_RATIO)
nodeMaxFont  = (h × zoom) × LABEL_FIT_RATIO         // ノードの表示高さ × 余裕係数
colFontPx    = max(mapLabelFontPx, min(zoomedMax, nodeMaxFont))
```

| 変数 | 意味 |
|------|------|
| `zoomedMax` | ズーム比率による上限（ZOOM_FONT_MAX_RATIO 倍が天井） |
| `nodeMaxFont` | ノードの表示高さに収まるフォントの上限（LABEL_FIT_RATIO で余裕確保） |
| `colFontPx` | 実際に使うフォントサイズ（screen px 相当）。base より小さくはしない |

`nodeMaxFont` の制約により、小さいノードではほとんど拡大されず、大きいノードほど大きくなる。

### topShift の変更

現状は `mapLabelSlotPx` 基準だが、新しいフォントサイズ（`colFontPx`）基準に変更する：

```ts
labelHSvg = colFontPx / zoom   // ラベル高さ（SVG units）
topShift  = h < labelHSvg
          ? Math.max(0, labelHSvg - h)
          : 0
```

ラベル y 座標は変更なし（`y = topShift + h / 2`）。

**位置補正の正しさの確認：**

- ノード高さ ≥ ラベル高さ（`h ≥ labelHSvg`）: `topShift = 0` → `y = h/2` → ノードのmiddle = ラベルのmiddle ✓
- ノード高さ < ラベル高さ（`h < labelHSvg`）: `topShift = labelHSvg - h` → `y = labelHSvg - h/2` → ラベルのmiddle（= y）= ノードのmiddle（= topShift + h/2 = labelHSvg - h/2）と一致 ✓

### 新規定数

[app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx#L85) 付近の定数群に追加：

```ts
const ZOOM_FONT_MAX_RATIO = 2.0;   // ズームインでフォントを最大で元の何倍まで拡大するか
const LABEL_FIT_RATIO = 0.85;      // ノード表示高さに対してフォントが占める割合の上限
```

---

## 実装箇所

### 1. `nodeShiftInfo` useMemo の拡張

[app/sankey-svg/page.tsx:1066](../../app/sankey-svg/page.tsx#L1066)

返り値の型を `{ cumShift: number; topShift: number; colFontPx: number }` に拡張。
依存配列に `baseZoom` を追加。
ループ内でノードごとの `colFontPx` と新しい `topShift` を計算してMapに格納。

### 2. ラベル描画箇所（4箇所）

`fontSize={mapLabelFontPx / zoom}` → `fontSize={nodeInfo.colFontPx / zoom}` に変更。

| 行番号（目安） | 対象 |
|---------------|------|
| [~2213](../../app/sankey-svg/page.tsx#L2213) | project-budget（spendingNode なし）の右ラベル |
| [~2241](../../app/sankey-svg/page.tsx#L2241) | project-budget（spendingNode あり）の左ラベル（金額） |
| [~2252](../../app/sankey-svg/page.tsx#L2252) | project-budget（spendingNode あり）の右ラベル（事業名） |
| [~2304](../../app/sankey-svg/page.tsx#L2304) | 通常ノード（total / ministry / recipient） |

---

## 不変条件（修正前後で同じであること）

fit zoom（= baseZoom）の状態では `colFontPx = mapLabelFontPx` が維持されるため、以下は変わらない：

- 全体表示時の TopN 収容上限 `N_max ≈ availH × 0.9 / mapLabelSlotPx`（Full HD baseFontPx=12 で約76ノード）
- `topShift` の計算結果（= `max(0, mapLabelSlotPx/zoom - h)` と同値）
- `calcShiftExtraH` → `fitZoomWithShifts` の結果（baseZoom の確定値）

この上限はユーザーが意図的に定めた仕様であり、修正後も同じ基準を維持する。

---

## スコープ外（今回変更しない）

- zoom ≤ baseZoom のフォントサイズ（adaptive ロジックを含む既存の挙動）
- 列ラベル（タイトル・金額）のサイズ
- ツールチップ・サイドパネルのフォント
- `mapLabelVisibleMinHPx` による可視判定閾値

---

## 関連

- 背景ドキュメント: [docs/tasks/20260514_0803_sankey-svg-zoom連動ラベルサイズ修正案.md](./20260514_0803_sankey-svg-zoom連動ラベルサイズ修正案.md)
- 実装対象: [app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx)（`nodeShiftInfo`、ラベル描画 4 箇所）
