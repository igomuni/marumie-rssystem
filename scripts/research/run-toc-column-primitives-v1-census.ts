/** Reproducible FY2024 TOC 82-page exploratory census for Column Primitives v1. */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundaryOfHeaderLines, REGEX_SOURCE, segmentPage, type Primitive, type SourceLine } from './toc-column-primitives-v1';
import { deterministicPdfSlug, sha256, splitAndValidatePdfText } from '../pipeline-v2/lib/budget-request-plain-text';

const ROOT = process.cwd();
const INVENTORY_PATH = 'tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json';
const RAW_MANIFEST_PATH = 'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json';
const DEFAULT_OUTPUT = 'data/work/exports/20261011_1622_FY2024_TOC_Column_Primitives_v1_Resume';
const OUT = process.argv.find(arg => arg.startsWith('--out-dir='))?.slice('--out-dir='.length) ?? DEFAULT_OUTPUT;

type InventoryPage = {
  localPdfPath: string;
  pdfSha256: string;
  physicalPage: number;
  textSha256: string;
  classifierPageType: string;
  classifierSource: 'DIRECT' | 'INHERITED';
  publisherDomain: string;
};
type FrozenDocument = {
  localPdfPath: string;
  pdfSha256: string;
  pageCount: number;
  pageTextSha256: string[];
};

type CsvValue = string | number | null | undefined;
function csv(rows: Record<string, CsvValue>[], headers: string[]): string {
  const q = (value: CsvValue): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return [headers.map(q).join(','), ...rows.map(row => headers.map(header => q(row[header])).join(','))].join('\n') + '\n';
}
function digest(data: Buffer | string): string { return crypto.createHash('sha256').update(data).digest('hex'); }
function nonblank(text: string): boolean { return !/^\s*$/u.test(text); }
function lineInputs(pageText: string): SourceLine[] {
  const rawLines = pageText.split('\n');
  let start = 0;
  return rawLines.map((rawText, lineIndex) => {
    const item = { lineIndex, lineStartUtf16: start, rawText };
    start += rawText.length + (lineIndex < rawLines.length - 1 ? 1 : 0);
    return item;
  });
}
function pageKey(page: InventoryPage): string { return `${page.localPdfPath}\u0000${page.physicalPage}`; }
function expectedUtf8(bytes: Buffer, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`invalid UTF-8 in ${label}`); }
}
function pageRefClass(value: string | null): string {
  if (!value) return 'NONE';
  if (/^[0-9]{1,4}$/u.test(value)) return 'ASCII_DIGITS';
  if (/^エ[ \t]+[0-9]{1,4}$/u.test(value)) return 'PREFIX_エ';
  if (/^電[ \t]+[0-9]{1,4}$/u.test(value)) return 'PREFIX_電';
  if (/^原[ \t]+[0-9]{1,4}$/u.test(value)) return 'PREFIX_原';
  if (/^国[ \t]+[0-9]{1,4}$/u.test(value)) return 'PREFIX_国';
  if (/^国\(国\)[ \t]?[0-9]{1,4}$/u.test(value)) return 'PREFIX_国(国)';
  return 'OTHER';
}

function main(): void {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, INVENTORY_PATH), 'utf8')) as { pages: InventoryPage[] };
  const rawManifest = JSON.parse(fs.readFileSync(path.join(ROOT, RAW_MANIFEST_PATH), 'utf8')) as { documents: FrozenDocument[] };
  const pages = inventory.pages.filter(page => page.classifierPageType === 'TOC')
    .sort((a, b) => a.localPdfPath.localeCompare(b.localPdfPath) || a.physicalPage - b.physicalPage);
  if (pages.length !== 82) throw new Error(`TOC inventory has ${pages.length} pages, expected 82`);
  const keys = pages.map(pageKey);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate TOC physical-page keys');
  const pdfPaths = [...new Set(pages.map(page => page.localPdfPath))];
  if (pdfPaths.length !== 55) throw new Error(`TOC inventory has ${pdfPaths.length} PDFs, expected 55`);
  const docs = new Map(rawManifest.documents.map(doc => [doc.localPdfPath, doc]));
  if (docs.size !== rawManifest.documents.length) throw new Error('duplicate raw manifest localPdfPath');
  const tocPagesByPdf = new Map<string, InventoryPage[]>();
  for (const page of pages) tocPagesByPdf.set(page.localPdfPath, [...(tocPagesByPdf.get(page.localPdfPath) ?? []), page]);

  const segmentRows: Record<string, CsvValue>[] = [];
  const primitiveRows: Record<string, CsvValue>[] = [];
  const unresolvedRows: Record<string, CsvValue>[] = [];
  const pageRows: Record<string, CsvValue>[] = [];
  const allPageSummaries: Record<string, unknown>[] = [];
  const inputEvidence: Record<string, { pdfSha256: string; txtSha256: string; pagesVerified: number }> = {};
  const classCounts: Record<string, number> = { title_page: 0, page_only: 0, title_only_candidate: 0, unresolved: 0 };
  const refCounts: Record<string, number> = {};
  let availableBoundaryPages = 0;
  let boundaryUnavailablePages = 0;
  let unsafeCutPages = 0;
  let directPages = 0;
  let inheritedPages = 0;
  let leftSegments = 0;
  let rightSegments = 0;
  let unknownSegments = 0;
  let emptySegments = 0;
  let unsegmentedNonblankLines = 0;

  for (const localPdfPath of pdfPaths) {
    const doc = docs.get(localPdfPath);
    if (!doc) throw new Error(`raw manifest is missing ${localPdfPath}`);
    const pdfBytes = fs.readFileSync(path.join(ROOT, localPdfPath));
    const pdfSha = sha256(pdfBytes);
    if (pdfSha !== doc.pdfSha256) throw new Error(`PDF hash mismatch: ${localPdfPath}`);
    const tocPages = tocPagesByPdf.get(localPdfPath)!;
    for (const page of tocPages) if (page.pdfSha256 !== doc.pdfSha256) throw new Error(`inventory/manifest PDF hash mismatch: ${localPdfPath} p${page.physicalPage}`);

    const txtPath = path.join(ROOT, 'data/work/budget-request-plain-text/2024', `${deterministicPdfSlug(localPdfPath)}.txt`);
    const txtBytes = fs.readFileSync(txtPath);
    const txtSha = sha256(txtBytes);
    const textChunks = splitAndValidatePdfText(txtBytes, doc.pageCount, doc.pageTextSha256);
    const pagesVerified = textChunks.length;
    inputEvidence[localPdfPath] = { pdfSha256: pdfSha, txtSha256: txtSha, pagesVerified };

    for (const page of tocPages) {
      if (!Number.isInteger(page.physicalPage) || page.physicalPage < 1 || page.physicalPage > textChunks.length) throw new Error(`invalid physical page: ${localPdfPath} p${page.physicalPage}`);
      const bytes = textChunks[page.physicalPage - 1];
      const textHash = sha256(bytes);
      if (textHash !== page.textSha256 || textHash !== doc.pageTextSha256[page.physicalPage - 1]) throw new Error(`TOC page text hash mismatch: ${localPdfPath} p${page.physicalPage}`);
      const pageText = expectedUtf8(bytes, `${localPdfPath} p${page.physicalPage}`);
      const lines = lineInputs(pageText);
      const headerLines = lines.map(line => line.rawText).filter(line => new RegExp(REGEX_SOURCE.HEADER_REGEX, 'u').test(line));
      const headerBoundary = boundaryOfHeaderLines(headerLines);
      const segmented = segmentPage(lines, headerLines);
      const boundaryAvailable = headerBoundary !== null;
      if (boundaryAvailable) availableBoundaryPages++; else boundaryUnavailablePages++;
      const unsafeLines = segmented.filter(line => line.lineStatus === 'UNRESOLVED_BOUNDARY_CUT');
      if (unsafeLines.length) unsafeCutPages++;
      if (page.classifierSource === 'DIRECT') directPages++; else inheritedPages++;

      let pageLeft = 0, pageRight = 0, pageUnknown = 0, pageEmpty = 0;
      let pageUnresolved = 0;
      const pageKinds: Record<string, number> = { title_page: 0, page_only: 0, title_only_candidate: 0, unresolved: 0 };
      for (const line of segmented) {
        const assertSourceSpan = (rawText: string, start: number, end: number, label: string): void => {
          if (start < 0 || end < start || end > line.sourceLine.rawText.length) {
            throw new Error(`invalid UTF-16 source span for ${label}: ${localPdfPath} p${page.physicalPage} L${line.sourceLine.lineIndex} [${start},${end})`);
          }
          if (line.sourceLine.rawText.slice(start, end) !== rawText) {
            throw new Error(`source span mismatch for ${label}: ${localPdfPath} p${page.physicalPage} L${line.sourceLine.lineIndex} [${start},${end})`);
          }
        };
        const addPrimitive = (primitive: Primitive, side: string, start: number, end: number): void => {
          assertSourceSpan(primitive.rawText, start, end, `primitive ${primitive.kind}`);
          if (primitive.sourceRangeUtf16[0] !== start || primitive.sourceRangeUtf16[1] !== end) {
            throw new Error(`primitive/source-range mismatch: ${localPdfPath} p${page.physicalPage} L${line.sourceLine.lineIndex}`);
          }
          classCounts[primitive.kind] = (classCounts[primitive.kind] ?? 0) + 1;
          pageKinds[primitive.kind] = (pageKinds[primitive.kind] ?? 0) + 1;
          refCounts[pageRefClass(primitive.pageRef)] = (refCounts[pageRefClass(primitive.pageRef)] ?? 0) + 1;
          primitiveRows.push({
            source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
            classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
            line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus,
            side, kind: primitive.kind, title_text: primitive.titleText ?? null, page_ref: primitive.pageRef,
            page_ref_format: pageRefClass(primitive.pageRef), raw_text: primitive.rawText,
            source_start_utf16: start, source_end_utf16_exclusive: end, reason: primitive.reason ?? null,
          });
          if (primitive.kind === 'unresolved') {
            pageUnresolved++;
            unresolvedRows.push({
              source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
              classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
              line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus,
              side, start_utf16: start, end_utf16_exclusive: end, raw_text: primitive.rawText,
              reason: primitive.reason ?? primitive.kind,
            });
          }
        };
        if (line.segments.length) {
          for (const segment of line.segments) {
            assertSourceSpan(segment.rawText, segment.sourceRangeUtf16[0], segment.sourceRangeUtf16[1], `segment ${segment.side}`);
            if (!nonblank(segment.rawText)) { pageEmpty++; emptySegments++; continue; }
            if (segment.side === 'left') { pageLeft++; leftSegments++; }
            else if (segment.side === 'right') { pageRight++; rightSegments++; }
            else { pageUnknown++; unknownSegments++; }
            segmentRows.push({
              source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
              classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
              line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus,
              boundary_utf16_column: line.boundaryUtf16Column, side: segment.side,
              start_utf16: segment.sourceRangeUtf16[0], end_utf16_exclusive: segment.sourceRangeUtf16[1],
              primitive_kind: segment.primitive?.kind ?? null, title_text: segment.primitive?.titleText ?? null,
              page_ref: segment.primitive?.pageRef ?? null, raw_text: segment.rawText,
            });
            if (segment.primitive) addPrimitive(segment.primitive, segment.side, segment.sourceRangeUtf16[0], segment.sourceRangeUtf16[1]);
            else if (nonblank(segment.rawText)) {
              pageUnresolved++;
              unresolvedRows.push({ source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
                classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
                line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus, side: segment.side,
                start_utf16: segment.sourceRangeUtf16[0], end_utf16_exclusive: segment.sourceRangeUtf16[1],
                raw_text: segment.rawText, reason: 'NONBLANK_SEGMENT_WITHOUT_PRIMITIVE' });
            }
          }
        } else if (line.primitive) {
          const primitive = line.primitive;
          pageUnknown++; unknownSegments++;
          segmentRows.push({
            source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
            classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
            line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus,
            boundary_utf16_column: line.boundaryUtf16Column, side: 'unknown', start_utf16: 0,
            end_utf16_exclusive: line.sourceLine.rawText.length, primitive_kind: primitive.kind,
            title_text: primitive.titleText ?? null, page_ref: primitive.pageRef ?? null, raw_text: line.sourceLine.rawText,
          });
          addPrimitive(primitive, 'unknown', 0, line.sourceLine.rawText.length);
        } else if (nonblank(line.sourceLine.rawText)) {
          unsegmentedNonblankLines++;
          pageUnresolved++;
          pageUnknown++; unknownSegments++;
          const reason = line.lineStatus === 'UNRESOLVED_BOUNDARY_CUT' ? 'UNRESOLVED_BOUNDARY_CUT' : 'NO_PAGE_LOCAL_BOUNDARY_MIXED_OR_UNCLASSIFIABLE';
          segmentRows.push({
            source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
            classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
            line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus,
            boundary_utf16_column: line.boundaryUtf16Column, side: 'unknown', start_utf16: 0,
            end_utf16_exclusive: line.sourceLine.rawText.length, primitive_kind: 'unresolved',
            title_text: null, page_ref: null, raw_text: line.sourceLine.rawText,
          });
          unresolvedRows.push({
            source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
            classifier_source: page.classifierSource, raw_line_index: line.sourceLine.lineIndex,
            line_start_utf16: line.sourceLine.lineStartUtf16, line_status: line.lineStatus, side: 'unknown',
            start_utf16: 0, end_utf16_exclusive: line.sourceLine.rawText.length, raw_text: line.sourceLine.rawText, reason,
          });
        }
      }
      const pageStatus = !boundaryAvailable ? 'BOUNDARY_UNAVAILABLE' : unsafeLines.length ? 'BOUNDARY_AVAILABLE_WITH_UNRESOLVED_CUTS' : 'BOUNDARY_AVAILABLE';
      pageRows.push({
        source_pdf: page.localPdfPath, publisher_domain: page.publisherDomain, physical_page: page.physicalPage,
        classifier_source: page.classifierSource, input_sha256: textHash, boundary_status: pageStatus,
        boundary_utf16_column: headerBoundary, raw_line_count: lines.length, nonblank_raw_line_count: lines.filter(line => nonblank(line.rawText)).length,
        nonempty_left_segments: pageLeft, nonempty_right_segments: pageRight, unknown_segments: pageUnknown,
        empty_segments: pageEmpty, primitive_title_page: pageKinds.title_page, primitive_page_only: pageKinds.page_only,
        primitive_title_only_candidate: pageKinds.title_only_candidate, primitive_unresolved: pageKinds.unresolved,
        unresolved_fragments: pageUnresolved, unsafe_cut_lines: unsafeLines.length,
      });
      allPageSummaries.push({ localPdfPath: page.localPdfPath, physicalPage: page.physicalPage, classifierSource: page.classifierSource,
        boundaryStatus: pageStatus, boundaryUtf16Column: headerBoundary, rawLineCount: lines.length,
        nonblankRawLineCount: lines.filter(line => nonblank(line.rawText)).length, leftSegments: pageLeft, rightSegments: pageRight,
        unknownSegments: pageUnknown, emptySegments: pageEmpty, primitiveKinds: pageKinds, unresolvedFragments: pageUnresolved,
        unsafeCutLines: unsafeLines.length, inputTextSha256: textHash });
    }
  }

  const summary = {
    scope: 'Exploratory development census; not formal held-out evaluation or accuracy assessment.',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    parserSha256: sha256(fs.readFileSync(path.join(ROOT, 'scripts/research/toc-column-primitives-v1.ts'))),
    preregistrationSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-column-primitives/2024/preregistration.md'))),
    fixtureSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-column-primitives/2024/fixture.json'))),
    expectedResultsSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-column-primitives/2024/expected-results.json'))),
    inventorySha256: sha256(fs.readFileSync(path.join(ROOT, INVENTORY_PATH))),
    rawManifestSha256: sha256(fs.readFileSync(path.join(ROOT, RAW_MANIFEST_PATH))),
    population: { tocPhysicalPages: pages.length, sourcePdfs: pdfPaths.length, directPages: directPages, inheritedPages: inheritedPages },
    boundary: { pagesWithBoundary: availableBoundaryPages, pagesWithoutBoundary: boundaryUnavailablePages, pagesWithUnsafeCutLines: unsafeCutPages },
    nonemptySegmentCount: segmentRows.length, leftSegments, rightSegments, unknownSegments, emptySegments,
    unsegmentedNonblankLines, primitiveCounts: classCounts, pageReferenceFormatCounts: refCounts,
    primitiveCount: primitiveRows.length, unresolvedInventoryRows: unresolvedRows.length,
    inputEvidence,
    pages: allPageSummaries,
  };
  const outPath = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(outPath, { recursive: true });
  const outputs: Record<string, string> = {
    'column-segments.csv': csv(segmentRows, ['source_pdf','publisher_domain','physical_page','classifier_source','raw_line_index','line_start_utf16','line_status','boundary_utf16_column','side','start_utf16','end_utf16_exclusive','primitive_kind','title_text','page_ref','raw_text']),
    'primitives.csv': csv(primitiveRows, ['source_pdf','publisher_domain','physical_page','classifier_source','raw_line_index','line_start_utf16','line_status','side','kind','title_text','page_ref','page_ref_format','raw_text','source_start_utf16','source_end_utf16_exclusive','reason']),
    'unresolved-inventory.csv': csv(unresolvedRows, ['source_pdf','publisher_domain','physical_page','classifier_source','raw_line_index','line_start_utf16','line_status','side','start_utf16','end_utf16_exclusive','raw_text','reason']),
    'page-status.csv': csv(pageRows, ['source_pdf','publisher_domain','physical_page','classifier_source','input_sha256','boundary_status','boundary_utf16_column','raw_line_count','nonblank_raw_line_count','nonempty_left_segments','nonempty_right_segments','unknown_segments','empty_segments','primitive_title_page','primitive_page_only','primitive_title_only_candidate','primitive_unresolved','unresolved_fragments','unsafe_cut_lines']),
    'exploratory-summary.json': JSON.stringify(summary, null, 2) + '\n',
  };
  const outputHashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(outputs)) {
    const bytes = Buffer.from(content, 'utf8');
    fs.writeFileSync(path.join(outPath, name), bytes);
    outputHashes[name] = digest(bytes);
  }
  fs.writeFileSync(path.join(outPath, 'validation.json'), JSON.stringify({
    status: 'PASS', rawLinePageAccount: { totalPages: pages.length, uniquePageKeys: new Set(keys).size },
    classifierSourceCounts: { DIRECT: directPages, INHERITED: inheritedPages },
    hashChecks: { inputPdfs: pdfPaths.length, inputTxtDocuments: pdfPaths.length, tocPageTextHashes: pages.length, manifestPageCounts: 'verified via splitAndValidatePdfText' },
    parserSource: summary.parserSha256, v0ParserSha256: sha256(fs.readFileSync(path.join(ROOT, 'scripts/pipeline-v2/lib/budget-request-plain-text-csv.ts'))),
    outputSha256: outputHashes,
  }, null, 2) + '\n');
  const readBack = ['column-segments.csv','primitives.csv','unresolved-inventory.csv','page-status.csv','exploratory-summary.json','validation.json'];
  for (const name of readBack) fs.readFileSync(path.join(outPath, name));
  process.stdout.write(JSON.stringify({ outDir: outPath, pages: pages.length, pdfs: pdfPaths.length, directPages, inheritedPages,
    segments: segmentRows.length, primitives: primitiveRows.length, unresolved: unresolvedRows.length,
    availableBoundaryPages, boundaryUnavailablePages, outputSha256: outputHashes }, null, 2) + '\n');
}

main();
