/**
 * 科目別内訳（項・目）一覧の列定義と並べ替えロジック。
 * `/mof-jikou` の columns.ts と同じ構成。ページ側は状態管理とレイアウトに専念させる。
 */

import type { MOFKouMokuAccountType, MOFKouMokuItem } from '@/types/mof-kou-moku';
import { changeRate } from '@/client/components/mof-jikou/format';

export const ACCOUNT_LABEL: Record<MOFKouMokuAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

/** ソート可能な列 */
export type SortKey =
  | 'accountType'
  | 'ministry'
  | 'organization'
  | 'subAccount'
  | 'sectionCode'
  | 'sectionName'
  | 'majorExpenseName'
  | 'subItemCode'
  | 'subItemName'
  | 'purposeName'
  | 'amount'
  | 'previousAmount'
  | 'difference'
  | 'rate';

export type SortDir = 'asc' | 'desc';

export interface ColumnSpec {
  key: SortKey;
  label: string;
  width: number;
  numeric?: boolean;
  note?: string;
}

export const COLUMNS: ColumnSpec[] = [
  { key: 'accountType', label: '会計区分', width: 92 },
  { key: 'ministry', label: '所管', width: 150, note: '政府関係機関の帳票には所管の欄が無い' },
  {
    key: 'organization',
    label: '組織／特会／機関',
    width: 160,
    note: '一般会計は組織、特別会計は特別会計名、政府関係機関は機関名',
  },
  { key: 'subAccount', label: '勘定／業務', width: 110, note: '特別会計は勘定、政府関係機関は業務区分' },
  { key: 'sectionCode', label: '項', width: 48, note: '項コード（組織・勘定内の連番）' },
  { key: 'sectionName', label: '項名', width: 190 },
  {
    key: 'majorExpenseName',
    label: '主要経費',
    width: 120,
    note: '特別会計・政府関係機関の帳票には無いことがある',
  },
  { key: 'subItemCode', label: '目コード', width: 64 },
  { key: 'subItemName', label: '目名', width: 220, note: '支出の性質による分類（事項＝目的による分類とは別系統）' },
  { key: 'purposeName', label: '使途別', width: 110 },
  { key: 'amount', label: '本年度額', width: 100, numeric: true },
  { key: 'previousAmount', label: '前年度予算額', width: 100, numeric: true },
  { key: 'difference', label: '増減額', width: 100, numeric: true },
  { key: 'rate', label: '増減率', width: 84, numeric: true },
];

export const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map(c => [c.key, c.width])
);

/** リサイズで潰しすぎないための下限 */
export const MIN_COLUMN_WIDTH = 40;

/** 一般会計は組織、特別会計は特別会計名、政府関係機関は機関名 */
export function orgColumn(item: MOFKouMokuItem): string {
  if (item.accountType === 'general') return item.organization;
  if (item.accountType === 'special') return item.specialAccount;
  return item.agency;
}

function sortValue(item: MOFKouMokuItem, key: SortKey): string | number | null {
  switch (key) {
    case 'accountType':
      return ACCOUNT_LABEL[item.accountType];
    case 'organization':
      return orgColumn(item);
    case 'rate': {
      const r = changeRate(item.amount, item.previousAmount);
      return r === null || r === 'new' ? null : r;
    }
    default:
      return item[key];
  }
}

/**
 * 並べ替え。渡された配列を破壊的にソートして返す。
 * 項コードは会計により2桁/3桁が混在するため、対象がすべて数字のときだけ数値比較にする。
 */
export function sortItems(rows: MOFKouMokuItem[], sortKey: SortKey, sortDir: SortDir): MOFKouMokuItem[] {
  const numericSectionCode = sortKey === 'sectionCode' && rows.every(r => /^\d+$/.test(r.sectionCode));
  const factor = sortDir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const va = numericSectionCode ? Number(a.sectionCode) : sortValue(a, sortKey);
    const vb = numericSectionCode ? Number(b.sectionCode) : sortValue(b, sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb), 'ja') * factor;
  });
}

/** その列を新たに選んだときの既定の並び順 */
export function defaultDirFor(column: ColumnSpec): SortDir {
  return column.numeric ? 'desc' : 'asc';
}

/** 複数リンクがある場合に列・詳細パネルの代表として使う1件（金額降順） */
export function bestLink<T extends { rsAmount: number }>(links: T[]): T | null {
  if (links.length === 0) return null;
  return [...links].sort((a, b) => b.rsAmount - a.rsAmount)[0];
}
