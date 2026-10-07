import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
type Page = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierPageType: string; classifierSource: string; rawStatus: string; explicitTitleObserved: boolean };
const inv = read<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; summary: { coverRouted: number; tocRouted: number; tocExplicitTitleStarts: number; tocContinuationPages: number }; pages: Page[] }>('structure-inventory.json');
const sel = read<{ seed: string; poolSizes: Record<string, number>; sample: { localPdfPath: string; physicalPage: number; selectionStratum: string[] }[] }>('development-sample-selection.json');
const ledger = read<{ pages: (Page & { selectionStratum: string[]; inspectionRole: string; inspection: { rawTextViewed: boolean; renderViewed: boolean } })[] }>('development-explored-pages.json');
const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] };
const cls = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json'), 'utf8')) as { summary: { corpusClassificationDigestSha256: string; pageType: Record<string, number> } };
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('cover / toc structure inventory（PR-3A: observation only）', () => {
  it('frozen Raw Text・Page Classification に紐づき、COVER / TOC の件数が classifier manifest と一致する', () => {
    expect(inv.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect(inv.frozenInput.pageClassificationCorpusDigestSha256).toBe(cls.summary.corpusClassificationDigestSha256);
    expect(inv.summary.coverRouted).toBe(cls.summary.pageType.COVER);
    expect(inv.summary.tocRouted).toBe(cls.summary.pageType.TOC);
    expect(inv.summary.tocExplicitTitleStarts + inv.summary.tocContinuationPages).toBe(inv.summary.tocRouted);
  });
  it('target key が unique で、PDF / text hash が Raw Text manifest と一致する', () => {
    expect(new Set(inv.pages.map(key)).size).toBe(inv.pages.length);
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of inv.pages) {
      const d = docs.get(p.localPdfPath)!;
      expect([d.pdfSha256, d.pageTextSha256[p.physicalPage - 1]]).toEqual([p.pdfSha256, p.textSha256]);
      expect(['COVER', 'TOC']).toContain(p.classifierPageType);
      expect(p.explicitTitleObserved).toBe(p.classifierSource === 'DIRECT');
    }
  });
  it('explored-page ledger は unique で、全 page が inventory に存在し、DEVELOPMENT_EXPLORATION と明示されている', () => {
    const invKeys = new Set(inv.pages.map(key));
    expect(new Set(ledger.pages.map(key)).size).toBe(ledger.pages.length);
    expect(ledger.pages.every(p => invKeys.has(key(p)) && p.inspectionRole === 'DEVELOPMENT_EXPLORATION' && p.inspection.rawTextViewed)).toBe(true);
    expect(ledger.pages.map(key).sort()).toEqual(sel.sample.map(key).sort());
  });
  it('development sample の strata が pool に存在し、seed が記録されている', () => {
    expect(sel.seed).toMatch(/dev-exploration/);
    for (const s of sel.sample) for (const st of s.selectionStratum) expect(sel.poolSizes[st]).toBeGreaterThan(0);
  });
});
