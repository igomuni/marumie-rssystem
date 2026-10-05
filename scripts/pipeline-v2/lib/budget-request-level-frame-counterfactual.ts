/**
 * level-frame counterfactual の research-only 純関数。規則は docs/tasks/20261005_1535_Budget_Request_Hierarchy_Level_Frame_Counterfactual_Protocol.md（T3 実行前に固定）。
 */
import type { ReplayEdge, ReplayNode } from './budget-request-stack-reset-counterfactual';

export interface FrameCluster { clusterIndex: number; xMin: number; xMax: number; level: number | null }
/** 既存 assignment 規則（first match、x 範囲内）。どの cluster にも入らなければ null（fail-closed、近傍割当てはしない） */
export function assignToFrame(x: number, frame: FrameCluster[]): FrameCluster | null {
  return frame.find(k => x >= k.xMin && x <= k.xMax) ?? null;
}

/** production の stack pass の replay。reset は locator node の処理直前（その node が unplaced でも位置は変えない）に 1 回。 */
export function replayStackAtNode(nodes: ReplayNode[], resetBeforeNodeId: string | null): { edges: ReplayEdge[]; resetEvents: { beforeNodeId: string; stackDepth: number }[] } {
  const edges: ReplayEdge[] = [], resetEvents: { beforeNodeId: string; stackDepth: number }[] = [];
  const stack: ReplayNode[] = [];
  const level = (n: ReplayNode) => n.xIndentEvidence.level as number;
  for (const c of nodes) {
    if (c.hierarchyEligibility !== 'candidate') { if (c.id === resetBeforeNodeId) { resetEvents.push({ beforeNodeId: c.id, stackDepth: stack.length }); stack.length = 0; } continue; }
    if (c.id === resetBeforeNodeId) { resetEvents.push({ beforeNodeId: c.id, stackDepth: stack.length }); stack.length = 0; }
    if (!c.xIndentEvidence.placed) continue;
    while (stack.length > 0 && level(stack[stack.length - 1]) >= level(c)) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) edges.push({ parentNodeId: null, childNodeId: c.id, status: 'unresolved', ancestorCandidateNodeIds: [] });
    else edges.push({ parentNodeId: parent.id, childNodeId: c.id, status: level(parent) === level(c) - 1 ? 'resolved_by_indent_sequence' : 'level_gap', ancestorCandidateNodeIds: stack.slice(0, -1).reverse().map(s => s.id) });
    stack.push(c);
  }
  return { edges, resetEvents };
}

export type TransitionClass = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
/** component 文字列（JSON）の C0 / T2 / T3 比較。undefined = 欠落、unassigned = frame 未割当 */
export function transitionClass(c0: string | undefined, t2: string | undefined, t3: string | undefined, unassigned = false): TransitionClass {
  if (unassigned || c0 === undefined || t2 === undefined || t3 === undefined) return 'R5';
  if (t2 === c0) return t3 === c0 ? 'R0' : 'R4';
  if (t3 === c0) return 'R1';
  return t3 === t2 ? 'R2' : 'R3';
}

export type LevelFrameDecision = 'LEVEL_FRAME_EXPLAINS_ALL_RESIDUAL_COMPONENT_DIFFERENCE' | 'LEVEL_FRAME_IS_A_CAUSAL_FACTOR_WITH_RESIDUAL' | 'NO_OBSERVED_LEVEL_FRAME_EFFECT' | 'LEVEL_FRAME_INTERVENTION_INTRODUCES_NEW_DIFFERENCE' | 'FRAME_ASSIGNMENT_INCOMPLETE' | 'LEVEL_FRAME_RESPONSIVE_WITHOUT_RESTORATION' | 'NO_T2_RESIDUAL' | 'INVALID';
/** 事前登録の順序: INVALID → D4 → D5 → D1 → D2 → D3 → D6 → D0 → 網羅漏れは INVALID。r は L・P・K 合計の R 件数 */
export function decideLevelFrame(f: { gatesPass: boolean; r: Record<TransitionClass, number> }): { decision: LevelFrameDecision; rule: string } {
  const r = f.r;
  if (!f.gatesPass) return { decision: 'INVALID', rule: 'gate' };
  if (r.R4 > 0) return { decision: 'LEVEL_FRAME_INTERVENTION_INTRODUCES_NEW_DIFFERENCE', rule: 'D4' };
  if (r.R5 > 0) return { decision: 'FRAME_ASSIGNMENT_INCOMPLETE', rule: 'D5' };
  if (r.R1 > 0 && r.R2 === 0 && r.R3 === 0) return { decision: 'LEVEL_FRAME_EXPLAINS_ALL_RESIDUAL_COMPONENT_DIFFERENCE', rule: 'D1' };
  if (r.R1 > 0 && r.R2 + r.R3 > 0) return { decision: 'LEVEL_FRAME_IS_A_CAUSAL_FACTOR_WITH_RESIDUAL', rule: 'D2' };
  if (r.R1 === 0 && r.R3 === 0 && r.R2 > 0) return { decision: 'NO_OBSERVED_LEVEL_FRAME_EFFECT', rule: 'D3' };
  if (r.R1 === 0 && r.R3 > 0) return { decision: 'LEVEL_FRAME_RESPONSIVE_WITHOUT_RESTORATION', rule: 'D6' };
  if (r.R1 + r.R2 + r.R3 === 0) return { decision: 'NO_T2_RESIDUAL', rule: 'D0' };
  return { decision: 'INVALID', rule: 'uncovered' };
}
