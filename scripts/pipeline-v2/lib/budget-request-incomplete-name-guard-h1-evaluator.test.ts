import { describe, expect, it } from 'vitest';
import { countLabels, decideH1 } from './budget-request-incomplete-name-guard-h1-evaluator';

// 事前登録の判定規則そのものの test（frozen GT の結果は参照しない）
describe('H1 decision rule', () => {
  it('GO: complete 0 かつ unclear 0', () => expect(decideH1({ complete: 0, unclear: 0 })).toBe('GO'));
  it('STOP: complete >= 1（unclear の有無を問わない）', () => {
    expect(decideH1({ complete: 1, unclear: 0 })).toBe('STOP');
    expect(decideH1({ complete: 1, unclear: 5 })).toBe('STOP');
  });
  it('INCONCLUSIVE: complete 0 かつ unclear >= 1', () => expect(decideH1({ complete: 0, unclear: 1 })).toBe('INCONCLUSIVE'));
  it('countLabels は件数を集計し、未知ラベルを拒否する', () => {
    expect(countLabels(['complete_on_current_logical_row', 'unclear', 'incomplete_continues_below', 'incomplete_continues_below'])).toEqual({ complete: 1, incomplete: 2, unclear: 1, decisive: 3 });
    expect(() => countLabels(['x'])).toThrow();
  });
});
