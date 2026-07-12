import { describe, it, expect } from 'vitest';
import type { SubcontractGraph, BlockNode, BlockEdge } from '@/types/subcontract';
import {
  computeSubcontractRibbonLayout,
  RIBBON_BAR_MIN_H,
} from '@/app/lib/subcontract-ribbon-layout';

function makeBlock(overrides: Partial<BlockNode> & Pick<BlockNode, 'blockId' | 'blockName' | 'totalAmount'>): BlockNode {
  return {
    isDirect: true,
    originKind: 'direct',
    isTerminal: true,
    recipientCount: 1,
    hasExpenses: false,
    recipients: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<BlockEdge> & Pick<BlockEdge, 'targetBlock'>): BlockEdge {
  return {
    sourceBlock: null,
    origin: 'direct',
    isReference: false,
    targetIncomingBlockCount: 1,
    ...overrides,
  };
}

function baseGraph(overrides: Partial<SubcontractGraph> = {}): SubcontractGraph {
  return {
    projectId: 1,
    projectName: 'テスト事業',
    ministry: 'A省',
    bureau: '',
    accountCategory: '一般会計',
    budget: 1000,
    execution: 1000,
    directExpenseTotal: 1000,
    totalExpense: 1000,
    blocks: [],
    flows: [],
    maxDepth: 1,
    directBlockCount: 0,
    totalBlockCount: 0,
    totalRecipientCount: 0,
    indirectCosts: [],
    hasSeparateOrigin: false,
    separateOriginCount: 0,
    strongSeparateOriginCount: 0,
    separateOriginAmount: 0,
    hasMerge: false,
    mergeTargetCount: 0,
    maxMergeWidth: 0,
    branchingBlockCount: 0,
    maxBranchWidth: 0,
    hasReferenceFlow: false,
    isInstitutionalFlowOnly: false,
    ...overrides,
  };
}

describe('computeSubcontractRibbonLayout', () => {
  it('entry-ribbon-sum approximately equals target bar height (within 0.5px)', () => {
    const graph = baseGraph({
      blocks: [
        makeBlock({ blockId: 'parentA', blockName: '親A', totalAmount: 600, isTerminal: false }),
        makeBlock({ blockId: 'parentB', blockName: '親B', totalAmount: 400, isTerminal: false }),
        makeBlock({ blockId: 'child', blockName: '子', totalAmount: 1000, isDirect: false, originKind: 'subcontract' }),
      ],
      flows: [
        makeFlow({ targetBlock: 'parentA' }),
        makeFlow({ targetBlock: 'parentB' }),
        makeFlow({ sourceBlock: 'parentA', targetBlock: 'child', origin: 'subcontract' }),
        makeFlow({ sourceBlock: 'parentB', targetBlock: 'child', origin: 'subcontract' }),
      ],
    });
    const layout = computeSubcontractRibbonLayout(graph);
    const childBar = layout.bars.find(b => b.blockId === 'child')!;
    const incomingFlows = layout.flows.filter(f => f.targetBlock === 'child');
    const sumThickness = incomingFlows.reduce((sum, f) => sum + (f.y2Bot - f.y2Top), 0);
    expect(Math.abs(sumThickness - childBar.h)).toBeLessThanOrEqual(0.5);
  });

  it('leaves partial space when Σ(child totalAmount) < parent bar height (Σexit < bar height)', () => {
    const graph = baseGraph({
      blocks: [
        makeBlock({ blockId: 'parent', blockName: '親', totalAmount: 1000, isTerminal: false }),
        makeBlock({ blockId: 'child', blockName: '子（一部再委託）', totalAmount: 200, isDirect: false, originKind: 'subcontract' }),
      ],
      flows: [
        makeFlow({ targetBlock: 'parent' }),
        makeFlow({ sourceBlock: 'parent', targetBlock: 'child', origin: 'subcontract' }),
      ],
    });
    const layout = computeSubcontractRibbonLayout(graph);
    const parentBar = layout.bars.find(b => b.blockId === 'parent')!;
    const outgoing = layout.flows.filter(f => f.sourceBlock === 'parent');
    const sumExitThickness = outgoing.reduce((sum, f) => sum + (f.y1Bot - f.y1Top), 0);
    // child (200) is a fraction of parent's total (1000), so exit ribbon sum should be
    // strictly less than the parent bar's full height.
    expect(sumExitThickness).toBeLessThan(parentBar.h);
  });

  it('excludes flows whose source-side bar is missing from the flows/backEdges output', () => {
    // 'ghost' is referenced as a sourceBlock but never appears in graph.blocks, so it never
    // gets a bar. The flow from 'ghost' must be dropped rather than mis-rendered as a root flow.
    const graph = baseGraph({
      blocks: [
        makeBlock({ blockId: 'real', blockName: '実在ブロック', totalAmount: 500 }),
      ],
      flows: [
        makeFlow({ targetBlock: 'real' }),
        makeFlow({ sourceBlock: 'ghost', targetBlock: 'real', origin: 'subcontract' }),
      ],
    });
    const layout = computeSubcontractRibbonLayout(graph);
    expect(layout.flows.some(f => f.sourceBlock === 'ghost')).toBe(false);
    expect(layout.backEdges.some(f => f.sourceBlock === 'ghost')).toBe(false);
    // Only the direct root flow into 'real' should exist
    expect(layout.flows).toHaveLength(1);
    expect(layout.flows[0].sourceBlock).toBeNull();
  });

  it('gives a block with totalAmount=0 a minimum bar height (RIBBON_BAR_MIN_H)', () => {
    const graph = baseGraph({
      blocks: [
        makeBlock({ blockId: 'zero', blockName: 'ゼロ円ブロック', totalAmount: 0, recipientCount: 0 }),
      ],
      flows: [makeFlow({ targetBlock: 'zero' })],
    });
    const layout = computeSubcontractRibbonLayout(graph);
    const zeroBar = layout.bars.find(b => b.blockId === 'zero')!;
    expect(zeroBar.h).toBe(RIBBON_BAR_MIN_H);
    expect(zeroBar.isZeroAmount).toBe(true);
  });

  it('gives the overall layout a minimum root height when there are no blocks at all', () => {
    const graph = baseGraph();
    const layout = computeSubcontractRibbonLayout(graph);
    expect(layout.root.h).toBeGreaterThanOrEqual(RIBBON_BAR_MIN_H);
    expect(layout.bars).toEqual([]);
  });
});
