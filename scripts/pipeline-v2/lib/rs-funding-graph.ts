/**
 * RS正規化済みの5-1（spending-blocks）・5-2（funding-relations/indirect-expenses）から、
 * 事業単位の資金フローグラフを作る。Python参照実装 pipeline_v2/funding_graph.py の
 * build_funding_graphs_for_yearと同じロジック。
 *
 * 重要な原則（参照実装のdocstringと同じ）:
 *   - tree/DAG/single-rootを前提にしない
 *   - 欠けている担当組織辺を推測しない（5-2に「担当組織からの支出」フラグがある場合のみ
 *     合成の担当組織ノードを作る）
 *   - 辺の金額を捏造しない（5-2に金額列は無いため常にamountYen=null、amountStatusで明示）
 */
import { stableId } from './stable-id';
import { normalizeText } from './stable-id';
import type {
  RsSpendingBlockRecord, RsFundingRelationRecord, RsIndirectExpenseRecord,
  RsFundingGraph, RsFundingGraphNode, RsFundingGraphEdge, RsFundingGraphDuplicatePair,
  RsFundingGraphUnresolvedRelation,
} from '../types';
import type { RsProject } from './rs-projects';

function blockNode(block: RsSpendingBlockRecord): RsFundingGraphNode {
  return {
    nodeId: block.nodeId,
    nodeType: 'spending_block',
    blockId: block.blockId ?? '',
    name: block.blockName ?? '',
    nameVariants: block.blockNames ?? [],
    roles: block.roles ?? [],
    recipientCountValues: block.recipientCountValues ?? [],
    totalAmountValuesYen: block.totalAmountValuesYen ?? [],
    summaryRowCount: block.summaryRowCount ?? 0,
    evidenceRowIds: block.evidenceRowIds ?? [],
  };
}

/** Tarjanの強連結成分分解（再帰DFS）。孤立した自己ループも1要素のSCCとして返す */
function tarjanScc(nodeIds: string[], adjacency: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const out: string[][] = [];

  function visit(v: string): void {
    indices.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      out.push(component);
    }
  }

  for (const node of nodeIds) {
    if (!indices.has(node)) visit(node);
  }
  return out;
}

/** 辺を無向とみなした弱連結成分（孤立ブロック検知・多始点検知に使う） */
function weakComponents(nodeIds: string[], edges: [string, string][]): string[][] {
  const adj = new Map<string, Set<string>>(nodeIds.map(n => [n, new Set<string>()]));
  for (const [a, b] of edges) {
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const start of nodeIds) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const comp: string[] = [];
    while (queue.length > 0) {
      const n = queue.pop()!;
      comp.push(n);
      for (const next of adj.get(n) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    comps.push(comp.sort());
  }
  return comps;
}

export interface FundingGraphTotals {
  projectCount: number;
  blockNodeCount: number;
  responsibleOrganizationNodeCount: number;
  relationEvidenceCount: number;
  semanticEdgeCount: number;
  indirectExpenseCount: number;
  projectsWithCycles: number;
  projectsWithMultipleWeakComponents: number;
  projectsWithOrphanBlocks: number;
  projectsWithDuplicateRelationPairs: number;
  unresolvedRelationEvidenceCount: number;
}

export function buildFundingGraphsForYear(
  reviewYear: number,
  blocks: RsSpendingBlockRecord[],
  relations: RsFundingRelationRecord[],
  indirectExpenses: RsIndirectExpenseRecord[],
  projects: RsProject[]
): { graphs: RsFundingGraph[]; totals: FundingGraphTotals } {
  const blocksByProject = new Map<string, RsSpendingBlockRecord[]>();
  for (const row of blocks) {
    const list = blocksByProject.get(row.projectId) ?? [];
    list.push(row);
    blocksByProject.set(row.projectId, list);
  }
  const relsByProject = new Map<string, RsFundingRelationRecord[]>();
  for (const row of relations) {
    const list = relsByProject.get(row.projectId) ?? [];
    list.push(row);
    relsByProject.set(row.projectId, list);
  }
  const indirectByProject = new Map<string, RsIndirectExpenseRecord[]>();
  for (const row of indirectExpenses) {
    const list = indirectByProject.get(row.projectId) ?? [];
    list.push(row);
    indirectByProject.set(row.projectId, list);
  }
  const projectMeta = new Map<string, RsProject>(projects.map(p => [p.projectId, p]));

  const projectIds = [...new Set([...blocksByProject.keys(), ...relsByProject.keys(), ...indirectByProject.keys()])].sort();

  const graphs: RsFundingGraph[] = [];
  const totals: FundingGraphTotals = {
    projectCount: 0, blockNodeCount: 0, responsibleOrganizationNodeCount: 0, relationEvidenceCount: 0,
    semanticEdgeCount: 0, indirectExpenseCount: 0, projectsWithCycles: 0, projectsWithMultipleWeakComponents: 0,
    projectsWithOrphanBlocks: 0, projectsWithDuplicateRelationPairs: 0, unresolvedRelationEvidenceCount: 0,
  };

  for (const pid of projectIds) {
    const projectBlocks = [...(blocksByProject.get(pid) ?? [])].sort((a, b) => (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0));
    const rels = relsByProject.get(pid) ?? [];
    const indirect = indirectByProject.get(pid) ?? [];
    const meta = projectMeta.get(pid);

    const nodes: RsFundingGraphNode[] = projectBlocks.map(blockNode);
    const blockNodeById = new Map<string, string>();
    for (const b of projectBlocks) if (b.blockId) blockNodeById.set(b.blockId, b.nodeId);

    const responsibleNeeded = rels.some(r => r.fromResponsibleOrganization === true && !r.sourceBlockId);
    const responsibleNodeId = responsibleNeeded ? `project:${pid}:responsible` : null;
    if (responsibleNeeded && responsibleNodeId) {
      const responsibleName = meta?.ministry || meta?.policyMinistry || '担当組織';
      nodes.push({
        nodeId: responsibleNodeId,
        nodeType: 'responsible_organization',
        blockId: null,
        name: responsibleName,
        nameVariants: responsibleName ? [responsibleName] : [],
        roles: [],
        synthetic: true,
        syntheticReason: '5-2 担当組織からの支出=TRUE and sourceBlockId is blank',
      });
    }

    const pairEvidence = new Map<string, { sourceNode: string; targetNode: string; evidence: RsFundingRelationRecord[] }>();
    const unresolvedRelationIds: string[] = [];
    const unresolvedDetails: RsFundingGraphUnresolvedRelation[] = [];
    for (const rel of rels) {
      const sbid = rel.sourceBlockId;
      const tbid = rel.targetBlockId;
      let sourceNode: string | null;
      let sourceResolution: RsFundingGraphUnresolvedRelation['sourceResolution'];
      if (sbid) {
        sourceNode = blockNodeById.get(sbid) ?? null;
        sourceResolution = '5-1-block';
      } else if (rel.fromResponsibleOrganization === true) {
        sourceNode = responsibleNodeId;
        sourceResolution = 'responsible-organization';
      } else {
        sourceNode = null;
        sourceResolution = 'unresolved';
      }
      const targetNode = tbid ? (blockNodeById.get(tbid) ?? null) : null;
      if (!sourceNode || !targetNode) {
        unresolvedRelationIds.push(rel.relationId);
        unresolvedDetails.push({
          relationId: rel.relationId,
          sourceBlockId: sbid,
          targetBlockId: tbid,
          sourceResolution,
          targetResolution: targetNode ? '5-1-block' : 'unresolved',
        });
        continue;
      }
      const pairKey = `${sourceNode}\x1f${targetNode}`;
      const entry = pairEvidence.get(pairKey) ?? { sourceNode, targetNode, evidence: [] };
      entry.evidence.push(rel);
      pairEvidence.set(pairKey, entry);
    }

    const semanticEdges: RsFundingGraphEdge[] = [];
    const duplicatePairs: RsFundingGraphDuplicatePair[] = [];
    const sortedPairs = [...pairEvidence.values()].sort((a, b) => {
      const ka = `${a.sourceNode}\x1f${a.targetNode}`;
      const kb = `${b.sourceNode}\x1f${b.targetNode}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const { sourceNode, targetNode, evidence } of sortedPairs) {
      const notes: string[] = [];
      const sourceNames: string[] = [];
      const targetNames: string[] = [];
      const fromOrgValues: (boolean | null)[] = [];
      for (const r of evidence) {
        for (const [value, arr] of [[r.note, notes], [r.sourceBlockName, sourceNames], [r.targetBlockName, targetNames]] as [string, string[]][]) {
          if (value && !arr.includes(value)) arr.push(value);
        }
        if (!fromOrgValues.includes(r.fromResponsibleOrganization)) fromOrgValues.push(r.fromResponsibleOrganization);
      }
      const edge: RsFundingGraphEdge = {
        edgeId: stableId([reviewYear, pid, sourceNode, targetNode], 'rsedge_'),
        sourceNodeId: sourceNode,
        targetNodeId: targetNode,
        amountYen: null,
        amountStatus: 'not_provided_by_5-2',
        evidenceRelationIds: evidence.map(r => r.relationId),
        evidenceCount: evidence.length,
        noteVariants: notes,
        sourceNameVariants: sourceNames,
        targetNameVariants: targetNames,
        fromResponsibleOrganizationValues: fromOrgValues,
      };
      semanticEdges.push(edge);
      if (evidence.length > 1) {
        duplicatePairs.push({
          sourceNodeId: sourceNode,
          targetNodeId: targetNode,
          evidenceCount: evidence.length,
          evidenceRelationIds: edge.evidenceRelationIds,
          noteVariants: notes,
        });
      }
    }

    const nodeIds = nodes.map(n => n.nodeId);
    const edgePairs: [string, string][] = semanticEdges.map(e => [e.sourceNodeId, e.targetNodeId]);
    const indegree = new Map<string, number>(nodeIds.map(n => [n, 0]));
    const outdegree = new Map<string, number>(nodeIds.map(n => [n, 0]));
    const adjacency = new Map<string, Set<string>>();
    for (const [a, b] of edgePairs) {
      if (outdegree.has(a) && indegree.has(b)) {
        outdegree.set(a, outdegree.get(a)! + 1);
        indegree.set(b, indegree.get(b)! + 1);
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        adjacency.get(a)!.add(b);
      }
    }

    const scc = tarjanScc(nodeIds, adjacency);
    const cyclicComponents: string[][] = [];
    for (const comp of scc) {
      if (comp.length > 1) cyclicComponents.push([...comp].sort());
      else if (comp.length === 1 && adjacency.get(comp[0])?.has(comp[0])) cyclicComponents.push(comp);
    }
    const weak = weakComponents(nodeIds, edgePairs);

    const blockNodeIds = new Set(blockNodeById.values());
    const orphanBlocks = projectBlocks
      .filter(b => blockNodeIds.has(b.nodeId) && (indegree.get(b.nodeId) ?? 0) === 0 && (outdegree.get(b.nodeId) ?? 0) === 0)
      .map(b => b.blockId).sort();
    const rootNodes = nodeIds.filter(n => (indegree.get(n) ?? 0) === 0).sort();
    const externalRootBlocks = projectBlocks
      .filter(b => (indegree.get(b.nodeId) ?? 0) === 0 && (outdegree.get(b.nodeId) ?? 0) > 0)
      .map(b => b.blockId).sort();

    const byName = new Map<string, string[]>();
    for (const b of projectBlocks) {
      const nm = normalizeText(b.blockName ?? '');
      if (!nm) continue;
      const list = byName.get(nm) ?? [];
      list.push(b.blockId);
      byName.set(nm, list);
    }
    const sameNameMultiple = [...byName.entries()]
      .filter(([, ids]) => new Set(ids).size > 1)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([name, ids]) => ({ normalizedName: name, blockIds: [...new Set(ids)].sort() }));

    const graph: RsFundingGraph = {
      schemaVersion: 2,
      recordType: 'rs_funding_graph',
      reviewYear,
      sourceYear: reviewYear,
      projectId: pid,
      projectName: meta?.projectName ?? '',
      ministry: meta?.ministry ?? '',
      nodes,
      semanticEdges,
      unresolvedRelationIds,
      unresolvedRelationDetails: unresolvedDetails,
      metrics: {
        blockCount: projectBlocks.length,
        nodeCount: nodes.length,
        relationEvidenceCount: rels.length,
        semanticEdgeCount: semanticEdges.length,
        indirectExpenseCount: indirect.length,
        responsibleOrganizationNodeId: responsibleNodeId,
        hasResponsibleOrganizationRoot: Boolean(responsibleNodeId),
        rootNodeIds: rootNodes,
        externalRootBlockIds: externalRootBlocks,
        orphanBlockIds: orphanBlocks,
        duplicateRelationPairCount: duplicatePairs.length,
        duplicateRelationEvidenceExtraCount: duplicatePairs.reduce((sum, d) => sum + Math.max(0, d.evidenceCount - 1), 0),
        hasCycle: cyclicComponents.length > 0,
        cyclicComponents,
        weakComponentCount: weak.length,
        weakComponentSizes: weak.map(c => c.length).sort((a, b) => b - a),
        maxOutDegree: Math.max(0, ...outdegree.values()),
        maxInDegree: Math.max(0, ...indegree.values()),
        sameNameMultipleBlocks: sameNameMultiple,
        unresolvedRelationEvidenceCount: unresolvedRelationIds.length,
      },
      duplicateRelationPairs: duplicatePairs,
    };
    graphs.push(graph);

    totals.projectCount++;
    totals.blockNodeCount += projectBlocks.length;
    totals.responsibleOrganizationNodeCount += responsibleNeeded ? 1 : 0;
    totals.relationEvidenceCount += rels.length;
    totals.semanticEdgeCount += semanticEdges.length;
    totals.indirectExpenseCount += indirect.length;
    totals.projectsWithCycles += cyclicComponents.length > 0 ? 1 : 0;
    totals.projectsWithMultipleWeakComponents += weak.length > 1 ? 1 : 0;
    totals.projectsWithOrphanBlocks += orphanBlocks.length > 0 ? 1 : 0;
    totals.projectsWithDuplicateRelationPairs += duplicatePairs.length > 0 ? 1 : 0;
    totals.unresolvedRelationEvidenceCount += unresolvedRelationIds.length;
  }

  return { graphs, totals };
}
