/**
 * 会計区分バッジ（一般/特別/一般特別）の表示スタイル。
 * メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）の予算・執行表示で共用する。
 * 引数は 'general' | 'special' | 'both'（未対応値・空は null）。
 */
export function getAccountBadgeStyle(category?: string | null): { label: string; background: string } | null {
  if (!category) return null;
  const generalColor = '#e45f6f';
  const specialColor = '#5f8ee8';
  if (category === 'general') return { label: '一般', background: generalColor };
  if (category === 'special') return { label: '特別', background: specialColor };
  if (category === 'both') {
    return {
      label: '一般特別',
      background: `linear-gradient(to right, ${generalColor} 0 50%, ${specialColor} 50% 100%)`,
    };
  }
  return null;
}
