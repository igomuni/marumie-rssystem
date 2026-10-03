import { describe, expect, it } from 'vitest';
import { guardMetrics, judge, type GuardMetrics, type UnitOutcome, type VerdictInput } from './budget-request-incomplete-name-guard-evaluator';

const o = (gt: UnitOutcome['visualGt'], fired: boolean, after: string): UnitOutcome => ({ unitId: 'u', visualGt: gt, stratum: 'G', beforeStatus: 'resolved', beforeNameMatchesFrozenBaseline: true, guardFired: fired, afterStatus: after, reasonCode: null, note: '' });
const inc = 'incomplete_continues_below' as const;
const comp = 'complete_on_current_logical_row' as const;

describe('guard metrics', () => {
  it('混同行列: safety catch / false-resolved incomplete / FAC / preserved complete', () => {
    const m = guardMetrics([o(inc, true, 'ambiguous'), o(inc, true, 'ambiguous'), o(inc, false, 'resolved'), o(comp, true, 'ambiguous'), o(comp, false, 'resolved'), o(comp, false, 'resolved'), o('unclear', true, 'ambiguous')]);
    expect(m).toMatchObject({ safetyCatches: 2, falseResolvedIncomplete: 1, falseAbstainedComplete: 1, preservedComplete: 2, incomplete: 3, complete: 3, unclear: 1, fired: 4, firedDecisive: 3 });
    expect(m.facRate).toBeCloseTo(1 / 3, 3);
  });
});

const base = (m: Partial<GuardMetrics>): VerdictInput => ({
  metrics: { falseResolvedIncomplete: 0, safetyCatches: 20, falseAbstainedComplete: 0, preservedComplete: 16, incomplete: 27, complete: 16, unclear: 0, fired: 20, firedDecisive: 20, facRate: 0, guardPrecision: 1, guardRecall: 1, ...m },
  knownFailuresFalseResolved: 0, firedCompleteInGStratum: { complete: 5 },
  differential: { records: 10, fired: 3, nonNameDifferences: 0, unexpectedNameChanges: 0 },
  goldenOutcomeChanges: 0, goldenOnSafety: { falseResolved: 0, wrongSource: 0, wrongNormalization: 0 },
  heldoutOnSafety: { wrongSource: 0, wrongNormalization: 0, blankAsZero: 0, zeroAsBlank: 0 }, beforeMismatches: 0,
});

describe('GO / STOP（事前登録の数値基準の機械的な適用）', () => {
  it('全て満たせば GO。G 層の complete が 3 件未満なら GO-WITH-SCOPE', () => {
    expect(judge(base({})).verdict).toBe('GO');
    expect(judge({ ...base({}), firedCompleteInGStratum: { complete: 2 } }).verdict).toBe('GO-WITH-SCOPE');
  });
  it('safety: FRI > 2 または incomplete の 10% 超、known failure が残れば STOP', () => {
    expect(judge(base({ falseResolvedIncomplete: 3 })).verdict).toBe('STOP');
    expect(judge(base({ falseResolvedIncomplete: 2 })).verdict).toBe('GO'); // 2 ≤ 2 かつ 27 の 10%（2.7）以下。known failure が残らなければ許容
    expect(judge({ ...base({}), knownFailuresFalseResolved: 1 }).verdict).toBe('STOP');
  });
  it('regression: FAC は 2 件以下かつ発火数の 10% 以下', () => {
    expect(judge(base({ falseAbstainedComplete: 2, firedDecisive: 20 })).verdict).toBe('GO');
    expect(judge(base({ falseAbstainedComplete: 2, firedDecisive: 19 })).verdict).toBe('STOP');
    expect(judge(base({ falseAbstainedComplete: 3, firedDecisive: 40 })).verdict).toBe('STOP');
  });
  it('invariant の違反・identity の不一致は STOP。incomplete が 10 件未満なら NON-INFORMATIVE', () => {
    expect(judge({ ...base({}), differential: { records: 1, fired: 1, nonNameDifferences: 1, unexpectedNameChanges: 0 } }).verdict).toBe('STOP');
    expect(judge({ ...base({}), goldenOutcomeChanges: 1 }).verdict).toBe('STOP');
    expect(judge({ ...base({}), beforeMismatches: 1 }).verdict).toBe('STOP');
    expect(judge(base({ incomplete: 5 })).verdict).toBe('NON-INFORMATIVE');
  });
});
