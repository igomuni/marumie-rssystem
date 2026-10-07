import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Page = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; renderedInPr3a: boolean; developmentExploredInPr3a: boolean };
const inv = read<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; summary: { pages: number; direct: number; inherited: number }; pages: Page[] }>(path.join(dir, 'machine-inventory.json'));
const sel = read<{ seed: string; previouslyRenderedInPr3aExcluded: string[]; poolSizes: Record<string, number>; sampleSize: number; sample: (Page & { selectionStratum: string[]; inspectionRole: string })[] }>(path.join(dir, 'development-sample-selection.json'));
const raw = read<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const pr3a = read<{ pages: { localPdfPath: string; physicalPage: number; classifierPageType: string; inspection: { renderViewed: boolean } }[] }>(path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json'));
const cls = read<{ summary: { corpusClassificationDigestSha256: string; pageType: Record<string, number> } }>(path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json'));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('toc column structure inventory（failure isolation: observation only）', () => {
  it('82 = DIRECT 55 + INHERITED 27 で frozen digest に紐づき、page key が unique・hash が Raw Text manifest と一致する', () => {
    expect(inv.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect(inv.frozenInput.pageClassificationCorpusDigestSha256).toBe(cls.summary.corpusClassificationDigestSha256);
    expect([inv.summary.pages, inv.summary.direct, inv.summary.inherited]).toEqual([82, 55, 27]);
    expect(inv.summary.pages).toBe(cls.summary.pageType.TOC);
    expect(new Set(inv.pages.map(key)).size).toBe(82);
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of inv.pages) expect([docs.get(p.localPdfPath)!.pdfSha256, docs.get(p.localPdfPath)!.pageTextSha256[p.physicalPage - 1]]).toEqual([p.pdfSha256, p.textSha256]);
  });
  it('PR-3A の explored ledger と整合し、render 済み 3 page は新規 sample から除外されている', () => {
    const rendered = pr3a.pages.filter(p => p.classifierPageType === 'TOC' && p.inspection.renderViewed).map(key).sort();
    expect(rendered).toHaveLength(3);
    expect(sel.previouslyRenderedInPr3aExcluded).toEqual(rendered);
    expect(inv.pages.filter(p => p.renderedInPr3a).map(key).sort()).toEqual(rendered);
    expect(sel.sample.filter(s => rendered.includes(key(s)))).toEqual([]);
  });
  it('development sample は inventory の page で、重複なく、DEVELOPMENT_EXPLORATION と明示されている', () => {
    const invKeys = new Set(inv.pages.map(key));
    expect(new Set(sel.sample.map(key)).size).toBe(sel.sample.length);
    expect(sel.sampleSize).toBe(sel.sample.length);
    expect(sel.sample.every(s => invKeys.has(key(s)) && s.inspectionRole === 'DEVELOPMENT_EXPLORATION' && s.selectionStratum.length > 0)).toBe(true);
    expect(sel.seed).toMatch(/dev-/);
  });
});
