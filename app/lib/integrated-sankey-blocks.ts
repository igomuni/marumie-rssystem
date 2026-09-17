/**
 * `/integrated-sankey` の事業サイドパネル「支出先／ブロック」2タブ用のビュー整形。
 * データソースは再委託構造（`SubcontractGraph`。scripts/generate-subcontracts.ts
 * が5-1・5-2 CSVから生成した既存データ）で、新規のCSVパースは行わない。
 *
 * 2タブの対応関係:
 *   - 支出先: `graph.blocks[].recipients[]` を全ブロック（直接＋再委託＋別財源）横断でフラット化。
 *     各行に所属ブロックの起点種別（direct/subcontract/separate-origin-*）と、
 *     再委託・別財源の場合は上流（親）ブロックを付与する
 *   - ブロック: `graph.flows[]`（ブロック同士の親子関係。ブロック名・対象ブロックの
 *     合計金額を解決）。当初はブロック単体の一覧（`buildBlockRows`）を別タブに
 *     していたが、対象ブロックの合計金額はこの一覧の`targetAmount`に出ているため
 *     単体一覧は重複と判断して1本化した（2026-09-17）
 *
 * 純関数（HTTP・React禁止）。fetch は呼び出し側（app/integrated-sankey/page.tsx）の責務。
 */

import type { BlockOriginKind, FlowOrigin, SubcontractGraph } from '@/types/subcontract';

export interface ParentBlockRef {
  blockId: string;
  blockName: string;
}

export interface IntegratedRecipientRow {
  name: string;
  corporateNumber: string;
  amount: number;
  blockId: string;
  blockName: string;
  originKind: BlockOriginKind;
  /** 再委託・別財源ブロックの場合、資金の出どころ（1つのブロックに複数の親がつくことがある） */
  parentBlocks: ParentBlockRef[];
}

export interface IntegratedFlowRow {
  sourceBlockId: string | null;
  sourceBlockName: string | null;
  targetBlockId: string;
  targetBlockName: string;
  targetAmount: number;
  origin: FlowOrigin;
  note?: string;
  isReference: boolean;
  /** 対象ブロックへ流入する支出元ブロック数（合流の太さ） */
  targetIncomingBlockCount: number;
}

function blockNameMap(graph: SubcontractGraph): Map<string, string> {
  return new Map(graph.blocks.map(b => [b.blockId, b.blockName]));
}

/** 指定ブロックへ資金を渡している親ブロック一覧（`sourceBlock`が無い＝事業自身からの直接支出は除く） */
function parentBlocksOf(graph: SubcontractGraph, blockId: string, nameById: Map<string, string>): ParentBlockRef[] {
  const seen = new Set<string>();
  const parents: ParentBlockRef[] = [];
  for (const flow of graph.flows) {
    if (flow.targetBlock !== blockId || !flow.sourceBlock || seen.has(flow.sourceBlock)) continue;
    seen.add(flow.sourceBlock);
    parents.push({ blockId: flow.sourceBlock, blockName: nameById.get(flow.sourceBlock) ?? flow.sourceBlock });
  }
  return parents;
}

/** 支出先タブ: 全ブロックの支出先を金額降順でフラット化 */
export function buildRecipientRows(graph: SubcontractGraph): IntegratedRecipientRow[] {
  const nameById = blockNameMap(graph);
  const rows: IntegratedRecipientRow[] = [];
  for (const block of graph.blocks) {
    const parentBlocks = parentBlocksOf(graph, block.blockId, nameById);
    for (const recipient of block.recipients) {
      rows.push({
        name: recipient.name,
        corporateNumber: recipient.corporateNumber,
        amount: recipient.amount,
        blockId: block.blockId,
        blockName: block.blockName,
        originKind: block.originKind,
        parentBlocks,
      });
    }
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

/** ブロックタブ: ブロック間の親子関係一覧（対象ブロックの金額降順） */
export function buildFlowRows(graph: SubcontractGraph): IntegratedFlowRow[] {
  const nameById = blockNameMap(graph);
  const amountById = new Map(graph.blocks.map(b => [b.blockId, b.totalAmount]));
  return graph.flows
    .map(flow => ({
      sourceBlockId: flow.sourceBlock,
      sourceBlockName: flow.sourceBlock ? nameById.get(flow.sourceBlock) ?? flow.sourceBlock : null,
      targetBlockId: flow.targetBlock,
      targetBlockName: nameById.get(flow.targetBlock) ?? flow.targetBlock,
      targetAmount: amountById.get(flow.targetBlock) ?? 0,
      origin: flow.origin,
      note: flow.note,
      isReference: flow.isReference,
      targetIncomingBlockCount: flow.targetIncomingBlockCount,
    }))
    .sort((a, b) => b.targetAmount - a.targetAmount);
}
