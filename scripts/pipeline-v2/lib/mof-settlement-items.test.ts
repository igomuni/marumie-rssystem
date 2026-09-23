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
  it('一意なitemNaturalKeyは1レコードになる', () => {
    const { items, summary } = buildSettlementItems([settlementRow({})], 2024);
    expect(items).toHaveLength(1);
    expect(items[0].sourceRecordCount).toBe(1);
    expect(items[0].currentBudgetYen).toBe(1000);
    expect(summary.multiSourceItemCount).toBe(0);
  });

  it('同一itemNaturalKeyの複数source rows（分類コード違い等の内訳行）は合算し、ambiguousとして扱わない', () => {
    const rows = [
      settlementRow({ recordId: 'r1', budgetAmountYen: 600, currentBudgetYen: 600, spentYen: 500, carryoverOutYen: 50, unusedYen: 50 }),
      settlementRow({ recordId: 'r2', budgetAmountYen: 400, currentBudgetYen: 400, spentYen: 300, carryoverOutYen: 50, unusedYen: 50 }),
    ];
    const { items, summary } = buildSettlementItems(rows, 2024);
    expect(items).toHaveLength(1);
    expect(items[0].sourceRecordCount).toBe(2);
    expect(items[0].sourceRecordIds).toEqual(['r1', 'r2']);
    expect(items[0].currentBudgetYen).toBe(1000);
    expect(items[0].equationChecked).toBe(true);
    expect(items[0].componentsToCurrentBudgetMismatch).toBe(false);
    expect(items[0].currentBudgetToSpentMismatch).toBe(false);
    expect(summary.multiSourceItemCount).toBe(1);
  });

  it('特別会計のfixtureでもaccountType/specialAccount/subAccountを保持して集約できる', () => {
    const rows = [
      settlementRow({
        recordId: 'sp1', accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興',
        itemNaturalKey: 'special-ik',
      }),
    ];
    const { items } = buildSettlementItems(rows, 2024);
    expect(items).toHaveLength(1);
    expect(items[0].accountType).toBe('special');
    expect(items[0].specialAccount).toBe('東日本大震災復興特別会計');
    expect(items[0].subAccount).toBe('復興');
  });

  it('決算以外のphaseは対象外', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ phase: 'initial' })], 2024);
    expect(items).toHaveLength(0);
    expect(summary.itemCount).toBe(0);
  });

  it('settlement行が0件でも引数のfiscalYearがsummaryに反映される（0にならない）', () => {
    const { items, summary } = buildSettlementItems([], 2025);
    expect(items).toHaveLength(0);
    expect(summary.fiscalYear).toBe(2025);
    expect(summary.itemCount).toBe(0);
  });

  it('必須項目がnullの行があるとその集計値はnullのまま伝播し、0にしない', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ transferAdjustmentYen: null })], 2024);
    expect(items[0].transferAdjustmentYen).toBeNull();
    expect(items[0].equationChecked).toBe(false);
    expect(summary.equationSkippedCount).toBe(1);
    expect(summary.equationCheckedCount).toBe(0);
  });

  it('構成要素の合計が現額と一致しない場合を検出する', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ currentBudgetYen: 999 })], 2024);
    expect(items[0].componentsToCurrentBudgetMismatch).toBe(true);
    expect(summary.componentsToCurrentBudgetMismatches).toBe(1);
    expect(summary.mismatchItemKeys).toContain('ik');
  });

  it('現額が支出済+繰越+不用と一致しない場合を検出する', () => {
    const { items, summary } = buildSettlementItems([settlementRow({ spentYen: 700 })], 2024);
    expect(items[0].currentBudgetToSpentMismatch).toBe(true);
    expect(summary.currentBudgetToSpentMismatches).toBe(1);
  });

  it('0円と欠損を区別する（0はnullにしない）', () => {
    const { items } = buildSettlementItems([settlementRow({ reserveUseYen: 0 })], 2024);
    expect(items[0].reserveUseYen).toBe(0);
    expect(items[0].reserveUseYen).not.toBeNull();
  });
});
