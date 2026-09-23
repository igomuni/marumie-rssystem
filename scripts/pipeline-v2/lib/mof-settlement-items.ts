/**
 * 決算（settlement）行を itemNaturalKey 単位に集約し、予算→決算のライフサイクルを
 * 1件のレコードとして検証可能にする（Phase A: derived成果物のみ、公開JSONは変更しない）。
 *
 * 設計: docs/chats/20260923_1430_予算現額比較検証/v2_settlement_linkage_design.md
 *
 * 方針:
 * - itemNaturalKey は budget-items.jsonl の既存キー（normalize-mof.ts生成）をそのまま使い、
 *   新しいキー生成ロジックは作らない。
 * - 同一itemNaturalKeyに複数のsettlement行がある場合、どちらか一方を選ばず ambiguous として残す
 *   （合算はするが matchStatus で明示する。値を握りつぶさない）。
 * - 必須フィールドのいずれかがnull/undefinedの行が混ざるグループは、その項目をnullのまま伝播する
 *   （0で埋めない）。
 */
import type { MofBudgetItemRecord, MofAccountType } from '../types';

export interface SettlementItemRecord {
  schemaVersion: number;
  recordType: 'mof_settlement_item';
  fiscalYear: number;
  itemNaturalKey: string;
  accountType: MofAccountType;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  subItemCode: string;
  subItemName: string;

  budgetAppropriationYen: number | null;
  carryoverInYen: number | null;
  reserveUseYen: number | null;
  budgetRuleIncreaseYen: number | null;
  reallocationYen: number | null;
  transferAdjustmentYen: number | null;
  currentBudgetYen: number | null;
  spentYen: number | null;
  carryoverOutYen: number | null;
  unusedYen: number | null;

  matchStatus: 'exact' | 'ambiguous';
  candidateCount: number;
  sourceRecordIds: string[];

  equationChecked: boolean;
  componentsToCurrentBudgetMismatch: boolean;
  currentBudgetToSpentMismatch: boolean;
}

export interface SettlementItemsSummary {
  schemaVersion: number;
  fiscalYear: number;
  itemCount: number;
  exactCount: number;
  ambiguousCount: number;
  equationCheckedCount: number;
  equationSkippedCount: number;
  componentsToCurrentBudgetMismatches: number;
  currentBudgetToSpentMismatches: number;
  mismatchItemKeys: string[];
}

const REQUIRED_FIELDS: (keyof MofBudgetItemRecord)[] = [
  'budgetAmountYen', 'carryoverInYen', 'reserveUseYen', 'budgetRuleIncreaseYen',
  'reallocationYen', 'transferAdjustmentYen', 'currentBudgetYen', 'spentYen',
  'carryoverOutYen', 'unusedYen',
];

function sumField(rows: MofBudgetItemRecord[], field: keyof MofBudgetItemRecord): number | null {
  if (rows.some(r => r[field] === null || r[field] === undefined)) return null;
  return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
}

export function buildSettlementItems(items: MofBudgetItemRecord[]): { items: SettlementItemRecord[]; summary: SettlementItemsSummary } {
  const settlementRows = items.filter(r => r.phase === 'settlement');
  const groups = new Map<string, MofBudgetItemRecord[]>();
  for (const row of settlementRows) {
    const list = groups.get(row.itemNaturalKey) ?? [];
    list.push(row);
    groups.set(row.itemNaturalKey, list);
  }

  const result: SettlementItemRecord[] = [];
  let exactCount = 0;
  let ambiguousCount = 0;
  let equationCheckedCount = 0;
  let equationSkippedCount = 0;
  let componentsToCurrentBudgetMismatches = 0;
  let currentBudgetToSpentMismatches = 0;
  const mismatchItemKeys: string[] = [];

  for (const key of [...groups.keys()].sort()) {
    const rows = groups.get(key)!;
    const template = rows[0];
    const matchStatus: 'exact' | 'ambiguous' = rows.length > 1 ? 'ambiguous' : 'exact';
    if (matchStatus === 'ambiguous') ambiguousCount++; else exactCount++;

    const budgetAppropriationYen = sumField(rows, 'budgetAmountYen');
    const carryoverInYen = sumField(rows, 'carryoverInYen');
    const reserveUseYen = sumField(rows, 'reserveUseYen');
    const budgetRuleIncreaseYen = sumField(rows, 'budgetRuleIncreaseYen');
    const reallocationYen = sumField(rows, 'reallocationYen');
    const transferAdjustmentYen = sumField(rows, 'transferAdjustmentYen');
    const currentBudgetYen = sumField(rows, 'currentBudgetYen');
    const spentYen = sumField(rows, 'spentYen');
    const carryoverOutYen = sumField(rows, 'carryoverOutYen');
    const unusedYen = sumField(rows, 'unusedYen');

    const requiredAllPresent = REQUIRED_FIELDS.every(f => rows.every(r => r[f] !== null && r[f] !== undefined));
    let equationChecked = false;
    let componentsToCurrentBudgetMismatch = false;
    let currentBudgetToSpentMismatch = false;
    if (requiredAllPresent) {
      equationChecked = true;
      equationCheckedCount++;
      const lhs = (budgetAppropriationYen ?? 0) + (carryoverInYen ?? 0) + (reserveUseYen ?? 0)
        + (budgetRuleIncreaseYen ?? 0) + (reallocationYen ?? 0) + (transferAdjustmentYen ?? 0);
      componentsToCurrentBudgetMismatch = lhs !== currentBudgetYen;
      if (componentsToCurrentBudgetMismatch) componentsToCurrentBudgetMismatches++;

      const rhs = (spentYen ?? 0) + (carryoverOutYen ?? 0) + (unusedYen ?? 0);
      currentBudgetToSpentMismatch = rhs !== currentBudgetYen;
      if (currentBudgetToSpentMismatch) currentBudgetToSpentMismatches++;

      if (componentsToCurrentBudgetMismatch || currentBudgetToSpentMismatch) mismatchItemKeys.push(key);
    } else {
      equationSkippedCount++;
    }

    result.push({
      schemaVersion: 1,
      recordType: 'mof_settlement_item',
      fiscalYear: template.fiscalYear,
      itemNaturalKey: key,
      accountType: template.accountType,
      ministry: template.ministry ?? '',
      organization: template.organization ?? '',
      specialAccount: template.specialAccount ?? '',
      subAccount: template.subAccount ?? '',
      agency: template.agency ?? '',
      sectionCode: template.sectionCode ?? '',
      sectionName: template.sectionName ?? '',
      subItemCode: template.subItemCode ?? '',
      subItemName: template.subItemName ?? '',
      budgetAppropriationYen,
      carryoverInYen,
      reserveUseYen,
      budgetRuleIncreaseYen,
      reallocationYen,
      transferAdjustmentYen,
      currentBudgetYen,
      spentYen,
      carryoverOutYen,
      unusedYen,
      matchStatus,
      candidateCount: rows.length,
      sourceRecordIds: rows.map(r => r.recordId).sort(),
      equationChecked,
      componentsToCurrentBudgetMismatch,
      currentBudgetToSpentMismatch,
    });
  }

  const summary: SettlementItemsSummary = {
    schemaVersion: 1,
    fiscalYear: settlementRows[0]?.fiscalYear ?? 0,
    itemCount: result.length,
    exactCount,
    ambiguousCount,
    equationCheckedCount,
    equationSkippedCount,
    componentsToCurrentBudgetMismatches,
    currentBudgetToSpentMismatches,
    mismatchItemKeys,
  };

  return { items: result, summary };
}
