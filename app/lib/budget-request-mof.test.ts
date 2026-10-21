import { describe, expect, it } from 'vitest';
import type { BudgetRequestMofRow } from '@/types/budget-request-mof';
import { INITIAL_MOF_FILTERS, diffOf, filterMofRows, groupOf, isJoint, mofRowKey, publishersOf, rateOf, sortMofRows } from './budget-request-mof';

const URLS = ['https://www.mlit.go.jp/a.pdf', 'https://www.meti.go.jp/b.pdf', 'https://www.env.go.jp/c.pdf'];
const R = (name: string, o: Partial<BudgetRequestMofRow> = {}): BudgetRequestMofRow =>
  ({ y: 2026, kind: 'matched', acct: 0, grp: '国土交通省', min: '国土交通省', sub: '', org: '気象庁', name, mof: 110, mofPrev: 100, req: 100, reqPrev: 100, books: [[0, '1', '3', 100]], types: [], ...o });
const rows = [
  R('気象官署共通費', { types: ['組織に事項要求'] }),
  R('予備費', { mof: 1000, req: 500, types: ['編成で決まる'] }),
  R('MOFのみの項', { kind: 'mofOnly', req: null, reqPrev: null, books: [] }),
  R('額0の項', { kind: 'zero', mof: null, req: 0, reqPrev: 0 }),
  R('特会の項', { acct: 1, grp: '内閣府、文部科学省、経済産業省及び環境省', min: 'エネルギー対策', sub: 'エネルギー需給勘定', org: '', books: [[1, '2', '', 50], [2, '3', '', 50]], mof: 40, req: 50 }),
  R('前年度の項', { y: 2025 }),
];

describe('budget-request-mof', () => {
  it('computes the difference as initial budget minus request', () => {
    expect(diffOf(rows[1])).toBe(500);
    expect(rateOf(rows[1])).toBe(1);
    expect(diffOf(rows[2])).toBeNull();
  });
  it('hides zero-amount rows and other years by default', () => {
    const names = filterMofRows(rows, INITIAL_MOF_FILTERS, 2026, URLS).map(r => r.name);
    expect(names).not.toContain('額0の項');
    expect(names).not.toContain('前年度の項');
    expect(names).toContain('MOFのみの項');
  });
  it('excludes placeholder items and filters by type and size of the difference', () => {
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, noPlaceholder: true }, 2026, URLS).map(r => r.name)).not.toContain('予備費');
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, types: ['組織に事項要求'] }, 2026, URLS).map(r => r.name)).toEqual(['気象官署共通費']);
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, diff: 'up10' }, 2026, URLS).map(r => r.name)).toEqual(['気象官署共通費', '予備費']);
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, diff: 'dn10' }, 2026, URLS).map(r => r.name)).toEqual(['特会の項']);
  });
  it('labels items of several ministries as N所管 (東日本大震災復興 by 復興庁), and filters by any ministry or by 複数所管', () => {
    expect(groupOf(rows[4], URLS)).toBe('2所管');
    expect(publishersOf(rows[4], URLS)).toEqual(['経済産業省', '環境省']);
    expect(groupOf(R('x', { acct: 1, grp: '内閣府及び厚生労働省', books: [] }), URLS)).toBe('2所管');
    expect(groupOf(R('x', { acct: 1, min: '東日本大震災復興', books: [[0, '1', '', 1], [3, '1', '', 1]] }), [...URLS, 'https://www.reconstruction.go.jp/x.pdf'])).toBe('復興庁（取りまとめ）');
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, groups: ['複数所管'] }, 2026, URLS).map(r => r.name)).toEqual(['特会の項']);
    expect(isJoint(rows[0], URLS)).toBe(false);
    // 一般会計も公開元（内閣府の外局は、予算書の所管が内閣府でも、それぞれの府省）
    expect(groupOf(R('保育対策費', { grp: '内閣府', org: 'こども家庭庁', books: [[3, '1', '2', 1]] }), [...URLS, 'https://www.cfa.go.jp/x.pdf'])).toBe('こども家庭庁');
    expect(groupOf(R('MOFのみ', { grp: '内閣府', books: [] }), URLS)).toBe('内閣府');
    expect(filterMofRows(rows, { ...INITIAL_MOF_FILTERS, groups: ['環境省'] }, 2026, URLS).map(r => r.name)).toEqual(['特会の項']);
  });
  it('sorts by the signed difference with missing values last, and keys rows uniquely', () => {
    const sorted = sortMofRows(filterMofRows(rows, INITIAL_MOF_FILTERS, 2026, URLS), 'diff', -1, URLS).map(r => r.name);
    expect(sorted).toEqual(['予備費', '気象官署共通費', '特会の項', 'MOFのみの項']);
    expect(new Set(rows.map(mofRowKey)).size).toBe(rows.length);
  });
});
