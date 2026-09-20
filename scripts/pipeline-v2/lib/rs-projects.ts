/**
 * RS 1-2（基本情報_事業概要等）の正規化。Python参照実装のnormalize_project_rowsと同じ。
 *
 * 1-2 CSVは1行=1レコードのsource rowだが、同一projectIdが複数行に現れることがある
 * （実データ確認: review-2025で6,061行に対し一意projectIdは5,794件）。そのため
 * source rowをそのまま「事業」として扱わず、canonical projectIdで畳んだprojects.jsonlを
 * 別に作る（Python参照実装の`_merge_projects`と同じ考え方。ただしレビューシートとの
 * マージ部分はこのPoCでは未実装で、1-2 CSV側のみを畳む）。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, sourceInventory, COMMON_COLUMNS } from './rs-common';
import { stableId } from './stable-id';
import { parseIntValue, parseBool, boolOrRaw } from './parse';
import type { RsProjectSourceRow, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '事業の目的', '現状・課題', '事業の概要', '事業概要URL', '事業区分', '事業開始年度',
  '開始年度不明', '事業終了（予定）年度', '終了予定なし', '主要経費', '備考',
  '実施方法ー直接実施', '実施方法ー補助', '実施方法ー負担', '実施方法ー交付',
  '実施方法ー分担金・拠出金', '実施方法ーその他', '旧事業番号', '整理表表示順',
]);

export function normalizeProjectRows(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { rows: RsProjectSourceRow[]; sourceInventory: SourceInventory } {
  const out = rows.map((row, i) => {
    const rowNumber = i + 2;
    return {
      ...rsBase(row, year),
      recordType: 'rs_project_source_row' as const,
      recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsproj_'),
      purpose: (row['事業の目的'] ?? '').trim(),
      currentIssues: (row['現状・課題'] ?? '').trim(),
      overview: (row['事業の概要'] ?? '').trim(),
      overviewUrl: (row['事業概要URL'] ?? '').trim(),
      projectCategory: (row['事業区分'] ?? '').trim(),
      startYear: parseIntValue(row['事業開始年度'], { noneIfBlank: true }),
      startYearUnknown: parseBool(row['開始年度不明']),
      endYear: parseIntValue(row['事業終了（予定）年度'], { noneIfBlank: true }),
      endYearRaw: (row['事業終了（予定）年度'] ?? '').trim(),
      noPlannedEnd: parseBool(row['終了予定なし']),
      majorExpense: (row['主要経費'] ?? '').trim(),
      note: (row['備考'] ?? '').trim(),
      implementationMethods: {
        direct: boolOrRaw(row['実施方法ー直接実施']),
        subsidy: boolOrRaw(row['実施方法ー補助']),
        burden: boolOrRaw(row['実施方法ー負担']),
        grant: boolOrRaw(row['実施方法ー交付']),
        contribution: boolOrRaw(row['実施方法ー分担金・拠出金']),
        other: (row['実施方法ーその他'] ?? '').trim() || null,
      },
      legacyProjectNumber: (row['旧事業番号'] ?? '').trim(),
      displayOrderRaw: (row['整理表表示順'] ?? '').trim(),
      extraFields: extraFields(row, MAPPED),
      source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '基本情報_事業概要等', year),
    };
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows: out, sourceInventory: sourceInventory(rawRoot, zipPath, entry, headers, rows, MAPPED, '1-2', '基本情報_事業概要等', year) };
}

/** canonical projectId単位の事業マスタ。Rsdataclass名は`rs_project`（source rowの`rs_project_source_row`と区別） */
export interface RsProject extends Omit<RsProjectSourceRow, 'recordType' | 'recordId' | 'source'> {
  recordType: 'rs_project';
  recordId: string;
  sources: import('../types').SourceRef[];
}

/** 同一projectIdの複数source rowを1事業へ畳む（後勝ち。Pythonのdict代入と同じ挙動） */
export function mergeProjects(sourceRows: RsProjectSourceRow[], year: number): RsProject[] {
  const byId = new Map<string, RsProject>();
  for (const row of sourceRows) {
    if (!row.projectId) continue;
    const { recordType: _recordType, recordId: _recordId, source, ...rest } = row;
    const existing = byId.get(row.projectId);
    byId.set(row.projectId, {
      ...rest,
      recordType: 'rs_project',
      recordId: stableId([year, row.projectId], 'rsproject_'),
      sources: [...(existing?.sources ?? []), source],
    });
  }
  return [...byId.values()].sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
}
