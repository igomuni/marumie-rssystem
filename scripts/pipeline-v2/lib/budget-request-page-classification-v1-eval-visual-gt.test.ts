import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const cand = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v1-eval-candidates.json'), 'utf8')) as { rows: { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; strata: string[] }[] };
const v0 = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v0-visual-gt.json'), 'utf8')) as { rows: { localPdfPath: string; physicalPage: number }[] };
const gt = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v1-eval-visual-gt.json'), 'utf8')) as {
  preregistrationCommit: string;
  summary: { rows: number; sourceHashMismatch: number; v0GtOverlap: number };
  adequacy: { safety: { safetyNegativeRows: number; safetyNegativePublisherDomains: number; safetyNegativeRiskStrata: string[]; result: string }; semanticCoverage: { coreFamilyCounts: Record<string, number>; continuationOrRiskCountsByFamily: Record<string, number>; result: string }; judgment: string };
  rows: { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; publisherDomain: string; evaluationRole: string; strata: string[]; gt: { pageType: string; evidence: string } }[];
};
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('page classification v1 evaluation visual GT freeze', () => {
  it('candidate と 1:1 で、hash が一致し、v0 GT と重ならない', () => {
    expect(gt.rows.map(key).sort()).toEqual(cand.rows.map(key).sort());
    const byKey = new Map(cand.rows.map(r => [key(r), r]));
    for (const r of gt.rows) expect([r.pdfSha256, r.textSha256]).toEqual([byKey.get(key(r))!.pdfSha256, byKey.get(key(r))!.textSha256]);
    const v0Keys = new Set(v0.rows.map(key));
    expect(gt.rows.filter(r => v0Keys.has(key(r)))).toEqual([]);
    expect(gt.summary.v0GtOverlap).toBe(0);
    expect(gt.summary.sourceHashMismatch).toBe(0);
  });
  it('全 row が VISUAL label で vocabulary 内、preregistration commit を記録', () => {
    expect(gt.rows.every(r => r.gt.evidence === 'VISUAL' && TYPES.includes(r.gt.pageType) && r.evaluationRole === 'FROZEN_EVALUATION_V1')).toBe(true);
    expect(gt.preregistrationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('adequacy summary が GT rows から決定的に再計算できる', () => {
    const RISK = ['R1_NO_ACTIVE_STATE', 'R2_PRE_DIRECT_TRANSITION', 'R3_LONG_INHERITANCE_TAIL', 'R4_POST_BLANK_BRIDGE', 'R5_POST_RESET', 'R6_TITLE_OUTSIDE_DIRECT_WINDOW', 'R7_PDF_START_WITHOUT_DIRECT'];
    const CONT = ['CONTINUATION_BALANCED', 'R2_PRE_DIRECT_TRANSITION', 'R3_LONG_INHERITANCE_TAIL', 'R4_POST_BLANK_BRIDGE'];
    const neg = gt.rows.filter(r => r.gt.pageType === 'OTHER' || r.gt.pageType === 'UNRESOLVED');
    expect(gt.adequacy.safety.safetyNegativeRows).toBe(neg.length);
    expect(gt.adequacy.safety.safetyNegativePublisherDomains).toBe(new Set(neg.map(r => r.publisherDomain)).size);
    expect(gt.adequacy.safety.safetyNegativeRiskStrata).toEqual([...new Set(neg.flatMap(r => r.strata.filter(s => RISK.includes(s))))].sort());
    for (const [f, n] of Object.entries(gt.adequacy.semanticCoverage.coreFamilyCounts)) expect(n).toBe(gt.rows.filter(r => r.gt.pageType === f).length);
    for (const [f, n] of Object.entries(gt.adequacy.semanticCoverage.continuationOrRiskCountsByFamily)) expect(n).toBe(gt.rows.filter(r => r.gt.pageType === f && r.strata.some(s => CONT.includes(s))).length);
    const ok = neg.length >= 10 && gt.adequacy.safety.safetyNegativePublisherDomains >= 2 && gt.adequacy.safety.safetyNegativeRiskStrata.length >= 2;
    expect(gt.adequacy.safety.result).toBe(ok ? 'SUFFICIENT' : 'INSUFFICIENT');
  });
});
