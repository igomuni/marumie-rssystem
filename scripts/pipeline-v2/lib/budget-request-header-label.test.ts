import { describe, expect, it } from 'vitest';
import { classifyRow, normalizeLabel, segmentize, shapeOf, titleOfPage, type PageProjection, type PageTitle } from './budget-request-header-label';

const row = (i: number, ...texts: string[]) => ({ logicalRowIndex: i, physicalRowIndexes: [i], tokenIndexes: [i], texts });
const title = (status: PageTitle['status'], norm: string | null = null): PageTitle => ({ status, blankReason: null, firstTitleRaw: norm, firstTitleNormalized: norm, shape: null, sourceRefs: null });
const pg = (page: number, status: PageTitle['status'], norm: string | null = null): PageProjection => ({ page, title: title(status, norm) });

describe('title 行と正規化', () => {
  it('最初の code 行より前の先頭行が first title line。ページ番号の位置が違っても正規化後は同じ', () => {
    const a = titleOfPage([row(0, '文（文）', '1053'), row(1, '要求', '前年度'), row(2, '001', '名称')]);
    const b = titleOfPage([row(0, '1054', '文（文）'), row(1, '要求'), row(2, '001', '名称')]);
    expect(a.status).toBe('observed_nonblank');
    expect(a.firstTitleRaw).toBe('文（文） 1053');
    expect(a.firstTitleNormalized).toBe('文(文)');
    expect(b.firstTitleNormalized).toBe(a.firstTitleNormalized);
    expect(a.shape).toEqual({ length: 4, parenthesized: true, prefixLength: 1, innerLength: 1 });
  });
  it('blank の種類を区別する（title 行なし・空行・数字のみ）。補完しない', () => {
    expect(titleOfPage([row(0, '001', '名称')])).toMatchObject({ status: 'observed_blank', blankReason: 'no_title_row', firstTitleNormalized: null });
    expect(titleOfPage([row(0), row(1, '001', '名称')])).toMatchObject({ status: 'observed_blank', blankReason: 'empty_row' });
    expect(titleOfPage([row(0, '1055'), row(1, '001', '名称')])).toMatchObject({ status: 'observed_blank', blankReason: 'digits_only' });
  });
  it('row の分類と lexical shape', () => {
    expect(classifyRow(['12', '01-02', '名'])).toBe('request');
    expect(classifyRow(['001', '名'])).toBe('plain3');
    expect(classifyRow(['001'])).toBe('plain3_only');
    expect(classifyRow(['01-02', 'x'])).toBe('hyphen');
    expect(classifyRow(['要求'])).toBe('other');
    expect(normalizeLabel('厚（地） 1547')).toBe('厚(地)');
    expect(shapeOf('abc').parenthesized).toBe(false);
  });
});

describe('segmentize（blank を bridge しない）', () => {
  it('A, A, blank, A は A・blank・A の 3 segment', () => {
    const s = segmentize([pg(1, 'observed_nonblank', 'A'), pg(2, 'observed_nonblank', 'A'), pg(3, 'observed_blank'), pg(4, 'observed_nonblank', 'A')]);
    expect(s.map(x => [x.kind, x.state, x.from, x.to])).toEqual([['label', 'A', 1, 2], ['blank', 'observed_blank', 3, 3], ['label', 'A', 4, 4]]);
  });
  it('label が変われば segment が変わる。連続する blank / unavailable は 1 つの state run。page が飛べば別 segment', () => {
    const s = segmentize([pg(1, 'observed_nonblank', 'A'), pg(2, 'observed_nonblank', 'B'), pg(3, 'unavailable_rotate90'), pg(4, 'unavailable_rotate90'), pg(6, 'unavailable_rotate90')]);
    expect(s.map(x => [x.state, x.from, x.to])).toEqual([['A', 1, 1], ['B', 2, 2], ['unavailable_rotate90', 3, 4], ['unavailable_rotate90', 6, 6]]);
  });
});
