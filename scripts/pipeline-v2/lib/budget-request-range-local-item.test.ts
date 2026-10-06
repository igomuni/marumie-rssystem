import { describe, expect, it } from 'vitest';
import { evaluateRange, isDetailRangeSignature } from './budget-request-range-local-item';
import type { CandidateSourceRecord } from './budget-request-item-candidate';

const rec = (page: number, row: number, kind: string, code: string, x: number, name: string | null = '名称'): CandidateSourceRecord => ({
  anchor: { page, logicalRowIndex: row }, recordKind: kind,
  rowLocal: { code: { status: 'resolved', value: { raw: code }, evidence: { bboxUnion: { xMin: x } } }, name: name === null ? { status: 'ambiguous', reasonCode: 'continuation_ambiguous', value: null } : { status: 'resolved', reasonCode: null, value: { raw: name, normalized: name } } },
});
const reqs = (page: number, n: number, x: number) => Array.from({ length: n }, (_, i) => rec(page, 100 + i, 'request', '01-01', x));
const DETAIL = 'H:w842|p207|r259|d414|R:66';

describe('明細表 range の mapping', () => {
  it('header 成分がある signature だけが detail range', () => {
    expect(isDetailRangeSignature(DETAIL)).toBe(true);
    expect(isDetailRangeSignature('H:-|R:55')).toBe(false);
    expect(isDetailRangeSignature('H:-|R:multi')).toBe(false);
  });
});

describe('evaluateRange（range-local の基準 x）', () => {
  it('PDF 全体の最頻値ではなく range 内の request 行から基準を決める（前置き表の x=55 に引かれない）', () => {
    const records = [...reqs(1, 10, 55.22), ...reqs(7, 5, 65.57), rec(7, 1, 'unclassified', '001', 58.67, '項A'), rec(1, 1, 'unclassified', '001', 48.3, '前置き')];
    const r = evaluateRange({ from: 7, to: 9, signature: DETAIL }, records);
    expect(r.status).toBe('evaluable_detail_range');
    expect(r.refX).toBe(65.57);
    expect(r.candidates.map(c => c.nameRaw)).toEqual(['項A']);
  });
  it('detail でない range は候補を数えない', () => {
    expect(evaluateRange({ from: 1, to: 3, signature: 'H:-|R:55' }, reqs(1, 10, 55.22))).toMatchObject({ status: 'outside_detail_range', candidates: [] });
  });
  it('request 行が 5 件未満なら fail-closed（隣接 range で補完しない）', () => {
    const r = evaluateRange({ from: 7, to: 9, signature: DETAIL }, [...reqs(7, 4, 65.57), rec(7, 1, 'unclassified', '001', 58.67)]);
    expect(r).toMatchObject({ status: 'range_request_x_unavailable', refX: null, requests: 4, candidates: [] });
  });
  it('range 内の request x が 0.5pt を超えて割れるなら multimodal（候補を数えない）', () => {
    const r = evaluateRange({ from: 7, to: 9, signature: DETAIL }, [...reqs(7, 5, 65.57), ...reqs(8, 3, 79.37), rec(7, 1, 'unclassified', '001', 58.67)]);
    expect(r).toMatchObject({ status: 'range_multimodal', candidates: [] });
  });
  it('候補条件は前回 detector のまま（3 桁 plain・refX-6.9±1.0）。range 外の page は使わない', () => {
    const records = [...reqs(7, 5, 65.57), rec(7, 1, 'unclassified', '001', 58.67), rec(7, 2, 'unclassified', '0012', 58.67), rec(7, 3, 'unclassified', '002', 72), rec(20, 1, 'unclassified', '003', 58.67)];
    expect(evaluateRange({ from: 7, to: 9, signature: DETAIL }, records).candidates.map(c => c.code)).toEqual(['001']);
  });
});
