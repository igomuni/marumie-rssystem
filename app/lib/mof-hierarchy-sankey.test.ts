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

describe('TopN は列単位で効く', () => {
  /**
   * 所管 → 項 → 事項 の枝を作る（1事項＝1枝）。
   * 項の表示名は「コード 名称」で組まれるので、照合は部分一致で行う
   */
  const branch = (ministry: string, section: string, name: string, amount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name,
      amount,
    });

  it('親ごとではなく列全体で上位N件を残す', () => {
    // 所管Aに小さい項が5本、所管Bに大きい項が1本。
    // 親ごとの TopN だと A から5本すべて残るが、列単位なら大きい順に切られる
    const items = [
      ...Array.from({ length: 5 }, (_, i) => branch('A', `a${i}`, `事項a${i}`, 10)),
      branch('B', 'b0', '事項b0', 1000),
    ];
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 2 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    expect(sections).toHaveLength(2);
    // 残るのは金額の大きい順。所管をまたいで比べる
    expect(sections.some(n => n.name.includes('b0'))).toBe(true);
    expect(sections.every(n => n.value === 1000 || n.value === 10)).toBe(true);
  });

  it('集約ノードの名前は「件数＋単位」で、「その他」とは書かない', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch('A', `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    );
    expect(agg).toBeDefined();
    expect(agg!.name).toBe('4項');
    expect(agg!.name).not.toContain('その他');
  });

  it('集約ノードは中身の上位を持つ', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch('A', `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    )!;
    expect(agg.details.aggregatedTop?.[0].amount).toBe(98);
    expect(agg.details.aggregatedTop?.[0].name).toContain('s2');
    // 大きい順に並ぶ
    const amounts = agg.details.aggregatedTop!.map(m => m.amount);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('すべての列に TopN を指定できる', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch(`省庁${i}`, `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { ministry: 2 } });
    const ministries = result.sankey.nodes.filter(
      n => n.details.column === 'ministry' && !n.details.aggregated
    );
    expect(ministries).toHaveLength(2);
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'ministry' && n.details.aggregated
    );
    expect(agg!.name).toBe('4所管');
  });

  it('集約された所管の下の項は個別に出さず、下の列の集約に流す', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch(`省庁${i}`, `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { ministry: 2 } });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 残った2所管の項だけが個別に立つ
    expect(sections).toHaveLength(2);
    expect(sections.some(n => n.name.includes('s0'))).toBe(true);
    expect(sections.some(n => n.name.includes('s1'))).toBe(true);
    // 合計は保たれる
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });
});

describe('TopN のオフセット', () => {
  const branch = (ministry: string, section: string, amount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name: `事項${section}`,
      amount,
    });

  /** 金額 100, 99, 98, ... の項を n 本作る */
  const ranked = (n: number) =>
    Array.from({ length: n }, (_, i) => branch('A', `s${i}`, 100 - i));

  it('オフセットの分だけ順位をずらして切り出す', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 4〜6位（金額 97, 96, 95）
    expect(sections.map(n => n.value).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([97, 96, 95]);
  });

  it('窓の外は上位側も含めて集約に入る', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    )!;
    // 10件中3件を残したので7件が集約。上位3件もここに入る
    expect(agg.details.aggregatedCount).toBe(7);
    // 合計は保たれる
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });

  it('行き過ぎたオフセットは末尾に丸め、丸めた値を返す', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 999 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 末尾3件（金額 93, 92, 91）
    expect(sections.map(n => n.value).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([93, 92, 91]);
    expect(result.metadata.offset.section).toBe(7);
  });

  it('列ごとの候補件数を返す（オフセットの上限を画面が出すため）', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
    });
    expect(result.metadata.columnCounts.section).toBe(10);
    expect(result.metadata.columnCounts.ministry).toBe(1);
  });
});
