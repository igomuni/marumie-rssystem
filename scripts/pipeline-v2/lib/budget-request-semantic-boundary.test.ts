import { describe, expect, it } from 'vitest';
import { BASIS, decideBoundary, mechanismOf, unclassifiedClassOf } from './budget-request-semantic-boundary';

describe('mechanismOf（recordKindBasis → M1〜M4）', () => {
  it('行単独の形 / stack・x-level・page 状態 / root / 説明できない', () => {
    expect(mechanismOf(BASIS.hyphen, null)).toBe('M1_row_local');
    expect(mechanismOf(BASIS.plainNoNode, 'no_name_token')).toBe('M1_row_local');
    expect(mechanismOf(BASIS.plainNoNode, null)).toBe('M4_unresolved');
    expect(mechanismOf(BASIS.childOfRoot, null)).toBe('M2_sequence_state');
    expect(mechanismOf(BASIS.nestedUnderRequest, null)).toBe('M2_sequence_state');
    expect(mechanismOf('code-only row nested under a detail_line in the observed hierarchy', null)).toBe('M2_sequence_state');
    expect(mechanismOf('hierarchy edge level_gap: kind not determined', null)).toBe('M2_sequence_state');
    expect(mechanismOf(BASIS.root, null)).toBe('M3_contract_dependent');
    expect(mechanismOf('something else', null)).toBe('M4_unresolved');
  });
  it('unclassified の分解', () => {
    expect(unclassifiedClassOf(BASIS.noEdge, null)).toBe('node_unplaced_no_edge');
    expect(unclassifiedClassOf('hierarchy edge level_gap: kind not determined', null)).toBe('level_gap');
    expect(unclassifiedClassOf(BASIS.plainNoNode, 'no_name_token')).toBe('no_node_row_shape_no_name_token');
    expect(unclassifiedClassOf(BASIS.plainNoNode, 'continuation_ambiguous')).toBe('no_node_unexplained');
    expect(unclassifiedClassOf('x', null)).toBe('other_unresolved');
  });
});

describe('decideBoundary', () => {
  const f = { populationReproduced: true, itemVsDetailSeparable: true, orgMechanismIdentified: true, m3Rows: 7 };
  it('規則 1〜5', () => {
    expect(decideBoundary(f)).toEqual({ decision: 'SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT', rule: 5 });
    expect(decideBoundary({ ...f, m3Rows: 0 }).decision).toBe('EXISTING_HIERARCHY_SEMANTIC_BOUNDARY_DETERMINISTIC_AND_PORTABLE');
    expect(decideBoundary({ ...f, orgMechanismIdentified: false }).decision).toBe('SEMANTIC_BOUNDARY_PARTIALLY_IDENTIFIED');
    expect(decideBoundary({ ...f, itemVsDetailSeparable: false, orgMechanismIdentified: false }).decision).toBe('NO_DETERMINISTIC_SEMANTIC_BOUNDARY_IDENTIFIED');
    expect(decideBoundary({ ...f, populationReproduced: false }).decision).toBe('INCONCLUSIVE');
  });
});
