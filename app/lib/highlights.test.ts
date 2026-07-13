import { describe, it, expect } from 'vitest';
import type { RawNode, RawEdge } from '@/types/sankey-svg';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import {
  computeHighlights,
  HIGHLIGHTS_MIN_SPEND_YEN,
  HIGHLIGHTS_MULTI_SIGNAL_MIN_METRICS,
} from '@/app/lib/highlights';

function makeQualityItem(overrides: Partial<QualityScoreItem> & Pick<QualityScoreItem, 'pid' | 'name'>): QualityScoreItem {
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
    budgetAmount: 0,
    execAmount: 0,
    spendTotal: 0,
    spendNetTotal: 0,
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

function makeNode(overrides: Partial<RawNode> & Pick<RawNode, 'id' | 'name' | 'type' | 'value'>): RawNode {
  return { ...overrides };
}

describe('computeHighlights', () => {
  it('excludes projects below HIGHLIGHTS_MIN_SPEND_YEN from otherRatio/concentration population', () => {
    const nodes: RawNode[] = [
      makeNode({ id: 'project-spending-1', name: '小規模事業', type: 'project-spending', value: 0, projectId: 1 }),
      makeNode({ id: 'r-2', name: 'その他', type: 'recipient', value: 0 }),
    ];
    const edges: RawEdge[] = [
      { source: 'project-spending-1', target: 'r-2', value: HIGHLIGHTS_MIN_SPEND_YEN - 1 },
    ];
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: '小規模事業', spendTotal: HIGHLIGHTS_MIN_SPEND_YEN - 1 }),
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes, edges },
      qualityItems,
    });
    expect(result.meta.otherRatioPopulation).toBe(0);
    expect(result.meta.concentrationPopulation).toBe(0);
    expect(result.metrics.otherRatio).toEqual([]);
  });

  it('includes projects at or above HIGHLIGHTS_MIN_SPEND_YEN in the otherRatio population', () => {
    const nodes: RawNode[] = [
      makeNode({ id: 'project-spending-1', name: '大規模事業', type: 'project-spending', value: 0, projectId: 1 }),
      makeNode({ id: 'r-2', name: 'その他', type: 'recipient', value: 0 }),
    ];
    const edges: RawEdge[] = [
      { source: 'project-spending-1', target: 'r-2', value: HIGHLIGHTS_MIN_SPEND_YEN },
    ];
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: '大規模事業', spendTotal: HIGHLIGHTS_MIN_SPEND_YEN }),
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes, edges },
      qualityItems,
    });
    expect(result.meta.otherRatioPopulation).toBe(1);
    expect(result.metrics.otherRatio).toHaveLength(1);
    expect(result.metrics.otherRatio[0].otherRatio).toBe(1);
  });

  it('multiSignal requires HIGHLIGHTS_MULTI_SIGNAL_MIN_METRICS (2+) co-occurring metrics', () => {
    expect(HIGHLIGHTS_MULTI_SIGNAL_MIN_METRICS).toBe(2);
    // Empty graph -> otherRatio/concentration never fire; only lowScoreHighBudget and
    // execBudgetGap are in play here.
    // pid1: very low totalScore (lowScore signal) but gapRatio=0, ranked out of execBudgetGap's
    //   top10 by 11 other higher-gap items -> single signal only, excluded from multiSignal.
    // pid2: very low totalScore AND a large gapRatio that ranks #1 in execBudgetGap -> 2 signals.
    const fillers: QualityScoreItem[] = Array.from({ length: 11 }, (_, i) =>
      makeQualityItem({
        pid: `p${i + 3}`,
        name: `事業${i + 3}`,
        totalScore: (i + 1) * 10 + 20, // 30..140, well above the low-score threshold
        budgetAmount: 100,
        execAmount: 100 + (i + 1) * 50, // gapRatio 0.5..5.5, all > pid1's gapRatio of 0
      }),
    );
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: '事業1', totalScore: 1, budgetAmount: 100, execAmount: 100 }),
      makeQualityItem({ pid: '2', name: '事業2', totalScore: 2, budgetAmount: 100, execAmount: 1200 }),
      ...fillers,
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems,
    });
    // Sanity: pid1 has a lowScore signal but is pushed out of execBudgetGap's top 10
    expect(result.metrics.lowScoreHighBudget.map(e => e.pid)).toContain('1');
    expect(result.metrics.execBudgetGap.map(e => e.pid)).not.toContain('1');

    const pids = result.multiSignal.map(m => m.pid);
    expect(pids).toContain('2');
    expect(pids).not.toContain('1');
    const entry2 = result.multiSignal.find(m => m.pid === '2')!;
    expect(entry2.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('execBudgetGap excludes items with budgetAmount <= 0', () => {
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: 'ゼロ予算事業', budgetAmount: 0, execAmount: 1000 }),
      makeQualityItem({ pid: '2', name: '負予算事業', budgetAmount: -100, execAmount: 1000 }),
      makeQualityItem({ pid: '3', name: '正常事業', budgetAmount: 100, execAmount: 200 }),
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems,
    });
    const pids = result.metrics.execBudgetGap.map(e => e.pid);
    expect(pids).toEqual(['3']);
  });

  it('execBudgetGap excludes items with null execAmount', () => {
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: '執行額未定', budgetAmount: 100, execAmount: null as unknown as number }),
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems,
    });
    expect(result.metrics.execBudgetGap).toEqual([]);
  });

  it('computes lowScoreHighBudget threshold via nearest-rank method (ceil(n*0.25)-1) on a small sample', () => {
    // 8 items with totalScore 10,20,...,80 and budgetAmount>0.
    // sorted ascending: [10,20,30,40,50,60,70,80]; idx = ceil(8*0.25)-1 = 2-1 = 1 -> threshold = 20
    const qualityItems: QualityScoreItem[] = Array.from({ length: 8 }, (_, i) =>
      makeQualityItem({
        pid: String(i + 1),
        name: `事業${i + 1}`,
        totalScore: (i + 1) * 10,
        budgetAmount: 1000,
      }),
    );
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems,
    });
    expect(result.meta.lowScoreThreshold).toBe(20);
    // entries: totalScore <= 20 -> pid 1 (score10), pid 2 (score20)
    const pids = result.metrics.lowScoreHighBudget.map(e => e.pid).sort();
    expect(pids).toEqual(['1', '2']);
  });

  it('returns null lowScoreThreshold when no items have both totalScore and budgetAmount > 0', () => {
    const qualityItems: QualityScoreItem[] = [
      makeQualityItem({ pid: '1', name: 'スコアなし', totalScore: null, budgetAmount: 1000 }),
      makeQualityItem({ pid: '2', name: '予算ゼロ', totalScore: 50, budgetAmount: 0 }),
    ];
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems,
    });
    expect(result.meta.lowScoreThreshold).toBeNull();
    expect(result.metrics.lowScoreHighBudget).toEqual([]);
  });

  it('spendingChange is empty with priorYear null when no priorGraph is given', () => {
    const result = computeHighlights({
      year: '2024',
      currentGraph: { nodes: [], edges: [] },
      qualityItems: [],
    });
    expect(result.metrics.spendingChange.priorYear).toBeNull();
    expect(result.metrics.spendingChange.increased).toEqual([]);
  });

  it('populates spendingChange.priorYear when priorGraph is supplied', () => {
    const result = computeHighlights({
      year: '2025',
      currentGraph: { nodes: [], edges: [] },
      priorGraph: { year: '2024', nodes: [], edges: [] },
      qualityItems: [],
    });
    expect(result.metrics.spendingChange.priorYear).toBe('2024');
  });
});
