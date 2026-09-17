import { describe, expect, it } from 'vitest';
import { buildFlowRows, buildRecipientRows } from './integrated-sankey-blocks';
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
  it('keeps a direct block ahead of its own subcontract child even when the child recipient amount is larger', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', totalAmount: 50, recipients: [{ name: '小口', corporateNumber: '', amount: 50, contractSummaries: [], expenses: [] }] }),
        block({ blockId: 'B', totalAmount: 200, originKind: 'subcontract', isDirect: false, recipients: [{ name: '大口', corporateNumber: '', amount: 200, contractSummaries: [], expenses: [] }] }),
      ],
      flows: [flow({ targetBlock: 'A' }), flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract' })],
    });
    const rows = buildRecipientRows(g);
    // ブロックの親子構造（A→その子B）を優先し、金額の大小では並べ替えない
    expect(rows.map(r => r.name)).toEqual(['小口', '大口']);
    expect(rows[1].originKind).toBe('subcontract');
    expect(rows[0].parentBlocks).toEqual([]);
    expect(rows[1].parentBlocks).toEqual([{ blockId: 'A', blockName: 'ブロックA' }]);
  });

  it('orders two independent direct-block families as direct→subcontract, direct→subcontract (not grouped by type)', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', totalAmount: 30, recipients: [{ name: 'A直接', corporateNumber: '', amount: 30, contractSummaries: [], expenses: [] }] }),
        block({ blockId: 'B', totalAmount: 20, originKind: 'subcontract', isDirect: false, recipients: [{ name: 'A再委託', corporateNumber: '', amount: 20, contractSummaries: [], expenses: [] }] }),
        block({ blockId: 'C', totalAmount: 25, recipients: [{ name: 'C直接', corporateNumber: '', amount: 25, contractSummaries: [], expenses: [] }] }),
        block({ blockId: 'D', totalAmount: 15, originKind: 'subcontract', isDirect: false, recipients: [{ name: 'C再委託', corporateNumber: '', amount: 15, contractSummaries: [], expenses: [] }] }),
      ],
      flows: [
        flow({ targetBlock: 'A' }), flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract' }),
        flow({ targetBlock: 'C' }), flow({ sourceBlock: 'C', targetBlock: 'D', origin: 'subcontract' }),
      ],
    });
    // A(30)がC(25)より大きいのでAの系統が先。各系統内は 直接→再委託
    expect(buildRecipientRows(g).map(r => r.name)).toEqual(['A直接', 'A再委託', 'C直接', 'C再委託']);
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
    expect(rows).toHaveLength(1);
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

  it('sorts recipients within the same block by amount descending', () => {
    const g = graph({
      blocks: [block({
        recipients: [
          { name: '小', corporateNumber: '', amount: 10, contractSummaries: [], expenses: [] },
          { name: '大', corporateNumber: '', amount: 90, contractSummaries: [], expenses: [] },
        ],
      })],
    });
    expect(buildRecipientRows(g).map(r => r.name)).toEqual(['大', '小']);
  });
});

describe('buildFlowRows', () => {
  it('resolves block names and the target block amount', () => {
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
    // 対象ブロックの並び順（A→その子B）に沿う。Bの金額(90)がAより大きくても
    // 金額では並べ替えない（「一覧の並びをブロックバッジ順にしたい」との指摘）
    expect(rows[0]).toMatchObject({ sourceBlockId: null, sourceBlockName: null, targetBlockId: 'A', targetAmount: 10 });
    expect(rows[1]).toMatchObject({ sourceBlockId: 'A', sourceBlockName: '起点ブロック', targetBlockId: 'B', targetBlockName: '委託先ブロック', targetAmount: 90, note: '一部再委託' });
  });

  it('orders rows by the target block position (direct family before the next direct family)', () => {
    const g = graph({
      blocks: [
        block({ blockId: 'A', totalAmount: 30 }),
        block({ blockId: 'B', totalAmount: 20, originKind: 'subcontract', isDirect: false }),
        block({ blockId: 'C', totalAmount: 25 }),
      ],
      flows: [
        flow({ targetBlock: 'A' }),
        flow({ sourceBlock: 'A', targetBlock: 'B', origin: 'subcontract' }),
        flow({ targetBlock: 'C' }),
      ],
    });
    expect(buildFlowRows(g).map(r => r.targetBlockId)).toEqual(['A', 'B', 'C']);
  });
});
