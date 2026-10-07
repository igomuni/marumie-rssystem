import { describe, expect, it } from 'vitest';
import { THRESHOLDS, buildVersionRows, computeAdequacy, judge, machineEvidenceOf, overlapOf, type CandidateRow, type CumulativeRow, type GtRow } from './budget-request-page-classification-v3-cumulative';

const base = { pdfSha256: 'p', textSha256: 't' };
const cand = (page: number, extra: Partial<CandidateRow>): CandidateRow => ({ localPdfPath: 'a.pdf', physicalPage: page, ...base, evaluationRole: 'R', strata: [], ...extra });
const gt = (page: number, strata: string[], pageType: string): GtRow => ({ localPdfPath: 'a.pdf', physicalPage: page, ...base, evaluationRole: 'R', strata, gt: { pageType, evidence: 'VISUAL' } });

describe('page classification v3 cumulative mapping（version ごと）', () => {
  it('v0: strataDetail から direct / continuation の machine evidence を取る', () => {
    expect(machineEvidenceOf('v0', cand(1, { strata: ['DIRECT'], strataDetail: { DIRECT: { family: 'COVER' } } }))).toEqual({ directFamily: 'COVER', activeStateFamily: null, distanceBucket: null });
    expect(machineEvidenceOf('v0', cand(2, { strata: ['CONTINUATION'], strataDetail: { CONTINUATION: { stateFamily: 'DETAIL', distanceBucket: 'd1' } } }))).toEqual({ directFamily: null, activeStateFamily: 'DETAIL', distanceBucket: 'd1' });
  });
  it('v1: samplingObservation.directResult は object、continuation の bucket は strataDetail', () => {
    expect(machineEvidenceOf('v1', cand(1, { strata: ['DIRECT_BALANCED'], samplingObservation: { directResult: { kind: 'DIRECT', family: 'TOC' } } })).directFamily).toBe('TOC');
    expect(machineEvidenceOf('v1', cand(2, { strata: ['CONTINUATION_BALANCED'], samplingObservation: { activeStateFamily: 'SUMMARY' }, strataDetail: { CONTINUATION_BALANCED: { distanceBucket: 'd2' } } }))).toEqual({ directFamily: null, activeStateFamily: 'SUMMARY', distanceBucket: 'd2' });
  });
  it('v2: samplingObservation の string field', () => {
    expect(machineEvidenceOf('v2', cand(1, { strata: ['DIRECT_BALANCED_V2'], samplingObservation: { directResult: 'STAFFING' } })).directFamily).toBe('STAFFING');
    expect(machineEvidenceOf('v2', cand(2, { strata: ['CONTINUATION_BALANCED_V2'], samplingObservation: { activeStateFamily: 'DETAIL', distanceBucket: 'D6_20' } })).distanceBucket).toBe('D6_20');
  });
  it('stratum に属するのに machine evidence が無ければ throw（推測しない）', () => {
    expect(() => machineEvidenceOf('v2', cand(1, { strata: ['DIRECT_BALANCED_V2'], samplingObservation: { directResult: null } }))).toThrow(/directFamily/);
    expect(() => machineEvidenceOf('v2', cand(1, { strata: ['CONTINUATION_BALANCED_V2'], samplingObservation: {} }))).toThrow(/activeStateFamily/);
  });
});

describe('page classification v3 cumulative join / adequacy', () => {
  it('GT と candidate が 1:1 でなければ throw、hash 不一致も throw', () => {
    expect(() => buildVersionRows('v2', [gt(1, [], 'DETAIL')], [])).toThrow(/count mismatch/);
    expect(() => buildVersionRows('v2', [gt(1, [], 'DETAIL')], [{ ...cand(1, {}), textSha256: 'x' }])).toThrow(/hash mismatch/);
  });
  it('DIRECT / CONTINUATION は stratum 所属 かつ machine family == GT family のときだけ matched', () => {
    const rows = buildVersionRows('v2', [gt(1, ['DIRECT_BALANCED_V2'], 'COVER'), gt(2, ['DIRECT_BALANCED_V2'], 'DETAIL'), gt(3, ['CONTINUATION_BALANCED_V2'], 'TOC'), gt(4, [], 'COVER')], [
      cand(1, { strata: ['DIRECT_BALANCED_V2'], samplingObservation: { directResult: 'COVER' } }),
      cand(2, { strata: ['DIRECT_BALANCED_V2'], samplingObservation: { directResult: 'SUMMARY' } }),
      cand(3, { strata: ['CONTINUATION_BALANCED_V2'], samplingObservation: { activeStateFamily: 'TOC', distanceBucket: 'D1' } }),
      cand(4, {}),
    ]);
    expect(rows.map(r => [r.directMatched, r.continuationMatched])).toEqual([[true, false], [false, false], [false, true], [false, false]]);
  });
  it('overlap を pairwise に数える', () => {
    expect(overlapOf({ a: new Set(['x', 'y']), b: new Set(['y']), c: new Set(['z']) })).toEqual({ 'a&b': 1, 'a&c': 0, 'b&c': 0 });
  });
  it('threshold は v2 の値を継承し、不足すれば INSUFFICIENT、openSetSafety は常に NOT_EVALUATED', () => {
    expect(THRESHOLDS).toEqual({ corePerFamily: 10, directPerCoreFamily: 5, continuationPerFamily: 5 });
    const mk = (pageType: string, n: number, matched: boolean): CumulativeRow[] => Array.from({ length: n }, (_, i) => ({ localPdfPath: `${pageType}${i}`, physicalPage: 1, pdfSha256: '', textSha256: '', sourceVersion: 'v2', sourceEvaluationRole: 'R', sourceStrata: [], gt: { pageType, evidence: 'VISUAL' }, machineEvidence: { directFamily: null, activeStateFamily: null, distanceBucket: null }, directMatched: matched, continuationMatched: matched }));
    const full = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING'].flatMap(f => mk(f, 10, true));
    const a = computeAdequacy(full);
    expect([a.coreOk, a.directOk, a.continuationOk, a.openSetSafety]).toEqual([true, true, true, 'NOT_EVALUATED']);
    expect(judge(a, 0)).toBe('ADEQUATE / STOP FOR REVIEW');
    expect(judge(a, 1)).toBe('INSUFFICIENT / STOP');
    const lack = computeAdequacy([...full.filter(r => r.gt.pageType !== 'STAFFING'), ...mk('STAFFING', 4, true)]);
    expect([lack.coreOk, lack.continuationOk]).toEqual([false, false]);
    expect(judge(lack, 0)).toBe('INSUFFICIENT / STOP');
  });
});
