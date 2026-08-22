import { describe, it, expect } from 'vitest';
import type { MOFJikouItem } from '@/types/mof-jikou';
import { buildMOFHierarchySankey, DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';

/** 検証に必要なフィールドだけ指定できるようにする */
function item(overrides: Partial<MOFJikouItem>): MOFJikouItem {
  return {
    id: 'x',
    key: 'x',
    accountType: 'general',
    budgetType: '当初予算',
    documentId: '202611001',
    ministry: '財務省',
    organization: '財務本省',
    specialAccount: '',
    subAccount: '',
    agency: '',
    sectionCode: '001',
    sectionName: '財務本省共通費',
    majorExpenseCode: '95',
    majorExpenseName: 'その他の事項経費',
    name: '事項A',
    amount: 100,
    previousAmount: null,
    difference: null,
    currentAmount: null,
    spent: null,
    carriedOver: null,
    unused: null,
    description: '',
    page: 1,
    sourceUrl: '',
    ...overrides,
  };
}

const options = {
  fiscalYear: 2026,
  eraLabel: '令和8年度',
  budgetType: '当初予算' as const,
  budgetTypes: ['当初予算' as const],
  availableYears: [2026],
};

describe('buildMOFHierarchySankey', () => {
  it('選んだ予算種別の事項だけを対象にする', () => {
    const result = buildMOFHierarchySankey(
      [item({ amount: 100 }), item({ budgetType: '暫定予算', amount: 999, name: '事項B' })],
      options
    );
    expect(result.metadata.total).toBe(100);
    expect(result.metadata.itemCount).toBe(1);
  });

  it('値の無い列は素通りし、列を畳まない', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    const columns = result.sankey.nodes.map(n => n.details.column);
    expect(columns).toContain('ministry');
    expect(columns).toContain('organization');
    expect(columns).toContain('section');
    expect(columns).toContain('item');
    // 一般会計は勘定を持たない。列は畳まず、場所だけ確保する通過ノードを置く
    const subAccounts = result.sankey.nodes.filter(n => n.details.column === 'subAccount');
    expect(subAccounts).toHaveLength(1);
    expect(subAccounts[0].details.passThrough).toBe(true);
    expect(subAccounts[0].value).toBe(100);
  });

  it('通過ノードは実体を持たない（名前が空・集約に数えない）', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    const pass = result.sankey.nodes.filter(n => n.details.passThrough);
    expect(pass).toHaveLength(1);
    expect(pass[0].name).toBe('');
    expect(pass[0].details.aggregated).toBeUndefined();
  });

  it('勘定を持つ特別会計では勘定列が立つ', () => {
    const result = buildMOFHierarchySankey(
      [
        item({
          accountType: 'special',
          ministry: '共管',
          organization: '',
          specialAccount: '年金特別会計',
          subAccount: '厚生年金勘定',
        }),
      ],
      options
    );
    const subAccounts = result.sankey.nodes.filter(n => n.details.column === 'subAccount');
    expect(subAccounts).toHaveLength(1);
    expect(subAccounts[0].name).toBe('厚生年金勘定');
  });

  it('所管が空の政府関係機関は会計区分名を所管に置く', () => {
    const result = buildMOFHierarchySankey(
      [item({ accountType: 'agency', ministry: '', organization: '', agency: '沖縄振興開発金融公庫' })],
      options
    );
    const ministries = result.sankey.nodes.filter(n => n.details.column === 'ministry');
    expect(ministries.map(n => n.name)).toEqual(['政府関係機関']);
  });

  it('同名の事項が別の項にあれば別ノードになる', () => {
    const result = buildMOFHierarchySankey(
      [
        item({ sectionCode: '001', sectionName: '項A', name: '同じ名前の事項' }),
        item({ sectionCode: '002', sectionName: '項B', name: '同じ名前の事項' }),
      ],
      options
    );
    const items = result.sankey.nodes.filter(n => n.details.column === 'item');
    expect(items).toHaveLength(2);
  });

  it('各ノードで流入と流出が一致する（根と葉を除く）', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ sectionCode: `00${i}`, sectionName: `項${i}`, name: `事項${i}`, amount: 10 * (i + 1) })
    );
    const result = buildMOFHierarchySankey(items, options);
    const inflow = new Map<string, number>();
    const outflow = new Map<string, number>();
    for (const link of result.sankey.links) {
      inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
      outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    }
    for (const node of result.sankey.nodes) {
      const inValue = inflow.get(node.id);
      const outValue = outflow.get(node.id);
      if (inValue !== undefined && outValue !== undefined) {
        expect(outValue).toBe(inValue);
      }
      if (inValue !== undefined) expect(inValue).toBe(node.value);
    }
  });

  it('TopN を超えた子は「その他」に集約され、合計は保たれる', () => {
    const count = (DEFAULT_TOP_N.section ?? 12) + 5;
    const items = Array.from({ length: count }, (_, i) =>
      item({
        sectionCode: String(i).padStart(3, '0'),
        sectionName: `項${i}`,
        name: `事項${i}`,
        amount: count - i,
      })
    );
    const result = buildMOFHierarchySankey(items, options);
    const sections = result.sankey.nodes.filter(n => n.details.column === 'section');
    expect(sections).toHaveLength((DEFAULT_TOP_N.section ?? 12) + 1);
    const others = sections.filter(n => n.details.aggregated);
    expect(others).toHaveLength(1);
    expect(others[0].details.aggregatedCount).toBe(5);
    // 集約しても総額は変わらない
    expect(sections.reduce((s, n) => s + (n.value ?? 0), 0)).toBe(result.metadata.total);
  });

  it('集約された枝の子孫はノードに残らない', () => {
    const count = (DEFAULT_TOP_N.section ?? 12) + 3;
    const items = Array.from({ length: count }, (_, i) =>
      item({
        sectionCode: String(i).padStart(3, '0'),
        sectionName: `項${i}`,
        name: `事項${i}`,
        amount: count - i,
      })
    );
    const result = buildMOFHierarchySankey(items, options);
    const itemNodes = result.sankey.nodes.filter(
      n => n.details.column === 'item' && !n.details.aggregated
    );
    // 残った項の下だけに事項が立つ（溢れた分は列の「その他」に入る）
    expect(itemNodes).toHaveLength(DEFAULT_TOP_N.section ?? 12);
    // リンクの参照先がすべて実在する
    const ids = new Set(result.sankey.nodes.map(n => n.id));
    for (const link of result.sankey.links) {
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    }
  });

  it('収録されていない会計区分は accounts に出さない', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    expect(result.accounts.map(a => a.accountType)).toEqual(['general']);
  });
});
