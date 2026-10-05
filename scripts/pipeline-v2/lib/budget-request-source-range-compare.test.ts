import { describe, expect, it } from 'vitest';
import { classifyChange, decidePaired, hierarchyDerivedChanged, inventoryOf, type RowRec } from './budget-request-source-range-compare';

const row = (over: Partial<RowRec> = {}): RowRec => ({
  kind: 'detail_line', basis: 'x', codeRaw: '001', nameStatus: 'resolved', nameReason: null, nameRaw: '名', parentItem: { status: 'not_applicable', ref: null }, parentOrg: { status: 'not_applicable', ref: null },
  node: { isNode: true, level: 3, clusterX: [72, 72.5], edgeStatus: 'resolved_by_indent_sequence', parentId: 'p1', root: false }, geometry: [1, 2, 3, 4], tokenRefs: [1], ...over,
});

describe('classifyChange（排他的 primary と multi-label flag）', () => {
  it('unchanged / kind 変化の 3 種 / root / parent / level / other', () => {
    expect(classifyChange(row(), row()).primary).toBe('unchanged');
    expect(classifyChange(row(), row({ kind: 'unclassified' })).primary).toBe('newly_unclassified');
    expect(classifyChange(row({ kind: 'unclassified' }), row({ kind: 'item' })).primary).toBe('unclassified_resolved');
    expect(classifyChange(row({ kind: 'item' }), row({ kind: 'organization' })).primary).toBe('record_kind_changed');
    expect(classifyChange(row(), row({ node: { ...row().node, root: true } })).primary).toBe('root_changed');
    expect(classifyChange(row(), row({ parentItem: { status: 'resolved', ref: 'a' } })).primary).toBe('parent_changed');
    expect(classifyChange(row(), row({ node: { ...row().node, level: 2 } })).primary).toBe('level_changed');
    expect(classifyChange(row(), row({ nameStatus: 'ambiguous' })).primary).toBe('other_changed');
  });
  it('複数の変化は flag に全て残し、primary は優先順の先頭。other_changed のみなら hierarchy-derived ではない', () => {
    const r = classifyChange(row(), row({ kind: 'unclassified', node: { ...row().node, level: null, isNode: false }, nameStatus: 'ambiguous' }));
    expect(r.primary).toBe('newly_unclassified');
    expect(r.flags).toEqual(['newly_unclassified', 'level_changed', 'other_changed']);
    expect(hierarchyDerivedChanged(['other_changed'])).toBe(false);
    expect(hierarchyDerivedChanged(r.flags)).toBe(true);
  });
});

describe('inventoryOf / decidePaired', () => {
  it('region の件数', () => {
    const inv = inventoryOf([row({ kind: 'item', node: { ...row().node, root: false } }), row({ kind: 'request', parentItem: { status: 'resolved', ref: 'a' } }), row({ kind: 'unclassified', node: { isNode: false, level: null, clusterX: null, edgeStatus: 'level_gap', parentId: null, root: false } })]);
    expect(inv).toMatchObject({ rows: 3, items: 1, requests: 1, parentResolved: 1, unclassified: 1, levelGap: 1, nodes: 2, distinctClusters: 1 });
  });
  it('D4 → D2 → D3 → D1', () => {
    const ok = { infrastructureOk: true, sameRangeExact: true, intersectionChangedRows: 0, sourceOnlyItems: 5, sourceOnlyOrganizations: 0, sourceOnlyResolvedRequests: 3 };
    expect(decidePaired(ok).decision).toBe('SOURCE_RANGE_DROP_IN_REPLACEMENT_SUPPORTED');
    expect(decidePaired({ ...ok, intersectionChangedRows: 1 }).decision).toBe('ACTIVATION_RANGE_CHANGES_HIERARCHY_STATE');
    expect(decidePaired({ ...ok, sourceOnlyItems: 0, sourceOnlyResolvedRequests: 0 }).decision).toBe('SOURCE_RANGE_ADDS_ONLY_NONSEMANTIC_OR_ABSTAINED_STRUCTURE');
    expect(decidePaired({ ...ok, sameRangeExact: false }).decision).toBe('PAIRED_DIAGNOSTIC_INCONCLUSIVE');
    expect(decidePaired({ ...ok, infrastructureOk: false, intersectionChangedRows: 9 }).decision).toBe('PAIRED_DIAGNOSTIC_INCONCLUSIVE');
  });
});
