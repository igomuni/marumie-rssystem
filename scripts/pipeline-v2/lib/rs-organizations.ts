/**
 * RS 1-1（基本情報_組織情報）の正規化。Python参照実装のnormalize_organizationsと同じ。
 *
 * CSV row iterator（readSingleCsvIter）→normalize generator→writeJsonlのstreaming経路。
 * 1行入力→1行出力の単純な変換のため、rows引数を1件も配列化せずgeneratorのまま
 * yieldする。source inventoryの列カウントはSourceInventoryTrackerでrecord()の
 * 副作用として集計するため、呼び出し側はrows generatorを最後まで消費した後で
 * なければ`sourceInventory()`を呼んではならない（deferred function）。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import type { RsOrganizationRelation, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '建制順', 'その他担当組織_作成責任者_no', '府省庁（その他担当組織）',
  '局・庁（その他担当組織）', '部（その他担当組織）', '課（その他担当組織）',
  '室（その他担当組織）', '班（その他担当組織）', '係（その他担当組織）', '作成責任者',
]);

export function normalizeOrganizations(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsOrganizationRelation>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsOrganizationRelation> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      yield {
        ...rsBase(row, year),
        recordType: 'rs_organization_relation' as const,
        recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsorg_'),
        additionalOrganizationNo: (row['その他担当組織_作成責任者_no'] ?? '').trim(),
        additionalMinistry: (row['府省庁（その他担当組織）'] ?? '').trim(),
        additionalBureau: (row['局・庁（その他担当組織）'] ?? '').trim(),
        additionalDepartment: (row['部（その他担当組織）'] ?? '').trim(),
        additionalDivision: (row['課（その他担当組織）'] ?? '').trim(),
        additionalOffice: (row['室（その他担当組織）'] ?? '').trim(),
        additionalTeam: (row['班（その他担当組織）'] ?? '').trim(),
        additionalUnit: (row['係（その他担当組織）'] ?? '').trim(),
        responsiblePerson: (row['作成責任者'] ?? '').trim(),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_組織情報', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '1-1', '基本情報_組織情報', year),
  };
}
