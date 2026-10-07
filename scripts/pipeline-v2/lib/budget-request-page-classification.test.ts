import { describe, expect, it } from 'vitest';
import { classifyDocument, documentDigest, verifyHashes, type ClassifierPageInput, type EmptyKind } from './budget-request-page-classification';

const T = (title: string) => [{ text: `令和６年度${title}` }];
const text = (page: number, lines: { text: string }[]): ClassifierPageInput => ({ physicalPage: page, rawStatus: 'EXTRACTED', textSha256: `t${page}`, nonEmptyLines: lines, emptyKind: 'NONE' });
const empty = (page: number, kind: EmptyKind): ClassifierPageInput => ({ physicalPage: page, rawStatus: 'EMPTY', textSha256: `t${page}`, nonEmptyLines: [], emptyKind: kind });
const run = (pages: ClassifierPageInput[]) => classifyDocument('a.pdf', 'sha', pages);
const types = (pages: ClassifierPageInput[]) => run(pages).map(r => [r.classification.pageType, r.classification.source]);

describe('page classification v0 implementation（frozen semantics conformance）', () => {
  it('DIRECT は frozen matcher の family、NONE かつ state なしは UNRESOLVED（source=null）', () => {
    expect(types([text(1, T('歳出概算要求額総表')), text(2, [{ text: 'x' }])])).toEqual([['SUMMARY', 'DIRECT'], ['SUMMARY', 'INHERITED']]);
    expect(types([text(1, [{ text: 'x' }])])).toEqual([['UNRESOLVED', null]]);
  });
  it('COVER は継承しない（COVER 直後の NONE は UNRESOLVED）', () => {
    expect(types([text(1, T('歳出概算要求書')), text(2, [{ text: 'x' }])])).toEqual([['COVER', 'DIRECT'], ['UNRESOLVED', null]]);
  });
  it('継承できるのは DIRECT 由来の family だけで、UNRESOLVED / INHERITED は state を作らない（OTHER は出力しない）', () => {
    const r = run([text(1, [{ text: 'x' }]), text(2, T('概算要求定員表')), text(3, [{ text: 'y' }]), text(4, [{ text: 'z' }])]);
    expect(r.map(x => x.classification.pageType)).toEqual(['UNRESOLVED', 'STAFFING', 'STAFFING', 'STAFFING']);
    expect(r.some(x => x.classification.pageType === 'OTHER')).toBe(false);
  });
  it('新しい DIRECT で state を更新する（specific→generic の precedence は matcher に従う）', () => {
    expect(types([text(1, T('歳出概算要求額総表')), text(2, T('歳出概算要求額明細表')), text(3, [{ text: 'x' }])]).map(x => x[0])).toEqual(['SUMMARY', 'DETAIL', 'DETAIL']);
    expect(types([text(1, T('重要政策推進枠要望額明細表'))])[0]).toEqual(['PRIORITY_DETAIL', 'DIRECT']);
  });
  it('CONFLICT は UNRESOLVED（source=null）で state を reset する', () => {
    const r = run([text(1, T('歳出概算要求額明細表')), text(2, [...T('歳出概算要求書'), ...T('概算要求額総表')]), text(3, [{ text: 'x' }])]);
    expect(r[1].classification).toMatchObject({ status: 'UNRESOLVED', pageType: 'UNRESOLVED', source: null });
    expect(r[1].stateObservation.resetReason).toBe('DIRECT_CONFLICT');
    expect(r[2].classification.pageType).toBe('UNRESOLVED');
  });
  it('VISUALLY_BLANK は NO_TEXT で state を変えない（bridge）。RASTER・unresolved EMPTY は NO_TEXT で state を reset する', () => {
    const bridged = run([text(1, T('歳出概算要求額明細表')), empty(2, 'VISUALLY_BLANK'), text(3, [{ text: 'x' }])]);
    expect(bridged[1].classification).toMatchObject({ status: 'NO_TEXT', pageType: null, source: null });
    expect(bridged[1].stateObservation).toMatchObject({ activeFamilyBefore: 'DETAIL', activeFamilyAfter: 'DETAIL', resetReason: null });
    expect(bridged[2].classification).toMatchObject({ pageType: 'DETAIL', source: 'INHERITED' });
    for (const k of ['RASTER', 'UNRESOLVED_EMPTY'] as const) {
      const r = run([text(1, T('歳出概算要求額明細表')), empty(2, k), text(3, [{ text: 'x' }])]);
      expect(r[1].stateObservation.resetReason).not.toBeNull();
      expect(r[2].classification.pageType).toBe('UNRESOLVED');
    }
  });
  it('state は physical PDF を越えない（document ごとに初期化）／look-ahead しない', () => {
    run([text(1, T('歳出概算要求額明細表'))]);
    expect(classifyDocument('b.pdf', 's', [text(1, [{ text: 'x' }])])[0].classification.pageType).toBe('UNRESOLVED');
    // 後続 page の DIRECT は先行 page の分類に影響しない
    expect(types([text(1, [{ text: 'x' }]), text(2, T('歳出概算要求額総表'))])[0]).toEqual(['UNRESOLVED', null]);
  });
  it('page 順序・page 数の不一致は throw、同入力は同 digest', () => {
    expect(() => classifyDocument('a.pdf', 's', [text(2, [])])).toThrow(/boundary mismatch/);
    expect(() => classifyDocument('a.pdf', 's', [text(1, [])], 2)).toThrow(/page count mismatch/);
    const pages = [text(1, T('歳出概算要求額総表')), empty(2, 'VISUALLY_BLANK'), text(3, [{ text: 'x' }])];
    expect(documentDigest(run(pages))).toBe(documentDigest(run(pages)));
  });
  it('source hash（PDF / page text）の不一致は throw する', () => {
    expect(() => verifyHashes('a.pdf', { expectedPdfSha256: 'p', actualPdfSha256: 'q', expectedPageTextSha256: [], actualPageTextSha256: [] })).toThrow(/pdf sha256 mismatch/);
    expect(() => verifyHashes('a.pdf', { expectedPdfSha256: 'p', actualPdfSha256: 'p', expectedPageTextSha256: ['a'], actualPageTextSha256: ['b'] })).toThrow(/text sha256 mismatch/);
    expect(() => verifyHashes('a.pdf', { expectedPdfSha256: 'p', actualPdfSha256: 'p', expectedPageTextSha256: ['a'], actualPageTextSha256: ['a'] })).not.toThrow();
  });
});
