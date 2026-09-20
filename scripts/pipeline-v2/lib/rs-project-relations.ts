/**
 * RS 1-5（基本情報_関連事業）の正規化。Python参照実装のnormalize_project_relationsと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { canonicalProjectId } from './parse';
import type { RsProjectRelation, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '番号（関連事業）', '関連事業の事業ID', '関連事業の事業名', '関連性',
]);

export function normalizeProjectRelations(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsProjectRelation>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsProjectRelation> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const relatedProjectIdRaw = (row['関連事業の事業ID'] ?? '').trim();
      const relatedProjectName = (row['関連事業の事業名'] ?? '').trim();
      const relationTypeRaw = (row['関連性'] ?? '').trim();
      yield {
        ...rsBase(row, year),
        recordType: 'rs_project_relation' as const,
        recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsprrel_'),
        relationNo: (row['番号（関連事業）'] ?? '').trim(),
        relatedProjectId: canonicalProjectId(relatedProjectIdRaw),
        relatedProjectIdRaw,
        relatedProjectName,
        relationTypeRaw,
        hasRelation: Boolean(relatedProjectIdRaw || relatedProjectName || relationTypeRaw),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_関連事業', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '1-5', '基本情報_関連事業', year),
  };
}
