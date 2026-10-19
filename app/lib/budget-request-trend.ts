/**
 * 概算要求の年度推移（項）の絞り込み・並べ替え。純粋関数のみ（HTTP・React 禁止）。
 * データ: types/budget-request-trend.ts。仕様: docs/budget-request-trend-csv.md。
 * 増減・増減率は、その年度の「要求額 − 前年度予算額」（その年度の要求書が載せる値どうし）。
 */
import type { BudgetRequestTrendRow, BudgetRequestTrendYear } from '@/types/budget-request-trend';
import { MAX_REGEX_PATTERN_LENGTH } from '@/app/lib/sankey-query';

export type PatternFilter = 'all' | 'all5' | 'new' | 'gone';
export type ChangeFilter = '' | 'up10' | 'up50' | 'dn10' | 'dn50';
export type TrendSortKey = 'group' | 'org' | 'name' | 'prev' | 'req' | 'diff' | 'rate';
export type TrendSortDir = 1 | -1;

export interface TrendFilters {
  /** 項名の検索。regex が true なら正規表現（/sankey-svg の事業名・支出先名と同じ: 大文字小文字を区別しない、128 文字まで） */
  name: string;
  nameRegex: boolean;
  /** 組織（特別会計は勘定）の検索。規則は項名と同じ */
  org: string;
  orgRegex: boolean;
  acct: 'all' | 0 | 1;
  /** 所管の絞り込み（groupOf の値）。空なら絞り込まない */
  groups: string[];
  pattern: PatternFilter;
  change: ChangeFilter;
  /** 共管（その年度に複数の要求書に載る）だけ */
  shared: boolean;
  /** その年度に金額が一致しない要求書がある行だけ */
  mismatch: boolean;
}

export const INITIAL_TREND_FILTERS: TrendFilters = { name: '', nameRegex: false, org: '', orgRegex: false, acct: 'all', groups: [], pattern: 'all', change: '', shared: false, mismatch: false };

/** 所管の表示名。特別会計は［特］を付ける */
export const groupOf = (r: BudgetRequestTrendRow): string => (r.acct === 0 ? r.min : `［特］${r.min}`);
/** 組織の列の表示。特別会計は勘定 */
export const orgOf = (r: BudgetRequestTrendRow): string => (r.acct === 0 ? r.org : r.sub);

export const yearOf = (r: BudgetRequestTrendRow, year: number): BudgetRequestTrendYear | undefined => r.y[String(year)];

export function changeAmount(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year);
  return a && a.req !== null && a.prev !== null ? a.req - a.prev : null;
}
export function changeRate(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year);
  return a && a.req !== null && a.prev !== null && a.prev !== 0 ? (a.req - a.prev) / a.prev : null;
}
/** その年度に載り、前年度（の要求書）に無い。最初の年度では判定しない */
export const isNew = (r: BudgetRequestTrendRow, year: number, firstYear: number): boolean =>
  year > firstYear && !!yearOf(r, year) && !yearOf(r, year - 1);
/** 前年度にあり、その年度に無い */
export const isGone = (r: BudgetRequestTrendRow, year: number, firstYear: number): boolean =>
  year > firstYear && !yearOf(r, year) && !!yearOf(r, year - 1);
export const inAllYears = (r: BudgetRequestTrendRow, years: readonly number[]): boolean => years.every(y => !!yearOf(r, y));

/**
 * 文字列フィルタの判定。空の検索語は全件一致。正規表現は /sankey-svg と同じく大文字小文字を区別せず、
 * 不正・長すぎる（128 文字超）ときは何も一致させない。通常は大文字小文字を区別しない部分一致。
 */
export function textMatches(haystack: string, query: string, regex: boolean): boolean {
  const q = query.trim();
  if (!q) return true;
  if (regex) {
    if (q.length > MAX_REGEX_PATTERN_LENGTH) return false;
    try { return new RegExp(q, 'i').test(haystack); } catch { return false; }
  }
  return haystack.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

export function filterRows(rows: readonly BudgetRequestTrendRow[], f: TrendFilters, year: number, years: readonly number[]): BudgetRequestTrendRow[] {
  const first = years[0];
  const groups = new Set(f.groups);
  return rows.filter(r => {
    const a = yearOf(r, year);
    if (f.pattern === 'gone') { if (!isGone(r, year, first)) return false; } else if (!a) return false;
    if (f.acct !== 'all' && r.acct !== f.acct) return false;
    if (groups.size > 0 && !groups.has(groupOf(r))) return false;
    if (!textMatches(r.name, f.name, f.nameRegex)) return false;
    if (!textMatches(`${r.org} ${r.sub}`, f.org, f.orgRegex)) return false;
    if (f.pattern === 'all5' && !inAllYears(r, years)) return false;
    if (f.pattern === 'new' && !isNew(r, year, first)) return false;
    if (f.shared && !(a && a.src.length > 1)) return false;
    if (f.mismatch && !(a && a.mismatch)) return false;
    if (f.change) {
      const t = changeRate(r, year);
      if (t === null) return false;
      if (f.change === 'up10' && !(t >= 0.1)) return false;
      if (f.change === 'up50' && !(t >= 0.5)) return false;
      if (f.change === 'dn10' && !(t <= -0.1)) return false;
      if (f.change === 'dn50' && !(t <= -0.5)) return false;
    }
    return true;
  });
}

function sortValue(r: BudgetRequestTrendRow, key: TrendSortKey, year: number): string | number | null {
  switch (key) {
    case 'group': return groupOf(r);
    case 'org': return orgOf(r);
    case 'name': return r.name;
    case 'prev': return yearOf(r, year)?.prev ?? null;
    case 'req': return yearOf(r, year)?.req ?? null;
    case 'diff': return changeAmount(r, year);
    case 'rate': return changeRate(r, year);
  }
}

/** 値の無い行は昇順・降順どちらでも末尾 */
export function sortRows(rows: readonly BudgetRequestTrendRow[], key: TrendSortKey, dir: TrendSortDir, year: number): BudgetRequestTrendRow[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key, year), y = sortValue(b, key, year);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'string' && typeof y === 'string') return dir * x.localeCompare(y, 'ja');
    return dir * ((x as number) - (y as number));
  });
}

/** 翌年度の要求書が載せる前年度予算額 − その年度の要求額（要求→予算の査定。負なら要求より予算が少ない） */
export function assessmentGap(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year), n = yearOf(r, year + 1);
  return a && n && a.req !== null && n.prev !== null ? n.prev - a.req : null;
}
