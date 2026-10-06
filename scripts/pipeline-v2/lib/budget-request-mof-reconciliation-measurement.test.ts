import { describe, expect, it } from 'vitest';
import { measureComparable, measureParentExact, parentAnchor, type RequestMeasureRow } from './budget-request-mof-reconciliation-measurement';

const row = (ownClass: RequestMeasureRow['ownClass'], parentItemClass: RequestMeasureRow['parentItemClass']): RequestMeasureRow => ({ ownClass, parentItemClass });

describe('parentAnchor', () => {
  it('ref の -p<page>-r<row> を item anchor に変換する', () => {
    expect(parentAnchor('run', 'detail-p3-r12')).toBe('run#3:12');
    expect(parentAnchor('run', null)).toBeNull();
    expect(parentAnchor('run', 'no-locator')).toBeNull();
  });
});

describe('measureParentExact（preregistration §7 の条件付き exact rate）', () => {
  it('request name resolved + 親が exact_unique → denominator に入り、exact_unique なら numerator にも入る', () => {
    const m = measureParentExact([row('exact_unique', 'exact_unique'), row('no_exact_match', 'exact_unique')]);
    expect(m).toMatchObject({ parentExactUnique: 2, numerator: 1, conditionalExactRate: 0.5 });
  });
  it('request が name_unavailable でも、親の項が exact_unique なら parentExactUnique denominator に入る', () => {
    const m = measureParentExact([row('exact_unique', 'exact_unique'), row('name_unavailable', 'exact_unique')]);
    expect(m.parentExactUnique).toBe(2);
    expect(m.nameUnavailableWithParentExact).toBe(1);
    expect(m.parentExactUniqueByOwnClass).toEqual({ exact_unique: 1, name_unavailable: 1 });
    expect(m.conditionalExactRate).toBe(0.5);
  });
  it('親が no_exact_match / ambiguous / 未解決（null）の request は denominator に入らない', () => {
    const m = measureParentExact([row('parent_unresolved', 'no_exact_match'), row('parent_unresolved', 'exact_ambiguous'), row('parent_unresolved', null), row('name_unavailable', null), row('exact_unique', 'exact_unique')]);
    expect(m.requestTotal).toBe(5);
    expect(m.parentExactUnique).toBe(1);
    expect(m.numerator).toBe(1);
    expect(m.conditionalExactRate).toBe(1);
  });
  it('親が exact_unique の request が 0 件なら rate は null', () => {
    expect(measureParentExact([row('parent_unresolved', null)]).conditionalExactRate).toBeNull();
  });
  it('numerator は parent-exact denominator の部分集合（request exact_unique で親が exact でないものは numerator に入らない）', () => {
    const m = measureParentExact([row('exact_unique', 'exact_unique'), row('exact_unique', null), row('no_exact_match', 'exact_unique')]);
    expect(m.requestExactUnique).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.numerator).toBeLessThanOrEqual(m.parentExactUnique);
  });
});

describe('measureComparable（parentExactUnique と comparableRequests を分ける）', () => {
  it('name_unavailable で親が exact_unique の request は parentExactUnique に入るが comparableRequests には入らない', () => {
    const m = measureComparable([row('exact_unique', 'exact_unique'), row('no_exact_match', 'exact_unique'), row('name_unavailable', 'exact_unique'), row('parent_unresolved', null)]);
    expect(m).toMatchObject({ parentExactUnique: 3, comparableRequests: 2, requestExactUnique: 1 });
    expect(m.exactRateWithinComparable).toBe(0.5);
    expect(m.parentExactConditionalRate).toBeCloseTo(1 / 3);
  });
  it('親が exact_unique でない request は、request 自身が exact_unique 系でも comparable に入らない', () => {
    const m = measureComparable([row('exact_unique', null), row('no_exact_match', 'no_exact_match')]);
    expect(m).toMatchObject({ parentExactUnique: 0, comparableRequests: 0, exactRateWithinComparable: null, parentExactConditionalRate: null });
  });
});
