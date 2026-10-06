import { describe, expect, it } from 'vitest';
import { decideIsolation, itemTransitions, joinOnOff, kindMatrix, nameStatusTransitions, parentState, requestParentTransitions, type IsolationFacts, type PairRecord } from './budget-request-hierarchy-paired';

const rec = (page: number, row: number, kind: string, o: { name?: [string, string | null]; parent?: { status: string; ref?: string } } = {}): PairRecord => ({
  anchor: { page, logicalRowIndex: row }, recordKind: kind,
  rowLocal: { name: { status: o.name?.[0] ?? 'resolved', reasonCode: o.name?.[1] ?? null } },
  hierarchyDependent: { parentItemAssociation: { status: o.parent?.status ?? 'not_applicable', value: o.parent?.ref ? { parentNodeRef: o.parent.ref } : null, reasonCode: null } },
});

describe('joinOnOff', () => {
  it('anchor で 1 対 1 に join し、対応しないもの・重複は推測せず別に返す', () => {
    const j = joinOnOff([rec(1, 1, 'item'), rec(1, 2, 'request'), rec(1, 3, 'request'), rec(1, 3, 'request')], [rec(1, 1, 'unclassified'), rec(1, 2, 'request'), rec(1, 9, 'request')]);
    expect(j.pairs.map(p => p.key)).toEqual(['1:1', '1:2']);
    expect(j.unjoinableOn).toEqual(['1:3']);
    expect(j.unjoinableOff).toEqual(['1:9']);
    expect(j.duplicateOn).toEqual(['1:3']);
  });
});

describe('transitions', () => {
  const on = [rec(1, 1, 'organization'), rec(1, 2, 'item'), rec(1, 3, 'request', { parent: { status: 'resolved', ref: 'detail-p1-r2' } }), rec(1, 4, 'request', { parent: { status: 'resolved', ref: 'detail-p1-r1' }, name: ['unresolved', 'column_layout_unobserved'] }), rec(1, 5, 'item')];
  const off = [rec(1, 1, 'unclassified'), rec(1, 2, 'unclassified'), rec(1, 3, 'request', { parent: { status: 'not_observed' } }), rec(1, 4, 'request', { parent: { status: 'not_observed' }, name: ['unresolved', 'column_layout_unobserved'] })];
  const j = joinOnOff(on, off);
  it('recordKind の遷移行列と item の遷移（join 不能は別枠）', () => {
    const m = kindMatrix(j.pairs);
    expect(m.organization.unclassified).toBe(1);
    expect(m.item.unclassified).toBe(1);
    expect(m.request.request).toBe(2);
    expect(itemTransitions(j, on)).toEqual({ off_unclassified: 1, off_missing_unjoinable: 1 });
  });
  it('request の親の項: ON が resolved_item / resolved_non_item で OFF が not_observed になる遷移を数える', () => {
    expect(parentState(on[2], new Map(on.map(r => [`${r.anchor.page}:${r.anchor.logicalRowIndex}`, r])))).toBe('resolved_item');
    expect(requestParentTransitions(j, on, off)).toEqual({ 'resolved_item→not_observed': 1, 'resolved_non_item→not_observed': 1 });
  });
  it('名称 status の変化: 変わらない unit と変わった unit を分ける', () => {
    expect(nameStatusTransitions(j.pairs)).toMatchObject({ unchanged: 4, changed: {}, byReasonUnchanged: { 'resolved/none': 3, 'unresolved/column_layout_unobserved': 1 } });
    const o2 = [rec(1, 1, 'unclassified', { name: ['unresolved', 'no_name_token'] })];
    expect(nameStatusTransitions(joinOnOff([rec(1, 1, 'item')], o2).pairs).changed).toEqual({ 'resolved/none→unresolved/no_name_token': 1 });
  });
});

describe('decideIsolation（事前登録の判定規則）', () => {
  const base: IsolationFacts = { controlMatched: true, unjoinable: 0, duplicates: 0, pageSetsEqual: true, offRunFailed: false, pairedPdfs: 8, publishers: 6, I: 10, R: 0, X: 100, Y: 20, P: 5, Con: 8, Coff: 0, pdfsWithI: 3, publishersWithI: 3, pdfsWithP: 3, publishersWithP: 3 };
  it('規則 1〜4 を順に適用する', () => {
    expect(decideIsolation(base)).toEqual({ decision: 'HIERARCHY_MAJOR_CAUSAL_FACTOR', rule: 3 });
    expect(decideIsolation({ ...base, controlMatched: false }).decision).toBe('INCONCLUSIVE');
    expect(decideIsolation({ ...base, unjoinable: 1 }).decision).toBe('INCONCLUSIVE');
    expect(decideIsolation({ ...base, pairedPdfs: 1 }).decision).toBe('INCONCLUSIVE');
    expect(decideIsolation({ ...base, I: 0, X: 0 })).toEqual({ decision: 'HIERARCHY_NOT_PRIMARY', rule: 2 });
    expect(decideIsolation({ ...base, X: 10 }).decision).toBe('HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT');
    expect(decideIsolation({ ...base, pdfsWithI: 1 }).decision).toBe('HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT');
    expect(decideIsolation({ ...base, Con: 3, Coff: 3 }).decision).toBe('HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT');
    expect(decideIsolation({ ...base, I: 1, R: 5 }).decision).toBe('HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT');
  });
});
