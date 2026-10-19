import { describe, expect, it } from 'vitest';
import type { BudgetRequestTrendRow, BudgetRequestTrendYear } from '@/types/budget-request-trend';
import { INITIAL_TREND_FILTERS, assessmentGap, changeRate, filterRows, isGone, isNew, sortRows } from './budget-request-trend';

const Y = (prev: number | null, req: number | null, extra: Partial<BudgetRequestTrendYear> = {}): BudgetRequestTrendYear => ({ prev, req, src: [[0, '1']], mismatch: false, mof: '', ...extra });
const row = (name: string, y: Record<string, BudgetRequestTrendYear>, o: Partial<BudgetRequestTrendRow> = {}): BudgetRequestTrendRow =>
  ({ acct: 0, code: '19', min: '内閣府', sub: '', org: '本府', orgSrc: '目次', name, y, ...o });
const YEARS = [2025, 2026, 2027];
const rows = [
  row('継続費', { '2025': Y(100, 120), '2026': Y(110, 200), '2027': Y(150, 150) }),
  row('新設費', { '2027': Y(0, 50) }),
  row('廃止費', { '2025': Y(10, 10), '2026': Y(10, 10) }),
  row('特会費', { '2027': Y(100, 90, { src: [[0, '1'], [1, '2']] }) }, { acct: 1, min: '東日本大震災復興特別会計', sub: '勘定A', org: '' }),
];

describe('budget-request-trend', () => {
  it('computes the change within the same year (req - prev)', () => {
    expect(changeRate(rows[0], 2026)).toBeCloseTo(0.8181, 3);
    expect(changeRate(rows[1], 2027)).toBeNull(); // prev = 0
  });
  it('detects new and gone against the previous year, never for the first year', () => {
    expect(isNew(rows[1], 2027, 2025)).toBe(true);
    expect(isNew(rows[0], 2027, 2025)).toBe(false);
    expect(isGone(rows[2], 2027, 2025)).toBe(true);
    expect(isNew(rows[0], 2025, 2025)).toBe(false);
  });
  it('lists only the keys present in the selected year, except for the gone pattern', () => {
    expect(filterRows(rows, INITIAL_TREND_FILTERS, 2027, YEARS).map(r => r.name)).toEqual(['継続費', '新設費', '特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, pattern: 'gone' }, 2027, YEARS).map(r => r.name)).toEqual(['廃止費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, pattern: 'all5' }, 2027, YEARS).map(r => r.name)).toEqual(['継続費']);
  });
  it('filters by account, ministry group, shared and change', () => {
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, acct: 1 }, 2027, YEARS).map(r => r.name)).toEqual(['特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, groups: ['［特］東日本大震災復興特別会計'] }, 2027, YEARS).map(r => r.name)).toEqual(['特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, shared: true }, 2027, YEARS).map(r => r.name)).toEqual(['特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, change: 'dn10' }, 2027, YEARS).map(r => r.name)).toEqual(['特会費']);
  });
  it('sorts with missing values last in both directions', () => {
    expect(sortRows(rows.slice(0, 2), 'rate', -1, 2027).map(r => r.name)).toEqual(['継続費', '新設費']);
    expect(sortRows(rows.slice(0, 2), 'rate', 1, 2027).map(r => r.name)).toEqual(['継続費', '新設費']);
  });
  it('computes the assessment gap from next year previous amount', () => {
    expect(assessmentGap(rows[0], 2025)).toBe(110 - 120);
    expect(assessmentGap(rows[0], 2027)).toBeNull();
  });
});
