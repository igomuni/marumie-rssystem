# 実機iPhone 13 と Chrome DevTools(iPhone XR) で表示が違う理由の考察

作成日時: 2026-05-31 20:50 (JST)
関連: Issue #195 レスポンシブ対応（`/sankey-svg-next`）

## 結論

バグではなく、**比較している2環境がそもそも別物**であることが主因。
要因は「機種差」「エミュレーションとエンジンの差」「Safari特有の動的UI/セーフエリア」に大別される。

## 要因の切り分け

### 1. 機種が違う（論理ビューポート幅が別物）— 影響大

| 項目 | iPhone 13（実機） | iPhone XR（DevToolsプリセット） |
|------|------------------|------------------------------|
| CSS論理幅(portrait) | 390px | 414px |
| CSS論理高さ | 844px | 896px |
| DPR | 3 | 2 |
| 物理解像度 | 1170×2532 | 828×1792 |

- 横24px・縦52pxの差。ブレークポイント／SVG viewBoxスケール／折り返し位置が変わる。
- まず **DevTools側を「iPhone 13」プリセットに変えて比較** すべき。

### 2. DevToolsはエミュレーション、エンジンはBlinkのまま

- DevToolsデバイスモードが変えるのは: ビューポートサイズ / DPR / UA文字列 / タッチエミュレート。
- レンダリングエンジンはデスクトップChromeの **Blink**。実機iPhoneは **WebKit(iOS Safari)**。
- エンジン差で異なるもの: フォント字幅・行高、SVGテキスト配置・サブピクセル描画、flex/grid端数処理、`-webkit-text-size-adjust`。

### 3. Safariの動的UIクロムと `100vh`

- 実機Safariはアドレスバー伸縮で `100vh` が指す高さが変動。DevToolsは再現しない。
- `vh` 基準レイアウトは実機で縦ズレ。`100dvh` 使用有無で挙動が分かれる。

### 4. セーフエリア（ノッチ／ホームインジケータ）

- `env(safe-area-inset-*)` は実機のみ有効。DevToolsでは0扱い。
- ノッチ周りの余白・上下パディングが実機だけ広く見える。

### 5. DPRによるラスタ描画差

- iPhone 13 DPR=3 / XRエミュ=2。SVG(ベクター)は影響小だが、ビットマップ・box-shadow・1px罫線・アイコンのにじみが変わる。

### 6. 実機側システム設定

- Dynamic Type(文字サイズ)、表示ズーム、太字設定などで実機だけフォント拡大→レイアウト崩れ。

## 切り分けの優先順位（推奨手順）

1. DevToolsプリセットを「iPhone 13」に変更（XR比較は無意味）。差の大半が消える可能性大。
2. 残差は Blink vs WebKit のエンジン差 → 実機Safari確認必須。MacのSafari「レスポンシブデザインモード」はWebKitなので実機に近い。
3. 縦ズレは `vh`→`dvh`、`env(safe-area-inset)` 対応状況を確認。

## 追記: iPhone 12 Pro でもズレる件のコード調査結果

iPhone 12 Pro(390×844/DPR3) は iPhone 13 と論理ビューポートが同一。
よって「機種サイズ差」は除外され、原因は iOS Safari 特有の挙動に絞られた。
`app/sankey-svg-next/page.tsx` / `app/layout.tsx` 調査で2点特定。

### 原因A: ルート `position: fixed; inset: 0` × 動的ツールバー（主因）

- ルート要素: `app/sankey-svg-next/page.tsx:2399` が `position: fixed; inset: 0`。
- Sankeyの自動フィット倍率は `page.tsx:342-343` の実測 `clientHeight` から算出。
- DevTools: ツールバー無し → 高さフル(≒844)。
- 実機Safari: アドレスバー＋タブバー差し引きで実効高 ≒620〜750px（スクロールで伸縮）。
- → 縦の使える高さが100px以上違い、`resetViewport` のズーム/位置がズレる = 主因。
- 現状は `window.resize` のみ購読で、iOS Safari のツールバー伸縮(`visualViewport` イベント)を取りこぼす。

### 原因B: `viewport-fit=cover` 未設定で `env(safe-area-inset-*)` が実機で無効

- `app/layout.tsx` に `viewport` 指定なし → Next.js デフォルト(`width=device-width, initial-scale=1`)のみ。
- `viewport-fit=cover` が無いため、ボトムシート `page.tsx:4605` の
  `calc(14px + env(safe-area-inset-bottom))` が実機で常に0。
- DevTools(Blink) はセーフエリア非再現 → 両者で下端パディング不一致。

### 対策案

1. `app/layout.tsx` に `export const viewport: Viewport` を追加し
   `viewportFit: 'cover'` / `interactiveWidget: 'resizes-content'` を設定。
2. `window.visualViewport` の `resize`/`scroll` を購読して `svgHeight` を更新（ツールバー伸縮追従）。または `100dvh` 併用。
3. 検証は WebKit 系（実機 or Mac Safari レスポンシブモード）を一次基準に。

## 検証結果（DevToolsカスタムデバイスでの再現確認）

DevTools にカスタムデバイス `390 × 659 / DPR3`（実機Safariの両バー表示時の
実効高さ相当）を追加して `/sankey-svg-next` を表示 → **実機の見え方にかなり近い**
ことを確認。これにより原因A（縦の実効高さの差で自動フィット倍率がズレる）が
主因とほぼ確定。

切り分け結果まとめ:
- ✅ 機種サイズ差ではない（iPhone 12 Pro / 13 / 659カスタムで一致方向）
- ✅ 主因は縦の実効高さ（DevTools既定 844 vs 実機 ~659）→ `resetViewport` の倍率ズレ
- ⬜ 原因B（セーフエリア下端パディング）は DevTools では再現不可・未確認のまま

参考: カスタムデバイス推奨値（iPhone 13/12 Pro = 390幅・DPR3）
| 名前 | W | H | DPR | 状態 |
|------|---|---|-----|------|
| 両バー表示 | 390 | 659 | 3 | 起動直後・最上部（最も縦が狭い／実機に最も近かった） |
| バー収納 | 390 | 745 | 3 | スクロールでバー縮小時 |
| フル(参考) | 390 | 844 | 3 | Chrome既定・比較ベースライン |

## 残課題（今後の対策候補・未着手）

1. `visualViewport` の `resize`/`scroll` を購読し `svgHeight` を実効高さに追従させる
   （`app/sankey-svg-next/page.tsx:342-343` は現状 `clientHeight` 一度きり測定＋`window.resize`のみ）。
2. `app/layout.tsx` に `export const viewport`（`viewportFit: 'cover'` 等）を追加し
   原因Bのセーフエリア対応。
3. 最終確認は WebKit 系（実機 or Mac Safari レスポンシブモード / iOS Simulator）で実施。

## 実装方針への示唆

- DevTools(Blink)で合わせ込んでも実機Safari(WebKit)で再現する保証はない。
- レスポンシブ実装の検証は「WebKit系（実機 or Mac Safari RDM）」を一次基準にする。
- 高さ基準は `clientHeight` の一度きり実測ではなく `visualViewport` 追従にすると実機のズレが解消しやすい。
