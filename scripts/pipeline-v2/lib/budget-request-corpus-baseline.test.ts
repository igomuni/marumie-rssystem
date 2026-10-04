import { describe, expect, it } from 'vitest';
import { addSummaries, documentStatus, emptySummary, summarizeSegment } from './budget-request-corpus-baseline';

const ok = (v: string) => ({ status: 'resolved', value: { raw: v, normalized: v }, reasonCode: null });
const bad = (status: string, reason: string) => ({ status, value: null, reasonCode: reason });
const rec = (kind: string, name: unknown, parentItem: string, parentOrg: string) => ({ recordKind: kind, rowLocal: { name }, hierarchyDependent: { parentItemAssociation: { status: parentItem }, parentOrganizationAssociation: { status: parentOrg } } }) as never;

describe('summarizeSegment', () => {
  const r = summarizeSegment({
    records: [rec('request', ok('a'), 'resolved', 'resolved'), rec('request', bad('unresolved', 'column_layout_unobserved'), 'not_observed', 'not_observed'), rec('item', ok('b'), 'not_applicable', 'resolved'), rec('detail_line', ok('c'), 'not_applicable', 'not_applicable')],
    pageDiagnostics: [{ page: 1, columnLayout: {}, columnLayoutReason: null, recordCount: 2 }, { page: 2, columnLayout: null, columnLayoutReason: 'x', recordCount: 2 }] as never,
  }, 3, { sourceTokens: 100, logicalRowCandidates: 10 });
  it('record 種別・名称 status・reasonCode・名称の有無・親の status を数える（値を補完しない）', () => {
    expect(r).toMatchObject({ records: 4, byKind: { request: 2, item: 1, detail_line: 1 }, pages: { attempted: 3, processed: 2 }, pagesWithColumnLayout: 1, pagesWithoutColumnLayout: 1 });
    expect(r.nameStatusByKind.request).toEqual({ resolved: 1, unresolved: 1 });
    expect(r.nameReasonByKind.request).toEqual({ column_layout_unobserved: 1 });
    expect(r.nameRawAvailableByKind).toEqual({ request: 1, item: 1, detail_line: 1 });
    expect(r.parentItemStatusOfRequests).toEqual({ resolved: 1, not_observed: 1 });
    expect(r.parentOrganizationStatusByKind).toEqual({ request: { resolved: 1, not_observed: 1 }, item: { resolved: 1 } });
  });
  it('加算は各 field の合計で、空の集計は単位元', () => {
    const sum = addSummaries(r, r);
    expect(sum.records).toBe(8);
    expect(sum.nameStatusByKind.request).toEqual({ resolved: 2, unresolved: 2 });
    expect(addSummaries(emptySummary(), r)).toEqual(r);
  });
});

describe('documentStatus', () => {
  it('全区間 success → success、区間なし → not_runnable、失敗があれば hard_failure を優先、他は exception', () => {
    expect(documentStatus(['success', 'success'])).toBe('success');
    expect(documentStatus([])).toBe('not_runnable');
    expect(documentStatus(['success', 'exception', 'hard_failure'])).toBe('hard_failure');
    expect(documentStatus(['success', 'exception'])).toBe('exception');
  });
});
