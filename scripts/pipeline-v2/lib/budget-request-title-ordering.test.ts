import { describe, expect, it } from 'vitest';
import { blankReasonOf, classifyOrdering, decidePhaseA, evidenceOf, type OrderRow } from './budget-request-title-ordering';

const H = 595;
const row = (index: number, y: number, ...texts: string[]): OrderRow => ({ index, x: 30, y, texts, physicalRowIndexes: [index], tokenIndexes: [index] });
const ev = (rows: OrderRow[]) => rows.map(r => evidenceOf(r, H));

describe('evidenceOf', () => {
  it('上端帯の prefix(inner) 形が label-shaped、先頭 3 桁が code-shaped。同じ row が両方でありうる', () => {
    const e = evidenceOf(row(0, 10, '100', '文（本）'), H);
    expect(e).toMatchObject({ codeShaped: true, labelShaped: true, normalized: '文(本)', shape: { prefixLength: 1, innerLength: 1 } });
    expect(evidenceOf(row(1, 300, '文（本）'), H).labelShaped).toBe(false); // 上端帯の外
    expect(evidenceOf(row(2, 10, '要求', '前年度'), H)).toMatchObject({ titleLike: true, labelShaped: false });
    expect(evidenceOf(row(3, 10, '53'), H)).toMatchObject({ codeShaped: false, titleLike: false });
  });
});

describe('classifyOrdering（排他・順序固定）', () => {
  it('label_before_code / code_before_label / same_row / neither / without', () => {
    expect(classifyOrdering(ev([row(0, 10, '文（文）', '1053'), row(1, 100, '001', '名称')])).cls).toBe('label_before_code');
    expect(classifyOrdering(ev([row(0, 10, '100'), row(1, 20, '文（本）')])).cls).toBe('code_before_label');
    expect(classifyOrdering(ev([row(0, 10, '100', '文（本）'), row(1, 100, '001', '名称')])).cls).toBe('label_and_code_same_row');
    expect(classifyOrdering(ev([row(0, 10, '要求')])).cls).toBe('neither_label_nor_code');
    expect(classifyOrdering(ev([row(0, 10, '文（文）')])).cls).toBe('label_without_code');
    expect(classifyOrdering(ev([row(0, 300, '001', '名称')])).cls).toBe('code_without_label');
  });
  it('複数 label・前後に label があれば ambiguous', () => {
    expect(classifyOrdering(ev([row(0, 10, '甲（乙）'), row(1, 20, '丙（丁）'), row(2, 300, '001', 'x')])).cls).toBe('multiple_labels_before_code');
    expect(classifyOrdering(ev([row(0, 10, '100'), row(1, 20, '甲（乙）'), row(2, 30, '丙（丁）')])).cls).toBe('multiple_labels_after_code');
    expect(classifyOrdering(ev([row(0, 5, '甲（乙）'), row(1, 10, '100'), row(2, 20, '丙（丁）')])).cls).toBe('ordering_ambiguous');
  });
});

describe('blankReasonOf と decidePhaseA', () => {
  it('優先順: unavailable > ambiguous > cutoff > unrecognized > absent', () => {
    const withLabel = ev([row(0, 10, '100', '文（本）')]);
    expect(blankReasonOf(true, 'label_and_code_same_row', withLabel)).toBe('projection_cutoff_before_label');
    expect(blankReasonOf(false, 'neither_label_nor_code', [])).toBe('unavailable');
    expect(blankReasonOf(true, 'ordering_ambiguous', withLabel)).toBe('source_order_ambiguous');
    expect(blankReasonOf(true, 'neither_label_nor_code', ev([row(0, 10, '要求')]))).toBe('label_shape_unrecognized');
    expect(blankReasonOf(true, 'neither_label_nor_code', ev([row(0, 10, '53')]))).toBe('source_label_absent');
  });
  it('判定規則 1〜4', () => {
    expect(decidePhaseA(true, 100, { projection_cutoff_before_label: 60, source_label_absent: 40 })).toEqual({ decision: 'PROJECTION_ARTIFACT_DOMINANT', rule: 2 });
    expect(decidePhaseA(true, 100, { projection_cutoff_before_label: 10, source_label_absent: 90 })).toEqual({ decision: 'SOURCE_BLANK_DOMINANT', rule: 3 });
    expect(decidePhaseA(true, 100, { projection_cutoff_before_label: 45, source_label_absent: 40, label_shape_unrecognized: 15 }).decision).toBe('MULTIPLE_SOURCE_SCHEMA_VARIANTS');
    expect(decidePhaseA(false, 100, { projection_cutoff_before_label: 90 }).decision).toBe('INCONCLUSIVE');
    expect(decidePhaseA(true, 100, { source_order_ambiguous: 60, source_label_absent: 40 }).decision).toBe('INCONCLUSIVE');
  });
});
