/**
 * 決算（settlement）行の検算。実データでの回帰チェック用（PID:4等の未解決差分と区別する）。
 *
 * 一般会計・特別会計:
 *   歳出予算額 + 前年度繰越額 + 予備費使用額 + 予算総則の規定による経費増額 + 流用等増△減額
 *     + 予算決定後移替増△減額 = 歳出予算現額
 *   歳出予算現額 = 支出済歳出額 + 翌年度繰越額 + 不用額
 * 政府関係機関は移替の概念が無くtransferAdjustmentYenは常に0（normalize-mof.ts参照）。
 */
import type { MofBudgetItemRecord } from '../types';

export interface SettlementEquationSummary {
  checkedRows: number;
  skippedRows: number;
  componentsToCurrentBudgetMismatches: number;
  currentBudgetToSpentMismatches: number;
  mismatchRecordIds: string[];
}

const REQUIRED_FIELDS: (keyof MofBudgetItemRecord)[] = [
  'budgetAmountYen', 'carryoverInYen', 'reserveUseYen', 'budgetRuleIncreaseYen',
  'reallocationYen', 'transferAdjustmentYen', 'currentBudgetYen', 'spentYen',
  'carryoverOutYen', 'unusedYen',
];

export function validateSettlementEquations(items: MofBudgetItemRecord[]): SettlementEquationSummary {
  const settlementRows = items.filter(r => r.phase === 'settlement');
  let checkedRows = 0;
  let skippedRows = 0;
  let componentsToCurrentBudgetMismatches = 0;
  let currentBudgetToSpentMismatches = 0;
  const mismatchRecordIds: string[] = [];

  for (const row of settlementRows) {
    if (REQUIRED_FIELDS.some(f => row[f] === null || row[f] === undefined)) { skippedRows++; continue; }
    checkedRows++;
    const lhs = (row.budgetAmountYen ?? 0) + (row.carryoverInYen ?? 0) + (row.reserveUseYen ?? 0)
      + (row.budgetRuleIncreaseYen ?? 0) + (row.reallocationYen ?? 0) + (row.transferAdjustmentYen ?? 0);
    const componentsMismatch = lhs !== row.currentBudgetYen;
    if (componentsMismatch) componentsToCurrentBudgetMismatches++;

    const rhs = (row.spentYen ?? 0) + (row.carryoverOutYen ?? 0) + (row.unusedYen ?? 0);
    const currentMismatch = rhs !== row.currentBudgetYen;
    if (currentMismatch) currentBudgetToSpentMismatches++;

    if (componentsMismatch || currentMismatch) mismatchRecordIds.push(row.recordId);
  }

  return { checkedRows, skippedRows, componentsToCurrentBudgetMismatches, currentBudgetToSpentMismatches, mismatchRecordIds };
}
