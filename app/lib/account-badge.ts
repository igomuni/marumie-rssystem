/**
 * 会計区分バッジ（一般/特別/一般特別/機関）の表示スタイル。
 * メインSankey（/sankey-svg）・再委託ビュー（/subcontracts）の予算・執行表示、
 * MOF予算書ページ（/mof-kou 等）の会計区分列で共用する。
 * 引数は 'general' | 'special' | 'both' | 'agency'（未対応値・空は null）。
 */
/**
 * 会計区分の文字列（'一般会計'/'一般'/'特別会計'/'特別' 等）を badge キーへ分類する共通関数。
 * メインSankeyの予算表示・再委託ビューのツールチップ/予算アコーディオンで共用し、分類ルールの二重化を防ぐ。
 */
export function classifyAccountCategory(value?: string | null): 'general' | 'special' | null {
  if (!value) return null;
  if (value.includes('一般')) return 'general';
  if (value.includes('特別')) return 'special';
  return null;
}

export function getAccountBadgeStyle(category?: string | null): { label: string; background: string } | null {
  if (!category) return null;
  const generalColor = '#e45f6f';
  const specialColor = '#5f8ee8';
  // 白文字とのコントラスト比 4.5:1（WCAG AA、小さいラベル向け）を確保できる濃さにする
  const agencyColor = '#18794e';
  if (category === 'general') return { label: '一般', background: generalColor };
  if (category === 'special') return { label: '特別', background: specialColor };
  if (category === 'agency') return { label: '機関', background: agencyColor };
  if (category === 'both') {
    return {
      label: '一般特別',
      background: `linear-gradient(to right, ${generalColor} 0 50%, ${specialColor} 50% 100%)`,
    };
  }
  return null;
}

/** RS側の予算種別のうち「前年度から繰越し」「予備費等N」はMOFの予算種別
 * （当初/補正/暫定/決算）に対応しない値なので、`integrated-sankey`の
 * `toMofBudgetType`で丸めず、独自の色でバッジ表示する（MOFの配色空間と混同しない
 * よう別の色を使う）。対応が無い理由: これらの行は所管・項・目が空でMOF側と
 * 突合できない（scripts/generate-mof-rs-kou-moku-linkage.ts の
 * resolveMofBudgetType 参照） */
export function rsOnlyBudgetTypeBadge(rsBudgetType: string): { label: string; color: string } | null {
  if (rsBudgetType === '前年度から繰越し') return { label: '繰越', color: '#2196f3' };
  const m = /^予備費等(\d+)$/.exec(rsBudgetType);
  if (m) return { label: `予備費${m[1]}`, color: '#009688' };
  return null;
}
