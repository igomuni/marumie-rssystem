import { describe, it, expect } from 'vitest';
import { buildSettlementItems } from './mof-settlement-items';
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

describe('buildSettlementItems', () => {
  it('一意なitemNaturalKeyはexactとして1レコードになる', () => {
    const { items, summary } = buildSettlementItems([settlementRow({})]);
    expect(items).toHaveLength(1);
    expect(items[0].matchStatus).toBe('exact');
    expect(items[0].candidateCount).toBe(1);
    expect(items[0].currentBudgetYen).toBe(1000);
    expect(summary.exactCount).toBe(1);
    expect(summary.ambiguousCount).toBe(0);
  });

  it('同一itemNaturalKeyが複数行あるとambiguousとして合算し、勝手に1件へ絞らない', () => {
    const rows = [
      settlementRow({ recordId: 'r1', budgetAmountYen: 600, currentBudgetYen: 600, spentYen: 500, carryoverOutYen: 50, unusedYen: 50 }),
      settlementRow({ recordId: 'r2', budgetAmountYen: 400, currentBudgetYen: 400, spentYen: 300, carryoverOutYen: 50, unusedYen: 50 }),
    ];
    const { items, summary } = buildSettlementItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0].matchStatus).toBe('ambiguous');
    expect(items[0].candidateCount).toBe(2);
    expect(items[0].sourceRecordIds).toEqual(['r1', 'r2']);
    expect(items[0].currentBudgetYen).toBe(1000);
    expect(summary.ambiguousCount).toBe(1);
  });

  it('決算以外のphaseは対象外', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ phase: 'initial' })]);
    expect(items).toHaveLength(0);
    expect(summary.itemCount).toBe(0);
  });

  it('必須項目がnullの行があるとその集計値はnullのまま伝播し、0にしない', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ transferAdjustmentYen: null })]);
    expect(items[0].transferAdjustmentYen).toBeNull();
    expect(items[0].equationChecked).toBe(false);
    expect(summary.equationSkippedCount).toBe(1);
    expect(summary.equationCheckedCount).toBe(0);
  });

  it('構成要素の合計が現額と一致しない場合を検出する', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ currentBudgetYen: 999 })]);
    expect(items[0].componentsToCurrentBudgetMismatch).toBe(true);
    expect(summary.componentsToCurrentBudgetMismatches).toBe(1);
    expect(summary.mismatchItemKeys).toContain('ik');
  });

  it('現額が支出済+繰越+不用と一致しない場合を検出する', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ spentYen: 700 })]);
    expect(items[0].currentBudgetToSpentMismatch).toBe(true);
    expect(summary.currentBudgetToSpentMismatches).toBe(1);
  });

  it('0円と欠損を区別する（0はnullにしない）', () => {
    const { items } = buildSettlementItems([settlementRow({ reserveUseYen: 0 })]);
    expect(items[0].reserveUseYen).toBe(0);
    expect(items[0].reserveUseYen).not.toBeNull();
  });
});
