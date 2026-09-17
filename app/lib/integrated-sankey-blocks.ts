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
 * 並び順は金額の単純な降順ではなく、ブロックの親子構造（直接支出ブロック→その
 * 再委託・別財源の子ブロック）を深さ優先でたどる（`orderedBlockIds`）。
 * 「一覧の並びをブロックバッジ順にしたい、直接・再委託・直接・再委託が並ぶような
 * イメージ」との指摘（2026-09-17）に基づく。ルート（直接・別財源など親を持たない
 * ブロック）は起点種別（直接→別財源の順）・同種別内は金額降順で並べ、各ルートの
 * 子孫を深さ優先で挿入する（兄弟ブロックは金額降順）。支出先タブは同じブロック内の
 * 支出先を金額降順、ブロックタブは対象ブロックの並びをこの順序に合わせる
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

/** 起点種別の並び順（直接→再委託→別財源）。/subcontracts の tierOf と同じ考え方 */
function originTier(kind: BlockOriginKind): number {
  return kind === 'direct' ? 0 : kind === 'subcontract' ? 1 : 2;
}

/**
 * ブロックを「ルート（直接支出・別財源など親を持たないブロック）→その子孫」の
 * 深さ優先順に並べたIDリストを返す。ルートは起点種別→金額降順、各ブロックの子は
 * 金額降順（兄弟ブロック内の並び）。マージ（複数の親を持つブロック）は最初に
 * 訪れた経路の位置に1回だけ現れる
 */
function orderedBlockIds(graph: SubcontractGraph): string[] {
  const childrenByParent = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const flow of graph.flows) {
    if (!flow.sourceBlock) continue;
    hasParent.add(flow.targetBlock);
    const list = childrenByParent.get(flow.sourceBlock) ?? [];
    if (!list.includes(flow.targetBlock)) list.push(flow.targetBlock);
    childrenByParent.set(flow.sourceBlock, list);
  }
  const amountById = new Map(graph.blocks.map(b => [b.blockId, b.totalAmount]));
  const tierById = new Map(graph.blocks.map(b => [b.blockId, originTier(b.originKind)]));
  const byAmountDesc = (ids: string[]) => [...ids].sort((a, b) => (amountById.get(b) ?? 0) - (amountById.get(a) ?? 0));
  for (const [parent, children] of childrenByParent) childrenByParent.set(parent, byAmountDesc(children));

  const roots = byAmountDesc(graph.blocks.map(b => b.blockId).filter(id => !hasParent.has(id)))
    .sort((a, b) => (tierById.get(a) ?? 0) - (tierById.get(b) ?? 0)); // 金額降順を保ったまま起点種別で安定ソート

  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    for (const child of childrenByParent.get(id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  for (const block of graph.blocks) visit(block.blockId); // 取りこぼし（孤立ブロック）の保険
  return order;
}

/** 支出先タブ: ブロックの並び順（`orderedBlockIds`）に沿って、同じブロック内は支出先の金額降順で並べる */
export function buildRecipientRows(graph: SubcontractGraph): IntegratedRecipientRow[] {
  const nameById = blockNameMap(graph);
  const blockById = new Map(graph.blocks.map(b => [b.blockId, b]));
  const rows: IntegratedRecipientRow[] = [];
  for (const blockId of orderedBlockIds(graph)) {
    const block = blockById.get(blockId);
    if (!block) continue;
    const parentBlocks = parentBlocksOf(graph, block.blockId, nameById);
    for (const recipient of [...block.recipients].sort((a, b) => b.amount - a.amount)) {
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
  return rows;
}

/** ブロックタブ: 対象ブロックの並び順（`orderedBlockIds`）に沿って親子関係を並べる。
 * 同じ対象ブロックへ複数系統から合流する場合（マージ）は元の並びを保つ（安定ソート） */
export function buildFlowRows(graph: SubcontractGraph): IntegratedFlowRow[] {
  const nameById = blockNameMap(graph);
  const amountById = new Map(graph.blocks.map(b => [b.blockId, b.totalAmount]));
  const order = orderedBlockIds(graph);
  const indexOf = new Map(order.map((id, i) => [id, i]));
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
    .sort((a, b) => (indexOf.get(a.targetBlockId) ?? 0) - (indexOf.get(b.targetBlockId) ?? 0));
}
