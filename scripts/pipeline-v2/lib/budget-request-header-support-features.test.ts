import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { binCount, binDensity, binDist, binRatio, charClassSignature, compareFeature, computeFeatures, decideHeaderSupport, tvd, xRelOf, type FeatureContext, type NodeLite, type Sample } from './budget-request-header-support-features';

describe('bin / signature / xRel', () => {
  it('事前登録した bin', () => {
    expect([binCount(0), binCount(1), binCount(4), binCount(450), binCount(5000)]).toEqual(['[0,1)', '[1,2)', '[3,5)', '[200,500)', '[1000,∞)']);
    expect([binDist(-1000), binDist(-5), binDist(0), binDist(4.9), binDist(100)]).toEqual(['[-∞,-100)', '[-5,0)', '[0,5)', '[0,5)', '[100,∞)']);
    expect([binRatio(0), binRatio(0.55), binRatio(1)]).toEqual(['r0', 'r5', 'r9']);
    expect(binDensity(1)).toBe('[1,1.5)');
  });
  it('character-class signature は意味を読まず記述だけ', () => {
    expect(charClassSignature('12(あア漢 ab)')).toBe('dpkhlp');
    expect(xRelOf(10, 20, 3)).toBe('deeper'); expect(xRelOf(20, 10, 3)).toBe('shallower'); expect(xRelOf(10, 12, 3)).toBe('same');
  });
});
describe('compareFeature（synthetic）', () => {
  const s = (pdf: string, ...labels: (string | null)[]): Sample[] => labels.map(label => ({ pdf, label }));
  const rec = { name: 'f', family: 'F', circular: false, kind: 'categorical' as const };
  it('complete separator', () => {
    const c = compareFeature(rec, [...s('a', 'x', 'x'), ...s('b', 'x')], [...s('c', 'y', 'y'), ...s('d', 'y')]);
    expect(c).toMatchObject({ complete: true, tvd: 1, disjointCombined: true });
  });
  it('strong partial: TVD ≥ 0.8 だが overlap あり、P2 の 1 PDF を除いても維持', () => {
    const p1 = [...s('a', ...Array(10).fill('x'), 'y'), ...s('b', ...Array(10).fill('x'), 'y')];
    const p2 = [...s('c', ...Array(10).fill('z'), 'x'), ...s('d', ...Array(10).fill('z'), 'x')];
    const c = compareFeature(rec, p1, p2);
    expect(c.complete).toBe(false);
    expect(c.tvd).toBeGreaterThanOrEqual(0.8);
    expect(c.strongPartial).toBe(true);
  });
  it('P2 の 1 PDF だけで差が作られていれば partial にしない', () => {
    const p1 = [...s('a', ...Array(10).fill('x'), 'y'), ...s('b', ...Array(10).fill('x'), 'y')];
    const p2 = [...s('c', ...Array(10).fill('z'), 'x'), ...s('d', ...Array(10).fill('x'))];
    expect(compareFeature(rec, p1, p2).strongPartial).toBe(false);
  });
  it('circular / descriptive / 高 cardinality / availability 不足は対象外', () => {
    expect(compareFeature({ ...rec, circular: true }, s('a', 'x'), s('c', 'y')).eligibleForSeparator).toBe(false);
    expect(compareFeature({ ...rec, kind: 'descriptive' }, s('a', 'x'), s('c', 'y')).ineligibleReason).toBe('descriptive_only');
    const many = (p: string) => s(p, ...Array.from({ length: 25 }, (_, i) => `${p}${i}`));
    expect(compareFeature(rec, [...many('a'), ...many('b')], many('c')).ineligibleReason).toBe('high_cardinality');
    expect(compareFeature(rec, [...s('a', 'x', null, null), ...s('b', 'x', null, null)], [...s('c', 'y', 'y'), ...s('d', 'y')]).complete).toBe(false);
  });
  it('tvd', () => { expect(tvd(s('a', 'x', 'x'), s('b', 'x', 'y'))).toBe(0.5); expect(tvd(s('a', null), s('b', 'x'))).toBeNull(); });
});
describe('computeFeatures（synthetic）', () => {
  const nd = (id: string, page: number, row: number, x: number, shape = 'code3_then_text'): NodeLite => ({ id, page, logicalRowIndex: row, x, rowShape: shape, code: '123', clusterIndex: 0, textParts: ['ab'], rowTokenCount: 3, rowTexts: ['123', 'ab'] });
  const seq = [nd('a', 1, 0, 10), nd('b', 1, 1, 10), nd('c', 2, 0, 30)];
  const ctx = (i: number): FeatureContext => ({ node: seq[i], indexInSequence: i, sequence: seq, range: [1, 10], gap: 3, relation: { frameAvailable: true, frameBBox: { top: 100, bottom: 700, left: 10, right: 500 }, bbox: { xMin: 20, xMax: 400, yMin: 50, yMax: 60 }, relation: 'header_position_supported' }, layoutOf: () => ({ id: '1-10', signature: 'H:w|R:1', detail: true, from: 1, to: 10 }), pageNodeOrdinal: i, pageNodeCount: 2 });
  it('F1〜F6 と circular block が付き、parent / level を含まない', () => {
    const f = computeFeatures(ctx(1), seq);
    const by = new Map(f.map(x => [x.name, x]));
    expect(by.get('prev1XRelation')!.label).toBe('same');
    expect(by.get('next1XRelation')!.label).toBe('deeper');
    expect(by.get('next1PageBreak')!.label).toBe('true');
    expect(by.get('next1RowDistance')!.missing).toBe('neighbor_on_other_page');
    expect(by.get('next3XRelation')!.label).toBe('no_neighbor');
    expect(by.get('sameXRunPosition')!.label).toBe('last');
    expect(by.get('rowTopMinusFrameTop')!.label).toBe(binDist(-50));
    expect(by.get('keyTokenXMin')!.circular).toBe(true);
    expect(by.get('rowLeftMinusFrameLeft')!.circular).toBe(true);
    expect(f.some(x => /parent|stack|level/i.test(x.name))).toBe(false);
  });
  it('relation artifact が無ければ missing reason が付く', () => {
    const f = computeFeatures({ ...ctx(0), relation: null }, seq);
    expect(f.find(x => x.name === 'frozenRelation')).toMatchObject({ label: null, missing: 'relation_artifact_missing' });
  });
});
describe('decideHeaderSupport routing（synthetic）', () => {
  const base = { gatesPass: true, p1Size: 100, p2Size: 100, p1Unconstructible: 0, p2Unconstructible: 0, completeSeparators: 0, strongPartialSeparators: 0 };
  const d = (o: Partial<typeof base>) => decideHeaderSupport({ ...base, ...o }).rule;
  it('各 decision', () => {
    expect(d({})).toBe('D3'); expect(d({ strongPartialSeparators: 2 })).toBe('D2'); expect(d({ completeSeparators: 1, strongPartialSeparators: 2 })).toBe('D1');
    expect(d({ p1Unconstructible: 11 })).toBe('D4'); expect(d({ p2Unconstructible: 10 })).toBe('D3'); expect(d({ gatesPass: false })).toBe('D0'); expect(d({ p2Size: 0 })).toBe('gap_empty_population');
    expect(d({ p2Unconstructible: 11, completeSeparators: 3 })).toBe('D4');
  });
});
describe('Phase A は基準 frame・基準範囲・外部照合・outcome を参照しない（source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-header-support-features.ts', 'scripts/pipeline-v2/run-budget-request-header-support-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/\.manual\b/, /\bh0\b/, /hierarchy-level-frame/, /hierarchy-stack-reset/, /table-eligibility\/2024\/phaseB/, /cluster-provenance\/2024\/phaseB/, /replayStack/, /mof-|budget-jikou|MofBudget|mofJikou/, /controlClusters/, /sameRangeControl/, /assignToFrame/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
