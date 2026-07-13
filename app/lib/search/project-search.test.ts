import { describe, it, expect } from 'vitest';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { ProjectDetail, ProjectDetailsData } from '@/types/project-details';
import { normalizeQuery, searchProjects } from '@/app/lib/search/project-search';

describe('normalizeQuery', () => {
  it('applies NFKC normalization (full-width -> half-width)', () => {
    expect(normalizeQuery('ＡＢＣ１２３')).toBe('abc123');
  });

  it('lowercases the input', () => {
    expect(normalizeQuery('HELLO')).toBe('hello');
  });

  it('strips whitespace (including embedded spaces)', () => {
    expect(normalizeQuery(' foo  bar ')).toBe('foobar');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeQuery('   ')).toBe('');
  });
});

function makeItem(overrides: Partial<QualityScoreItem> & Pick<QualityScoreItem, 'pid' | 'name'>): QualityScoreItem {
  return {
    ministry: 'A省',
    bureau: '',
    division: '',
    section: '',
    office: '',
    team: '',
    unit: '',
    rowCount: 1,
    validCount: 1,
    govAgencyCount: 0,
    suppValidCount: 0,
    invalidCount: 0,
    validRatio: 1,
    cnFilled: 1,
    cnEmpty: 0,
    cnFillRatio: 1,
    budgetAmount: 100,
    execAmount: 100,
    spendTotal: 100,
    spendNetTotal: 100,
    gapRatio: null,
    blockCount: 1,
    orphanBlockCount: 0,
    hasRedelegation: false,
    redelegationDepth: 0,
    opaqueRatio: null,
    axis1: null,
    axis2: null,
    axis3: null,
    axis4: null,
    axis5: null,
    totalScore: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<ProjectDetail> & Pick<ProjectDetail, 'projectId' | 'projectName'>): ProjectDetail {
  return {
    ministry: 'A省',
    bureau: '',
    purpose: '',
    currentIssues: '',
    overview: '',
    url: null,
    category: '',
    startYear: null,
    startYearUnknown: false,
    endYear: null,
    noEndDate: false,
    majorExpense: '',
    remarks: '',
    implementationMethods: [],
    oldProjectNumber: '',
    ...overrides,
  };
}

describe('searchProjects scope=details matchedIn priority', () => {
  const items: QualityScoreItem[] = [
    makeItem({ pid: 'p1', name: '子育て支援事業', budgetAmount: 100 }),
    makeItem({ pid: 'p2', name: '無関係事業', budgetAmount: 200 }),
  ];
  const projectDetails: ProjectDetailsData = {
    p1: makeDetail({ projectId: 1, projectName: '子育て支援事業', purpose: '子育て世帯への支援' }),
    p2: makeDetail({ projectId: 2, projectName: '無関係事業', overview: '子育て関連の間接効果' }),
  };

  it('prioritizes name match over details match when both match', () => {
    const { items: hits } = searchProjects(items, '子育て', { limit: 10, offset: 0, sortBy: 'budget', scope: 'details', projectDetails });
    const p1Hit = hits.find(h => h.item.pid === 'p1');
    expect(p1Hit?.matchedIn).toBe('name');
  });

  it('falls back to details match when name does not match', () => {
    const { items: hits } = searchProjects(items, '子育て', { limit: 10, offset: 0, sortBy: 'budget', scope: 'details', projectDetails });
    const p2Hit = hits.find(h => h.item.pid === 'p2');
    expect(p2Hit?.matchedIn).toBe('details');
  });

  it('does not search details when scope=name (default)', () => {
    const { items: hits, totalHits } = searchProjects(items, '子育て', { limit: 10, offset: 0, sortBy: 'budget' });
    expect(totalHits).toBe(1);
    expect(hits[0].item.pid).toBe('p1');
  });

  it('returns empty result for an empty query', () => {
    const result = searchProjects(items, '   ', { limit: 10, offset: 0, sortBy: 'budget' });
    expect(result.totalHits).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('sorts by spendTotal when sortBy=spending', () => {
    const bySpend: QualityScoreItem[] = [
      makeItem({ pid: 'a', name: 'テスト事業A', spendTotal: 500, budgetAmount: 100 }),
      makeItem({ pid: 'b', name: 'テスト事業B', spendTotal: 900, budgetAmount: 100 }),
    ];
    const { items: hits } = searchProjects(bySpend, 'テスト事業', { limit: 10, offset: 0, sortBy: 'spending' });
    expect(hits.map(h => h.item.pid)).toEqual(['b', 'a']);
  });

  it('applies limit/offset paging', () => {
    const many: QualityScoreItem[] = Array.from({ length: 5 }, (_, i) =>
      makeItem({ pid: `id${i}`, name: `検索対象事業${i}`, budgetAmount: 100 - i }),
    );
    const { items: hits, totalHits } = searchProjects(many, '検索対象事業', { limit: 2, offset: 1, sortBy: 'budget' });
    expect(totalHits).toBe(5);
    expect(hits).toHaveLength(2);
    expect(hits[0].item.pid).toBe('id1');
  });
});
