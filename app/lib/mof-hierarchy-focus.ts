/**
 * 階層サンキーの絞り込み（選択したノードに連なる筋だけを取り出す）。
 *
 * 薄暗くするだけでは選んだ枝が細い線のままで、深い階層を追うという目的を果たせない。
 * 関連だけを取り出して配置を計算し直すために、ここで金額の付け替えまで済ませる。
 * 純粋関数で React にも DOM にも依存しない（描画は client/components/mof-hierarchy/）。
 */

import type { MOFHierarchyNode } from '@/types/mof-hierarchy';
import { MOF_HIERARCHY_COLUMNS } from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';

const COLUMN_INDEX = new Map(MOF_HIERARCHY_COLUMNS.map((c, i) => [c, i]));

/** 選択したノードに連なる集合（自分・祖先・子孫） */
export function relatedNodeIds(
  links: SankeyLink[],
  selectedId: string
): Set<string> {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    parentOf.set(link.target, link.source);
    childrenOf.set(link.source, [...(childrenOf.get(link.source) ?? []), link.target]);
  }
  const set = new Set<string>([selectedId]);
  for (let id = parentOf.get(selectedId); id; id = parentOf.get(id)) set.add(id);
  const stack = [selectedId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (set.has(child)) continue;
      set.add(child);
      stack.push(child);
    }
  }
  return set;
}

/**
 * 選択した筋だけのノードとリンクを作る。
 *
 * 金額は2箇所を付け替える。付け替えないと図の数字が破綻する。
 *
 * - **選択より上（祖先）**: その枝ぶんしか流れていない。全体の金額のままだと
 *   根が巨大なままで、選んだ枝が細い線に潰れる
 * - **「その他」**: 複数の親で共有しているので、この枝から来た分だけに直す。
 *   さらに集約は次の列の集約へも流れるため、下流のリンクも同じ割合で縮める。
 *   これをしないと下流ほど金額が膨らみ、事項列の合計が根を超える
 */
export function focusHierarchy(
  nodes: MOFHierarchyNode[],
  links: SankeyLink[],
  selectedId: string
): { nodes: MOFHierarchyNode[]; links: SankeyLink[] } {
  const related = relatedNodeIds(links, selectedId);
  const parentOf = new Map(links.map(l => [l.target, l.source]));
  const branchValue = nodes.find(n => n.id === selectedId)?.value ?? 0;

  const ancestors = new Set<string>();
  for (let id = parentOf.get(selectedId); id; id = parentOf.get(id)) ancestors.add(id);

  const visibleLinks: SankeyLink[] = links
    .filter(l => related.has(l.source) && related.has(l.target))
    .map(l =>
      ancestors.has(l.source) || ancestors.has(l.target)
        ? { ...l, value: branchValue }
        : { ...l }
    );

  // 集約は列順に処理する。上流の集約を縮めてから下流の流入を数える必要がある
  const columnOf = new Map(nodes.map(n => [n.id, COLUMN_INDEX.get(n.details.column) ?? 0]));
  const aggregates = nodes
    .filter(n => n.details.aggregated && related.has(n.id))
    .sort((a, b) => (columnOf.get(a.id) ?? 0) - (columnOf.get(b.id) ?? 0));

  const rewritten = new Map<string, number>();
  for (const aggregate of aggregates) {
    const inflow = visibleLinks
      .filter(l => l.target === aggregate.id)
      .reduce((sum, l) => sum + l.value, 0);
    rewritten.set(aggregate.id, inflow);
    const outgoing = visibleLinks.filter(l => l.source === aggregate.id);
    const outflow = outgoing.reduce((sum, l) => sum + l.value, 0);
    if (outflow <= 0) continue;
    const ratio = inflow / outflow;
    for (const link of outgoing) link.value *= ratio;
  }

  const visibleNodes = nodes
    .filter(n => related.has(n.id))
    .map(n => {
      if (ancestors.has(n.id)) return { ...n, value: branchValue };
      const value = rewritten.get(n.id);
      return value === undefined ? n : { ...n, value };
    });

  return { nodes: visibleNodes, links: visibleLinks };
}
