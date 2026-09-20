/**
 * RS 6-1（その他備考）の正規化。Python参照実装のnormalize_notesと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import type { RsProjectNote, SourceInventory } from '../types';

const MAPPED = new Set([...COMMON_COLUMNS, '備考']);

export function normalizeNotes(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsProjectNote>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsProjectNote> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      yield {
        ...rsBase(row, year),
        recordType: 'rs_project_note' as const,
        noteId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsnote_'),
        note: (row['備考'] ?? '').trim(),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, 'その他備考', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '6-1', 'その他備考', year),
  };
}
