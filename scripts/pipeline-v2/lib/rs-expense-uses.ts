/**
 * RS 5-3（支出先_費目・使途）の正規化。Python参照実装のnormalize_expense_usesと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { parseNumber } from './parse';
import type { RsExpenseUse, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '支出先ブロック番号', '支出先名', '法人番号', '契約概要', '費目', '使途', '金額',
]);

export function normalizeExpenseUses(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsExpenseUse>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsExpenseUse> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const amountRaw = (row['金額'] ?? '').trim();
      yield {
        ...rsBase(row, year),
        recordType: 'rs_expense_use' as const,
        expenseUseId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsuse_'),
        blockId: (row['支出先ブロック番号'] ?? '').trim(),
        recipientName: (row['支出先名'] ?? '').trim(),
        corporateNumber: (row['法人番号'] ?? '').trim(),
        contractSummary: (row['契約概要'] ?? '').trim(),
        expenseItem: (row['費目'] ?? '').trim(),
        use: (row['使途'] ?? '').trim(),
        amountYen: parseNumber(amountRaw),
        amountRaw,
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '支出先_費目・使途', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '5-3', '支出先_費目・使途', year),
  };
}
