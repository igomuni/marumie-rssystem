import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] };
const v0c = read<{ publisherAssignment: Record<string, string> }>('page-classification-v0-candidates.json');
const v0gt = read<{ rows: { localPdfPath: string; physicalPage: number }[] }>('page-classification-v0-visual-gt.json');
const v1 = read<{
  frozenInput: { rawTextCorpusDigestSha256: string };
  parameters: { riskCap: number; riskPerDomain: number };
  frozenPublishers: string[];
  summary: { rows: number; v0GtOverlap: number; byStratum: Record<string, number> };
  rows: { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; evaluationRole: string; strata: string[] }[];
}>('page-classification-v1-eval-candidates.json');
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const RISK = ['R1_NO_ACTIVE_STATE', 'R2_PRE_DIRECT_TRANSITION', 'R3_LONG_INHERITANCE_TAIL', 'R4_POST_BLANK_BRIDGE', 'R5_POST_RESET', 'R6_TITLE_OUTSIDE_DIRECT_WINDOW', 'R7_PDF_START_WITHOUT_DIRECT'];

describe('page classification v1 evaluation candidates (preregistration freeze)', () => {
  it('v0 の publisherAssignment をそのまま再利用し、candidate は FROZEN publisher のみ', () => {
    const frozen = Object.entries(v0c.publisherAssignment).filter(([, v]) => v === 'FROZEN_EVALUATION').map(([k]) => k).sort();
    expect(v1.frozenPublishers).toEqual(frozen);
    expect(v1.rows.every(r => frozen.includes(r.publisherDomain) && r.evaluationRole === 'FROZEN_EVALUATION_V1')).toBe(true);
    expect(v1.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
  });
  it('v0 GT key と重ならず、key が unique で、hash が frozen manifest と一致する', () => {
    const v0Keys = new Set(v0gt.rows.map(key));
    expect(v0Keys.size).toBe(172);
    expect(v1.rows.filter(r => v0Keys.has(key(r)))).toEqual([]);
    expect(v1.summary.v0GtOverlap).toBe(0);
    expect(new Set(v1.rows.map(key)).size).toBe(v1.rows.length);
    for (const r of v1.rows) {
      const d = raw.documents.find(x => x.localPdfPath === r.localPdfPath)!;
      expect([r.pdfSha256, r.textSha256]).toEqual([d.pdfSha256, d.pageTextSha256[r.physicalPage - 1]]);
    }
  });
  it('risk strata の publisher cap と件数上限が守られている', () => {
    for (const s of RISK) {
      const rows = v1.rows.filter(r => r.strata.includes(s));
      expect(rows.length).toBeLessThanOrEqual(v1.parameters.riskCap);
      const per: Record<string, number> = {};
      for (const r of rows) per[r.publisherDomain] = (per[r.publisherDomain] ?? 0) + 1;
      expect(Math.max(0, ...Object.values(per))).toBeLessThanOrEqual(v1.parameters.riskPerDomain);
    }
  });
  it('label を含まず、summary が rows と一致する', () => {
    expect(v1.rows.every(r => !('gt' in r))).toBe(true);
    expect(v1.rows).toHaveLength(v1.summary.rows);
    const c: Record<string, number> = {};
    for (const r of v1.rows) for (const s of r.strata) c[s] = (c[s] ?? 0) + 1;
    expect(c).toEqual(v1.summary.byStratum);
  });
});
