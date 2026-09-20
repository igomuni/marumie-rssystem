/**
 * RS 1-4（基本情報_補助率等）の正規化。Python参照実装のnormalize_subsidy_rulesと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import type { RsSubsidyRule, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '番号（補助率等）', '補助対象', '補助率', '補助上限等', '補助率URL',
]);

export function normalizeSubsidyRules(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsSubsidyRule>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsSubsidyRule> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const target = (row['補助対象'] ?? '').trim();
      const rateRaw = (row['補助率'] ?? '').trim();
      const upperLimitRaw = (row['補助上限等'] ?? '').trim();
      const url = (row['補助率URL'] ?? '').trim();
      yield {
        ...rsBase(row, year),
        recordType: 'rs_subsidy_rule' as const,
        recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rssub_'),
        ruleNo: (row['番号（補助率等）'] ?? '').trim(),
        target,
        rateRaw,
        upperLimitRaw,
        url,
        hasRule: Boolean(target || rateRaw || upperLimitRaw || url),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_補助率等', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '1-4', '基本情報_補助率等', year),
  };
}
