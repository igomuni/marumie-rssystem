/**
 * RS Funding Graphの層別レイアウト計算（純粋関数。JSXを含まないためvitestで直接テストできる）。
 * 5-2に金額列が無いため辺の太さで金額を表す「本物のSankey」は作れない
 * （rs-funding-graph.tsのamountStatus='not_provided_by_5-2'のとおり）。
 * ここでは循環を検知して壊すのではなく、表示のための層割当てに留める
 * （一般有向グラフとして保持する設計原則をUI側でも守る）。
 */
import type { RsFundingGraph } from './rs-model';

export interface LayoutNode { nodeId: string; name: string; nodeType: string; layer: number; row: number; synthetic?: boolean }
export interface LayoutEdge { edgeId: string; sourceNodeId: string; targetNodeId: string; evidenceCount: number; isCycleEdge: boolean }
export interface GraphLayout { nodes: LayoutNode[]; edges: LayoutEdge[]; layerCount: number; maxRowCount: number }

/**
 * 近似トポロジカル層別。循環がある場合はKahn法が行き詰まった時点で
 * 残存ノードのうち入次数最小のものを選んでシード投入し、層を打ち切らずに進める。
 */
export function layoutFundingGraph(graph: RsFundingGraph): GraphLayout {
  const nodeIds = graph.nodes.map(n => n.nodeId);
  const adjacency = new Map<string, string[]>(nodeIds.map(id => [id, []]));
  const indegree = new Map<string, number>(nodeIds.map(id => [id, 0]));
  for (const e of graph.edges) {
    if (adjacency.has(e.sourceNodeId) && indegree.has(e.targetNodeId)) {
      adjacency.get(e.sourceNodeId)!.push(e.targetNodeId);
      indegree.set(e.targetNodeId, (indegree.get(e.targetNodeId) ?? 0) + 1);
    }
  }
  const layer = new Map<string, number>(nodeIds.map(id => [id, 0]));
  const remaining = new Set(nodeIds);
  const workingIndegree = new Map(indegree);
  const queue = nodeIds.filter(id => workingIndegree.get(id) === 0);

  while (remaining.size > 0) {
    if (queue.length === 0) {
      let best: string | null = null;
      let bestValue = Infinity;
      for (const id of remaining) {
        const v = workingIndegree.get(id) ?? 0;
        if (v < bestValue) { bestValue = v; best = id; }
      }
      if (best) queue.push(best);
      else break;
    }
    const id = queue.shift()!;
    if (!remaining.has(id)) continue;
    remaining.delete(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!remaining.has(next)) continue;
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      workingIndegree.set(next, (workingIndegree.get(next) ?? 0) - 1);
      if ((workingIndegree.get(next) ?? 0) <= 0) queue.push(next);
    }
  }

  const cyclicNodeIds = new Set(graph.metrics.cyclicComponents.flat());
  const byLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layer.get(id) ?? 0;
    const list = byLayer.get(l) ?? [];
    list.push(id);
    byLayer.set(l, list);
  }
  const nameById = new Map(graph.nodes.map(n => [n.nodeId, n]));
  const layoutNodes: LayoutNode[] = [];
  let maxRowCount = 0;
  for (const [l, ids] of byLayer) {
    maxRowCount = Math.max(maxRowCount, ids.length);
    ids.forEach((id, row) => {
      const n = nameById.get(id);
      layoutNodes.push({ nodeId: id, name: n?.name || id, nodeType: n?.nodeType ?? 'spending_block', layer: l, row, synthetic: n?.synthetic });
    });
  }
  const layoutEdges: LayoutEdge[] = graph.edges.map(e => ({
    edgeId: e.edgeId, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, evidenceCount: e.evidenceCount,
    isCycleEdge: cyclicNodeIds.has(e.sourceNodeId) && cyclicNodeIds.has(e.targetNodeId),
  }));

  return { nodes: layoutNodes, edges: layoutEdges, layerCount: byLayer.size, maxRowCount };
}
