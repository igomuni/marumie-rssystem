/**
 * full-corpus baseline の集計（純関数）。FieldResolver の出力（RecordFieldResolution）を数えるだけで、値を補正・補完しない。
 * 実際の型に存在する field だけを数える。
 */
import type { FieldResolverResult, RecordFieldResolution } from './budget-request-field-resolver';

export interface SegmentSummary {
  pages: { attempted: number; processed: number };
  stageCounts: { sourceTokens: number; logicalRowCandidates: number };
  pagesWithColumnLayout: number;
  pagesWithoutColumnLayout: number;
  records: number;
  byKind: Record<string, number>;
  /** kind → name.status → 件数 */
  nameStatusByKind: Record<string, Record<string, number>>;
  /** kind → name.reasonCode（status が resolved でないもの）→ 件数 */
  nameReasonByKind: Record<string, Record<string, number>>;
  nameRawAvailableByKind: Record<string, number>;
  nameNormalizedAvailableByKind: Record<string, number>;
  /** request の親の項の status、item・request の親の組織の status */
  parentItemStatusOfRequests: Record<string, number>;
  parentOrganizationStatusByKind: Record<string, Record<string, number>>;
}

const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const incNested = (m: Record<string, Record<string, number>>, a: string, b: string) => { (m[a] ??= {}); inc(m[a], b); };

export function summarizeSegment(result: Pick<FieldResolverResult, 'records' | 'pageDiagnostics'>, pagesAttempted: number, stageCounts: { sourceTokens: number; logicalRowCandidates: number }): SegmentSummary {
  const s: SegmentSummary = {
    pages: { attempted: pagesAttempted, processed: result.pageDiagnostics.length }, stageCounts,
    pagesWithColumnLayout: result.pageDiagnostics.filter(p => p.columnLayout !== null).length,
    pagesWithoutColumnLayout: result.pageDiagnostics.filter(p => p.columnLayout === null).length,
    records: result.records.length, byKind: {}, nameStatusByKind: {}, nameReasonByKind: {}, nameRawAvailableByKind: {}, nameNormalizedAvailableByKind: {},
    parentItemStatusOfRequests: {}, parentOrganizationStatusByKind: {},
  };
  for (const r of result.records as RecordFieldResolution[]) {
    const k = r.recordKind;
    inc(s.byKind, k);
    incNested(s.nameStatusByKind, k, r.rowLocal.name.status);
    if (r.rowLocal.name.status !== 'resolved') incNested(s.nameReasonByKind, k, r.rowLocal.name.reasonCode ?? 'none');
    if (r.rowLocal.name.value) { inc(s.nameRawAvailableByKind, k); if (typeof r.rowLocal.name.value.normalized === 'string' && r.rowLocal.name.value.normalized !== '') inc(s.nameNormalizedAvailableByKind, k); }
    if (k === 'request') inc(s.parentItemStatusOfRequests, r.hierarchyDependent.parentItemAssociation.status);
    if (k === 'item' || k === 'request') incNested(s.parentOrganizationStatusByKind, k, r.hierarchyDependent.parentOrganizationAssociation.status);
  }
  return s;
}

/** 2 つの集計を加算する（PDF・省庁の合計用） */
export function addSummaries(a: SegmentSummary, b: SegmentSummary): SegmentSummary {
  const add = (x: Record<string, number>, y: Record<string, number>) => { const o = { ...x }; for (const [k, v] of Object.entries(y)) o[k] = (o[k] ?? 0) + v; return o; };
  const addN = (x: Record<string, Record<string, number>>, y: Record<string, Record<string, number>>) => { const o: Record<string, Record<string, number>> = {}; for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) o[k] = add(x[k] ?? {}, y[k] ?? {}); return o; };
  return {
    pages: { attempted: a.pages.attempted + b.pages.attempted, processed: a.pages.processed + b.pages.processed },
    stageCounts: { sourceTokens: a.stageCounts.sourceTokens + b.stageCounts.sourceTokens, logicalRowCandidates: a.stageCounts.logicalRowCandidates + b.stageCounts.logicalRowCandidates },
    pagesWithColumnLayout: a.pagesWithColumnLayout + b.pagesWithColumnLayout, pagesWithoutColumnLayout: a.pagesWithoutColumnLayout + b.pagesWithoutColumnLayout,
    records: a.records + b.records, byKind: add(a.byKind, b.byKind),
    nameStatusByKind: addN(a.nameStatusByKind, b.nameStatusByKind), nameReasonByKind: addN(a.nameReasonByKind, b.nameReasonByKind),
    nameRawAvailableByKind: add(a.nameRawAvailableByKind, b.nameRawAvailableByKind), nameNormalizedAvailableByKind: add(a.nameNormalizedAvailableByKind, b.nameNormalizedAvailableByKind),
    parentItemStatusOfRequests: add(a.parentItemStatusOfRequests, b.parentItemStatusOfRequests),
    parentOrganizationStatusByKind: addN(a.parentOrganizationStatusByKind, b.parentOrganizationStatusByKind),
  };
}

export const emptySummary = (): SegmentSummary => ({ pages: { attempted: 0, processed: 0 }, stageCounts: { sourceTokens: 0, logicalRowCandidates: 0 }, pagesWithColumnLayout: 0, pagesWithoutColumnLayout: 0, records: 0, byKind: {}, nameStatusByKind: {}, nameReasonByKind: {}, nameRawAvailableByKind: {}, nameNormalizedAvailableByKind: {}, parentItemStatusOfRequests: {}, parentOrganizationStatusByKind: {} });

export type RunStatus = 'success' | 'hard_failure' | 'exception' | 'not_runnable';

/** PDF の status: 区間がすべて success なら success、区間が無ければ not_runnable、どれかが失敗なら失敗側（hard_failure を優先） */
export function documentStatus(segmentStatuses: RunStatus[]): RunStatus {
  if (segmentStatuses.length === 0) return 'not_runnable';
  if (segmentStatuses.every(s => s === 'success')) return 'success';
  return segmentStatuses.includes('hard_failure') ? 'hard_failure' : 'exception';
}
