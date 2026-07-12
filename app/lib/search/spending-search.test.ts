import { describe, it, expect } from 'vitest';
import type { SpendingSearchRow } from '@/app/lib/api/quality-recipients-loader';
import { normalizeQuery } from '@/app/lib/search/project-search';
import { searchSpending } from '@/app/lib/search/spending-search';

function makeRow(overrides: Partial<SpendingSearchRow> & Pick<SpendingSearchRow, 'pid' | 'role' | 'cc'>): SpendingSearchRow {
  const role = overrides.role ?? '';
  const cc = overrides.cc ?? '';
  return {
    n: '受領者',
    b: '',
    s: 'valid',
    c: true,
    cn: '1234567890123',
    o: false,
    a2: 1000,
    r: false,
    chain: '',
    d: 0,
    roleNorm: normalizeQuery(role),
    ccNorm: normalizeQuery(cc),
    ...overrides,
  };
}

describe('searchSpending', () => {
  it('aggregates direct (d=0) and subcontract (d>0) amounts separately', () => {
    const rows: SpendingSearchRow[] = [
      makeRow({ pid: '1', role: '広報活動の実施', cc: '', d: 0, a2: 1000 }),
      makeRow({ pid: '1', role: '広報活動の再委託先', cc: '', d: 1, a2: 300 }),
    ];
    const result = searchSpending(rows, '広報', { limit: 10, offset: 0 });
    expect(result.aggregate.amountDirect).toBe(1000);
    expect(result.aggregate.amountSubcontract).toBe(300);
    expect(result.aggregate.hitCount).toBe(2);
    expect(result.aggregate.projectCount).toBe(1);
  });

  it('computes topProjects per-category amounts (direct vs subcontract) independently', () => {
    const rows: SpendingSearchRow[] = [
      makeRow({ pid: 'A', role: 'システム改修業務', cc: '', d: 0, a2: 5000 }),
      makeRow({ pid: 'A', role: 'システム改修の再委託', cc: '', d: 2, a2: 2000 }),
      makeRow({ pid: 'B', role: 'システム改修支援', cc: '', d: 0, a2: 100 }),
    ];
    const result = searchSpending(rows, 'システム改修', { limit: 10, offset: 0 });
    const top = result.aggregate.topProjects;
    expect(top[0].pid).toBe('A'); // 5000+2000=7000 > 100
    expect(top[0].amountDirect).toBe(5000);
    expect(top[0].amountSubcontract).toBe(2000);
    expect(top[1].pid).toBe('B');
    expect(top[1].amountDirect).toBe(100);
    expect(top[1].amountSubcontract).toBe(0);
  });

  it('finds the excerpt around the match position with embedded whitespace in the query', () => {
    const longText = 'あ'.repeat(80) + 'キーワード' + 'い'.repeat(80);
    const rows: SpendingSearchRow[] = [makeRow({ pid: '1', role: longText, cc: '' })];
    // query has an embedded space that should be stripped by normalization
    const result = searchSpending(rows, 'キー ワード', { limit: 10, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].excerpt).toContain('キーワード');
    // excerpt should be truncated (not the full 165-char text), with ellipsis markers
    expect(result.items[0].excerpt.length).toBeLessThan(longText.length);
    expect(result.items[0].excerpt.startsWith('…')).toBe(true);
    expect(result.items[0].excerpt.endsWith('…')).toBe(true);
  });

  it('normalizes full-width/half-width (NFKC) differences between query and text', () => {
    const rows: SpendingSearchRow[] = [makeRow({ pid: '1', role: 'ＡＢＣシステム開発', cc: '' })];
    const result = searchSpending(rows, 'ABC', { limit: 10, offset: 0 });
    expect(result.items).toHaveLength(1);
  });

  it('falls back to the head of the text when the normalized match position cannot be found in excerpt (matches ccNorm not sourceText role)', () => {
    // matchedIn is determined by roleNorm/ccNorm inclusion, but excerpt always reads from the
    // matched field's *original* text. Here cc matches, so excerpt should come from cc text, not role.
    const rows: SpendingSearchRow[] = [
      makeRow({ pid: '1', role: '無関係な役割テキスト', cc: 'これは契約概要のテキストです' }),
    ];
    const result = searchSpending(rows, '契約概要', { limit: 10, offset: 0 });
    expect(result.items[0].matchedIn).toBe('cc');
    expect(result.items[0].excerpt).toContain('契約概要');
  });

  it('applies limit/offset to items while keeping aggregate over all matches', () => {
    const rows: SpendingSearchRow[] = Array.from({ length: 5 }, (_, i) =>
      makeRow({ pid: String(i), role: `対象業務${i}`, cc: '', a2: 100 + i }),
    );
    const result = searchSpending(rows, '対象業務', { limit: 2, offset: 1 });
    expect(result.totalHits).toBe(5);
    expect(result.items).toHaveLength(2);
    expect(result.aggregate.hitCount).toBe(5);
  });

  it('returns an empty result for an empty/whitespace query', () => {
    const rows: SpendingSearchRow[] = [makeRow({ pid: '1', role: 'テスト', cc: '' })];
    const result = searchSpending(rows, '   ', { limit: 10, offset: 0 });
    expect(result.totalHits).toBe(0);
    expect(result.aggregate.hitCount).toBe(0);
  });

  it('sorts items by amount (a2) descending', () => {
    const rows: SpendingSearchRow[] = [
      makeRow({ pid: '1', role: '対象X 小額', cc: '', a2: 50 }),
      makeRow({ pid: '2', role: '対象X 高額', cc: '', a2: 5000 }),
    ];
    const result = searchSpending(rows, '対象X', { limit: 10, offset: 0 });
    expect(result.items.map(h => h.row.a2)).toEqual([5000, 50]);
  });
});
