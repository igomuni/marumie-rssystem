/** RS 1-1（基本情報_組織情報）の正規化。Python参照実装のnormalize_organizationsと同じ。 */
import { rsBase, rsSourceRef, rsRecordId } from './rs-common';
import type { RsOrganizationRelation } from '../types';

export function normalizeOrganizations(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): RsOrganizationRelation[] {
  return rows.map((row, i) => {
    const rowNumber = i + 2;
    return {
      ...rsBase(row, year),
      recordType: 'rs_organization_relation',
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
      source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_組織情報', year),
    };
  });
}
