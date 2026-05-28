// レスポンシブ表示モードとレイアウトトークン定義（Issue #195 / レスポンシブ実装ロードマップ Phase 0）
//
// 設計書: docs/tasks/20260528_1914_sankey-svg_レスポンシブ対応設計.md §1, §2
// ロードマップ: docs/tasks/20260528_2204_sankey-svg_レスポンシブ実装ロードマップ.md
//
// このモジュールは page.tsx 各所に散らばっていた「幅・余白・フォント・サイドパネル幅・
// 列ラベル詳細度」の数値を、表示モードごとの単一の source-of-truth に集約する。
// HTTP・React 依存を持たない純粋な定数/関数のみを置く（CLAUDE.md レイヤー設計ルール）。

/** 閲覧環境・幅に応じた表示モード（第1級概念）。 */
export type DisplayMode =
  | 'compact-mobile'
  | 'compact-tablet'
  | 'standard-desktop'
  | 'dense-laptop'
  | 'presentation-tv'
  | 'projection';

/** 上部ツールバーの段組み方式。 */
export type TopToolbarLayout = 'single-row' | 'two-row' | 'sheet';

/** サイドパネル（ノード詳細）の提示方式。 */
export type SidePanelMode = 'docked' | 'bottom-sheet' | 'fullscreen';

/** 列見出しの詳細度。 */
export type ColumnHeaderMode = 'with-amount' | 'name-only' | 'hidden';

/** 表示モードごとのレイアウトトークン（設計書 §2）。 */
export interface LayoutTokens {
  /** 上部ツールバーの段組み方式 */
  topToolbarLayout: TopToolbarLayout;
  /** 描画領域の上部に予約する余白（検索/年度/TopN コントロール用）。fontScale 適用前の基準px */
  searchBoxReservePx: number;
  /** サイドパネル（ノード詳細）の提示方式 */
  sidePanelMode: SidePanelMode;
  /** docked 時のサイドパネル幅（px）。bottom-sheet / fullscreen では意味を持たない */
  sidePanelWidthPx: number;
  /** 列見出しの詳細度 */
  columnHeaderMode: ColumnHeaderMode;
  /** 列ラベルのフォントサイズ（fontScale 適用前の基準px） */
  columnLabelFontPx: number;
  /** タッチ向け最小タップサイズ（px）。0 は強制しない（デスクトップ） */
  controlIconMinHitPx: number;
  /** フォントスケールの下限（極小化防止）。0 はクランプなし */
  fontScaleClampMin: number;
}

// ── モード別トークン定義 ──
//
// Phase 0 時点では standard-desktop / dense-laptop に現状の実値を入れ、
// 他モードは仮値とする（Phase 2 以降で確定）。

/** standard-desktop / dense-laptop の現状値（page.tsx の既存定数に一致させる）。 */
const DESKTOP_TOKENS: LayoutTokens = {
  topToolbarLayout: 'single-row',
  searchBoxReservePx: 56, // 既存: svgWidth >= 1100 のときの値
  sidePanelMode: 'docked',
  sidePanelWidthPx: 310, // 既存: SIDE_PANEL_WIDTH_DEFAULT
  columnHeaderMode: 'with-amount',
  columnLabelFontPx: 12, // 既存: COLUMN_LABEL_FONT_PX_DEFAULT
  controlIconMinHitPx: 0,
  fontScaleClampMin: 0,
};

export const MODE_TOKENS: Record<DisplayMode, LayoutTokens> = {
  // 確定値（現状デスクトップと同一）
  'standard-desktop': { ...DESKTOP_TOKENS },
  'dense-laptop': { ...DESKTOP_TOKENS },

  // 以下は仮値（Phase 2〜4 で確定）
  'compact-mobile': {
    topToolbarLayout: 'sheet',
    searchBoxReservePx: 92,
    sidePanelMode: 'bottom-sheet',
    sidePanelWidthPx: 310,
    columnHeaderMode: 'with-amount',
    columnLabelFontPx: 12,
    controlIconMinHitPx: 44,
    fontScaleClampMin: 11,
  },
  'compact-tablet': {
    topToolbarLayout: 'two-row',
    searchBoxReservePx: 92,
    sidePanelMode: 'bottom-sheet',
    sidePanelWidthPx: 310,
    columnHeaderMode: 'name-only',
    columnLabelFontPx: 12,
    controlIconMinHitPx: 44,
    fontScaleClampMin: 11,
  },

  // 将来モード（Issue #195「将来的に」。完了条件外、仮値）
  'presentation-tv': {
    ...DESKTOP_TOKENS,
    columnLabelFontPx: 16,
  },
  'projection': {
    ...DESKTOP_TOKENS,
    columnLabelFontPx: 18,
  },
};

// ── 自動判定の閾値 ──
//
// Phase 2 で URL クエリ・localStorage・自動判定の3層解決に組み込む。
// Phase 0 ではエクスポートのみ（page.tsx はまだ standard-desktop 固定で呼ばない）。

const COMPACT_MOBILE_MAX_WIDTH = 480;
const COMPACT_TABLET_MAX_WIDTH = 1024;
const DENSE_LAPTOP_MAX_WIDTH = 1366;

/**
 * 幅・ポインタ種別・手動上書きから表示モードを解決する。
 *
 * 優先順位:
 *   1. override（URL クエリ・localStorage 由来の明示指定）
 *   2. 自動判定（width と pointerCoarse）
 *
 * @param width コンテナ幅（px）
 * @param pointerCoarse `matchMedia('(pointer: coarse)')` の結果（タッチ環境）
 * @param override 明示指定があれば最優先
 */
export function resolveDisplayMode(
  width: number,
  pointerCoarse: boolean,
  override?: DisplayMode,
): DisplayMode {
  if (override) return override;

  // pointerCoarse は Phase 2 で自動判定の補正に用いる（タッチ環境でのモード昇格など）。
  // Phase 0 では幅のみで判定する。
  void pointerCoarse;

  if (width <= COMPACT_MOBILE_MAX_WIDTH) return 'compact-mobile';
  if (width <= COMPACT_TABLET_MAX_WIDTH) return 'compact-tablet';
  if (width <= DENSE_LAPTOP_MAX_WIDTH) return 'dense-laptop';
  return 'standard-desktop';
}
