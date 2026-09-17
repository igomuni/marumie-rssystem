import { describe, expect, it } from 'vitest';
import { buildBlockRows, buildFlowRows, buildRecipientRows } from './integrated-sankey-blocks';
import type { BlockEdge, BlockNode, SubcontractGraph } from '@/types/subcontract';

const block = (o: Partial<BlockNode> = {}): BlockNode => ({
  blockId: 'A', blockName: 'ブロックA', totalAmount: 100, isDirect: true, originKind: 'direct',
  isTerminal: true, recipientCount: 1, hasExpenses: false,
  recipients: [{ name: '支出先A', corporateNumber: '', amount: 100, contractSummaries: [], expenses: [] }],
  ...o,
});
const flow = (o: Partial<BlockEdge> = {}): BlockEdge => ({
  sourceBlock: null, targetBlock: 'A', origin: 'direct', isReference: false, targetIncomingBlockCount: 0, ...o,
});
const graph = (o: Partial<SubcontractGraph> = {}): SubcontractGraph => ({
  projectId: 1, projectName: '事業X', ministry: '省', bureau: '', accountCategory: '一般会計',
  budget: 100, execution: 100, directExpenseTotal: 100, totalExpense: 100,
  blocks: [block()], flows: [flow()], maxDepth: 1, directBlockCount: 1, totalBlockCount: 1,
  totalRecipientCount: 1, indirectCosts: [], hasSeparateOrigin: false, separateOriginCount: 0,
  strongSeparateOriginCount: 0, separateOriginAmount: 0, hasMerge: false, mergeTargetCount: 0,
  maxMergeWidth: 0, branchingBlockCount: 0, maxBranchWidth: 0, hasReferenceFlow: false,
  isInstitutionalFlowOnly: false, ...o,
});

describe('buildRecipientRows', () => {
  it('flattens recipients across all blocks, amount descending', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', totalAmount: 50, recipients: [{ name: '小口', corporateNumber: '', amount: 50, contractSummaries: [], expenses: [] }] }),
        block({ blockId: 'B', totalAmount: 200, originKind: 'subcontract', isDirect: false, recipients: [{ name: '大口', corporateNumber: '', amount: 200, contractSummaries: [], expenses: [] }] }),
      ],
      flows: [flow({ targetBlock: 'A' }), flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract' })],
    });
    const rows = buildRecipientRows(g);
    expect(rows.map(r => r.name)).toEqual(['大口', '小口']);
    expect(rows[0].originKind).toBe('subcontract');
    expect(rows[0].parentBlocks).toEqual([{ blockId: 'A', blockName: 'ブロックA' }]);
    expect(rows[1].parentBlocks).toEqual([]);
  });

  it('lists multiple parent blocks when a block receives from more than one source (merge)', () => {
    const g = graph({
      blocks: [block({ blockId: 'A' }), block({ blockId: 'B', blockName: 'ブロックB' }), block({ blockId: 'C', originKind: 'subcontract', isDirect: false })],
      flows: [
        flow({ targetBlock: 'A' }), flow({ targetBlock: 'B' }),
        flow({ sourceBlock: 'A', targetBlock: 'C', origin: 'subcontract' }),
        flow({ sourceBlock: 'B', targetBlock: 'C', origin: 'subcontract' }),
      ],
    });
    const rows = buildRecipientRows(g).filter(r => r.blockId === 'C');
    expect(rows[0].parentBlocks.map(p => p.blockId).sort()).toEqual(['A', 'B']);
  });

  it('deduplicates a parent that appears in more than one flow row to the same block', () => {
    const g = graph({
      blocks: [block({ blockId: 'A' }), block({ blockId: 'B', originKind: 'subcontract', isDirect: false })],
      flows: [flow({ targetBlock: 'A' }), flow({ sourceBlock: 'A', targetBlock: 'B' }), flow({ sourceBlock: 'A', targetBlock: 'B', note: '参考' })],
    });
    const rows = buildRecipientRows(g).filter(r => r.blockId === 'B');
    expect(rows[0].parentBlocks).toHaveLength(1);
  });
});

describe('buildBlockRows', () => {
  it('sorts blocks by totalAmount descending and attaches parent blocks', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', totalAmount: 10 }),
        block({ blockId: 'B', totalAmount: 90, originKind: 'subcontract', isDirect: false }),
      ],
      flows: [flow({ targetBlock: 'A' }), flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract' })],
    });
    const rows = buildBlockRows(g);
    expect(rows.map(r => r.blockId)).toEqual(['B', 'A']);
    expect(rows[0].parentBlocks).toEqual([{ blockId: 'A', blockName: 'ブロックA' }]);
    expect(rows[1].parentBlocks).toEqual([]);
  });

  it('carries role and recipientCount through unchanged', () => {
    const g = graph({ blocks: [block({ role: '調査委託', recipientCount: 3 })] });
    const rows = buildBlockRows(g);
    expect(rows[0].role).toBe('調査委託');
    expect(rows[0].recipientCount).toBe(3);
  });
});

describe('buildFlowRows', () => {
  it('resolves block names and the target block amount, sorted by target amount descending', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', blockName: '起点ブロック', totalAmount: 10 }),
        block({ blockId: 'B', blockName: '委託先ブロック', totalAmount: 90, originKind: 'subcontract', isDirect: false }),
      ],
      flows: [
        flow({ targetBlock: 'A' }),
        flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract', note: '一部再委託' }),
      ],
    });
    const rows = buildFlowRows(g);
    expect(rows[0]).toMatchObject({ sourceBlockId: 'A', sourceBlockName: '起点ブロック', targetBlockId: 'B', targetBlockName: '委託先ブロック', targetAmount: 90, note: '一部再委託' });
    expect(rows[1]).toMatchObject({ sourceBlockId: null, sourceBlockName: null, targetBlockId: 'A', targetAmount: 10 });
  });
});
