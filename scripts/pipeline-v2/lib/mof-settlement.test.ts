import { describe, it, expect } from 'vitest';
import { validateSettlementEquations } from './mof-settlement';
import type { MofBudgetItemRecord } from '../types';

function settlementRow(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'r1', fiscalYear: 2024,
    phase: 'settlement', budgetStatus: 'settled', revision: null,
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
    sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    budgetAmountYen: 1000, carryoverInYen: 0, reserveUseYen: 0, budgetRuleIncreaseYen: 0,
    reallocationYen: 0, transferAdjustmentYen: 0, currentBudgetYen: 1000,
    spentYen: 800, carryoverOutYen: 100, unusedYen: 100,
    ...overrides,
  };
}

describe('validateSettlementEquations', () => {
  it('整合する行はmismatchが0になる', () => {
    const result = validateSettlementEquations([settlementRow({})]);
    expect(result.checkedRows).toBe(1);
    expect(result.componentsToCurrentBudgetMismatches).toBe(0);
    expect(result.currentBudgetToSpentMismatches).toBe(0);
  });

  it('歳出予算額の構成要素が現額と一致しない行を検出する', () => {
    const result = validateSettlementEquations([settlementRow({ currentBudgetYen: 999 })]);
    expect(result.componentsToCurrentBudgetMismatches).toBe(1);
    expect(result.mismatchRecordIds).toContain('r1');
  });

  it('現額が支出済+繰越+不用と一致しない行を検出する', () => {
    const result = validateSettlementEquations([settlementRow({ spentYen: 700 })]);
    expect(result.currentBudgetToSpentMismatches).toBe(1);
  });

  it('決算以外のphaseは対象外', () => {
    const result = validateSettlementEquations([settlementRow({ phase: 'initial' })]);
    expect(result.checkedRows).toBe(0);
  });

  it('必須項目がnullの行はskipする', () => {
    const result = validateSettlementEquations([settlementRow({ transferAdjustmentYen: null })]);
    expect(result.skippedRows).toBe(1);
    expect(result.checkedRows).toBe(0);
  });
});
