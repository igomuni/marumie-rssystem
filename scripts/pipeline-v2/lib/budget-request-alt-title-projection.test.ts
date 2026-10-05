import { describe, expect, it } from 'vitest';
import { titleOfPageAlt, type AltRow } from './budget-request-alt-title-projection';

const H = 595;
const row = (i: number, y: number, ...texts: string[]): AltRow => ({ logicalRowIndex: i, physicalRowIndexes: [i], tokenIndexes: [i * 10, i * 10 + 1], texts, x: 38, y });

describe('titleOfPageAlt', () => {
  it('現行が nonblank の page は現行の出力のまま（basis は before_first_code_row）', () => {
    const r = titleOfPageAlt([row(0, 10, '文（文）', '1053'), row(1, 100, '100', '内（消）'), row(2, 120, '001', '名称')], H);
    expect(r.basis).toBe('before_first_code_row');
    expect(r.title.firstTitleNormalized).toBe('文(文)');
    expect(r.title.sourceRefs?.logicalRowIndex).toBe(0);
  });
  it('「100 内（消）」型の same-row: 最初の code row が label-shaped なら、その row を丸ごと projection し provenance を保持', () => {
    const r = titleOfPageAlt([row(0, 10, '100', '内（消）'), row(1, 60, '要求', '前年度'), row(2, 120, '001', '名称')], H);
    expect(r.basis).toBe('label_on_first_code_row');
    expect(r.title).toMatchObject({ status: 'observed_nonblank', firstTitleRaw: '100 内（消）', firstTitleNormalized: '内(消)' });
    expect(r.title.sourceRefs).toEqual({ logicalRowIndex: 0, physicalRowIndexes: [0], tokenIndexes: [0, 1] });
  });
  it('code-only row（label なし）・label が上端帯の外・label 形でない row は救済しない（blank のまま）', () => {
    expect(titleOfPageAlt([row(0, 10, '100'), row(1, 120, '001', '名称')], H)).toMatchObject({ basis: null, title: { status: 'observed_blank', blankReason: 'no_title_row' } });
    expect(titleOfPageAlt([row(0, 300, '100', '内（消）')], H).basis).toBeNull();
    expect(titleOfPageAlt([row(0, 10, '100', '要求', '前年度')], H).basis).toBeNull();
  });
  it('label-only row（code 行より前）・label なしの page は現行と同じ', () => {
    expect(titleOfPageAlt([row(0, 10, '甲（乙）'), row(1, 120, '001', '名称')], H).basis).toBe('before_first_code_row');
    expect(titleOfPageAlt([row(0, 10, '要求'), row(1, 120, '001', '名称')], H).title.status).toBe('observed_nonblank');
    expect(titleOfPageAlt([row(0, 120, '001', '名称')], H).basis).toBeNull();
  });
  it('code row より後ろの label は探索しない。同じ page の別 label は ambiguity として数える', () => {
    expect(titleOfPageAlt([row(0, 10, '100'), row(1, 20, '甲（乙）')], H).basis).toBeNull();
    const r = titleOfPageAlt([row(0, 10, '100', '内（消）'), row(1, 20, '甲（乙）')], H);
    expect(r.basis).toBe('label_on_first_code_row');
    expect(r.otherLabelRowsDifferingFromProjected).toBe(1);
  });
});
