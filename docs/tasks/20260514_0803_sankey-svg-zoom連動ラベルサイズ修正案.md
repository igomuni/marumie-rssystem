# sankey-svg：zoom 連動ラベルサイズの設計検討

作成日: 2026-05-14 08:03 (Asia/Tokyo)
対象: [app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx)

## 背景

「基準フォントサイズ」設定の追加と高フォント時の全体表示問題への対応のなかで、列ごとの **adaptive slot/font** を導入した。

- Fit zoom 時: 列内すべてのラベルが viewport に収まるよう、列ごとに slot/font を縮小
- ユーザーがズームインしたとき (`zoom > baseZoom`): adaptive を停止し base 値へ戻す → 元のドリルダウン体験を維持

このベースをさらに「zoom 率に応じてラベルが動的に変わる」方向へ拡張するための検討用ドキュメント。

---

## 現状の関係式

```text
fontScale       = baseFontPx / 12
mapLabelFontPx  = round(11 × fontScale)   ≈ baseFontPx × 11/12      (screen px)
mapLabelSlotPx  = round(12 × fontScale)   = baseFontPx              (screen px)

useAdaptive     = zoom <= baseZoom + 0.001

slotPxEffective = useAdaptive
                ? clamp(labelBudgetScreen / nShort, 6, mapLabelSlotPx)   // 列ごと
                : mapLabelSlotPx

labelBudgetScreen = availH × 0.85 − tallContribSvg × zoom

colFontPx       = useAdaptive ? min(mapLabelFontPx, slotPxEffective) : mapLabelFontPx

text fontSize   = colFontPx / zoom   (SVG units、画面では colFontPx px に見える)
```

### スクリーン上のラベル高さ範囲

| baseFontPx | Max (= mapLabelFontPx) | Min (床値) |
|-----------:|-----------------------:|-----------:|
|  8         |  7                     | 6          |
| 12 (既定)  | 11                     | 6          |
| 16         | 15                     | 6          |
| 20         | 18                     | 6          |
| 24         | 22                     | 6          |

---

## UI 全体のフォントサイズ一覧

`scaleFont(px) = max(1, round(px × baseFontPx / 12))` ですべての UI 要素が比例スケール。

### Sankey 図本体

| 用途 | 定数 (DEFAULT) | baseFontPx=8 | 12 (既定) | 16 | 20 | 24 |
|------|---------------:|----:|----:|----:|----:|----:|
| ノードラベル | MAP_LABEL_FONT_PX (11) | 7 | 11 | 15 | 18 | 22 |
| ラベルスロット高 | MAP_LABEL_SLOT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| ラベル可視判定閾値 | MAP_LABEL_VISIBLE_MIN_H_PX (11) | 7 | 11 | 15 | 18 | 22 |
| 列ラベル（タイトル） | COLUMN_LABEL_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| 列ラベル（金額） | COLUMN_AMOUNT_FONT_PX (11) | 7 | 11 | 15 | 18 | 22 |

### 検索 / コントロール類（画面右上の Row 1, TopN パネル, 設定ダイアログ）

| 用途 | 定数 (DEFAULT) | 8 | 12 | 16 | 20 | 24 |
|------|---------------:|---:|---:|---:|---:|---:|
| 検索入力 | SEARCH_FONT_PX (14) | 9 | 14 | 19 | 23 | 28 |
| 通常コントロール | CONTROL_FONT_PX (13) | 9 | 13 | 17 | 22 | 26 |
| 小コントロール（会計/省庁/予算/支出 など） | CONTROL_SMALL_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| メタ表示（× / カウント / 補足） | META_FONT_PX (11) | 7 | 11 | 15 | 18 | 22 |

設定ダイアログ・TopN ダイアログのテキストは原則 `CONTROL_SMALL_FONT_PX` と `META_FONT_PX` を併用。`minWidth` も `240 × fontScale` でスケールするため横幅も連動。

### サイドパネル（ノード詳細）

| 用途 | 定数 (DEFAULT) | 8 | 12 | 16 | 20 | 24 |
|------|---------------:|---:|---:|---:|---:|---:|
| パネルタイトル（ノード名） | PANEL_TITLE_FONT_PX (14) | 9 | 14 | 19 | 23 | 28 |
| 主指標値（予算 or 支出） | PANEL_PRIMARY_VALUE_FONT_PX (15) | 10 | 15 | 20 | 25 | 30 |
| リスト名（事業・支出先 名前） | PANEL_LIST_NAME_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| リスト金額 | PANEL_LIST_VALUE_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| パネル内メタ・事業概要本文 | PANEL_META_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |

### ホバーツールチップ（ノード / リンク / 列ヘッダ）

| 用途 | 定数 (DEFAULT) | 8 | 12 | 16 | 20 | 24 |
|------|---------------:|---:|---:|---:|---:|---:|
| Tooltip タイトル | TOOLTIP_TITLE_FONT_PX (12) | 8 | 12 | 16 | 20 | 24 |
| Tooltip 値（兆/億表記） | TOOLTIP_VALUE_FONT_PX (11) | 7 | 11 | 15 | 18 | 22 |
| Tooltip メタ（円/件数/補足） | TOOLTIP_META_FONT_PX (10) | 7 | 10 | 13 | 17 | 20 |

ツールチップは `tipW = 240 × fontScale`, `tipH = (88 or 76 + 18) × fontScale`, `GAP = 8 × fontScale`, `cursorGap = 12 × fontScale` で外形寸法も比例スケール。配置時は cumShift+topShift を考慮した実描画位置基準で計算（[app/sankey-svg/page.tsx:2417 付近](../../app/sankey-svg/page.tsx)）。

### サイズ感の比較（base=12 で全体最小〜最大）

base=12 のときの screen px ベース最小〜最大: 10 px (Tooltip メタ) 〜 15 px (パネル主指標) と、目視で 1.5 倍程度のレンジに収まる。base を上げてもこの相対比は維持される。

### いつ Max / Min か

| 状況 | colFontPx |
|------|-----------|
| Fit zoom、short ノード少 | Max |
| Fit zoom、short ノード過剰 | adaptive 縮小 (Min まで) |
| ズームイン (`zoom > baseZoom`) | Max 固定 |
| ズームアウト (`zoom < baseZoom`) | adaptive 適用（実質 Max 近辺） |

---

## 検討課題

現在の挙動には次の改善余地がある。

1. ズームイン時にラベルが「base 固定」で、rect は大きくなるのにラベルだけ変わらず**密度差が強調されすぎる**。
2. Adaptive の床値が絶対値 6 px。`baseFontPx` の意図に反する小さい値になり得る。
3. Fit ⇄ ズームイン の境界 (`zoom = baseZoom`) で**ラベルサイズが不連続に切り替わる**（境目で見た目が瞬時に変化）。
4. Adaptive は列ごと独立。列をまたいだ視覚的な統一感が薄い。
5. `availH × 0.85` の 0.85 が固定。タイトル/コントロール領域が増えるとマージンが不足するかも。

---

## 修正案

### 案 A: zoom 倍率に連動する Max（ズームインで拡大）

ズームインしたとき、ラベルもある程度大きくしたい。

```text
zoomFactor = clamp(zoom / baseZoom, 1, ZOOM_FONT_MAX_RATIO)   // 1〜2 倍程度
colFontPx_max = mapLabelFontPx × zoomFactor                     // ズームインで成長
```

- メリット: ズームインで rect とラベルの相対バランス維持。詳細閲覧で読みやすい。
- 注意: 大きくしすぎるとラベル同士がぶつかる。`ZOOM_FONT_MAX_RATIO` の妥当値要検討（1.5〜2.0 が候補）。

### 案 B: Min を相対値に変える

```text
COLFONT_MIN_RATIO = 0.5   // base の半分
fontMinPx = max(6, baseFontPx × COLFONT_MIN_RATIO)
slotPxEffective = clamp(labelBudgetScreen / nShort, fontMinPx, mapLabelSlotPx)
```

- メリット: 「base=24 なのに 6px は小さすぎる」を回避。`baseFontPx` の意図を尊重。
- 注意: base 大かつノード多列の場合、Min 引き上げによって fit zoom が小さくなり全体縮小される（トレードオフ）。

### 案 C: Fit ⇄ ズームインの遷移を線形ブレンド

```text
TRANSITION_END = 1.5            // baseZoom の何倍まででブレンドするか
t = clamp((zoom − baseZoom) / (baseZoom × (TRANSITION_END − 1)), 0, 1)
colFontPx = lerp(adaptiveColFontPx, mapLabelFontPx, t)
```

- メリット: ズームの境目でラベルサイズがピョコンと変わらず滑らか。
- 注意: 中間域では「adaptive と base のあいだ」のサイズ。ピクセル単位の計算なのでアンチエイリアスは綺麗。

### 案 D: 列ごとではなくグローバルな adapt スケール

すべての列で最も厳しい列の縮小率に合わせる：

```text
globalScale = min(列ごとの slotPxEffective / mapLabelSlotPx)
colFontPx = mapLabelFontPx × globalScale   // 全列同じ
```

- メリット: 列をまたいで font サイズ統一、視覚的に整う。
- 注意: 余裕のある列まで縮小される（情報密度はやや低下）。

### 案 E: `availH 占有率` を baseFontPx に応じて可変

`0.85` を hard-code でなく、baseFontPx が大きいほど大きめ（labels 専有を許容）にする:

```text
availHRatio = clamp(0.7 + (baseFontPx − 12) × 0.015, 0.7, 0.9)
```

- メリット: 大フォント時にラベル領域を確保しやすい。
- 注意: 効果はやや軽微。他案と組み合わせで採用したい。

---

## 推奨組み合わせ案

| Tier | 案 | 理由 |
|------|----|------|
| 必須 | B (Min を相対値) | baseFontPx の意図を尊重するための基本 |
| 推奨 | C (線形ブレンド) | 境界の見た目をなめらかにする副作用が少なく実装も明快 |
| 検討 | A (zoom 連動 Max) | ドリルダウン UX を強化したい場合 |
| 任意 | D (グローバル統一) | 視覚的一体感を優先したい場合（A と相反する設計判断） |
| 補助 | E (availH 比率可変) | A/B のフォロー |

ベースラインとしては **B + C** を最初に入れ、効果を見て A もしくは D を追加採用する流れが安全。

---

## 実装ポイント

主に [app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx) の `nodeShiftInfo` useMemo を改修。

- 案 A: `colFontPx` の上限を `mapLabelFontPx × min(zoom/baseZoom, MAX_RATIO)` に変更
- 案 B: `fontMinPx = max(6, baseFontPx × MIN_RATIO)` を定数化、`slotPxEffective` の下限へ
- 案 C: `t` 遷移係数で adaptive / base を `lerp`
- 案 D: 列ループ後にもう一段の reduce で `globalScale` を計算、各列に再代入
- 案 E: `availH × ratio` の係数を関数化

定数追加箇所（[app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx#L85) 付近に既存定数群あり）:

```ts
const COLFONT_MIN_RATIO = 0.5;           // 案 B
const ZOOM_FONT_TRANSITION_END = 1.5;    // 案 C
const ZOOM_FONT_MAX_RATIO = 1.4;         // 案 A
```

---

## 検証指針

`tmp/` 配下のスクショ撮影と Playwright スクリプトで:

1. base × 5 段階 (8, 12, 16, 20, 24)
2. fit / +1zoom / +3zoom / −1zoom の 4 状態
3. 検証項目:
   - 全ラベル可視数（target = 191）
   - 最大 `text.fontSize`（SVG units → screen 換算）
   - 最大 `getBoundingClientRect().bottom` (target < viewport height)
   - ラベル相互の overlap 件数（隣接 text 矩形の交差判定）

→ 4 × 5 = 20 ケースを自動チェックして合否マトリクス化。

---

## 不変条件

fit zoom（= baseZoom）の状態は修正前後で同じであること。具体的には：

- 全体表示時の TopN 収容上限 `N_max ≈ availH × 0.9 / mapLabelSlotPx`（Full HD baseFontPx=12 で約76ノード）
- `topShift` 計算・`calcShiftExtraH`・`fitZoomWithShifts` の結果

この上限は意図的な仕様であり、いずれの案を採用しても fit zoom 時の基準値を変えてはならない。

---

## 関連

- 既存実装: [app/sankey-svg/page.tsx](../../app/sankey-svg/page.tsx)（`nodeShiftInfo`, `calcShiftExtraH`, label 描画 4 箇所）
- 関連メモ: [docs/tasks/archive/](../tasks/archive/)（既存タスク群）
- 実装計画: [docs/tasks/20260515_0624_sankey-svg-zoom連動ラベルフォントサイズ動的拡大.md](./20260515_0624_sankey-svg-zoom連動ラベルフォントサイズ動的拡大.md)
