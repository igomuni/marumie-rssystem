import { describe, expect, it } from 'vitest';
import { charCounts, compareFeatures, countBin, decideAmbiguity, deltaBin, populationOf, relativePosition, stageShapes, stagesOf, stepBin, type FeatureTable } from './budget-request-label-candidate';

describe('normalization の段階分解（既存変換のまま）', () => {
  it('段階ごとの shape と、digit removal 依存の判定', () => {
    expect(stagesOf('100 内（消）').final).toBe('内(消)');
    expect(stageShapes('100 内（消）')).toMatchObject({ raw: false, nfkc: true, noWhitespace: true, final: true, firstShapeStage: 'nfkc', digitRemovalDependent: false });
    expect(stageShapes('内（消） 1053')).toMatchObject({ nfkc: false, noWhitespace: false, final: true, firstShapeStage: 'final', digitRemovalDependent: true });
    expect(stageShapes('内（消）')).toMatchObject({ nfkc: true, noWhitespace: true, firstShapeStage: 'nfkc', digitRemovalDependent: false });
    expect(stageShapes('内(消)')).toMatchObject({ raw: true, firstShapeStage: 'raw' });
    expect(stageShapes('計 (1,234)')).toMatchObject({ noWhitespace: true, final: true, digitRemovalDependent: false });
    expect(stageShapes('abc').firstShapeStage).toBe('none');
  });
});

describe('文字クラス・bin', () => {
  it('意味解釈なしの個数', () => {
    expect(charCounts('計 (1,2)／３')).toMatchObject({ total: 9, han: 1, asciiDigits: 2, digits: 3, comma: 1, slash: 1, openParen: 1, closeParen: 1, whitespace: 1 });
    expect(['0', '2', '3', '6', '11'].map(x => countBin(Number(x)))).toEqual(['0', '2', '3-5', '6-10', '11+']);
    expect(stepBin(57.3, 10)).toBe('50');
    expect([deltaBin(-1), deltaBin(0), deltaBin(4), deltaBin(20)]).toEqual(['neg', '0', '3-5', '11+']);
  });
});

describe('population と relative position', () => {
  it('排他的な割り当て', () => {
    expect(relativePosition(3, 3)).toBe('same_as_first_code');
    expect(relativePosition(1, 3)).toBe('before_first_code');
    expect(relativePosition(5, null)).toBe('first_code_unavailable');
    expect(populationOf(true, true, 'same_as_first_code', true, false)).toBe('P1_projected_same_row');
    expect(populationOf(false, false, 'after_first_code', true, true)).toBe('P2_ambiguity_additional_after_code');
    expect(populationOf(false, false, 'after_first_code', true, false)).toBe('P5_other');
    expect(populationOf(false, false, 'after_first_code', false, true)).toBe('P3_nonambiguous_additional_after_code');
    expect(populationOf(true, false, 'before_first_code', false, false)).toBe('P4_before_first_code');
  });
});

describe('feature 比較と判定', () => {
  const t = (rl: Record<string, string>, pc: Record<string, string>): FeatureTable => ({ rowLocal: rl, projectionContext: pc });
  it('disjoint と tvd、判定の順序 D4→D1→D2→D3', () => {
    const p1 = [t({ a: 'x', b: 'y' }, { pos: 'same' }), t({ a: 'x', b: 'z' }, { pos: 'same' })], p2 = [t({ a: 'x', b: 'y' }, { pos: 'after' })];
    const r = compareFeatures(p1, p2);
    expect(r.find(x => x.feature === 'a')).toMatchObject({ disjoint: false, tvd: 0 });
    expect(r.find(x => x.feature === 'pos')).toMatchObject({ group: 'projection_context', disjoint: true, tvd: 1 });
    expect(decideAmbiguity(true, 0, r)).toEqual({ decision: 'AMBIGUITY_PARTIALLY_ISOLATED', rule: 3 });
    expect(decideAmbiguity(true, 0, r.map(x => (x.feature === 'a' ? { ...x, disjoint: true } : x))).decision).toBe('AMBIGUITY_STRUCTURALLY_ISOLATED');
    expect(decideAmbiguity(true, 0, [{ feature: 'a', group: 'row_local', p1Values: {}, p2Values: {}, disjoint: false, tvd: 0.1 }]).decision).toBe('AMBIGUITY_NOT_ISOLATED');
    expect(decideAmbiguity(false, 0, r).decision).toBe('INCONCLUSIVE');
    expect(decideAmbiguity(true, 1, r).decision).toBe('INCONCLUSIVE');
  });
});
