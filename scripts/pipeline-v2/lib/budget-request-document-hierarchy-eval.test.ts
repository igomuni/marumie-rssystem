import { describe, expect, it } from 'vitest';
import type { DocumentHierarchyResult, DocumentHierarchyNodeObservation, DocumentHierarchyEdgeCandidate } from './budget-request-document-hierarchy';
import { evaluateView, matchGtNodes, summarize, type GtNode } from './budget-request-document-hierarchy-eval';

const gt: GtNode[] = [
  { key: 'o', depth: 1, code: '900', name: '組織甲', printedStartPage: 10, set: 'development', inResearchGT: true },
  { key: 'i', depth: 2, parent: 'o', code: '910', name: '項乙', printedStartPage: 10, set: 'development', inResearchGT: true },
  { key: 'r', depth: 3, parent: 'i', requestNo: '5', code: '01-95', name: '要求丙', printedStartPage: 10, set: 'development', inResearchGT: true },
];
const node = (id: string, page: number, row: number, level: number, code: string, requestNo?: string, text = '', pageRef: string | null = null): DocumentHierarchyNodeObservation => ({
  id, view: 'detail', sourcePage: page,
  rowShape: requestNo ? 'request_no_then_code' : 'code3_then_text',
  sourceRowRefs: { logicalRowIndex: row, physicalRowIndexes: [row] },
  sourceTokenRefs: { keyTokenIndex: 0, rowTokenIndexes: [0] },
  observedCodeParts: requestNo ? { requestNo, code } : { code },
  observedTextParts: [text],
  xIndentEvidence: { keyTokenXMin: 10 * level, clusterIndex: level, level, placed: true },
  structureEvidence: { printedPageRefCandidate: pageRef, rowTokenCount: 2 },
});
const edge = (c: string, p: string | null, status: DocumentHierarchyEdgeCandidate['status'] = 'resolved_by_indent_sequence'): DocumentHierarchyEdgeCandidate => ({ parentNodeId: p, childNodeId: c, status, evidence: [], ancestorCandidateNodeIds: [] });
const result = (nodes: DocumentHierarchyNodeObservation[], edges: DocumentHierarchyEdgeCandidate[], view: 'summary' | 'detail' = 'detail'): DocumentHierarchyResult =>
  ({ schema: 'budget-request-document-hierarchy-poc/v1', view, nodes, edges } as unknown as DocumentHierarchyResult);

const OFFSET = 8;
const good = result([node('n1', 18, 0, 1, '900', undefined, '組織甲'), node('n2', 18, 1, 2, '910', undefined, '項乙'), node('n3', 18, 5, 3, '01-95', '5', '要求丙')], [edge('n1', null, 'unresolved'), edge('n2', 'n1'), edge('n3', 'n2')]);
const keys = new Set(gt.map(g => g.key));

describe('evaluation（GT側）', () => {
  it('全て一致: exact / ancestorExact / depthExact', () => {
    const c = summarize(good, gt, keys, evaluateView(good, gt, OFFSET));
    expect(c).toMatchObject({ gtEdges: 2, exact: 2, falseParent: 0, unresolved: 0, childNotFound: 0, precision: 1, recall: 1, f1: 1, ancestorExact: { x: 2, n: 2 }, depthExact: { x: 3, n: 3 } });
  });
  it('親が違えば false_parent、親がGT外のnodeでも false_parent（precisionが下がる）', () => {
    const r = result([...good.nodes, node('nx', 18, 3, 2, '911', undefined, '別項')], [edge('n1', null, 'unresolved'), edge('n2', 'n1'), edge('nx', 'n1'), edge('n3', 'nx')]);
    const ev = evaluateView(r, gt, OFFSET);
    expect(ev.edges.find(e => e.childKey === 'r')).toMatchObject({ outcome: 'false_parent', predictedParentGtKey: null, note: 'predicted parent is not a GT node' });
    const c = summarize(r, gt, keys, ev);
    expect(c).toMatchObject({ exact: 1, falseParent: 1, precision: 0.5, recall: 0.5 });
  });
  it('level_gap / unresolved は親を確定扱いにしない（false parentではなく unresolved）', () => {
    const r = result(good.nodes, [edge('n1', null, 'unresolved'), edge('n2', 'n1', 'level_gap'), edge('n3', 'n2')]);
    const ev = evaluateView(r, gt, OFFSET);
    expect(ev.edges.find(e => e.childKey === 'i')?.outcome).toBe('unresolved');
    expect(summarize(r, gt, keys, ev)).toMatchObject({ exact: 1, unresolved: 1, falseParent: 0 });
  });
  it('見つからないnodeは child_not_found（recallの母数に入る）', () => {
    const r = result(good.nodes.slice(0, 2), [edge('n1', null, 'unresolved'), edge('n2', 'n1')]);
    expect(summarize(r, gt, keys, evaluateView(r, gt, OFFSET))).toMatchObject({ gtEdges: 2, exact: 1, childNotFound: 1, recall: 0.5 });
  });
  it('同じページ・同じコード・同じ形の候補が複数あるときだけ名称前方一致で絞る（絞れなければ見つからない扱い）', () => {
    const twins = result([node('a', 18, 0, 2, '910', undefined, '別の名称'), node('b', 18, 4, 5, '910', undefined, '項乙')], []);
    expect(matchGtNodes(twins, [gt[1]], OFFSET, true).matched.get('i')?.id).toBe('b');
    expect(matchGtNodes(twins, [gt[1]], OFFSET, false).status.get('i')).toBe('ambiguous_match');
    const none = result([node('a', 18, 0, 2, '910', undefined, '甲'), node('b', 18, 4, 5, '910', undefined, '乙')], []);
    expect(matchGtNodes(none, [gt[1]], OFFSET, true).status.get('i')).toBe('not_found');
  });
  it('summaryは頁数列の候補が printedStartPage と一致するnodeに対応づける（detailのページ位置は使わない）', () => {
    const s = result([node('a', 1, 0, 2, '910', undefined, '項乙', '10'), node('b', 1, 1, 2, '910', undefined, '項乙', '99')], [], 'summary');
    expect(matchGtNodes(s, [gt[1]], OFFSET).matched.get('i')?.id).toBe('a');
  });
});
