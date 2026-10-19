import { formatBudgetShort } from '@/client/lib/formatBudget';

/** 金額（千円）を /sankey-svg と同じ桁数の円・万円・億円・兆円で表示する。負の値は先頭に − を付ける */
export function formatSen(amount: number | null): string {
  if (amount === null) return '–';
  return amount < 0 ? `−${formatBudgetShort(-amount)}` : formatBudgetShort(amount);
}

/** 符号付き（増減用）。0 は符号なし */
export function formatSenSigned(amount: number | null): string {
  if (amount === null) return '–';
  return amount > 0 ? `+${formatSen(amount)}` : formatSen(amount);
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '–';
  return `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;
}

/** 増減の色（増=赤系、減=青系）。値が無い・0 は既定色 */
export function changeColor(v: number | null): string {
  if (v === null || v === 0) return '';
  return v > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400';
}
