import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Pg = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; explored: { pr3aExplored: boolean; issue389Explored: boolean; pr3aRendered: boolean; issue389Rendered: boolean; issue389Tags: string[] } };
const inv = read<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; summary: { pages: number; direct: number; inherited: number; physicalPdfs: number; newSampleDenominator: number }; pages: Pg[] }>(path.join(dir, 'candidate-inventory.json'));
const sel = read<{ seed: string; poolSizes: Record<string, number>; newDevelopment: number; recheck: number; totalRender: number; pages: (Pg & { role: string; selectionStratum: string[]; inspectionRole: string })[] }>(path.join(dir, 'development-sample.json'));
const raw = read<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const col = read<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024', 'machine-inventory.json'));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('toc physical row failure isolation（A 層。analysis support のみ）', () => {
  it('TOC 82 = 55 + 27（55 PDF）で #389 inventory と同一 population、hash が Raw Text manifest と一致し、duplicate がない', () => {
    expect(inv.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect([inv.summary.pages, inv.summary.direct, inv.summary.inherited, inv.summary.physicalPdfs]).toEqual([82, 55, 27, 55]);
    expect(inv.pages.map(key).sort()).toEqual(col.pages.map(key).sort());
    expect(new Set(inv.pages.map(key)).size).toBe(82);
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of inv.pages) expect([docs.get(p.localPdfPath)!.pdfSha256, docs.get(p.localPdfPath)!.pageTextSha256[p.physicalPage - 1]]).toEqual([p.pdfSha256, p.textSha256]);
  });
  it('explored の統合: 新規 sample は PR-3A / #389 の explored と重ならず、RECHECK は #389 の H-A3 既知 4 case と一致する', () => {
    const seen = new Set(inv.pages.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored).map(key));
    const news = sel.pages.filter(p => p.role === 'NEW_DEVELOPMENT');
    const rech = sel.pages.filter(p => p.role === 'RECHECK');
    expect(news.filter(p => seen.has(key(p)))).toEqual([]);
    expect(inv.summary.newSampleDenominator).toBe(82 - seen.size);
    const h3 = inv.pages.filter(p => p.explored.issue389Tags.includes('OTHER:circled-request-number-not-in-raw')).map(key).sort();
    expect(h3).toHaveLength(4);
    expect(rech.map(key).sort()).toEqual(h3);
    expect([sel.newDevelopment, sel.recheck, sel.totalRender]).toEqual([news.length, rech.length, sel.pages.length]);
  });
  it('sample は重複なく inventory の page で、DEVELOPMENT_EXPLORATION と明示され、全 stratum に pool がある', () => {
    const keys = new Set(inv.pages.map(key));
    expect(new Set(sel.pages.map(key)).size).toBe(sel.pages.length);
    expect(sel.pages.every(p => keys.has(key(p)) && p.inspectionRole === 'DEVELOPMENT_EXPLORATION' && p.selectionStratum.length > 0)).toBe(true);
    for (const p of sel.pages.filter(x => x.role === 'NEW_DEVELOPMENT')) for (const s of p.selectionStratum) expect(sel.poolSizes[s]).toBeGreaterThan(0);
    expect(sel.seed).toMatch(/dev-/);
  });
});
