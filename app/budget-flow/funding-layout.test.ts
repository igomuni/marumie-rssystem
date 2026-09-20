import { describe, it, expect } from 'vitest';
import { layoutFundingGraph } from './funding-layout';
import type { RsFundingGraph } from './rs-model';

function graph(overrides: Partial<RsFundingGraph>): RsFundingGraph {
  return {
    nodes: [], edges: [],
    metrics: {
      blockCount: 0, nodeCount: 0, semanticEdgeCount: 0, relationEvidenceCount: 0, hasCycle: false,
      cyclicComponents: [], weakComponentCount: 0, weakComponentSizes: [], maxOutDegree: 0, maxInDegree: 0,
      orphanBlockIds: [], externalRootBlockIds: [], duplicateRelationPairCount: 0, duplicateRelationEvidenceExtraCount: 0,
      indirectExpenseCount: 0, sameNameMultipleBlocks: [], hasResponsibleOrganizationRoot: false,
      responsibleOrganizationNodeId: null, rootNodeIds: [], unresolvedRelationEvidenceCount: 0,
    },
    unresolvedRelationIds: [], unresolvedRelationDetails: [], duplicateRelationPairs: [],
    ...overrides,
  };
}
function node(id: string, name = id): RsFundingGraph['nodes'][number] {
  return { nodeId: id, nodeType: 'spending_block', blockId: id, name, nameVariants: [], roles: [] };
}
function edge(id: string, source: string, target: string, evidenceCount = 1): RsFundingGraph['edges'][number] {
  return { edgeId: id, sourceNodeId: source, targetNodeId: target, evidenceCount, noteVariants: [], sourceNameVariants: [], targetNameVariants: [], fromResponsibleOrganizationValues: [], amountYen: null, amountStatus: 'not_provided_by_5-2' };
}

describe('layoutFundingGraph: 単純なDAG', () => {
  it('root→leafの層を正しく割り当てる（A→B→C）', () => {
    const g = graph({ nodes: [node('A'), node('B'), node('C')], edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')] });
    const layout = layoutFundingGraph(g);
    const byId = new Map(layout.nodes.map(n => [n.nodeId, n]));
    expect(byId.get('A')!.layer).toBe(0);
    expect(byId.get('B')!.layer).toBe(1);
    expect(byId.get('C')!.layer).toBe(2);
  });

  it('星型（1担当組織→複数block）は全ブロックが同じ層になる', () => {
    const g = graph({ nodes: [node('org'), node('A'), node('B'), node('C')], edges: [edge('e1', 'org', 'A'), edge('e2', 'org', 'B'), edge('e3', 'org', 'C')] });
    const layout = layoutFundingGraph(g);
    const byId = new Map(layout.nodes.map(n => [n.nodeId, n]));
    expect(byId.get('org')!.layer).toBe(0);
    expect(byId.get('A')!.layer).toBe(1);
    expect(byId.get('B')!.layer).toBe(1);
    expect(byId.get('C')!.layer).toBe(1);
  });
});

describe('layoutFundingGraph: 循環を含むグラフでも無限ループせず終了する', () => {
  it('A→B→A の循環を層別できる（打ち切りロジックが機能する）', () => {
    const g = graph({
      nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')],
      metrics: { ...graph({}).metrics, hasCycle: true, cyclicComponents: [['A', 'B']] },
    });
    const layout = layoutFundingGraph(g);
    expect(layout.nodes).toHaveLength(2);
    // 循環に属する辺はisCycleEdge=trueとしてマークする
    expect(layout.edges.every(e => e.isCycleEdge)).toBe(true);
  });

  it('孤立ノードのみのグラフ（辺0件）でも全ノードを層0に配置する', () => {
    const g = graph({ nodes: [node('A'), node('B'), node('C')], edges: [] });
    const layout = layoutFundingGraph(g);
    expect(layout.nodes.every(n => n.layer === 0)).toBe(true);
    expect(layout.layerCount).toBe(1);
    expect(layout.maxRowCount).toBe(3);
  });
});

describe('layoutFundingGraph: 重複辺はevidenceCountで判別できる', () => {
  it('evidenceCount>1の辺情報を保持する（呼び出し側で×N表示に使う）', () => {
    const g = graph({ nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B', 3)] });
    const layout = layoutFundingGraph(g);
    expect(layout.edges[0].evidenceCount).toBe(3);
  });
});
