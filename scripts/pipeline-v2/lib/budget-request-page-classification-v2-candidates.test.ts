import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] };
const v0 = read<{ rows: { localPdfPath: string; physicalPage: number }[] }>('page-classification-v0-visual-gt.json');
const v1 = read<{ rows: { localPdfPath: string; physicalPage: number }[] }>('page-classification-v1-eval-visual-gt.json');
const c = read<{
  frozenInput: { rawTextCorpusDigestSha256: string };
  parameters: { directPerFamily: number; continuationPerFamilyBucket: number; riskCap: number; randomPages: number };
  priorGtExclusion: { v0Rows: number; v1Rows: number; uniqueKeys: number };
  population: { physicalPages: number; textObservable: number };
  summary: { rows: number; byStratum: Record<string, number>; priorGtOverlap: number };
  rows: { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; evaluationRole: string; strata: string[]; samplingObservation: { directResult: string | null; activeStateFamily: string | null; distanceBucket: string | null } }[];
}>('page-classification-v2-candidates.json');
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('page classification v2 candidates (preregistration freeze)', () => {
  it('prior GT（v0 172・v1 89）の unique key を全て除外し、frozen Raw Text に紐づく', () => {
    const excl = new Set([...v0.rows, ...v1.rows].map(key));
    expect([v0.rows.length, v1.rows.length, excl.size]).toEqual([c.priorGtExclusion.v0Rows, c.priorGtExclusion.v1Rows, c.priorGtExclusion.uniqueKeys]);
    expect(c.rows.filter(r => excl.has(key(r)))).toEqual([]);
    expect(c.summary.priorGtOverlap).toBe(0);
    expect(c.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect([c.population.physicalPages, c.population.textObservable]).toEqual([9899, 8968]);
  });
  it('key が unique で hash が一致し、label を含まない', () => {
    expect(new Set(c.rows.map(key)).size).toBe(c.rows.length);
    for (const r of c.rows) {
      const d = raw.documents.find(x => x.localPdfPath === r.localPdfPath)!;
      expect([r.pdfSha256, r.textSha256]).toEqual([d.pdfSha256, d.pageTextSha256[r.physicalPage - 1]]);
      expect(r.evaluationRole).toBe('FROZEN_EVALUATION_V2');
      expect('gt' in r).toBe(false);
    }
  });
  it('DIRECT family cap・CONTINUATION family×bucket cap・risk cap・random 件数が守られる', () => {
    const direct: Record<string, number> = {};
    const cont: Record<string, number> = {};
    for (const r of c.rows) {
      if (r.strata.includes('DIRECT_BALANCED_V2')) direct[r.samplingObservation.directResult!] = (direct[r.samplingObservation.directResult!] ?? 0) + 1;
      if (r.strata.includes('CONTINUATION_BALANCED_V2')) { const k = `${r.samplingObservation.activeStateFamily}|${r.samplingObservation.distanceBucket}`; cont[k] = (cont[k] ?? 0) + 1; }
    }
    expect(Math.max(0, ...Object.values(direct))).toBeLessThanOrEqual(c.parameters.directPerFamily);
    expect(Math.max(0, ...Object.values(cont))).toBeLessThanOrEqual(c.parameters.continuationPerFamilyBucket);
    for (const [s, n] of Object.entries(c.summary.byStratum)) if (s.startsWith('KNOWN_COVERAGE_RISK_V2')) expect(n).toBeLessThanOrEqual(c.parameters.riskCap);
    expect(c.summary.byStratum.CORPUS_RANDOM_V2).toBe(c.parameters.randomPages);
  });
  it('summary が rows と一致する（duplicate 排除済み）', () => {
    const t: Record<string, number> = {};
    for (const r of c.rows) for (const s of r.strata) t[s] = (t[s] ?? 0) + 1;
    expect(t).toEqual(c.summary.byStratum);
    expect(c.rows).toHaveLength(c.summary.rows);
  });
});
