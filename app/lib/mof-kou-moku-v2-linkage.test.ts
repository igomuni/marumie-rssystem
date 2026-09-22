import { describe, expect, it } from 'vitest';
import {
  aggregateRsProjectAmounts,
  countV2IdentityProjectsByKouMoku,
  groupV2SettlementIdentityByKey,
} from './mof-kou-moku-v2-linkage';

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

describe('settlement identity projection helpers', () => {
  it('counts distinct inherited RS projects per settlement kouMokuKey', () => {
    const relations = [
      {
        relationId: 'r1', relationKind: 'inherited-from-budget-link' as const,
        reviewYear: 2025, fiscalYear: 2025, kouMokuKey: 'settlement-key',
        itemNaturalKey: 'item-1', projectIds: ['100', '200'], projects: [],
      },
      {
        relationId: 'r2', relationKind: 'inherited-from-budget-link' as const,
        reviewYear: 2025, fiscalYear: 2025, kouMokuKey: 'settlement-key',
        itemNaturalKey: 'item-2', projectIds: ['200', '300'], projects: [],
      },
    ];

    expect(countV2IdentityProjectsByKouMoku(groupV2SettlementIdentityByKey(relations)).get('settlement-key')).toBe(3);
  });
});
