import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Page = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; renderedInPr3a: boolean; developmentExploredInPr3a: boolean };
const inv = read<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; summary: { pages: number; direct: number; inherited: number }; pages: Page[] }>(path.join(dir, 'machine-inventory.json'));
const sel = read<{ seed: string; previouslyRenderedInPr3aExcluded: string[]; poolSizes: Record<string, number>; sampleSize: number; sample: (Page & { selectionStratum: string[]; inspectionRole: string })[] }>(path.join(dir, 'development-sample-selection.json'));
const raw = read<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const ledger12 = read<{ pages: (Page & { selectionStratum: string[]; inspectionRole: string; inspection: { rawTextViewed: boolean; renderViewed: boolean }; failureTags: string[] })[] }>(path.join(dir, 'development-explored-pages.json'));
const boundary = read<{ summary: { pages: number; pagesWithRightRowLine: number }; pages: { localPdfPath: string; physicalPage: number; rightRowLineCount: number }[] }>(path.join(dir, 'column-boundary-evidence.json'));
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
  it('explored-page ledger は sample と 1:1 で、render 済み page 数が記録され、DEVELOPMENT_EXPLORATION と明示されている', () => {
    expect(ledger12.pages.map(key).sort()).toEqual(sel.sample.map(key).sort());
    expect(ledger12.pages.every(p => p.inspectionRole === 'DEVELOPMENT_EXPLORATION' && p.inspection.rawTextViewed)).toBe(true);
    expect(ledger12.pages.filter(p => p.inspection.renderViewed)).toHaveLength(10);
  });
  it('machine の right-row 観測量は render 確認した page の視覚（右 column 空 / 使用）と一致する（記述的な照合）', () => {
    expect(boundary.summary.pages).toBe(82);
    const byKey = new Map(boundary.pages.map(p => [key(p), p.rightRowLineCount]));
    for (const p of ledger12.pages.filter(x => x.inspection.renderViewed)) {
      const empty = p.failureTags.includes('RIGHT_COLUMN_EMPTY');
      expect(byKey.get(key(p))! === 0).toBe(empty);
    }
    // PR-3A の「両 page 参照候補 81/82」は request-number 行に混線した指標で、右 row 開始の観測は 38/82
    expect(boundary.summary.pagesWithRightRowLine).toBe(boundary.pages.filter(p => p.rightRowLineCount > 0).length);
  });
});
