import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { buildPageRawText, sha256Hex } from './budget-request-raw-text';

const DIR = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024');
type Doc = { localPdfPath: string; pdfSha256?: string; artifactSha256?: string; pageCount?: number; status: string; emptyPages?: number[]; pageTextSha256?: string[]; charCount?: number; nonWhitespaceCharCount?: number };
const m = JSON.parse(fs.readFileSync(path.join(DIR, 'raw-text-manifest.json'), 'utf8')) as {
  frozenInput: { logicalDocuments: number; physicalPdfs: number; physicalPages: number; status: Record<string, number>; charCount: number; nonWhitespaceCharCount: number; corpusDigestSha256: string };
  documents: Doc[];
};
const rep = JSON.parse(fs.readFileSync(path.join(DIR, 'representative-pages.json'), 'utf8')) as { pages: { localPdfPath: string; page: number; pageCount: number; text: string; textSha256: string; status: string }[] };

// freeze 済み Raw Text artifact の整合性（data/download に依存しない）
describe('budget-request raw text artifact manifest', () => {
  it('physical PDF・page・status の集計が文書別 record と一致する', () => {
    const f = m.frozenInput;
    expect(m.documents).toHaveLength(f.physicalPdfs);
    expect(new Set(m.documents.map(d => d.localPdfPath)).size).toBe(f.physicalPdfs);
    expect(m.documents.reduce((n, d) => n + (d.pageCount ?? 0), 0)).toBe(f.physicalPages);
    for (const s of ['EXTRACTED', 'EMPTY', 'FAILED']) expect(m.documents.filter(d => d.status === s)).toHaveLength(f.status[s]);
    expect(m.documents.reduce((n, d) => n + (d.charCount ?? 0), 0)).toBe(f.charCount);
    expect(m.documents.reduce((n, d) => n + (d.nonWhitespaceCharCount ?? 0), 0)).toBe(f.nonWhitespaceCharCount);
  });
  it('PDF の page 数と page 単位 hash の件数が一致し、EMPTY page は document status と整合する', () => {
    for (const d of m.documents.filter(x => x.status !== 'FAILED')) {
      expect(d.pageTextSha256).toHaveLength(d.pageCount!);
      expect(d.emptyPages!.every(p => p >= 1 && p <= d.pageCount!)).toBe(true);
      expect(d.status === 'EMPTY').toBe(d.emptyPages!.length === d.pageCount);
    }
  });
  it('corpus digest が文書別 hash から再計算できる', () => {
    const digest = sha256Hex(m.documents.map(d => `${d.localPdfPath} ${d.pdfSha256 ?? '-'} ${d.artifactSha256 ?? '-'}`).join('\n'));
    expect(digest).toBe(m.frozenInput.corpusDigestSha256);
  });
  it('代表 page の raw text が manifest の page hash と contract の導出値に一致する', () => {
    expect(rep.pages.length).toBeGreaterThan(0);
    for (const r of rep.pages) {
      const d = m.documents.find(x => x.localPdfPath === r.localPdfPath)!;
      expect(d.pageTextSha256![r.page - 1]).toBe(r.textSha256);
      expect(buildPageRawText(r.page, r.text).textSha256).toBe(r.textSha256);
      expect(buildPageRawText(r.page, r.text).status).toBe(r.status);
      expect(d.pageCount).toBe(r.pageCount);
    }
  });
});
