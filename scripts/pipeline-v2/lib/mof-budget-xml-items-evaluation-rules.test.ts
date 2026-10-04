import { describe, expect, it } from 'vitest';
import { checkSourceSetCompleteness, failClosedTestsPassed } from './mof-budget-xml-items-evaluation-rules';

describe('frozen evaluation の GO 条件（source set の完全性・test 通過）', () => {
  const targets = ['t1.xml', 't2.xml'];
  const nonTargets = ['n1.xml', 'n2.xml', 'n3.xml'];
  it('完全一致なら complete', () => {
    expect(checkSourceSetCompleteness(['n1.xml', 't1.xml', 'n2.xml', 't2.xml', 'n3.xml'], targets, nonTargets)).toMatchObject({ complete: true, localCount: 5, expectedCount: 5 });
  });
  it('non-target を 1 本欠いたら不完全（target と records が揃っていても GO にしない）', () => {
    const r = checkSourceSetCompleteness(['t1.xml', 't2.xml', 'n1.xml', 'n2.xml'], targets, nonTargets);
    expect(r.complete).toBe(false);
    expect(r.missingLocally).toEqual(['n3.xml']);
  });
  it('余剰ファイル・同数の差し替え・重複も不完全', () => {
    expect(checkSourceSetCompleteness(['t1.xml', 't2.xml', 'n1.xml', 'n2.xml', 'n3.xml', 'x.xml'], targets, nonTargets)).toMatchObject({ complete: false, unexpectedLocally: ['x.xml'] });
    expect(checkSourceSetCompleteness(['t1.xml', 't2.xml', 'n1.xml', 'n2.xml', 'x.xml'], targets, nonTargets)).toMatchObject({ complete: false, missingLocally: ['n3.xml'], unexpectedLocally: ['x.xml'] });
    expect(checkSourceSetCompleteness(['t1.xml', 't2.xml', 'n1.xml', 'n2.xml', 'n3.xml', 'n3.xml'], targets, nonTargets).complete).toBe(false);
  });
  it('test の失敗・0 件・最低件数未満は通過扱いにしない', () => {
    expect(failClosedTestsPassed({ numTotalTests: 44, numPassedTests: 44, numFailedTests: 0 }, 44)).toBe(true);
    expect(failClosedTestsPassed({ numTotalTests: 44, numPassedTests: 43, numFailedTests: 1 }, 44)).toBe(false);
    expect(failClosedTestsPassed({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 }, 44)).toBe(false);
    expect(failClosedTestsPassed({ numTotalTests: 10, numPassedTests: 10, numFailedTests: 0 }, 44)).toBe(false);
  });
});
