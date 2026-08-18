/**
 * 事項一覧の表示整形ヘルパ。
 * MOF の金額は千円単位なので、円単位を前提にした既存の整形関数とは共用しない。
 */

/** 千円単位の金額を「1.2兆円」「345億円」等に整形する */
export function formatThousandYen(thousandYen: number): string {
  const yen = thousandYen * 1000;
  const abs = Math.abs(yen);
  if (abs >= 1e12) return `${(yen / 1e12).toFixed(2)}兆円`;
  if (abs >= 1e8) return `${(yen / 1e8).toFixed(1)}億円`;
  if (abs >= 1e4) return `${Math.round(yen / 1e4).toLocaleString()}万円`;
  return `${yen.toLocaleString()}円`;
}

/** 増減率。前年度が0のときは null（新規） */
export function changeRate(amount: number, previous: number): number | null {
  if (previous === 0) return null;
  return (amount - previous) / previous;
}

/** 増減率の表示文字列 */
export function formatChangeRate(rate: number | null): string {
  if (rate === null) return '新規';
  const sign = rate > 0 ? '+' : '';
  return `${sign}${(rate * 100).toFixed(1)}%`;
}
