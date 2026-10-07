import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
type Row = { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string; strata: string[]; gt: { pageType: string; evidence: string } };
const cand = read<{ rows: Row[] }>('page-classification-v2-candidates.json');
const v0 = read<{ rows: Row[] }>('page-classification-v0-visual-gt.json');
const v1 = read<{ rows: Row[] }>('page-classification-v1-eval-visual-gt.json');
const gt = read<{
  preregistrationCommit: string;
  priorGt: { exclusionUniqueKeys: number };
  summary: { rows: number; priorGtOverlap: number; sourceHashMismatch: number };
  adequacy: { coreFamilyCounts: Record<string, number>; directCoreCounts: Record<string, number>; continuationCounts: Record<string, number>; coreOk: boolean; directOk: boolean; continuationOk: boolean; openSetSafety: string; outOfScopeFalseResolution: string; outOfScopeFalseResolutionTargetRows: number; judgment: string };
  rows: Row[];
}>('page-classification-v2-visual-gt.json');
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];
const CORE = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING'];
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('page classification v2 visual GT freeze', () => {
  it('candidate と 1:1 で hash が一致し、prior GT と重ならない', () => {
    expect(gt.rows.map(key).sort()).toEqual(cand.rows.map(key).sort());
    const byKey = new Map(cand.rows.map(r => [key(r), r]));
    for (const r of gt.rows) expect([r.pdfSha256, r.textSha256]).toEqual([byKey.get(key(r))!.pdfSha256, byKey.get(key(r))!.textSha256]);
    const excl = new Set([...v0.rows, ...v1.rows].map(key));
    expect(excl.size).toBe(gt.priorGt.exclusionUniqueKeys);
    expect(gt.rows.filter(r => excl.has(key(r)))).toEqual([]);
    expect([gt.summary.priorGtOverlap, gt.summary.sourceHashMismatch]).toEqual([0, 0]);
  });
  it('全 row が VISUAL label で vocabulary 内、preregistration commit を記録', () => {
    expect(gt.rows.every(r => r.gt.evidence === 'VISUAL' && TYPES.includes(r.gt.pageType) && r.evaluationRole === 'FROZEN_EVALUATION_V2')).toBe(true);
    expect(gt.preregistrationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('adequacy summary が GT rows から決定的に再計算でき、openSetSafety は常に NOT_EVALUATED', () => {
    const n = (f: string, s?: string) => gt.rows.filter(r => r.gt.pageType === f && (!s || r.strata.includes(s))).length;
    for (const f of CORE) {
      expect(gt.adequacy.coreFamilyCounts[f]).toBe(n(f));
      expect(gt.adequacy.directCoreCounts[f]).toBe(n(f, 'DIRECT_BALANCED_V2'));
    }
    for (const f of ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING']) expect(gt.adequacy.continuationCounts[f]).toBe(n(f, 'CONTINUATION_BALANCED_V2'));
    expect(gt.adequacy.coreOk).toBe(CORE.every(f => n(f) >= 10));
    expect(gt.adequacy.directOk).toBe(CORE.every(f => n(f, 'DIRECT_BALANCED_V2') >= 5));
    expect(gt.adequacy.continuationOk).toBe(['TOC', 'SUMMARY', 'DETAIL', 'STAFFING'].every(f => n(f, 'CONTINUATION_BALANCED_V2') >= 5));
    const ok = gt.adequacy.coreOk && gt.adequacy.directOk && gt.adequacy.continuationOk && gt.summary.sourceHashMismatch === 0;
    expect(gt.adequacy.judgment).toBe(ok ? 'ADEQUATE / STOP FOR REVIEW' : 'INSUFFICIENT / STOP');
    const neg = gt.rows.filter(r => r.gt.pageType === 'OTHER' || r.gt.pageType === 'UNRESOLVED').length;
    expect(gt.adequacy.outOfScopeFalseResolutionTargetRows).toBe(neg);
    expect(gt.adequacy.outOfScopeFalseResolution).toBe(neg === 0 ? 'NOT EVALUABLE' : 'EVALUABLE');
    expect(gt.adequacy.openSetSafety).toBe('NOT_EVALUATED');
  });
});
