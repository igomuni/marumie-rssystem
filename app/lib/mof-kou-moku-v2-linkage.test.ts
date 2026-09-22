import { describe, expect, it } from 'vitest';
import { aggregateRsProjectAmounts } from './mof-kou-moku-v2-linkage';

describe('aggregateRsProjectAmounts', () => {
  it('preserves signed 2-2 amounts when aggregating by project', () => {
    const actual = aggregateRsProjectAmounts([
      { projectId: 'A', budgetAmountYen: 120 },
      { projectId: 'A', budgetAmountYen: -20 },
      { projectId: 'B', budgetAmountYen: -30 },
    ]);

    expect(actual.get('A')).toBe(100);
    expect(actual.get('B')).toBe(-30);
    expect([...actual.values()].reduce((sum, amount) => sum + amount, 0)).toBe(70);
  });
});
