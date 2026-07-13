/**
 * subcontract 系テスト（layout / ribbon-layout）で共用する合成フィクスチャ。
 * 各テストで同一の makeBlock/makeFlow を重複定義しないため集約する（ドリフト防止）。
 */
import type { BlockNode, BlockEdge } from '@/types/subcontract';

export function makeBlock(
  overrides: Partial<BlockNode> & Pick<BlockNode, 'blockId' | 'blockName' | 'totalAmount'>,
): BlockNode {
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

export function makeFlow(
  overrides: Partial<BlockEdge> & Pick<BlockEdge, 'targetBlock'>,
): BlockEdge {
  return {
    sourceBlock: null,
    origin: 'direct',
    isReference: false,
    targetIncomingBlockCount: 1,
    ...overrides,
  };
}
