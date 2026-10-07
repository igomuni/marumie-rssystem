import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as {
  frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; publisherDomain: string; pageTextSha256: string[] }[];
};
const c = JSON.parse(fs.readFileSync(path.join(dir, 'page-classification-v0-candidates.json'), 'utf8')) as {
  frozenInput: { rawTextCorpusDigestSha256: string };
  population: { physicalPages: number; textObservable: number };
  parameters: { seed: string };
  summary: { rows: number; byRole: Record<string, number>; publisherOverlap: number };
  rows: { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; strata: string[]; evaluationRole: string }[];
};

describe('page classification v0 candidates (preregistration freeze)', () => {
  it('frozen Raw Text に紐づき、母集団は 9,899 / 8,968', () => {
    expect(c.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect([c.population.physicalPages, c.population.textObservable]).toEqual([9899, 8968]);
  });
  it('key が unique で、hash が frozen manifest と一致する', () => {
    expect(new Set(c.rows.map(r => `${r.localPdfPath}#${r.physicalPage}`)).size).toBe(c.rows.length);
    for (const r of c.rows) {
      const d = raw.documents.find(x => x.localPdfPath === r.localPdfPath)!;
      expect(r.pdfSha256).toBe(d.pdfSha256);
      expect(r.textSha256).toBe(d.pageTextSha256[r.physicalPage - 1]);
      expect(r.publisherDomain).toBe(d.publisherDomain);
    }
  });
  it('split は publisher 単位で overlap が無く、件数が summary と一致する', () => {
    const by = (role: string) => new Set(c.rows.filter(r => r.evaluationRole === role).map(r => r.publisherDomain));
    expect([...by('DEVELOPMENT')].filter(x => by('FROZEN_EVALUATION').has(x))).toEqual([]);
    expect(c.summary.publisherOverlap).toBe(0);
    expect(c.rows.filter(r => r.evaluationRole === 'DEVELOPMENT')).toHaveLength(c.summary.byRole.DEVELOPMENT);
    expect(c.rows).toHaveLength(c.summary.rows);
  });
  it('label を含まない（GT は別 fixture）', () => {
    expect(c.rows.every(r => !('gt' in r))).toBe(true);
  });
});
