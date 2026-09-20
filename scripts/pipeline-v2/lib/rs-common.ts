/**
 * RS CSV正規化の共通基盤。Python参照実装 pipeline_v2/normalize_rs.py の
 * _base/_extra_fields/_source/_record_id と同じロジック。
 */
import * as path from 'path';
import * as crypto from 'crypto';
import { stableId } from './stable-id';
import { canonicalProjectId } from './parse';
import type { SourceRef, SourceInventory } from '../types';

export const COMMON_COLUMNS = new Set([
  'シート種別', '事業年度', '予算事業ID', '事業名', '府省庁の建制順',
  '政策所管府省庁', '所管府省庁', '府省庁', '局・庁', '部', '課', '室', '班', '係',
]);

export interface RsBaseFields {
  schemaVersion: number;
  sourceSystem: 'rs';
  sourceYear: number;
  reviewYear: number;
  sheetType: string;
  projectId: string;
  projectIdRaw: string;
  projectName: string;
  policyMinistry: string;
  ministry: string;
  bureau: string;
  department: string;
  division: string;
  office: string;
  team: string;
  unit: string;
  ministryOrderRaw: string;
}

function clean(v: string | undefined): string {
  return (v ?? '').trim();
}

/** 全RSレコードに共通する事業マスタ・組織情報のベース部分 */
export function rsBase(row: Record<string, string>, sourceYear: number): RsBaseFields {
  const rawId = clean(row['予算事業ID']);
  return {
    schemaVersion: 2,
    sourceSystem: 'rs',
    sourceYear,
    reviewYear: sourceYear,
    sheetType: clean(row['シート種別']),
    projectId: canonicalProjectId(rawId),
    projectIdRaw: rawId,
    projectName: clean(row['事業名']),
    policyMinistry: clean(row['政策所管府省庁'] || row['所管府省庁']),
    ministry: clean(row['府省庁']),
    bureau: clean(row['局・庁']),
    department: clean(row['部']),
    division: clean(row['課']),
    office: clean(row['室']),
    team: clean(row['班']),
    unit: clean(row['係']),
    ministryOrderRaw: clean(row['府省庁の建制順'] || row['建制順']),
  };
}

/** mapped以外の非空列を保持する（将来の列追加で情報が消えないように） */
export function extraFields(row: Record<string, string>, mapped: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (mapped.has(k)) continue;
    const cleaned = clean(v);
    if (cleaned) out[k] = cleaned;
  }
  return out;
}

export function rsSourceRef(rawRoot: string, filePath: string, entry: string | null, rowNumber: number | null, dataset: string, year: number): SourceRef {
  const ref: SourceRef = {
    domain: 'rssystem.go.jp',
    path: path.relative(rawRoot, filePath).split(path.sep).join('/'),
    file: path.basename(filePath),
    dataset,
    year,
  };
  if (entry) ref.zipEntry = entry;
  if (rowNumber !== null) ref.rowNumber = rowNumber;
  return ref;
}

export function rsRecordId(rawRoot: string, filePath: string, entry: string | null, rowNumber: number, prefix: string): string {
  return stableId([path.relative(rawRoot, filePath).split(path.sep).join('/'), entry ?? '', rowNumber], prefix);
}

/**
 * 列単位の突合監査（mapped/extra_preserved/empty_unmapped）とヘッダーのSHA-256を作る。
 * 非空の未マップ列（extra_preserved）はextraFieldsで値自体は保持されるが、この一覧により
 * 「将来列が追加/リネームされたときにmanifest/validationで検知できる」ことを目的とする。
 * Python参照実装 pipeline_v2/normalize_rs.py の_source_inventoryと同じ。
 */
export function sourceInventory(
  rawRoot: string, filePath: string, entry: string, headers: string[], rows: Record<string, string>[],
  mapped: Set<string>, datasetCode: string, datasetName: string, year: number
): SourceInventory {
  const counts = new Map<string, number>(headers.map(h => [h, 0]));
  for (const row of rows) {
    for (const h of headers) {
      if ((row[h] ?? '').trim()) counts.set(h, (counts.get(h) ?? 0) + 1);
    }
  }
  const columns: SourceInventory['columns'] = headers.map(h => {
    const nonEmptyCount = counts.get(h) ?? 0;
    const status: SourceInventory['columns'][number]['status'] = mapped.has(h) ? 'mapped' : nonEmptyCount ? 'extra_preserved' : 'empty_unmapped';
    return { column: h, nonEmptyCount, status };
  });
  const headerSha256 = crypto.createHash('sha256').update(JSON.stringify(headers)).digest('hex');
  return {
    datasetCode,
    datasetName,
    sourceYear: year,
    path: path.relative(rawRoot, filePath).split(path.sep).join('/'),
    zipEntry: entry,
    rowCount: rows.length,
    columnCount: headers.length,
    headerSha256,
    columns,
  };
}

/**
 * sourceInventory()の1行ずつ計上できる版。CSV row iterator→normalize generator→
 * writeJsonlのstreaming経路（1-1/1-2/2-2）では入力行配列を保持しないため、
 * 列ごとの非空件数をrecord()の副作用として集計し、generatorを最後まで
 * 消費し終えたあとにfinish()で確定させる。
 */
export class SourceInventoryTracker {
  private readonly counts: Map<string, number>;
  private rowCount = 0;

  constructor(private readonly headers: string[]) {
    this.counts = new Map(headers.map(h => [h, 0]));
  }

  record(row: Record<string, string>): void {
    this.rowCount++;
    for (const h of this.headers) {
      if ((row[h] ?? '').trim()) this.counts.set(h, (this.counts.get(h) ?? 0) + 1);
    }
  }

  finish(
    rawRoot: string, filePath: string, entry: string,
    mapped: Set<string>, datasetCode: string, datasetName: string, year: number
  ): SourceInventory {
    const columns: SourceInventory['columns'] = this.headers.map(h => {
      const nonEmptyCount = this.counts.get(h) ?? 0;
      const status: SourceInventory['columns'][number]['status'] = mapped.has(h) ? 'mapped' : nonEmptyCount ? 'extra_preserved' : 'empty_unmapped';
      return { column: h, nonEmptyCount, status };
    });
    const headerSha256 = crypto.createHash('sha256').update(JSON.stringify(this.headers)).digest('hex');
    return {
      datasetCode,
      datasetName,
      sourceYear: year,
      path: path.relative(rawRoot, filePath).split(path.sep).join('/'),
      zipEntry: entry,
      rowCount: this.rowCount,
      columnCount: this.headers.length,
      headerSha256,
      columns,
    };
  }
}
