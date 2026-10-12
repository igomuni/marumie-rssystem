# 右サイドパネル（項詳細）を/sankey-svg準拠のSidePanelChromeに変更

前回「左サイドバーを/sankey-svg準拠に」と実装したのは指示の取り違えで、正しくは右の項詳細パネル（`KouSidePanel`）だった。左フィルタパネルは独自実装（固定div＋マージン部分の幅調整ハンドル）に戻し、右の詳細パネルを`SidePanelChrome`（`side="right"`）に置き換えた。

## 対応内容

- **左フィルタパネル**: `20260828_2058`のコミットで加えたSidePanelChrome化を取り消し、`FilterSidebar.tsx`・`app/mof-kou/page.tsx`を`20260828_2045`時点の実装（自前の固定幅div＋マージン部分の幅調整ハンドル）に戻した。RangeSliderのThumb位置修正はそのまま維持（この不具合修正自体は取り違えと無関係）
- **右詳細パネル**: `KouSidePanel.tsx`から幅管理（`width`/`onWidthChange`props、自前の`startResize`、外側の`<aside style={{width}}>`と幅調整ハンドルdiv）を削除し、中身だけを返すコンポーネントにした。`app/mof-kou/page.tsx`側で`useSidePanel({ side: 'right', ... })`＋`SidePanelChrome side="right" position="absolute"`でラップする形にした。開閉タブのクリック（`onToggle`）は既存の✕ボタンと同じ`onClose`（選択解除）に紐づけている

## ハマった点

`SidePanelChrome`を`position="absolute"`でテーブルと重ねて配置する構成にした際、パネルを開くと`document.body.scrollWidth`がビューポート幅を超えて横スクロールが発生する不具合が出た。原因はテーブルを包む`flex-1`のdivに`min-w-0`が無く、`marginRight`でパネル分の幅を空けようとしてもflexアイテムがテーブル内容の最小幅より縮まらず、行全体が右にはみ出していたため。テーブルの外側divと、その親の`relative`ラッパーの両方に`min-w-0`を追加して解消（`min-h-0`は元々あったが横方向の対になる`min-w-0`が抜けていた）。

## 検証

- `npx tsc --noEmit` / `npm run lint`: クリーン
- Playwrightで確認: 行クリックで右詳細パネルが正しく開く（横スクロール発生なし）、開閉タブで✕ボタンと同様に閉じられる、左フィルタパネルが元の見た目（角丸の枠・マージン部分のドラッグハンドル）に戻っていることを確認
