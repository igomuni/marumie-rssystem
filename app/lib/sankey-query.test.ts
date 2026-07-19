import { describe, it, expect } from 'vitest';
import type { RawNode, RawEdge } from '@/types/sankey-svg';
import type { SankeyQuery } from '@/types/sankey-query';
import {
  resolveSankeyQuery,
  sankeyQueryToUrlParams,
  sankeyQueryFromUrlParams,
  summarizeFilteredGraph,
  compareYearsSummary,
  buildFilterExcludedIds,
  TOP_PROJECT_MAX,
  SANKEY_QUERY_DEFAULTS,
} from '@/app/lib/sankey-query';

describe('resolveSankeyQuery', () => {
  it('normalizes filter.subcontract (minDepth floor, hasRedelegation strict true)', () => {
    const { query, errors } = resolveSankeyQuery({
      filter: { subcontract: { hasRedelegation: true, minDepth: 3.7 } },
    });
    expect(errors).toEqual([]);
    expect(query.filter.subcontract).toEqual({ hasRedelegation: true, minDepth: 3 });
  });

  it('reports an error for subcontract.minDepth below 2', () => {
    const { errors } = resolveSankeyQuery({ filter: { subcontract: { minDepth: 1 } } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/minDepth/);
  });

  it('reports an error for an invalid regex pattern', () => {
    const { errors } = resolveSankeyQuery({
      filter: { projectName: { query: '(unterminated', regex: true } },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/正規表現として不正/);
  });

  it('reports an error when budget min > max', () => {
    const { errors } = resolveSankeyQuery({
      filter: { budget: { min: 100, max: 10 } },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/min.*max/);
  });

  it('falls back to the default year when omitted', () => {
    const { query, errors } = resolveSankeyQuery({});
    expect(errors).toEqual([]);
    expect(query.year).toBe(SANKEY_QUERY_DEFAULTS.year);
  });

  it('clamps topProject above TOP_PROJECT_MAX down to the max', () => {
    const { query } = resolveSankeyQuery({ view: { topProject: TOP_PROJECT_MAX + 500 } });
    expect(query.view.topProject).toBe(TOP_PROJECT_MAX);
  });

  it('clamps topProject below 1 up to 1', () => {
    const { query } = resolveSankeyQuery({ view: { topProject: -5 } });
    expect(query.view.topProject).toBe(1);
  });

  it('rejects an unsupported year value', () => {
    const { errors } = resolveSankeyQuery({ year: '2099' as unknown as '2024' });
    expect(errors.some(e => e.includes('year'))).toBe(true);
  });

  it('flags unknown accountCategories values', () => {
    const { errors, query } = resolveSankeyQuery({
      filter: { accountCategories: ['bogus' as never] },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(query.filter.accountCategories).toEqual([]);
  });
});

describe('sankeyQueryToUrlParams / sankeyQueryFromUrlParams round trip', () => {
  it('round-trips amounts, multiple ministries, and regex flag', () => {
    const input: SankeyQuery = {
      year: '2025',
      filter: {
        projectName: { query: '子育て|保育', regex: true },
        recipientName: { query: '株式会社テスト' },
        ministries: ['デジタル庁', '厚生労働省'],
        budget: { min: 1_000_000_000_000, max: null },
        spending: { min: null, max: 5_000_000 },
      },
      view: { topProject: 120, topRecipient: 80 },
    };
    const { query: resolved } = resolveSankeyQuery(input);
    const params = sankeyQueryToUrlParams(resolved);
    const roundTripped = sankeyQueryFromUrlParams(params);
    const { query: resolvedAgain } = resolveSankeyQuery(roundTripped);

    expect(resolvedAgain.year).toBe('2025');
    expect(resolvedAgain.filter.projectName).toEqual({ query: '子育て|保育', regex: true });
    expect(resolvedAgain.filter.recipientName).toEqual({ query: '株式会社テスト', regex: false });
    expect(resolvedAgain.filter.ministries.sort()).toEqual(['デジタル庁', '厚生労働省'].sort());
    expect(resolvedAgain.filter.budget).toEqual({ min: 1_000_000_000_000, max: null });
    expect(resolvedAgain.filter.spending).toEqual({ min: null, max: 5_000_000 });
    expect(resolvedAgain.view.topProject).toBe(120);
    expect(resolvedAgain.view.topRecipient).toBe(80);
  });

  it('omits default-valued fields from the URL and keeps them omitted on reparse', () => {
    const { query: resolved } = resolveSankeyQuery({});
    const params = sankeyQueryToUrlParams(resolved);
    expect(params.has('tp')).toBe(false);
    expect(params.has('tm')).toBe(false);
    expect(params.has('tr')).toBe(false);
    expect(params.has('fp')).toBe(false);

    const roundTripped = sankeyQueryFromUrlParams(params);
    expect(roundTripped.view?.topProject).toBeUndefined();
    expect(roundTripped.filter).toBeUndefined();
  });

  it('always writes yr explicitly even at defaults', () => {
    const { query: resolved } = resolveSankeyQuery({ year: '2024' });
    const params = sankeyQueryToUrlParams(resolved);
    expect(params.get('yr')).toBe('2024');
  });
});

// ── summarizeFilteredGraph ──

function makeNode(overrides: Partial<RawNode> & Pick<RawNode, 'id' | 'name' | 'type' | 'value'>): RawNode {
  return { ...overrides };
}

describe('summarizeFilteredGraph', () => {
  // Small synthetic graph: 1 ministry, 2 projects, 3 recipients (one named "その他", one aggregated)
  const nodes: RawNode[] = [
    makeNode({ id: 'ministry-A', name: 'A省', type: 'ministry', value: 100 }),
    makeNode({ id: 'project-budget-1', name: '事業1', type: 'project-budget', value: 1000, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-spending-1', name: '事業1', type: 'project-spending', value: 900, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-budget-2', name: '事業2', type: 'project-budget', value: 500, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'project-spending-2', name: '事業2', type: 'project-spending', value: 400, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'r-1', name: '受領者A', type: 'recipient', value: 600 }),
    makeNode({ id: 'r-2', name: 'その他', type: 'recipient', value: 300 }),
    makeNode({ id: 'r-agg', name: 'その他の支出先', type: 'recipient', value: 400, aggregated: true }),
  ];
  const edges: RawEdge[] = [
    { source: 'project-spending-1', target: 'r-1', value: 600 },
    { source: 'project-spending-1', target: 'r-2', value: 300 },
    { source: 'project-spending-2', target: 'r-agg', value: 400 },
  ];

  it('counts, totals, and topShare1/topShare3 correctly', () => {
    const summary = summarizeFilteredGraph(nodes, edges, null, 10);
    expect(summary.projects.count).toBe(2);
    expect(summary.projects.budgetTotal).toBe(1500);
    expect(summary.projects.spendingTotal).toBe(1300);
    expect(summary.recipients.count).toBe(3);
    // non-aggregated total = 600 + 300 = 900; topShare1 = 600/900, topShare3 = 900/900
    expect(summary.recipients.topShare1).toBeCloseTo(0.6667, 4);
    expect(summary.recipients.topShare3).toBe(1);
  });

  it('includes the real "その他" recipient node in topShare (not excluded like aggregated)', () => {
    const summary = summarizeFilteredGraph(nodes, edges, null, 10);
    const names = summary.recipients.top.map(r => r.name);
    expect(names).toContain('その他');
  });

  it('excludes aggregated nodes from topShare1/topShare3 denominator', () => {
    // Verify aggregated recipient (r-agg, 400) does not inflate the denominator:
    // if it were included, topShare1 would be 600/1300 ≈ 0.4615 instead of 0.6667
    const summary = summarizeFilteredGraph(nodes, edges, null, 10);
    expect(summary.recipients.topShare1).not.toBeCloseTo(600 / 1300, 4);
  });

  it('returns null topShare when non-aggregated inflow total is zero', () => {
    const zeroEdges: RawEdge[] = [{ source: 'project-spending-2', target: 'r-agg', value: 400 }];
    const summary = summarizeFilteredGraph(nodes, zeroEdges, null, 10);
    expect(summary.recipients.topShare1).toBeNull();
    expect(summary.recipients.topShare3).toBeNull();
  });

  it('excludes nodes present in excludedIds', () => {
    const excluded = new Set(['project-budget-2', 'project-spending-2', 'r-agg']);
    const summary = summarizeFilteredGraph(nodes, edges, excluded, 10);
    expect(summary.projects.count).toBe(1);
    expect(summary.projects.budgetTotal).toBe(1000);
  });
});

describe('compareYearsSummary', () => {
  const baseNodes: RawNode[] = [
    makeNode({ id: 'project-budget-1', name: '事業1', type: 'project-budget', value: 1000, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-spending-1', name: '事業1', type: 'project-spending', value: 900, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-budget-2', name: '消滅事業', type: 'project-budget', value: 200, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'project-spending-2', name: '消滅事業', type: 'project-spending', value: 150, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'r-1', name: '受領者A', type: 'recipient', value: 900 }),
  ];
  const baseEdges: RawEdge[] = [
    { source: 'project-spending-1', target: 'r-1', value: 900 },
    { source: 'project-spending-2', target: 'r-1', value: 150 },
  ];

  const compareNodes: RawNode[] = [
    makeNode({ id: 'project-budget-1', name: '事業1', type: 'project-budget', value: 0, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-spending-1', name: '事業1', type: 'project-spending', value: 1200, projectId: 1, ministry: 'A省' }),
    makeNode({ id: 'project-budget-3', name: '新規事業', type: 'project-budget', value: 300, projectId: 3, ministry: 'A省' }),
    makeNode({ id: 'project-spending-3', name: '新規事業', type: 'project-spending', value: 300, projectId: 3, ministry: 'A省' }),
    makeNode({ id: 'r-1', name: '受領者A', type: 'recipient', value: 1500 }),
  ];
  const compareEdges: RawEdge[] = [
    { source: 'project-spending-1', target: 'r-1', value: 1200 },
    { source: 'project-spending-3', target: 'r-1', value: 300 },
  ];

  it('classifies increased/decreased/added/removed projects', () => {
    const result = compareYearsSummary(
      { nodes: baseNodes, edges: baseEdges, excludedIds: null },
      { nodes: compareNodes, edges: compareEdges, excludedIds: null },
    );
    expect(result.diff.projects.increased.map(p => p.projectId)).toEqual([1]);
    expect(result.diff.projects.increased[0].spendingDiff).toBe(300); // 1200 - 900
    expect(result.diff.projects.added.map(p => p.projectId)).toEqual([3]);
    expect(result.diff.projects.removed.map(p => p.projectId)).toEqual([2]);
    expect(result.diff.projects.decreased).toEqual([]);
  });

  it('returns diffRate null when base spending is 0', () => {
    // project 1's budget goes 1000 -> 0, so budgetDiffRate should be null
    const result = compareYearsSummary(
      { nodes: baseNodes, edges: baseEdges, excludedIds: null },
      { nodes: compareNodes, edges: compareEdges, excludedIds: null },
    );
    const entry = result.diff.projects.increased.find(p => p.projectId === 1);
    expect(entry).toBeDefined();
    // budgetBase=1000, budgetCompare=0 -> budgetDiffRate should be -1, not null (base!=0)
    expect(entry!.budgetDiffRate).toBe(-1);
    // Now confirm the null path: budgetBase=0 case via a project whose base budget is 0
    const zeroBaseNodes: RawNode[] = [
      makeNode({ id: 'project-budget-9', name: '事業9', type: 'project-budget', value: 0, projectId: 9, ministry: 'A省' }),
      makeNode({ id: 'project-spending-9', name: '事業9', type: 'project-spending', value: 0, projectId: 9, ministry: 'A省' }),
    ];
    const zeroCompareNodes: RawNode[] = [
      makeNode({ id: 'project-budget-9', name: '事業9', type: 'project-budget', value: 500, projectId: 9, ministry: 'A省' }),
      makeNode({ id: 'project-spending-9', name: '事業9', type: 'project-spending', value: 500, projectId: 9, ministry: 'A省' }),
    ];
    const zeroEdges: RawEdge[] = [];
    const zeroCompareEdges: RawEdge[] = [{ source: 'project-spending-9', target: 'r-1', value: 500 }];
    const zeroNodesWithRecipient = [...zeroBaseNodes, makeNode({ id: 'r-1', name: 'X', type: 'recipient', value: 0 })];
    const zeroCompareNodesWithRecipient = [...zeroCompareNodes, makeNode({ id: 'r-1', name: 'X', type: 'recipient', value: 500 })];
    const result2 = compareYearsSummary(
      { nodes: zeroNodesWithRecipient, edges: zeroEdges, excludedIds: null },
      { nodes: zeroCompareNodesWithRecipient, edges: zeroCompareEdges, excludedIds: null },
    );
    const e9 = result2.diff.projects.increased.find(p => p.projectId === 9);
    expect(e9!.spendingDiffRate).toBeNull(); // spendingBase = 0
  });
});

// ── buildFilterExcludedIds: filter.subcontract ──

describe('buildFilterExcludedIds (subcontract)', () => {
  const nodes: RawNode[] = [
    makeNode({ id: 'ministry-A', name: 'A省', type: 'ministry', value: 100 }),
    // 事業1: 再委託あり（階層3）
    makeNode({ id: 'project-budget-1', name: '事業1', type: 'project-budget', value: 1000, projectId: 1, ministry: 'A省', subcontractDepth: 3 }),
    makeNode({ id: 'project-spending-1', name: '事業1', type: 'project-spending', value: 900, projectId: 1, ministry: 'A省' }),
    // 事業2: 再委託記載なし（subcontractDepth 未設定）
    makeNode({ id: 'project-budget-2', name: '事業2', type: 'project-budget', value: 500, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'project-spending-2', name: '事業2', type: 'project-spending', value: 400, projectId: 2, ministry: 'A省' }),
    makeNode({ id: 'r-1', name: '受領者A', type: 'recipient', value: 600 }),
    makeNode({ id: 'r-2', name: '受領者B', type: 'recipient', value: 300 }),
  ];
  const edges: RawEdge[] = [
    { source: 'ministry-A', target: 'project-budget-1', value: 1000 },
    { source: 'ministry-A', target: 'project-budget-2', value: 500 },
    { source: 'project-spending-1', target: 'r-1', value: 600 },
    { source: 'project-spending-2', target: 'r-2', value: 300 },
  ];
  const baseFilter = () => resolveSankeyQuery({}).query.filter;

  it('returns null when subcontract filter is inactive', () => {
    expect(buildFilterExcludedIds(nodes, edges, baseFilter())).toBeNull();
  });

  it('hasRedelegation keeps only projects with depth >= 2 (missing depth = no redelegation)', () => {
    const filter = { ...baseFilter(), subcontract: { hasRedelegation: true, minDepth: null } };
    const excluded = buildFilterExcludedIds(nodes, edges, filter)!;
    expect(excluded.has('project-budget-2')).toBe(true);
    expect(excluded.has('project-spending-2')).toBe(true);
    expect(excluded.has('project-budget-1')).toBe(false);
  });

  it('minDepth takes precedence and excludes shallower projects', () => {
    const filter = { ...baseFilter(), subcontract: { hasRedelegation: false, minDepth: 4 } };
    const excluded = buildFilterExcludedIds(nodes, edges, filter)!;
    // 事業1（階層3）も 4 未満なので除外され、A省もカスケード除外される
    expect(excluded.has('project-budget-1')).toBe(true);
    expect(excluded.has('project-budget-2')).toBe(true);
    expect(excluded.has('ministry-A')).toBe(true);
  });

  it('recipientName.includeSubcontract matches direct OR subcontract names at project level', () => {
    // 事業1: 再委託先に WELMA / 事業2: 直接支出先 r-2（受領者B）のみ
    const withNames = nodes.map(n => n.id === 'project-budget-1'
      ? { ...n, subcontractRecipients: ['株式会社WELMA', 'コスモス商事株式会社'] }
      : n);
    const filter = { ...baseFilter(), recipientName: { query: 'welma', regex: false, includeSubcontract: true } };
    const excluded = buildFilterExcludedIds(withNames, edges, filter)!;
    // 事業1は再委託先マッチで残る。支出先ノードは隠されない
    expect(excluded.has('project-budget-1')).toBe(false);
    expect(excluded.has('r-1')).toBe(false);
    // 事業2は直接・再委託ともマッチなし → 除外
    expect(excluded.has('project-budget-2')).toBe(true);

    // 直接支出先マッチの側も残ることを確認（受領者B → 事業2）
    const filter2 = { ...baseFilter(), recipientName: { query: '受領者B', regex: false, includeSubcontract: true } };
    const excluded2 = buildFilterExcludedIds(withNames, edges, filter2)!;
    expect(excluded2.has('project-budget-2')).toBe(false);
    expect(excluded2.has('project-budget-1')).toBe(true);
    // includeSubcontract では支出先ノードを名前で隠さない（r-1 は残存事業の支出先として表示可）
    expect(excluded2.has('r-2')).toBe(false);
  });

  it('URL round trip preserves subcontract (fsd / fsr)', () => {
    const withDepth = resolveSankeyQuery({ filter: { subcontract: { minDepth: 3 } } }).query;
    const p1 = sankeyQueryToUrlParams(withDepth);
    expect(p1.get('fsd')).toBe('3');
    expect(sankeyQueryFromUrlParams(p1).filter?.subcontract).toEqual({ minDepth: 3 });

    const withHas = resolveSankeyQuery({ filter: { subcontract: { hasRedelegation: true } } }).query;
    const p2 = sankeyQueryToUrlParams(withHas);
    expect(p2.get('fsr')).toBe('1');
    expect(sankeyQueryFromUrlParams(p2).filter?.subcontract).toEqual({ hasRedelegation: true });

    const withInclude = resolveSankeyQuery({ filter: { recipientName: { query: 'NEDO', includeSubcontract: true } } }).query;
    const p3 = sankeyQueryToUrlParams(withInclude);
    expect(p3.get('fnr')).toBe('NEDO');
    expect(p3.get('fnrs')).toBe('1');
    expect(sankeyQueryFromUrlParams(p3).filter?.recipientName).toEqual({ query: 'NEDO', regex: false, includeSubcontract: true });
  });
});
