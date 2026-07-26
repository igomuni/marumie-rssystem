import { describe, it, expect } from 'vitest';
import type { SubcontractGraph } from '@/types/subcontract';
import {
  computeSubcontractRibbonLayout,
  RIBBON_BAR_MIN_H,
  RIBBON_TARGET_COL_H,
} from '@/app/lib/subcontract-ribbon-layout';
import { makeBlock, makeFlow } from '@/app/lib/test-utils/subcontract-fixtures';

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

  describe('間接経費の終端ノード', () => {
    const indirectGraph = (costs: SubcontractGraph['indirectCosts']) => baseGraph({
      blocks: [
        makeBlock({ blockId: 'b1', blockName: '支出先ブロック', totalAmount: 900 }),
      ],
      flows: [makeFlow({ targetBlock: 'b1' })],
      indirectCosts: costs,
    });
    const cost = (amount: number, over: Partial<SubcontractGraph['indirectCosts'][number]> = {}) => ({
      blockHint: '', kind: '間接経費', category: '講師謝金', amount, ...over,
    });

    it('事業ノードの支出側 = ブロック流出 + 間接経費 になり、リボンはブロック流出の下に積まれる', () => {
      const layout = computeSubcontractRibbonLayout(indirectGraph([cost(100)]));
      const node = layout.indirectNode!;
      const flow = layout.indirectFlow!;
      expect(node.amount).toBe(100);
      const blockOut = layout.flows
        .filter(f => f.sourceBlock === null)
        .reduce((s, f) => s + (f.y1Bot - f.y1Top), 0);
      // 出口の開始位置がブロック流出の直下 ＝ 事業ノードの支出側が両者の合計で閉じる
      expect(Math.abs(flow.y1Top - (layout.root.y + blockOut))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(layout.root.h - (blockOut + node.h))).toBeLessThanOrEqual(0.5);
      // 入口はノード本体に一致
      expect(flow.y2Top).toBe(node.y);
      expect(Math.abs((flow.y2Bot - flow.y2Top) - node.h)).toBeLessThanOrEqual(0.5);
    });

    it('直接系ブロックより下・別財源レーンより上に置かれる', () => {
      const graph = baseGraph({
        blocks: [
          makeBlock({ blockId: 'b1', blockName: '直接', totalAmount: 900 }),
          makeBlock({ blockId: 's1', blockName: '別財源', totalAmount: 300, isDirect: false, originKind: 'separate-origin-strong' }),
        ],
        flows: [
          makeFlow({ targetBlock: 'b1' }),
          makeFlow({ targetBlock: 's1', origin: 'separate-origin' }),
        ],
        indirectCosts: [cost(100)],
      });
      const layout = computeSubcontractRibbonLayout(graph);
      const node = layout.indirectNode!;
      const directBar = layout.bars.find(b => b.blockId === 'b1')!;
      expect(node.y).toBeGreaterThanOrEqual(directBar.y + directBar.h);
      expect(node.y + node.h).toBeLessThanOrEqual(layout.separateLane!.top);
    });

    it('ブロックが1件も無くても深度1列に置かれ、SVG幅がその列を含む', () => {
      const layout = computeSubcontractRibbonLayout(baseGraph({ indirectCosts: [cost(500)] }));
      const node = layout.indirectNode!;
      expect(layout.bars).toEqual([]);
      expect(node.x).toBeGreaterThan(layout.root.x);
      expect(layout.svgWidth).toBeGreaterThanOrEqual(node.x + node.w);
      expect(layout.svgHeight).toBeGreaterThanOrEqual(node.y + node.h);
    });

    it('金額が0のみ・記録なしならノードを作らない', () => {
      expect(computeSubcontractRibbonLayout(indirectGraph([cost(0)])).indirectNode).toBeNull();
      expect(computeSubcontractRibbonLayout(indirectGraph([])).indirectNode).toBeNull();
      expect(computeSubcontractRibbonLayout(indirectGraph([])).indirectFlow).toBeNull();
    });

    it('支出先ブロックを持つ間接経費（attachedToBlock）は合計から除外する', () => {
      const layout = computeSubcontractRibbonLayout(indirectGraph([
        cost(100),
        cost(400, { attachedToBlock: true }),
      ]));
      expect(layout.indirectNode!.amount).toBe(100);
      expect(layout.indirectNode!.count).toBe(1);
    });

    it('深度1列の合計に間接経費を含めてスケールを決める（列が目標高さに収まる）', () => {
      const layout = computeSubcontractRibbonLayout(indirectGraph([cost(1100)]));
      const colH = layout.bars.filter(b => b.depth === 1).reduce((s, b) => s + b.h, 0)
        + layout.indirectNode!.h;
      expect(colH).toBeLessThanOrEqual(RIBBON_TARGET_COL_H + 0.5);
    });
  });
});
