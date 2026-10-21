import { describe, expect, it } from 'vitest';
import type { BudgetRequestTrendRow, BudgetRequestTrendYear } from '@/types/budget-request-trend';
import { INITIAL_TREND_FILTERS, assessmentGap, groupOf, jikouKeyOf, mergeJikou, recordsOf, changeRate, filterRows, isGone, isNew, patternOf, publisherOf, sortRows, textMatches } from './budget-request-trend';

const URLS = ['https://www.env.go.jp/a.pdf', 'https://www.meti.go.jp/b.pdf'];
const Y = (prev: number | null, req: number | null, extra: Partial<BudgetRequestTrendYear> = {}): BudgetRequestTrendYear => ({ code: '19', prev, req, src: [[0, '1', '3']], mismatch: false, mof: '', ...extra });
const row = (name: string, y: Record<string, BudgetRequestTrendYear>, o: Partial<BudgetRequestTrendRow> = {}): BudgetRequestTrendRow =>
  ({ acct: 0, code: '19', min: '内閣府', sub: '', org: '本府', orgSrc: '目次', name, y, ...o });
const YEARS = [2025, 2026, 2027];
const recs = (rs: readonly BudgetRequestTrendRow[]) => rs.flatMap(r => recordsOf(r, 2027, URLS));
const recordsOfNames = (xs: readonly { row: BudgetRequestTrendRow }[]) => xs.map(x => x.row.name);
const rows = [
  row('継続費', { '2025': Y(100, 120), '2026': Y(110, 200), '2027': Y(150, 150) }),
  row('新設費', { '2027': Y(0, 50) }),
  row('廃止費', { '2025': Y(10, 10), '2026': Y(10, 10) }),
  row('特会費', { '2027': Y(100, 90, { src: [[0, '1', '3'], [1, '2', '4']] }) }, { acct: 1, min: '東日本大震災復興特別会計', sub: '勘定A', org: '' }),
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
  it('labels the appearance pattern against the previous year (none for the first year)', () => {
    expect(patternOf(rows[0], 2027, 2025)).toBe('継続');
    expect(patternOf(rows[1], 2027, 2025)).toBe('新規');
    expect(patternOf(rows[2], 2027, 2025)).toBe('消滅');
    expect(patternOf(rows[0], 2025, 2025)).toBeNull();
    expect(sortRows(recs(rows), 'pattern', 1, 2027, 2025).map(r => r.row.name)).toEqual(['新設費', '特会費', '特会費', '継続費', '廃止費']);
  });
  it('lists only the keys present in the selected year, except for the gone pattern', () => {
    expect(filterRows(rows, INITIAL_TREND_FILTERS, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['継続費', '新設費', '特会費', '特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, pattern: 'gone' }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['廃止費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, pattern: 'all5' }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['継続費']);
  });
  it('filters by account, ministry group, shared and change', () => {
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, accts: ['東日本大震災復興特別会計特別会計'] }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費', '特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, groups: ['経済産業省'] }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, shared: true }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費', '特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, change: 'dn10' }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費', '特会費']);
  });
  it('sorts with missing values last in both directions', () => {
    expect(sortRows(recs(rows.slice(0, 2)), 'rate', -1, 2027, 2025).map(r => r.row.name)).toEqual(['継続費', '新設費']);
    expect(sortRows(recs(rows.slice(0, 2)), 'rate', 1, 2027, 2025).map(r => r.row.name)).toEqual(['継続費', '新設費']);
  });
  it('matches text like /sankey-svg: case-insensitive, regex only when asked, invalid or long regex matches nothing', () => {
    expect(textMatches('Digital庁', 'digital', false)).toBe(true);
    expect(textMatches('a.b', '.*', false)).toBe(false); // 通常の検索では .* は文字どおり
    expect(textMatches('子ども家庭庁', '^子ども.*庁$', true)).toBe(true);
    expect(textMatches('Digital庁', 'DIGITAL', true)).toBe(true);
    expect(textMatches('x', '(', true)).toBe(false);
    expect(textMatches('x', 'x'.repeat(129), true)).toBe(false);
    expect(textMatches('x', '  ', false)).toBe(true);
  });
  it('searches the item name and the organization separately', () => {
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, name: '特会', org: '' }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費', '特会費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, org: '本府' }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['継続費', '新設費']);
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, org: '勘定[AB]', orgRegex: true }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費', '特会費']);
  });
  it('computes the assessment gap from next year previous amount', () => {
    expect(assessmentGap(rows[0], 2025)).toBe(110 - 120);
    expect(assessmentGap(rows[0], 2027)).toBeNull();
  });
  it('maps a request book URL to the publishing ministry by domain', () => {
    expect(publisherOf('https://www.env.go.jp/content/x.pdf')).toBe('環境省');
    expect(publisherOf('https://www.unknown.example/x.pdf')).toBe('unknown.example');
  });
  it('uses the publishing ministries of the request books as the 所管 (any match filters)', () => {
    const shared = rows.find(r => r.name === '特会費')!;
    expect(groupOf(shared, 2027, URLS)).toBe('環境省、経済産業省');
    expect(filterRows(rows, { ...INITIAL_TREND_FILTERS, groups: ['経済産業省'] }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['特会費']);
  });
  it('filters items whose 目 include a 繰入 in the selected year', () => {
    const withXfer = [row('繰入費', { '2027': Y(10, 20, { xfer: ['国債整理基金特別会計へ繰入'] }) }), ...rows];
    expect(filterRows(withXfer, { ...INITIAL_TREND_FILTERS, transfer: true }, 2027, YEARS, URLS).map(r => r.row.name)).toEqual(['繰入費']);
  });
  it('flags a missing PDF page only on the publisher whose book lacks it', () => {
    const partly = row('一部だけ頁なし', { '2027': Y(10, 20, { src: [[0, '1', '3'], [1, '2', '']] }) });
    const rs = recordsOf(partly, 2027, URLS);
    expect(rs.map(x => [x.group, x.noPdfPage])).toEqual([['環境省', false], ['経済産業省', true]]);
    expect(filterRows([partly], { ...INITIAL_TREND_FILTERS, noPdfPage: true }, 2027, YEARS, URLS).map(x => x.group)).toEqual(['経済産業省']);
  });
  it('merges the 事項要求 candidates into the year values by key and filters on them', () => {
    const data = { years: YEARS, urls: URLS, rows };
    const merged = mergeJikou(data, { years: { '2027': [[jikouKeyOf(rows[0]), ['印'], '（事項要求）'], ['0|無い|||項', ['要求0'], '']], '2026': [[jikouKeyOf(rows[3]), ['要求0'], '']] } });
    expect(merged.rows[0].y['2027'].jikou).toEqual({ forms: ['印'], text: '（事項要求）' });
    expect(merged.rows[0].y['2026'].jikou).toBeUndefined();
    expect(merged.rows[3].y['2026']).toBeUndefined(); // その年度に載っていない行には付けない
    expect(rows[0].y['2027'].jikou).toBeUndefined(); // 元のデータは変えない
    expect(recordsOfNames(filterRows(merged.rows, { ...INITIAL_TREND_FILTERS, jikou: true }, 2027, YEARS, URLS))).toEqual(['継続費']);
  });
});
