/**
 * T4（table-frame eligibility による level-frame support 限定）の research-only 純関数。規則は
 * docs/tasks/20261005_1735_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Protocol.md（Phase A の結果を見る前に固定）。
 * table-frame の既存 rule（frameOf / classifyPosition / relationOf）は変更せずに使う。
 */
import { relationOf, type RelationResult } from './budget-request-table-frame-eligibility';

export interface RowBBox { xMin: number; xMax: number; yMin: number; yMax: number }

/** node の bbox（logical row の bbox）と page の long vertical rule から relation と support eligibility を決める */
export function nodeSupport(bbox: RowBBox | null | undefined, longVerticalRules: { x: number; yMin: number; yMax: number }[]): { rel: RelationResult; supportEligible: boolean; reason: string } {
  const rel = relationOf(bbox, longVerticalRules);
  const supportEligible = rel.relation === 'body_or_table_position_supported';
  return { rel, supportEligible, reason: supportEligible ? `body_or_table: ${rel.reason}` : `excluded(${rel.relation}): ${rel.reason}` };
}

/** frame 構築用の page 入力から、support でない node の行だけを除く（node 以外の行は残す）。logicalRowIndex の集合で指定 */
export function filterLogicalRows<T extends { logicalRowIndex: number }>(rows: T[], excludedNodeRowIndexes: Set<number>): T[] {
  return rows.filter(r => !excludedNodeRowIndexes.has(r.logicalRowIndex));
}

export type SupportEffect = 'support_removed' | 'support_reduced' | 'support_maintained';
export function supportEffect(eligible: number, total: number): SupportEffect {
  return eligible === 0 ? 'support_removed' : eligible < total ? 'support_reduced' : 'support_maintained';
}

export interface Interval { xMin: number; xMax: number }
/** T4 cluster が単一の T2 cluster の区間に含まれるか。含まれなければ new（T2 に由来しない） */
export function t2ParentOf(t4: Interval, t2: (Interval & { clusterIndex: number })[]): number | null {
  const p = t2.find(k => t4.xMin >= k.xMin && t4.xMax <= k.xMax);
  return p ? p.clusterIndex : null;
}

export type TableEligibilityDecision = 'TABLE_FRAME_SUPPORT_LOCALIZES_B4_WITHOUT_CONTROL_REGRESSION' | 'TABLE_FRAME_SUPPORT_SIGNAL_PRESENT_BUT_CONTROL_REGRESSION' | 'TABLE_FRAME_SUPPORT_SIGNAL_WEAK' | 'TABLE_FRAME_SUPPORT_COVERAGE_INSUFFICIENT' | 'TABLE_FRAME_SUPPORT_CHANGES_DIFFERENT_COMPONENT' | 'INVALID' | 'INVALID_DECISION_RULE_GAP';
export interface TableEligibilityFacts {
  gatesPass: boolean; nonHierarchyChangedRows: number;
  primaryRows: number; primaryUnassignedRows: number; primaryFrameBuilt: boolean[];
  b4Total: number; b4RemovedOrReduced: number;
  sameRangeChangedRows: number; newClusters: number; primaryNewChangeRows: number;
}
/** 事前登録の順序: D0 → D4 → D3 → (D2 | D5 | D1 | RULE_GAP) */
export function decideTableEligibility(f: TableEligibilityFacts): { decision: TableEligibilityDecision; rule: string } {
  if (!f.gatesPass || f.nonHierarchyChangedRows > 0) return { decision: 'INVALID', rule: 'D0' };
  if (f.primaryFrameBuilt.some(b => !b) || f.primaryUnassignedRows * 10 > f.primaryRows) return { decision: 'TABLE_FRAME_SUPPORT_COVERAGE_INSUFFICIENT', rule: 'D4' };
  if (f.b4RemovedOrReduced * 2 <= f.b4Total) return { decision: 'TABLE_FRAME_SUPPORT_SIGNAL_WEAK', rule: 'D3' };
  if (f.sameRangeChangedRows > 0) return { decision: 'TABLE_FRAME_SUPPORT_SIGNAL_PRESENT_BUT_CONTROL_REGRESSION', rule: 'D2' };
  if (f.primaryNewChangeRows * 20 > f.primaryRows) return { decision: 'TABLE_FRAME_SUPPORT_CHANGES_DIFFERENT_COMPONENT', rule: 'D5' };
  if (f.newClusters === 0) return { decision: 'TABLE_FRAME_SUPPORT_LOCALIZES_B4_WITHOUT_CONTROL_REGRESSION', rule: 'D1' };
  return { decision: 'INVALID_DECISION_RULE_GAP', rule: 'gap' };
}
