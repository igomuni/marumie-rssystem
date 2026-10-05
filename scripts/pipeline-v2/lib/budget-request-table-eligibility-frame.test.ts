import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { decideTableEligibility, filterLogicalRows, nodeSupport, supportEffect, t2ParentOf, type TableEligibilityFacts } from './budget-request-table-eligibility-frame';

const rules = [{ x: 10, yMin: 100, yMax: 700 }, { x: 500, yMin: 100, yMax: 700 }];
describe('nodeSupport（既存 relationOf の再利用）', () => {
  it('frame 内は support、上側（header）・frame なし・geometry なし・はみ出しは support でない', () => {
    expect(nodeSupport({ xMin: 20, xMax: 400, yMin: 200, yMax: 210 }, rules).supportEligible).toBe(true);
    expect(nodeSupport({ xMin: 20, xMax: 400, yMin: 50, yMax: 60 }, rules)).toMatchObject({ supportEligible: false, rel: { relation: 'header_position_supported' } });
    expect(nodeSupport({ xMin: 20, xMax: 600, yMin: 200, yMax: 210 }, rules)).toMatchObject({ supportEligible: false, rel: { relation: 'ambiguous' } });
    expect(nodeSupport({ xMin: 20, xMax: 400, yMin: 200, yMax: 210 }, [])).toMatchObject({ supportEligible: false, rel: { relation: 'unavailable' } });
    expect(nodeSupport(null, rules)).toMatchObject({ supportEligible: false, rel: { relation: 'unavailable' } });
  });
});
describe('補助関数', () => {
  it('filterLogicalRows / supportEffect / t2ParentOf', () => {
    expect(filterLogicalRows([{ logicalRowIndex: 0 }, { logicalRowIndex: 1 }, { logicalRowIndex: 2 }], new Set([1])).map(r => r.logicalRowIndex)).toEqual([0, 2]);
    expect([supportEffect(0, 3), supportEffect(1, 3), supportEffect(3, 3)]).toEqual(['support_removed', 'support_reduced', 'support_maintained']);
    const t2 = [{ clusterIndex: 0, xMin: 10, xMax: 12 }, { clusterIndex: 1, xMin: 20, xMax: 30 }];
    expect(t2ParentOf({ xMin: 21, xMax: 25 }, t2)).toBe(1);
    expect(t2ParentOf({ xMin: 11, xMax: 21 }, t2)).toBeNull();
  });
});
describe('decideTableEligibility routing（synthetic）', () => {
  const base: TableEligibilityFacts = { gatesPass: true, nonHierarchyChangedRows: 0, primaryRows: 1000, primaryUnassignedRows: 0, primaryFrameBuilt: [true, true], b4Total: 10, b4RemovedOrReduced: 8, sameRangeChangedRows: 0, newClusters: 0, primaryNewChangeRows: 0 };
  const d = (o: Partial<TableEligibilityFacts>) => decideTableEligibility({ ...base, ...o }).rule;
  it('各 decision', () => {
    expect(d({})).toBe('D1');
    expect(d({ sameRangeChangedRows: 1 })).toBe('D2');
    expect(d({ b4RemovedOrReduced: 5 })).toBe('D3');
    expect(d({ b4RemovedOrReduced: 6 })).toBe('D1');
    expect(d({ primaryUnassignedRows: 101 })).toBe('D4');
    expect(d({ primaryUnassignedRows: 100 })).toBe('D1');
    expect(d({ primaryFrameBuilt: [true, false] })).toBe('D4');
    expect(d({ primaryNewChangeRows: 51 })).toBe('D5');
    expect(d({ primaryNewChangeRows: 50 })).toBe('D1');
    expect(d({ gatesPass: false })).toBe('D0');
    expect(d({ nonHierarchyChangedRows: 1 })).toBe('D0');
    expect(d({ newClusters: 1 })).toBe('gap');
  });
  it('優先順: D4 > D3 > D2 > D5', () => {
    expect(d({ primaryUnassignedRows: 500, b4RemovedOrReduced: 0, sameRangeChangedRows: 3 })).toBe('D4');
    expect(d({ b4RemovedOrReduced: 0, sameRangeChangedRows: 3, primaryNewChangeRows: 900 })).toBe('D3');
    expect(d({ sameRangeChangedRows: 3, primaryNewChangeRows: 900 })).toBe('D2');
  });
});
describe('Phase A は基準 frame・基準範囲・外部照合を参照しない（source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-table-eligibility-frame.ts', 'scripts/pipeline-v2/run-budget-request-table-eligibility-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/\.manual\b/, /\bh0\b/, /hierarchy-level-frame/, /hierarchy-stack-reset/, /cluster-provenance\/2024\/phaseB/, /replayStack/, /mof-|budget-jikou|MofBudget|mofJikou/, /controlClusters/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
