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
 * 並び順は金額の降順ではなく、ブロック番号（`blockId`）の自然順（A, B, … Z,
 * AA, AB, …のExcel列名方式）で、ブロックの親子構造（直接支出ブロック→その
 * 再委託・別財源の子ブロック）を深さ優先でたどる（`orderedBlockIds`・
 * `compareBlockId`）。ルート（親を持たないブロック）・兄弟ブロック（同じ親を
 * 持つブロック同士）ともブロック番号順。当初は起点種別→金額降順で並べていたが、
 * 枝が多い事業で兄弟の並びが番号順から外れる不具合（北海道開発事業で実測）が
 * あり、「一覧の並びをブロックバッジ順にしたい」「ブロックがブロック番号バッジ
 * 順じゃない」との指摘（2026-09-17）を受けて番号順に変更した。番号の生成器は
 * 発見順に振るため子は親より必ず大きい番号になり、番号順だけで親子関係も保たれる。
 * 支出先タブは同じブロック内の支出先を金額降順、ブロックタブは対象ブロックの
 * 並びをこの順序に合わせる
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

/**
 * ブロック番号（A, B, … Z, AA, AB, …のExcel列名方式）を自然な順序で比較する。
 * 文字数が少ない方を先にし（"T" < "AA"。文字コード比較だと逆になる）、同じ文字数
 * なら通常の文字列比較。生成器（scripts/generate-subcontracts.ts）はブロックを
 * 発見した順に番号を振り、実測では子ブロックの番号が親より必ず大きくなるため、
 * 番号順で並べるだけで親子関係もおおむね保たれる
 */
function compareBlockId(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * ブロックを「ルート（親を持たないブロック）→その子孫」の深さ優先順に並べた
 * IDリストを返す。ルート・兄弟ブロックの並びはブロック番号の自然順（`compareBlockId`）。
 * 「一覧の並びをブロックバッジ順にしたい」「北海道開発事業のブロックがブロック
 * 番号バッジ順じゃない」との指摘（2026-09-17）で金額降順から変更した。
 * マージ（複数の親を持つブロック）は最初に訪れた経路の位置に1回だけ現れる
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
  const byBlockId = (ids: string[]) => [...ids].sort(compareBlockId);
  for (const [parent, children] of childrenByParent) childrenByParent.set(parent, byBlockId(children));

  const roots = byBlockId(graph.blocks.map(b => b.blockId).filter(id => !hasParent.has(id)));

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
