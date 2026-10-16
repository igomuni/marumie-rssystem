/**
 * plain text（build-budget-request-plain-text.ts の出力）から、Raw Text 層と同じ PageRawText[] を作る。
 * plain text は `pdftotext -layout -enc UTF-8` の標準出力そのもの（page 末尾に form feed）で、Raw Text 層の入力と同じバイト列。
 * したがって、Raw Text を別に作らなくても、頁分類・構造分析は plain text から同じ page 単位の入力を得られる（`--input=plain-text`）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildDocumentPages, type PageRawText } from './budget-request-raw-text';

export interface PlainTextManifestDocument {
  localPdfPath: string; textFile: string; pdfSha256: string; pageCount: number; status: 'EXTRACTED' | 'EMPTY'; textSha256: string; pageTextSha256: string[];
}
export interface PlainTextCorpus {
  fiscalYear: string;
  /** 頁分類・構造分析が参照する「凍結した入力」の識別子（plain-text-manifest.json が指す PDF corpus 記録の SHA-256） */
  corpusDigestSha256: string;
  physicalPages: number;
  textDir: string;
  documents: (PlainTextManifestDocument & { publisherDomain: string })[];
}

/** year は "2026" や "2024-supplement"。manifest は tests/fixtures/budget-request-plain-text/{year}/plain-text-manifest.json、本文は data/work/budget-request-plain-text/{year}/ */
export function loadPlainTextCorpus(year: string): PlainTextCorpus {
  const manifestPath = path.join('tests', 'fixtures', 'budget-request-plain-text', year, 'plain-text-manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { frozenPdfCorpus: { sha256: string }; physicalPages: number; documents: PlainTextManifestDocument[] };
  return {
    fiscalYear: year,
    corpusDigestSha256: m.frozenPdfCorpus.sha256,
    physicalPages: m.physicalPages,
    textDir: path.join('data', 'work', 'budget-request-plain-text', year),
    documents: m.documents.map(d => ({ ...d, publisherDomain: d.localPdfPath.replace(/^data\/download\//, '').split('/')[0] })),
  };
}

export function plainTextPages(corpus: PlainTextCorpus, d: PlainTextManifestDocument): PageRawText[] {
  return buildDocumentPages(fs.readFileSync(path.join(corpus.textDir, d.textFile), 'utf8'), d.pageCount);
}
