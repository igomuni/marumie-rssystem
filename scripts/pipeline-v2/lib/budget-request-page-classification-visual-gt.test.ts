import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const cand = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v0-candidates.json'), 'utf8')) as { rows: { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string }[] };
const gt = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v0-visual-gt.json'), 'utf8')) as {
  preregistration: { commit: string };
  summary: { rows: number; sourceHashMismatch: number; unresolved: number; byRole: Record<string, number> };
  rows: { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string; gt: { pageType: string; evidence: string } }[];
};
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];

describe('page classification v0 visual GT freeze', () => {
  it('candidate と 1:1 で、hash・split が candidate freeze と一致する', () => {
    const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
    expect(gt.rows.map(key).sort()).toEqual(cand.rows.map(key).sort());
    const byKey = new Map(cand.rows.map(r => [key(r), r]));
    for (const r of gt.rows) {
      const c = byKey.get(key(r))!;
      expect([r.pdfSha256, r.textSha256, r.evaluationRole]).toEqual([c.pdfSha256, c.textSha256, c.evaluationRole]);
    }
  });
  it('全 row に visual label があり、vocabulary 内で、summary と一致する', () => {
    expect(gt.rows.every(r => r.gt.evidence === 'VISUAL' && TYPES.includes(r.gt.pageType))).toBe(true);
    expect(gt.summary.rows).toBe(gt.rows.length);
    expect(gt.summary.sourceHashMismatch).toBe(0);
    expect(gt.summary.unresolved).toBe(gt.rows.filter(r => r.gt.pageType === 'UNRESOLVED').length);
    expect(gt.rows.filter(r => r.evaluationRole === 'FROZEN_EVALUATION')).toHaveLength(gt.summary.byRole.FROZEN_EVALUATION);
  });
  it('preregistration commit を記録している', () => {
    expect(gt.preregistration.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
