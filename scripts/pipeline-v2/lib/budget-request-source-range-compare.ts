/**
 * manual activation range と source-derived detail range の paired 比較（research-only 純関数）。規則は docs/tasks/20261005_1425_Budget_Request_Source_Range_Hierarchy_Paired_Protocol.md（treatment 実行前に固定）。
 * hierarchy algorithm・FieldResolver は変更せず、出力 row の比較・change class・decision だけを持つ。
 */
export interface NodeInfo { isNode: boolean; level: number | null; clusterX: [number, number] | null; edgeStatus: string | null; parentId: string | null; root: boolean }
export interface RowRec {
  kind: string; basis: string; codeRaw: string | null; nameStatus: string; nameReason: string | null; nameRaw: string | null;
  parentItem: { status: string; ref: string | null }; parentOrg: { status: string; ref: string | null };
  node: NodeInfo; geometry: [number, number, number, number]; tokenRefs: number[];
}
export type ChangeClass = 'newly_unclassified' | 'unclassified_resolved' | 'record_kind_changed' | 'root_changed' | 'parent_changed' | 'level_changed' | 'other_changed' | 'unchanged';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 排他的 primary class（優先順）と、該当する全 flag（multi-label） */
export function classifyChange(c: RowRec, t: RowRec): { primary: ChangeClass; flags: ChangeClass[] } {
  const flags: ChangeClass[] = [];
  if (c.kind !== t.kind) { if (t.kind === 'unclassified' && c.kind !== 'unclassified') flags.push('newly_unclassified'); else if (c.kind === 'unclassified' && t.kind !== 'unclassified') flags.push('unclassified_resolved'); else flags.push('record_kind_changed'); }
  if (c.node.root !== t.node.root) flags.push('root_changed');
  if (!same(c.parentItem, t.parentItem) || !same(c.parentOrg, t.parentOrg) || c.node.parentId !== t.node.parentId || c.node.edgeStatus !== t.node.edgeStatus) flags.push('parent_changed');
  if (c.node.isNode !== t.node.isNode || c.node.level !== t.node.level || !same(c.node.clusterX, t.node.clusterX)) flags.push('level_changed');
  if (c.codeRaw !== t.codeRaw || c.nameStatus !== t.nameStatus || c.nameReason !== t.nameReason || c.nameRaw !== t.nameRaw || !same(c.geometry, t.geometry) || !same(c.tokenRefs, t.tokenRefs)) flags.push('other_changed');
  const order: ChangeClass[] = ['newly_unclassified', 'unclassified_resolved', 'record_kind_changed', 'root_changed', 'parent_changed', 'level_changed', 'other_changed'];
  const primary = order.find(o => flags.includes(o)) ?? 'unchanged';
  return { primary, flags };
}

export const hierarchyDerivedChanged = (flags: ChangeClass[]): boolean => flags.some(f => f !== 'other_changed');

export interface RegionInventory { rows: number; nodes: number; roots: number; organizations: number; items: number; requests: number; detailLines: number; unclassified: number; levelGap: number; parentResolved: number; parentUnresolved: number; parentNotObserved: number; nameStatus: Record<string, number>; distinctClusters: number; maxLevel: number }
/** source-only region の inventory。request の親の項の status を parent として数える */
export function inventoryOf(rows: RowRec[]): RegionInventory {
  const inv: RegionInventory = { rows: rows.length, nodes: 0, roots: 0, organizations: 0, items: 0, requests: 0, detailLines: 0, unclassified: 0, levelGap: 0, parentResolved: 0, parentUnresolved: 0, parentNotObserved: 0, nameStatus: {}, distinctClusters: 0, maxLevel: 0 };
  const clusters = new Set<string>();
  for (const r of rows) {
    if (r.node.isNode) inv.nodes++;
    if (r.node.root) inv.roots++;
    if (r.kind === 'organization') inv.organizations++;
    if (r.kind === 'item') inv.items++;
    if (r.kind === 'request') { inv.requests++; const s = r.parentItem.status; if (s === 'resolved') inv.parentResolved++; else if (s === 'not_observed') inv.parentNotObserved++; else inv.parentUnresolved++; }
    if (r.kind === 'detail_line') inv.detailLines++;
    if (r.kind === 'unclassified') inv.unclassified++;
    if (r.node.edgeStatus === 'level_gap') inv.levelGap++;
    inv.nameStatus[r.nameStatus] = (inv.nameStatus[r.nameStatus] ?? 0) + 1;
    if (r.node.clusterX) clusters.add(r.node.clusterX.join('-'));
    if (r.node.level !== null) inv.maxLevel = Math.max(inv.maxLevel, r.node.level);
  }
  inv.distinctClusters = clusters.size;
  return inv;
}

export type PairedDecision = 'SOURCE_RANGE_DROP_IN_REPLACEMENT_SUPPORTED' | 'ACTIVATION_RANGE_CHANGES_HIERARCHY_STATE' | 'SOURCE_RANGE_ADDS_ONLY_NONSEMANTIC_OR_ABSTAINED_STRUCTURE' | 'PAIRED_DIAGNOSTIC_INCONCLUSIVE';
export interface PairedFacts { infrastructureOk: boolean; sameRangeExact: boolean; intersectionChangedRows: number; sourceOnlyItems: number; sourceOnlyOrganizations: number; sourceOnlyResolvedRequests: number }
/** 事前登録の判定順序: D4 → D2 → D3 → D1 */
export function decidePaired(f: PairedFacts): { decision: PairedDecision; rule: number } {
  if (!f.infrastructureOk || !f.sameRangeExact) return { decision: 'PAIRED_DIAGNOSTIC_INCONCLUSIVE', rule: 1 };
  if (f.intersectionChangedRows > 0) return { decision: 'ACTIVATION_RANGE_CHANGES_HIERARCHY_STATE', rule: 2 };
  if (f.sourceOnlyItems === 0 && f.sourceOnlyOrganizations === 0 && f.sourceOnlyResolvedRequests === 0) return { decision: 'SOURCE_RANGE_ADDS_ONLY_NONSEMANTIC_OR_ABSTAINED_STRUCTURE', rule: 3 };
  return { decision: 'SOURCE_RANGE_DROP_IN_REPLACEMENT_SUPPORTED', rule: 4 };
}
