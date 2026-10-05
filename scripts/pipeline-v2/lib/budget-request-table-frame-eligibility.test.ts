import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { decideRefinement, isEligible, relationOf, selectEligible, type RefinementFacts } from './budget-request-table-frame-eligibility';

const rules = [{ x: 31, yMin: 27.8, yMax: 555.5 }, { x: 797, yMin: 27.8, yMax: 555.5 }];
describe('relationOf（fail-closed）', () => {
  it('frame の上側 → header、内側 → body/table、跨ぐ → ambiguous', () => {
    expect(relationOf({ xMin: 38, xMax: 83, yMin: 20.8, yMax: 27.8 }, rules).relation).toBe('header_position_supported');
    expect(relationOf({ xMin: 38, xMax: 83, yMin: 55, yMax: 69 }, rules).relation).toBe('body_or_table_position_supported');
    expect(relationOf({ xMin: 38, xMax: 83, yMin: 24, yMax: 33 }, rules).relation).toBe('ambiguous');
  });
  it('frame なし・bbox なし・不正な geometry は header として採用しない', () => {
    expect(relationOf({ xMin: 38, xMax: 83, yMin: 20, yMax: 27 }, []).relation).toBe('unavailable');
    expect(relationOf(null, rules).relation).toBe('unavailable');
    expect(relationOf({ xMin: NaN, xMax: 83, yMin: 20, yMax: 27 }, rules).relation).toBe('unavailable');
    expect(relationOf({ xMin: 90, xMax: 83, yMin: 20, yMax: 27 }, rules).relation).toBe('unavailable');
    expect(isEligible(relationOf(undefined, rules))).toBe(false);
  });
  it('複数の eligible candidate があれば abstain', () => {
    const h = { relation: relationOf({ xMin: 38, xMax: 83, yMin: 20.8, yMax: 27.8 }, rules) }, b = { relation: relationOf({ xMin: 38, xMax: 83, yMin: 55, yMax: 69 }, rules) };
    expect(selectEligible([h, b]).kind).toBe('selected');
    expect(selectEligible([h, h]).kind).toBe('abstain_multiple');
    expect(selectEligible([b]).kind).toBe('none');
  });
});

describe('直前研究の outlier 2 + control の再現（frozen packet の frame と bbox）', () => {
  const packet = JSON.parse(fs.readFileSync('tests/fixtures/budget-request-p1-outlier/2024/source-evidence-packet.json', 'utf8')) as { packets: { role: string; geometry: { bounds: { xMin: number; xMax: number; yMin: number; yMax: number } }; drawing: { longVerticalRules: { x: number; yMin: number; yMax: number }[] }; sourceOnlyClassification: { classification: string } }[] };
  it('outlier 1・2 → body/table、control → header。直前研究の分類と一致', () => {
    const rel = packet.packets.map(p => ({ role: p.role, r: relationOf(p.geometry.bounds, p.drawing.longVerticalRules), prior: p.sourceOnlyClassification.classification }));
    expect(rel.filter(x => x.role === 'outlier').map(x => x.r.relation)).toEqual(['body_or_table_position_supported', 'body_or_table_position_supported']);
    expect(rel.filter(x => x.role === 'control').map(x => x.r.relation)).toEqual(['header_position_supported']);
    for (const x of rel) expect(x.r.classification).toBe(x.prior);
  });
});

describe('decideRefinement（事前登録の gate と順序）', () => {
  const ok: RefinementFacts = { integrityOk: true, classifierReproduced: true, deterministic: true, p1DominantRetention: 0.995, outliersExcluded: 2, outliersTotal: 2, p2BodyShare: 0.9, coverage: 0.95, regressionChanged: 0, fidelityViolations: 0, provenanceMissing: 0, provenanceLoss: 0, synthesizedText: 0 };
  it('D4 → D3 → D1 → D2', () => {
    expect(decideRefinement(ok).decision).toBe('TABLE_FRAME_REFINEMENT_SUPPORTED');
    expect(decideRefinement({ ...ok, p2BodyShare: 0.6 }).decision).toBe('TABLE_FRAME_REFINEMENT_PARTIALLY_SUPPORTED');
    expect(decideRefinement({ ...ok, p1DominantRetention: 0.95 }).decision).toBe('TABLE_FRAME_REFINEMENT_PARTIALLY_SUPPORTED');
    expect(decideRefinement({ ...ok, p1DominantRetention: 0.8 }).decision).toBe('TABLE_FRAME_REFINEMENT_NOT_SUPPORTED');
    expect(decideRefinement({ ...ok, outliersExcluded: 1 }).decision).toBe('TABLE_FRAME_REFINEMENT_NOT_SUPPORTED');
    expect(decideRefinement({ ...ok, regressionChanged: 1 }).decision).toBe('TABLE_FRAME_REFINEMENT_NOT_SUPPORTED');
    expect(decideRefinement({ ...ok, coverage: 0.4 }).decision).toBe('TABLE_FRAME_REFINEMENT_NOT_SUPPORTED');
    expect(decideRefinement({ ...ok, deterministic: false }).decision).toBe('STOP_INTEGRITY_FAILURE');
    expect(decideRefinement({ ...ok, classifierReproduced: false }).decision).toBe('STOP_INTEGRITY_FAILURE');
  });
});
