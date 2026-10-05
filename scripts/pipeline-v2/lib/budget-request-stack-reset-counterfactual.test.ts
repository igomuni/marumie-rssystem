import { describe, expect, it } from 'vitest';
import { causalClass, decideStackReset, replayStack, type ReplayNode } from './budget-request-stack-reset-counterfactual';

const n = (id: string, page: number, level: number | null, eligible = true): ReplayNode => ({ id, sourcePage: page, hierarchyEligibility: eligible ? 'candidate' : 'excluded', xIndentEvidence: { level, placed: level !== null } });
const nodes = [n('a', 1, 1), n('b', 1, 2), n('x', 2, null), n('c', 3, 2), n('d', 3, 3), n('e', 4, 2, false), n('f', 4, 2)];

describe('replayStack', () => {
  it('reset なしは通常の stack pass（親・status・祖先）', () => {
    const { edges, resetEvents } = replayStack(nodes, null);
    expect(resetEvents).toEqual([]);
    expect(edges.map(e => [e.childNodeId, e.parentNodeId, e.status])).toEqual([['a', null, 'unresolved'], ['b', 'a', 'resolved_by_indent_sequence'], ['c', 'a', 'resolved_by_indent_sequence'], ['d', 'c', 'resolved_by_indent_sequence'], ['f', 'a', 'resolved_by_indent_sequence']]);
    expect(edges.find(e => e.childNodeId === 'd')!.ancestorCandidateNodeIds).toEqual(['a']);
  });
  it('reset は開始 page 以降の最初の eligible・placed node の直前に 1 回だけ。それ以前の edge は変わらない', () => {
    const base = replayStack(nodes, null).edges, r = replayStack(nodes, 3);
    expect(r.resetEvents).toEqual([{ beforeNodeId: 'c', stackDepth: 2 }]);
    expect(r.edges.slice(0, 2)).toEqual(base.slice(0, 2));
    expect(r.edges.find(e => e.childNodeId === 'c')).toMatchObject({ parentNodeId: null, status: 'unresolved' });
    expect(r.edges.find(e => e.childNodeId === 'f')!.parentNodeId).toBe(null);
  });
  it('開始 page に node が無ければ reset は発火しない', () => {
    expect(replayStack(nodes, 99).resetEvents).toEqual([]);
  });
});

describe('causalClass / decision', () => {
  it('S0〜S5', () => {
    expect(causalClass('a', 'a', 'a')).toBe('S0');
    expect(causalClass('a', 'b', 'a')).toBe('S1');
    expect(causalClass('a', 'b', 'b')).toBe('S2');
    expect(causalClass('a', 'b', 'c')).toBe('S3');
    expect(causalClass('a', 'a', 'b')).toBe('S4');
    expect(causalClass('a', undefined, 'a')).toBe('S5');
  });
  it('判定の順序', () => {
    const c = (o: Partial<Record<'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5', number>>) => ({ S0: 0, S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, ...o });
    expect(decideStackReset({ gatesPass: false, counts: c({}), priorChanged: 0 }).decision).toBe('INVALID');
    expect(decideStackReset({ gatesPass: true, counts: c({ S1: 5, S4: 1 }), priorChanged: 5 }).rule).toBe('D4');
    expect(decideStackReset({ gatesPass: true, counts: c({ S1: 5 }), priorChanged: 5 }).rule).toBe('D1');
    expect(decideStackReset({ gatesPass: true, counts: c({ S1: 2, S2: 3 }), priorChanged: 5 }).rule).toBe('D2');
    expect(decideStackReset({ gatesPass: true, counts: c({ S2: 5 }), priorChanged: 5 }).rule).toBe('D3');
    expect(decideStackReset({ gatesPass: true, counts: c({ S3: 5 }), priorChanged: 5 }).decision).toBe('INVALID');
  });
});
