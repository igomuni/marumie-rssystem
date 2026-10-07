import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as {
  frozenInput: { corpusDigestSha256: string };
  documents: { localPdfPath: string; pdfSha256: string; status: string; emptyPages: number[]; pageTextSha256: string[] }[];
};
const iso = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'empty-page-failure-isolation.json'), 'utf8')) as {
  frozenInput: { rawTextCorpusDigestSha256: string; targetPages: number };
  summary: { unresolved: number; byCategory: Record<string, number> };
  pages: { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; rawTextStatus: string; isolationCategory: string }[];
};

// PR-2 Phase A: failure isolation record が frozen Raw Text と一致する（page type は含まない）
describe('budget-request empty page failure isolation record', () => {
  it('frozen Raw Text の corpus digest を参照し、対象は EXTRACTED 文書内の EMPTY page 全件（117）', () => {
    expect(iso.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    const expected = raw.documents.filter(d => d.status === 'EXTRACTED').flatMap(d => d.emptyPages.map(p => `${d.localPdfPath}#${p}`)).sort();
    expect(expected).toHaveLength(117);
    expect(iso.pages.map(p => `${p.localPdfPath}#${p.physicalPage}`).sort()).toEqual(expected);
  });
  it('record の hash が frozen manifest と一致し、key が unique', () => {
    expect(new Set(iso.pages.map(p => `${p.localPdfPath}#${p.physicalPage}`)).size).toBe(117);
    for (const p of iso.pages) {
      const d = raw.documents.find(x => x.localPdfPath === p.localPdfPath)!;
      expect(p.pdfSha256).toBe(d.pdfSha256);
      expect(p.textSha256).toBe(d.pageTextSha256[p.physicalPage - 1]);
      expect(p.rawTextStatus).toBe('EMPTY');
    }
  });
  it('category の集計が page record と一致する', () => {
    const c: Record<string, number> = {};
    for (const p of iso.pages) c[p.isolationCategory] = (c[p.isolationCategory] ?? 0) + 1;
    expect(c).toEqual(iso.summary.byCategory);
    expect(iso.summary.unresolved).toBe(iso.pages.filter(p => p.isolationCategory === 'UNRESOLVED').length);
  });
});
