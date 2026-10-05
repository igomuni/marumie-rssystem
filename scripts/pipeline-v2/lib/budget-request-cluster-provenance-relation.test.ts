import { describe, expect, it } from 'vitest';
import { classifyRelations, decideProvenance, patternsOf, type PatternInput, type Relation } from './budget-request-cluster-provenance-relation';

describe('classifyRelations', () => {
  it('B1〜B6', () => {
    const { relation, target } = classifyRelations([
      { id: 0, assigned: [0, 0] }, { id: 1, assigned: [1] }, { id: 2, assigned: [1, 1] }, { id: 3, assigned: [0, 1] },
      { id: 4, assigned: [null, null] }, { id: 5, assigned: [2, null] }, { id: 6, assigned: [] },
    ]);
    expect(relation.get(0)).toBe('B1_one_to_one');
    expect(relation.get(1)).toBe('B2_split_member');
    expect(relation.get(2)).toBe('B2_split_member');
    expect(relation.get(3)).toBe('B3_crosses_c0_clusters');
    expect(relation.get(4)).toBe('B4_c0_unassigned_only');
    expect(relation.get(5)).toBe('B5_mixed_assigned_unassigned');
    expect(relation.get(6)).toBe('B6_unclassifiable');
    expect([...target.entries()]).toEqual([[0, 0], [1, 1], [2, 1]]);
  });
});

const empty = (): PatternInput => ({ relation: new Map<string, Relation>(), target: new Map(), regions: new Map(), layoutRanges: new Map(), runs: new Map(), pdfOf: k => k.split('|')[0] });
describe('patternsOf（synthetic）', () => {
  it('何も無ければ全て不成立', () => {
    const i = empty();
    i.relation.set('p|0', 'B1_one_to_one'); i.relation.set('p|1', 'B1_one_to_one');
    i.target.set('p|0', 'p|0'); i.target.set('p|1', 'p|1');
    i.regions.set('p|0', new Set(['inside', 'after'])); i.regions.set('p|1', new Set(['before']));
    i.layoutRanges.set('p|0', new Set(['a', 'b'])); i.layoutRanges.set('p|1', new Set(['unassigned']));
    i.runs.set('p|0', [{ start: 1, end: 2 }]); i.runs.set('p|1', [{ start: 5, end: 6 }]);
    expect(patternsOf(i)).toEqual({ A: false, B: false, C: false, D: false, E: false });
  });
  it('各 family', () => {
    const i = empty();
    for (const k of ['p|0', 'p|1']) { i.relation.set(k, 'B4_c0_unassigned_only'); i.target.set(k, 'p|9'); i.regions.set(k, new Set(['inside'])); i.layoutRanges.set(k, new Set(['r1'])); i.runs.set(k, [{ start: 3, end: 4 }]); }
    expect(patternsOf(i)).toEqual({ A: true, B: true, C: true, D: true, E: true });
  });
  it('family は PDF 別に判定する（別 PDF の cluster 同士は数えない）', () => {
    const i = empty();
    i.relation.set('p|0', 'B4_c0_unassigned_only'); i.relation.set('q|0', 'B4_c0_unassigned_only');
    expect(patternsOf(i).B).toBe(false);
  });
});

describe('decideProvenance routing', () => {
  const none = { A: false, B: false, C: false, D: false, E: false };
  it('順序', () => {
    expect(decideProvenance({ gatesPass: true, b6: 0, joinComplete: true, patterns: { ...none, A: true } }).rule).toBe('D1');
    expect(decideProvenance({ gatesPass: true, b6: 0, joinComplete: true, patterns: { ...none, B: true } }).rule).toBe('D1');
    expect(decideProvenance({ gatesPass: true, b6: 0, joinComplete: true, patterns: { ...none, C: true } }).rule).toBe('D1');
    expect(decideProvenance({ gatesPass: true, b6: 0, joinComplete: true, patterns: none }).rule).toBe('D2');
    expect(decideProvenance({ gatesPass: true, b6: 1, joinComplete: true, patterns: { ...none, A: true } }).rule).toBe('D3');
    expect(decideProvenance({ gatesPass: true, b6: 0, joinComplete: false, patterns: none }).rule).toBe('D3');
    expect(decideProvenance({ gatesPass: false, b6: 0, joinComplete: true, patterns: { ...none, A: true } }).decision).toBe('INVALID');
  });
});
