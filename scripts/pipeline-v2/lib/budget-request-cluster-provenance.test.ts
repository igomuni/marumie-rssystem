import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { classifyCluster, layoutRangeOf, lexicalClassOf, pageRuns } from './budget-request-cluster-provenance';

describe('pageRuns / lexicalClassOf', () => {
  it('連続 page を run にまとめ、重複を support count に数える', () => {
    expect(pageRuns([3, 1, 2, 2, 7, 9, 8])).toEqual([{ start: 1, end: 3, supportCount: 4 }, { start: 7, end: 9, supportCount: 3 }]);
    expect(pageRuns([])).toEqual([]);
  });
  it('lexical class', () => {
    expect(lexicalClassOf('request_no_then_code', '01-95')).toBe('request_like');
    expect(lexicalClassOf('code3_then_text', '123')).toBe('plain3');
    expect(lexicalClassOf('code3_then_text', '12-3')).toBe('hyphen_other');
    expect(lexicalClassOf('code3_then_text', '1234')).toBe('other_numeric');
    expect(lexicalClassOf('code3_then_text', 'ab')).toBe('non_code');
  });
});
describe('classifyCluster / layoutRangeOf', () => {
  const s = (page: number, id: string, shape = 'code3_then_text') => ({ page, layoutRangeId: id, lexical: lexicalClassOf(shape, '123'), rowShape: shape });
  it('各軸', () => {
    expect(classifyCluster([s(1, 'a'), s(1, 'a')])).toMatchObject({ supportExtent: 'single_page', layoutConcentration: 'single_layout_range', documentDistribution: 'contiguous' });
    expect(classifyCluster([s(1, 'a'), s(2, 'b')])).toMatchObject({ supportExtent: 'multi_page_single_run', layoutConcentration: 'multiple_layout_ranges' });
    expect(classifyCluster([s(1, 'unassigned'), s(5, 'unassigned')])).toMatchObject({ supportExtent: 'multi_run', layoutConcentration: 'layout_unavailable', documentDistribution: 'reappears_in_separate_runs' });
    expect(classifyCluster([])).toMatchObject({ supportExtent: 'unclassifiable' });
    expect(classifyCluster([s(1, 'a', 'request_no_then_code'), s(1, 'a')]).request).toEqual({ requestShaped: 1, nonRequest: 1, mixed: true });
  });
  it('layout range（gap page は unassigned、H:- は detail ではない）', () => {
    const ranges = [{ from: 1, to: 10, gapPages: [5], signature: 'H:w842|R:66' }, { from: 11, to: 12, gapPages: [], signature: 'H:-|R:multi' }];
    expect(layoutRangeOf(3, ranges)).toEqual({ id: '1-10', signature: 'H:w842|R:66', detail: true });
    expect(layoutRangeOf(5, ranges).id).toBe('unassigned');
    expect(layoutRangeOf(11, ranges).detail).toBe(false);
  });
});
describe('Phase A は基準 frame・基準範囲・外部照合を参照しない（A4 source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-cluster-provenance.ts', 'scripts/pipeline-v2/run-budget-request-cluster-provenance-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/\.manual\b/, /\bh0\b/, /hierarchy-level-frame/, /hierarchy-stack-reset/, /assignToFrame/, /mof-|budget-jikou|MofBudget|mofJikou/, /controlClusters/, /replayStack/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
