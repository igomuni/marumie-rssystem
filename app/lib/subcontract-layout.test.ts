import { describe, it, expect } from 'vitest';
import type { SubcontractGraph, BlockEdge } from '@/types/subcontract';
import { computeDepths, mergeParallelFlows, computeSubcontractLayout, NODE_W } from '@/app/lib/subcontract-layout';
import { makeBlock, makeFlow } from '@/app/lib/test-utils/subcontract-fixtures';

describe('computeDepths', () => {
  it('assigns depth 1 to direct roots (sourceBlock === null)', () => {
    const flows: BlockEdge[] = [makeFlow({ targetBlock: 'a' })];
    const depths = computeDepths(flows);
    expect(depths.get('a')).toBe(1);
  });

  it('assigns depth via BFS along the chain', () => {
    const flows: BlockEdge[] = [
      makeFlow({ targetBlock: 'a' }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b' }),
      makeFlow({ sourceBlock: 'b', targetBlock: 'c' }),
    ];
    const depths = computeDepths(flows);
    expect(depths.get('a')).toBe(1);
    expect(depths.get('b')).toBe(2);
    expect(depths.get('c')).toBe(3);
  });

  it('handles cycles without infinite loop (adopts the minimum depth reached first)', () => {
    const flows: BlockEdge[] = [
      makeFlow({ targetBlock: 'a' }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b' }),
      makeFlow({ sourceBlock: 'b', targetBlock: 'a' }), // cycle back to a
    ];
    const depths = computeDepths(flows);
    expect(depths.get('a')).toBe(1);
    expect(depths.get('b')).toBe(2);
    expect(depths.size).toBe(2);
  });

  it('respects MAX_DEPTH_LIMIT (30) by dropping nodes beyond it', () => {
    const flows: BlockEdge[] = [makeFlow({ targetBlock: 'n0' })];
    for (let i = 0; i < 35; i++) {
      flows.push(makeFlow({ sourceBlock: `n${i}`, targetBlock: `n${i + 1}` }));
    }
    const depths = computeDepths(flows);
    expect(depths.get('n29')).toBe(30);
    expect(depths.has('n30')).toBe(false);
    expect(depths.has('n35')).toBe(false);
  });

  it('starts separate-origin roots at depth 1', () => {
    const flows: BlockEdge[] = [
      makeFlow({ sourceBlock: 'sep', targetBlock: 'child', origin: 'separate-origin' }),
    ];
    const depths = computeDepths(flows);
    expect(depths.get('sep')).toBe(1);
    expect(depths.get('child')).toBe(2);
  });
});

describe('mergeParallelFlows', () => {
  it('merges flows sharing the same source/target/origin/isReference key', () => {
    const flows: BlockEdge[] = [
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', origin: 'subcontract' }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', origin: 'subcontract' }),
    ];
    const merged = mergeParallelFlows(flows);
    expect(merged).toHaveLength(1);
  });

  it('concatenates distinct notes with " / " and de-duplicates identical notes', () => {
    const flows: BlockEdge[] = [
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', note: '注記1' }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', note: '注記2' }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', note: '注記1' }), // duplicate, should not repeat
    ];
    const merged = mergeParallelFlows(flows);
    expect(merged).toHaveLength(1);
    expect(merged[0].note).toBe('注記1 / 注記2');
  });

  it('does not merge flows differing in isReference', () => {
    const flows: BlockEdge[] = [
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', isReference: false }),
      makeFlow({ sourceBlock: 'a', targetBlock: 'b', isReference: true }),
    ];
    const merged = mergeParallelFlows(flows);
    expect(merged).toHaveLength(2);
  });

  it('treats null sourceBlock as its own group (root flows)', () => {
    const flows: BlockEdge[] = [
      makeFlow({ sourceBlock: null, targetBlock: 'a' }),
      makeFlow({ sourceBlock: null, targetBlock: 'a' }),
    ];
    const merged = mergeParallelFlows(flows);
    expect(merged).toHaveLength(1);
  });

  it('leaves note undefined when no flow in the group has a note', () => {
    const flows: BlockEdge[] = [makeFlow({ sourceBlock: 'a', targetBlock: 'b' })];
    const merged = mergeParallelFlows(flows);
    expect(merged[0].note).toBeUndefined();
  });
});

describe('computeSubcontractLayout band invariants', () => {
  function makeGraph(): SubcontractGraph {
    // root -> parentA (amount 1000) -> childA1 (400), childA2 (300)
    //      -> parentB (amount 200)
    return {
      projectId: 1,
      projectName: 'テスト事業',
      ministry: 'A省',
      bureau: '',
      accountCategory: '一般会計',
      budget: 1000,
      execution: 1000,
      directExpenseTotal: 1000,
      totalExpense: 1900,
      blocks: [
        makeBlock({ blockId: 'parentA', blockName: '親A', totalAmount: 1000, isTerminal: false }),
        makeBlock({ blockId: 'parentB', blockName: '親B', totalAmount: 200 }),
        makeBlock({ blockId: 'childA1', blockName: '子A1', totalAmount: 400, isDirect: false, originKind: 'subcontract' }),
        makeBlock({ blockId: 'childA2', blockName: '子A2', totalAmount: 300, isDirect: false, originKind: 'subcontract' }),
      ],
      flows: [
        makeFlow({ targetBlock: 'parentA' }),
        makeFlow({ targetBlock: 'parentB' }),
        makeFlow({ sourceBlock: 'parentA', targetBlock: 'childA1', origin: 'subcontract' }),
        makeFlow({ sourceBlock: 'parentA', targetBlock: 'childA2', origin: 'subcontract' }),
      ],
      maxDepth: 2,
      directBlockCount: 2,
      totalBlockCount: 4,
      totalRecipientCount: 4,
      indirectCosts: [],
      hasSeparateOrigin: false,
      separateOriginCount: 0,
      strongSeparateOriginCount: 0,
      separateOriginAmount: 0,
      hasMerge: false,
      mergeTargetCount: 0,
      maxMergeWidth: 0,
      branchingBlockCount: 1,
      maxBranchWidth: 2,
      hasReferenceFlow: false,
      isInstitutionalFlowOnly: false,
    };
  }

  it('places children within their max-amount parent band (no overlap outside parent bounds)', () => {
    const layout = computeSubcontractLayout(makeGraph());
    const parentA = layout.blocks.find(b => b.blockId === 'parentA')!;
    const childA1 = layout.blocks.find(b => b.blockId === 'childA1')!;
    const childA2 = layout.blocks.find(b => b.blockId === 'childA2')!;
    const bandLeft = Math.min(childA1.x, childA2.x);
    const bandRight = Math.max(childA1.x + childA1.w, childA2.x + childA2.w);
    // parentA's center should fall within its children's combined band
    const parentCenter = parentA.x + parentA.w / 2;
    expect(parentCenter).toBeGreaterThanOrEqual(bandLeft);
    expect(parentCenter).toBeLessThanOrEqual(bandRight);
  });

  it('has no horizontal overlap between sibling blocks within the same row (depth)', () => {
    const layout = computeSubcontractLayout(makeGraph());
    const depth2 = layout.blocks.filter(b => b.depth === 2).sort((a, b) => a.x - b.x);
    for (let i = 0; i < depth2.length - 1; i++) {
      expect(depth2[i].x + depth2[i].w).toBeLessThanOrEqual(depth2[i + 1].x);
    }
  });

  it('centers a single child directly under its parent (same center x)', () => {
    const graph = makeGraph();
    // Reduce to a single-child chain: parentB depth1 has no children; use parentA -> only childA1
    graph.blocks = graph.blocks.filter(b => b.blockId !== 'childA2' && b.blockId !== 'parentB');
    graph.flows = graph.flows.filter(f => f.targetBlock !== 'childA2' && f.targetBlock !== 'parentB');
    const layout = computeSubcontractLayout(graph);
    const parentA = layout.blocks.find(b => b.blockId === 'parentA')!;
    const childA1 = layout.blocks.find(b => b.blockId === 'childA1')!;
    expect(parentA.x + parentA.w / 2).toBeCloseTo(childA1.x + childA1.w / 2, 5);
  });

  it('assigns depth1 nodes their expected NODE_W width and non-negative coordinates', () => {
    const layout = computeSubcontractLayout(makeGraph());
    for (const b of layout.blocks) {
      expect(b.w).toBe(NODE_W);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
    }
  });
});
