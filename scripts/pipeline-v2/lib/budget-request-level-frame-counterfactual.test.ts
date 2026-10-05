import { describe, expect, it } from 'vitest';
import { assignToFrame, decideLevelFrame, replayStackAtNode, transitionClass, type TransitionClass } from './budget-request-level-frame-counterfactual';
import { replayStack, type ReplayNode } from './budget-request-stack-reset-counterfactual';

const n = (id: string, page: number, level: number | null, eligible = true): ReplayNode => ({ id, sourcePage: page, hierarchyEligibility: eligible ? 'candidate' : 'excluded', xIndentEvidence: { level, placed: level !== null } });
const r = (o: Partial<Record<TransitionClass, number>>) => ({ R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, ...o });

describe('assignToFrame', () => {
  const frame = [{ clusterIndex: 0, xMin: 10, xMax: 12, level: 1 }, { clusterIndex: 1, xMin: 20, xMax: 22, level: null }];
  it('範囲内は first match、範囲外は null（近傍割当てなし）', () => {
    expect(assignToFrame(11, frame)?.clusterIndex).toBe(0);
    expect(assignToFrame(21, frame)?.level).toBe(null);
    expect(assignToFrame(15, frame)).toBeNull();
  });
});
describe('replayStackAtNode', () => {
  const nodes = [n('a', 1, 1), n('b', 1, 2), n('c', 2, 2), n('d', 2, 3)];
  it('locator が placed なら replayStack の page 指定と一致', () => {
    expect(replayStackAtNode(nodes, 'c')).toEqual(replayStack(nodes, 2));
    expect(replayStackAtNode(nodes, null)).toEqual(replayStack(nodes, null));
  });
  it('locator が unplaced でも reset の位置は変わらず 1 回', () => {
    const m = [n('a', 1, 1), n('b', 1, 2), n('c', 2, null), n('d', 2, 2)];
    const out = replayStackAtNode(m, 'c');
    expect(out.resetEvents).toEqual([{ beforeNodeId: 'c', stackDepth: 2 }]);
    expect(out.edges.find(e => e.childNodeId === 'd')).toMatchObject({ parentNodeId: null });
  });
});
describe('transitionClass', () => {
  it('R0〜R5', () => {
    expect(transitionClass('a', 'a', 'a')).toBe('R0');
    expect(transitionClass('a', 'b', 'a')).toBe('R1');
    expect(transitionClass('a', 'b', 'b')).toBe('R2');
    expect(transitionClass('a', 'b', 'c')).toBe('R3');
    expect(transitionClass('a', 'a', 'b')).toBe('R4');
    expect(transitionClass('a', 'b', 'a', true)).toBe('R5');
    expect(transitionClass('a', undefined, 'a')).toBe('R5');
  });
});
describe('decideLevelFrame routing（synthetic）', () => {
  const d = (g: boolean, o: Partial<Record<TransitionClass, number>>) => decideLevelFrame({ gatesPass: g, r: r(o) }).rule;
  it('各 decision へ routing し、網羅漏れが無い', () => {
    expect(d(true, { R1: 5 })).toBe('D1');
    expect(d(true, { R1: 3, R2: 2 })).toBe('D2');
    expect(d(true, { R1: 3, R3: 1 })).toBe('D2');
    expect(d(true, { R2: 5 })).toBe('D3');
    expect(d(true, { R4: 1, R1: 3 })).toBe('D4');
    expect(d(true, { R5: 2, R1: 3 })).toBe('D5');
    expect(d(true, { R4: 1, R5: 1 })).toBe('D4');
    expect(d(true, { R3: 4 })).toBe('D6');
    expect(d(true, { R3: 4, R2: 2 })).toBe('D6');
    expect(d(true, { R0: 9 })).toBe('D0');
    expect(d(false, { R1: 5 })).toBe('gate');
    // R1 = 0 の全ての R2/R3 組合せ、R1 > 0 の全組合せに rule が割り当たる（uncovered 無し）
    for (const R1 of [0, 1]) for (const R2 of [0, 1]) for (const R3 of [0, 1]) expect(d(true, { R1, R2, R3 })).not.toBe('uncovered');
  });
});
