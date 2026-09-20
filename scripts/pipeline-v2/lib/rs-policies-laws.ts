/**
 * RS 1-3（基本情報_政策・施策、法令等）の正規化。Python参照実装のnormalize_policies_lawsと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路（rs-organizations.tsと同じ設計）。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import type { RsPolicyLawRelation, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '番号（政策・施策）', '政策所管府省庁_P', '政策', '施策', '政策・施策URL',
  '番号（根拠法令）', '法令名', '法令番号', '法令ID', '条', '項', '号・号の細分',
  '番号（関係する計画・通知等）', '計画通知名', '計画通知等URL',
]);

export function normalizePoliciesLaws(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsPolicyLawRelation>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsPolicyLawRelation> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      yield {
        ...rsBase(row, year),
        recordType: 'rs_policy_law_relation' as const,
        recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rspol_'),
        policyMeasureNo: (row['番号（政策・施策）'] ?? '').trim(),
        policyOwnerMinistry: (row['政策所管府省庁_P'] ?? '').trim(),
        policy: (row['政策'] ?? '').trim(),
        measure: (row['施策'] ?? '').trim(),
        policyMeasureUrl: (row['政策・施策URL'] ?? '').trim(),
        lawNo: (row['番号（根拠法令）'] ?? '').trim(),
        lawName: (row['法令名'] ?? '').trim(),
        lawNumber: (row['法令番号'] ?? '').trim(),
        lawId: (row['法令ID'] ?? '').trim(),
        article: (row['条'] ?? '').trim(),
        paragraph: (row['項'] ?? '').trim(),
        item: (row['号・号の細分'] ?? '').trim(),
        planNo: (row['番号（関係する計画・通知等）'] ?? '').trim(),
        planName: (row['計画通知名'] ?? '').trim(),
        planUrl: (row['計画通知等URL'] ?? '').trim(),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_政策・施策、法令等', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '1-3', '基本情報_政策・施策、法令等', year),
  };
}
