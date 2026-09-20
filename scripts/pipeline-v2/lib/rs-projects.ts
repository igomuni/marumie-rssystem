/**
 * RS 1-2（基本情報_事業概要等）の正規化。Python参照実装のnormalize_project_rowsと同じ。
 *
 * 1-2 CSVは1行=1レコードのsource rowだが、同一projectIdが複数行に現れることがある
 * （実データ確認: review-2025で6,061行に対し一意projectIdは5,794件）。そのため
 * source rowをそのまま「事業」として扱わず、canonical projectIdで畳んだprojects.jsonlを
 * 別に作る（Python参照実装の`_merge_projects`と同じ考え方）。レビューシート
 * （rs-review-sheets.ts）とのマージもmergeProjects()内で行う。
 *
 * CSV row iterator（readSingleCsvIter）→normalize generator→writeJsonlのstreaming経路。
 * normalizeProjectRowsの出力（rows）はgeneratorのまま返す。source inventory()は
 * rows消費後にのみ正しい値を返すdeferred function（rs-organizations.tsと同じ設計）。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { normalizeText, stableId } from './stable-id';
import { parseIntValue, parseBool, boolOrRaw } from './parse';
import type { RsProjectSourceRow, RsProjectSheetConflict, RsReviewSheetRecord, SourceInventory, SourceRef } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '事業の目的', '現状・課題', '事業の概要', '事業概要URL', '事業区分', '事業開始年度',
  '開始年度不明', '事業終了（予定）年度', '終了予定なし', '主要経費', '備考',
  '実施方法ー直接実施', '実施方法ー補助', '実施方法ー負担', '実施方法ー交付',
  '実施方法ー分担金・拠出金', '実施方法ーその他', '旧事業番号', '整理表表示順',
]);

export function normalizeProjectRows(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsProjectSourceRow>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsProjectSourceRow> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      yield {
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
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '1-2', '基本情報_事業概要等', year),
  };
}

/** canonical projectId単位の事業マスタ。Rsdataclass名は`rs_project`（source rowの`rs_project_source_row`と区別） */
export interface RsProject extends Omit<RsProjectSourceRow, 'recordType' | 'recordId' | 'source'> {
  recordType: 'rs_project';
  recordId: string;
  projectIdRawVariants: string[];
  sources: SourceRef[];
  officialProjectUrl: string;
  accountClass: string;
  /** 由来（'download-csv:1-2' / 'sheets:form1' / 'sheets:form2'）を全て記録する */
  sourceKinds: string[];
}

/** レビューシートから補完する際、1-2 CSV側が空欄の場合にのみ埋めるフィールド（Python参照実装と同じ） */
const SHEET_SUPPLEMENT_FIELDS = ['projectName', 'startYear', 'endYear', 'accountClass', 'officialProjectUrl'] as const;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/**
 * 1-2 CSVの事業行とレビューシート行を同一projectIdで畳んで事業マスタを作る
 * （Python参照実装の`_merge_projects`と同じ考え方）。値が競合する場合は断定せず
 * project-sheet-conflictsとして記録し、1-2 CSV側の値を優先したまま残す。
 *
 * 参照実装との既知の相違: 参照実装は1-2側で同一projectIdが複数行に現れる場合、
 * 最後の行のsourcesで完全に上書きし、それ以前の行の証跡を失う。source-preservingの
 * 原則を優先し、TS実装ではsourcesを蓄積して全ての重複行の証跡を残す（意図的な改善）。
 */
export function mergeProjects(
  sourceRows: Iterable<RsProjectSourceRow>, sheetRows: RsReviewSheetRecord[], year: number
): { projects: RsProject[]; conflicts: RsProjectSheetConflict[] } {
  const byId = new Map<string, RsProject>();
  for (const row of sourceRows) {
    if (!row.projectId) continue;
    const { recordType: _recordType, recordId: _recordId, source, ...rest } = row;
    const existing = byId.get(row.projectId);
    byId.set(row.projectId, {
      ...rest,
      recordType: 'rs_project',
      recordId: stableId([year, row.projectId], 'rsproject_'),
      projectIdRawVariants: [...new Set([...(existing?.projectIdRawVariants ?? []), row.projectIdRaw])],
      sources: [...(existing?.sources ?? []), source],
      officialProjectUrl: existing?.officialProjectUrl ?? '',
      accountClass: existing?.accountClass ?? '',
      sourceKinds: [...(existing?.sourceKinds ?? []), 'download-csv:1-2'],
    });
  }

  const conflicts: RsProjectSheetConflict[] = [];
  for (const s of sheetRows) {
    const pid = s.projectId;
    if (!pid) continue;
    const existing = byId.get(pid);
    if (!existing) {
      byId.set(pid, {
        schemaVersion: 2,
        sourceSystem: 'rs',
        sourceYear: year,
        reviewYear: year,
        recordType: 'rs_project',
        recordId: stableId([year, pid], 'rsproject_'),
        sheetType: '',
        projectId: pid,
        projectIdRaw: s.projectIdRaw,
        projectIdRawVariants: [s.projectIdRaw],
        projectName: s.projectName,
        policyMinistry: '',
        ministry: s.ministryFromFile,
        bureau: '',
        department: '',
        division: s.responsibleOffice,
        office: '',
        team: '',
        unit: '',
        ministryOrderRaw: '',
        purpose: '',
        currentIssues: '',
        overview: '',
        overviewUrl: '',
        projectCategory: s.projectCategory,
        startYear: 'startYear' in s ? s.startYear : null,
        startYearUnknown: null,
        endYear: 'endYear' in s ? s.endYear : null,
        endYearRaw: 'endYearRaw' in s ? s.endYearRaw : '',
        noPlannedEnd: null,
        majorExpense: '',
        note: '',
        // 1-2側の実データが無いため確定情報が無い旨を明示する（参照実装は空dict {} を使うが、
        // TS側は型安全のため全フィールドnullの形で同じ意味を表す）
        implementationMethods: { direct: null, subsidy: null, burden: null, grant: null, contribution: null, other: null },
        legacyProjectNumber: '',
        displayOrderRaw: '',
        extraFields: {},
        officialProjectUrl: s.officialProjectUrl,
        accountClass: s.accountClass,
        sources: [s.source],
        sourceKinds: [`sheets:${s.sheetForm}`],
      });
      continue;
    }
    existing.sources.push(s.source);
    existing.sourceKinds.push(`sheets:${s.sheetForm}`);
    if (s.projectIdRaw && !existing.projectIdRawVariants.includes(s.projectIdRaw)) existing.projectIdRawVariants.push(s.projectIdRaw);

    const sheetValues: Record<string, unknown> = {
      projectName: s.projectName,
      startYear: 'startYear' in s ? s.startYear : undefined,
      endYear: 'endYear' in s ? s.endYear : undefined,
      accountClass: s.accountClass,
      officialProjectUrl: s.officialProjectUrl,
    };
    for (const field of SHEET_SUPPLEMENT_FIELDS) {
      const sv = sheetValues[field];
      if (isBlank(sv)) continue;
      const record = existing as unknown as Record<string, unknown>;
      const pv = record[field];
      if (isBlank(pv)) {
        record[field] = sv;
      } else if (normalizeText(String(pv)) !== normalizeText(String(sv))) {
        conflicts.push({ sourceYear: year, projectId: pid, field, downloadValue: pv, sheetValue: sv, sheetRecordId: s.recordId });
      }
    }
  }

  return {
    projects: [...byId.values()].sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0)),
    conflicts,
  };
}
