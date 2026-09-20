/** RS 1-1（基本情報_組織情報）の正規化。Python参照実装のnormalize_organizationsと同じ。 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, sourceInventory, COMMON_COLUMNS } from './rs-common';
import type { RsOrganizationRelation, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '建制順', 'その他担当組織_作成責任者_no', '府省庁（その他担当組織）',
  '局・庁（その他担当組織）', '部（その他担当組織）', '課（その他担当組織）',
  '室（その他担当組織）', '班（その他担当組織）', '係（その他担当組織）', '作成責任者',
]);

export function normalizeOrganizations(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { rows: RsOrganizationRelation[]; sourceInventory: SourceInventory } {
  const out = rows.map((row, i) => {
    const rowNumber = i + 2;
    return {
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
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows: out, sourceInventory: sourceInventory(rawRoot, zipPath, entry, headers, rows, MAPPED, '1-1', '基本情報_組織情報', year) };
}
