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
const ledger = read<{ pages: (Pg & { role: string; inspection: { rawTextViewed: boolean; renderViewed: boolean } })[] }>(path.join(dir, 'development-explored-pages.json'));
const result = read<{ population: { pages: number }; sample: { newDevelopment: number; recheck: number; rendered: number }; h_a1: { categories: Record<string, number> }; h_a3: { knownCases: number; rendered: number }; judgment: string }>(path.join(dir, 'result.json'));
const bandEv = read<{ summary: { pagesWithRightRow: number }; pages: { hasRightRow: boolean }[] }>(path.join(dir, 'boundary-band-evidence.json'));
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
  it('explored ledger は sample と 1:1 で、render 済み page 数・role が result と整合する', () => {
    expect(ledger.pages.map(key).sort()).toEqual(sel.pages.map(key).sort());
    expect(ledger.pages.every(p => p.inspection.rawTextViewed)).toBe(true);
    expect(ledger.pages.filter(p => p.inspection.renderViewed)).toHaveLength(result.sample.rendered);
    expect(ledger.pages.filter(p => p.role === 'NEW_DEVELOPMENT')).toHaveLength(result.sample.newDevelopment);
    expect(ledger.pages.filter(p => p.role === 'RECHECK')).toHaveLength(result.sample.recheck);
    expect(result.h_a3.rendered).toBe(result.h_a3.knownCases);
    expect(Object.values(result.h_a1.categories).reduce((a, b) => a + b, 0)).toBe(ledger.pages.length);
  });
  it('boundary band 補助分析は 82 page の inventory と整合し、右 row を持つ page 数が candidate inventory と一致する', () => {
    expect(bandEv.pages).toHaveLength(82);
    expect(bandEv.summary.pagesWithRightRow).toBe(bandEv.pages.filter(p => p.hasRightRow).length);
    expect(bandEv.summary.pagesWithRightRow).toBe(38);
    expect(result.population.pages).toBe(82);
  });
});
