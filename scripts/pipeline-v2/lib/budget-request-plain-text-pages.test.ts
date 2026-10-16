import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDocumentPages } from './budget-request-raw-text';
import { plainTextPages, type PlainTextCorpus } from './budget-request-plain-text-pages';

describe('plainTextPages', () => {
  it('plain text（pdftotext の出力）から、Raw Text 層と同じ page 単位の入力を作る', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-pages-'));
    const raw = '令和５年度歳出概算要求書\n  総表\n\f\n\f(組織) 010 テスト\n事項  100\n\f';
    fs.writeFileSync(path.join(dir, 'a.txt'), raw);
    const corpus: PlainTextCorpus = { fiscalYear: 'test', corpusDigestSha256: '', physicalPages: 3, textDir: dir, documents: [] };
    const pages = plainTextPages(corpus, { localPdfPath: 'data/download/example.go.jp/a.pdf', textFile: 'a.txt', pdfSha256: '', pageCount: 3, status: 'EXTRACTED', textSha256: '', pageTextSha256: [] });
    expect(pages).toEqual(buildDocumentPages(raw, 3));
    expect(pages.map(p => p.status)).toEqual(['EXTRACTED', 'EMPTY', 'EXTRACTED']);
    expect(pages[2].nonEmptyLines.map(l => l.lineIndex)).toEqual([0, 1]);
  });

  it('page 数が合わなければ throw する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-pages-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x\f');
    const corpus: PlainTextCorpus = { fiscalYear: 'test', corpusDigestSha256: '', physicalPages: 2, textDir: dir, documents: [] };
    expect(() => plainTextPages(corpus, { localPdfPath: 'data/download/example.go.jp/a.pdf', textFile: 'a.txt', pdfSha256: '', pageCount: 2, status: 'EXTRACTED', textSha256: '', pageTextSha256: [] })).toThrow(/page boundary mismatch/);
  });
});
