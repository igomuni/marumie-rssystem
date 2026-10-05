/**
 * stack-reset counterfactual の research-only 純関数。規則は docs/tasks/20261005_1450_Budget_Request_Hierarchy_Stack_Reset_Counterfactual_Protocol.md（T2 実行前に固定）。
 * production の DocumentHierarchy v2 の stack pass（level 付与後、document order の eligible・placed node に対する pop-while + push）を replay するだけで、algorithm は変えない。
 */
export interface ReplayNode { id: string; sourcePage: number; hierarchyEligibility: 'candidate' | 'excluded'; xIndentEvidence: { level: number | null; placed: boolean } }
export interface ReplayEdge { parentNodeId: string | null; childNodeId: string; status: 'resolved_by_indent_sequence' | 'level_gap' | 'unresolved'; ancestorCandidateNodeIds: string[] }

/** resetBeforePage が指定されると、sourcePage >= resetBeforePage を満たす最初の eligible・placed node の処理直前に stack を空にする（ちょうど 1 回）。 */
export function replayStack(nodes: ReplayNode[], resetBeforePage: number | null): { edges: ReplayEdge[]; resetEvents: { beforeNodeId: string; stackDepth: number }[] } {
  const edges: ReplayEdge[] = [], resetEvents: { beforeNodeId: string; stackDepth: number }[] = [];
  const stack: ReplayNode[] = [];
  const level = (n: ReplayNode) => n.xIndentEvidence.level as number;
  let done = resetBeforePage === null;
  for (const c of nodes) {
    if (c.hierarchyEligibility !== 'candidate' || !c.xIndentEvidence.placed) continue;
    if (!done && c.sourcePage >= (resetBeforePage as number)) { resetEvents.push({ beforeNodeId: c.id, stackDepth: stack.length }); stack.length = 0; done = true; }
    while (stack.length > 0 && level(stack[stack.length - 1]) >= level(c)) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) edges.push({ parentNodeId: null, childNodeId: c.id, status: 'unresolved', ancestorCandidateNodeIds: [] });
    else edges.push({ parentNodeId: parent.id, childNodeId: c.id, status: level(parent) === level(c) - 1 ? 'resolved_by_indent_sequence' : 'level_gap', ancestorCandidateNodeIds: stack.slice(0, -1).reverse().map(s => s.id) });
    stack.push(c);
  }
  return { edges, resetEvents };
}

export type CausalClass = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
/** V（hierarchy-state vector）の JSON を 3 条件で比較する。undefined は欠落 = S5 */
export function causalClass(c0: string | undefined, t1: string | undefined, t2: string | undefined): CausalClass {
  if (c0 === undefined || t1 === undefined || t2 === undefined) return 'S5';
  if (c0 === t1) return t2 === c0 ? 'S0' : 'S4';
  if (t2 === c0) return 'S1';
  if (t2 === t1) return 'S2';
  return 'S3';
}

export type StackResetDecision = 'STACK_CARRYOVER_SUFFICIENT_FOR_PRIOR_CHANGE' | 'STACK_AND_RANGE_GLOBAL_STATE_BOTH_CAUSAL' | 'STACK_RESET_NO_OBSERVED_EFFECT' | 'STACK_RESET_INTRODUCES_ADDITIONAL_STATE_CHANGE' | 'INVALID';
/** 事前登録の順序: INVALID → D4 → D1 → D2 → D3 → 網羅漏れは INVALID */
export function decideStackReset(f: { gatesPass: boolean; counts: Record<CausalClass, number>; priorChanged: number }): { decision: StackResetDecision; rule: string } {
  const { counts: n } = f;
  if (!f.gatesPass || n.S5 > 0) return { decision: 'INVALID', rule: 'gate_or_S5' };
  if (n.S4 > 0) return { decision: 'STACK_RESET_INTRODUCES_ADDITIONAL_STATE_CHANGE', rule: 'D4' };
  if (n.S3 === 0 && n.S1 === f.priorChanged) return { decision: 'STACK_CARRYOVER_SUFFICIENT_FOR_PRIOR_CHANGE', rule: 'D1' };
  if (n.S1 > 0 && n.S2 + n.S3 > 0) return { decision: 'STACK_AND_RANGE_GLOBAL_STATE_BOTH_CAUSAL', rule: 'D2' };
  if (n.S1 === 0 && n.S3 === 0 && n.S2 === f.priorChanged) return { decision: 'STACK_RESET_NO_OBSERVED_EFFECT', rule: 'D3' };
  return { decision: 'INVALID', rule: 'uncovered' };
}
