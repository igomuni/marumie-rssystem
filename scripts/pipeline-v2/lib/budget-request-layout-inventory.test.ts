import { describe, expect, it } from 'vitest';
import { buildRanges, codeClass, contractAlignment, decideLayout, headerSignatureOf, headerSignatureRequestClusters, pdfStatus, summarizePage, type InvColumnLayout, type InvRecord, type LayoutFacts, type PageSummary } from './budget-request-layout-inventory';

const rec = (kind: string, code: string | null, x = 60): InvRecord => ({ anchor: { page: 1, logicalRowIndex: 1 }, recordKind: kind, rowLocal: { code: code === null ? { status: 'blank', value: null, evidence: null } : { status: 'resolved', value: { raw: code }, evidence: { bboxUnion: { xMin: x } } } } });
const layout = (p: number, r: number, d: number): InvColumnLayout => ({ basis: 'page_header', previousBudget: [p, p + 50], requestedBudget: [r, r + 50], difference: [d, d + 50], regions: { name: [null, p - 3] } });
const geom = { width: 595.3, height: 841.9, rotate: 0 };
const page = (n: number, h: string | null, r: string | null = null, reqX: number | null = null): PageSummary => ({ page: n, width: 595, height: 842, rotate: 0, header: null, headerSignature: h, requestKey: r, signature: h === null && r === null ? null : `H:${h ?? '-'}|R:${r ?? '-'}`, lexical: { plain3: 0, request_like: 0, hyphen_other: 0, other_numeric: 0, non_code: 0 }, requestX: [], plain3X: [], requestEvidence: reqX === null ? 'none' : 'dominant', requestDominantX: reqX });

describe('lexical class と page summary', () => {
  it('3 桁 plain / request 番号つき NN-NN / ハイフンのみ / 他の数字 を分ける（3 桁=項とはしない）', () => {
    expect(codeClass(rec('unclassified', '001'))).toBe('plain3');
    expect(codeClass(rec('request', '01-01'))).toBe('request_like');
    expect(codeClass(rec('detail_line', '01-01'))).toBe('hyphen_other');
    expect(codeClass(rec('unclassified', '0012'))).toBe('other_numeric');
    expect(codeClass(rec('unclassified', null))).toBe('non_code');
  });
  it('request x の単峰 / 多峰 / なし、signature は見出し由来の column layout がある page のみ', () => {
    const one = summarizePage(1, [rec('request', '01-01', 65.57), rec('request', '01-02', 65.6), rec('unclassified', '001', 58.67)], layout(200, 260, 410), geom);
    expect(one.requestEvidence).toBe('dominant');
    expect(one.requestDominantX).toBe(65.6);
    expect(one.headerSignature).toBe('w595|p200|r260|d410');
    expect(one.requestKey).toBe('66');
    expect(one.signature).toBe('H:w595|p200|r260|d410|R:66');
    expect(summarizePage(1, [rec('request', '01-01', 65.5), rec('request', '01-02', 79.4)], null, geom)).toMatchObject({ requestEvidence: 'multimodal', headerSignature: null, requestKey: 'multi', signature: 'H:-|R:multi' });
    expect(summarizePage(1, [rec('unclassified', '001')], null, geom).requestEvidence).toBe('none');
    expect(headerSignatureOf(layout(200.4, 260, 410), geom)).toBe(headerSignatureOf(layout(199.6, 260, 410), geom));
  });
});

describe('range / transition / status', () => {
  it('header と request の成分が互換な page は同じ range、衝突したら transition。signature の無い page は前後が同じ range なら吸収', () => {
    const r = buildRanges([page(1, null), page(2, 'H', null), page(3, null), page(4, 'H', '79'), page(5, null, '55'), page(6, null)]);
    expect(r.ranges).toEqual([{ from: 2, to: 4, signature: 'H:H|R:79', assignedPages: 2, gapPages: [3] }, { from: 5, to: 5, signature: 'H:-|R:55', assignedPages: 1, gapPages: [] }]);
    expect(r.transitions).toEqual([{ fromSignature: 'H:H|R:79', toSignature: 'H:-|R:55', lastPageBefore: 4, firstPageAfter: 5, unassignedPagesBetween: [] }]);
    expect(r.leadingUnassigned).toEqual([1]);
    expect(r.trailingUnassigned).toEqual([6]);
    expect(pdfStatus(r.ranges)).toBe('mixed_layout_like');
    expect(pdfStatus(buildRanges([page(1, 'H', '66')]).ranges)).toBe('single_layout_like');
    expect(pdfStatus(buildRanges([page(1, null)]).ranges)).toBe('insufficient_evidence');
  });
  it('同じ header でも request x が違えば別 range（header geometry だけでは行の geometry を決められない）', () => {
    const r = buildRanges([page(1, 'H', '66'), page(2, 'H', '66'), page(3, 'H', '79')]);
    expect(r.ranges.map(x => [x.from, x.to, x.signature])).toEqual([[1, 2, 'H:H|R:66'], [3, 3, 'H:H|R:79']]);
  });
  it('contract の page 範囲が layout range の境界と一致するか（range に属さない page は不一致）', () => {
    const ranges = buildRanges([page(1, 'S', '55'), page(2, 'S', '55'), page(3, 'D', '66'), page(4, 'D', '66'), page(5, 'D', '66')]).ranges;
    expect(contractAlignment(ranges, 5, 3, 5)).toEqual({ startAligned: true, endAligned: true, rangesInside: 1 });
    expect(contractAlignment(ranges, 5, 4, 5)).toMatchObject({ startAligned: false, endAligned: true });
    expect(contractAlignment(ranges, 5, 3, 4)).toMatchObject({ startAligned: true, endAligned: false });
  });
  it('header signature ごとの request x クラスタ数（報告用）', () => {
    expect(headerSignatureRequestClusters([page(1, 'A', '66', 65.5), page(2, 'A', '79', 79.4), page(3, 'B', '66', 65.5), page(4, 'B', '66', 65.7)])).toEqual({ A: 2, B: 1 });
  });
});

describe('decideLayout（事前登録の判定規則）', () => {
  const f: LayoutFacts = { developmentOk: true, evaluablePdfs: 74, unavailablePdfs: 8, pagesRequestMultimodal: 10, pagesRequestDominant: 900, contractPdfs: 8, contractAligned: 8 };
  it('規則 1〜4 を上から適用する', () => {
    expect(decideLayout(f)).toEqual({ decision: 'LAYOUT_VARIANTS_DETERMINISTIC', rule: 4 });
    expect(decideLayout({ ...f, developmentOk: false }).decision).toBe('INCONCLUSIVE');
    expect(decideLayout({ ...f, unavailablePdfs: 74 }).decision).toBe('INCONCLUSIVE');
    expect(decideLayout({ ...f, pagesRequestMultimodal: 901 }).decision).toBe('LAYOUT_VARIANTS_AMBIGUOUS');
    expect(decideLayout({ ...f, contractAligned: 7 }).decision).toBe('LAYOUT_DETERMINISTIC_BUT_HIERARCHY_SOURCE_INCOMPLETE');
  });
});
