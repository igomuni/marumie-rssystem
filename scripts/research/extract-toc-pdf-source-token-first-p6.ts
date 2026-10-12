/** Read-only PDF-native text item capture for the frozen P6 population. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pageMetaFrom, toSourceToken, type RawTextItem, type RawTextStyles } from '../pipeline-v2/lib/budget-request-source-token';

const OPTIONS_ID = 'pdfjs-5.4.296-disableNormalization-true-cmaps-standardfonts-verbosity0-v1';
const PDFJS_ROOT = path.resolve('node_modules/pdfjs-dist');
const DEFAULT_OUTPUT = 'data/work/exports/20261012_2239_FY2024_TOC_PDF_Source_Token_First_P6';
type PageInput = { sourcePdf: string; sourcePdfSha256: string; physicalPage: number; pageId: string; sourceCandidateIds: string[] };
type ItemRecord = {
  occurrenceId: { pdfSha256: string; page: number; pdfjsVersion: string; optionsId: string; textItemIndex: number };
  occurrenceIdHash: string; textItemIndex: number; returnedOrder: number; str: string; utf8TextSha256: string;
  transform: number[]; width: number; height: number; fontName: string; hasEOL: boolean; dir: string;
  bbox: unknown; bboxGranularity: 'APPROXIMATE_ITEM_EM_BOX' | 'UNDETERMINED';
};
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const stable = (value: unknown): string => JSON.stringify(value);

async function main() {
  const sourceRoot = path.resolve(process.argv[2] ?? '/Users/igomuni/MyGitHub/marumie-rssystem');
  const outputDir = path.resolve(process.argv[3] ?? DEFAULT_OUTPUT);
  const inventoryPath = 'tests/fixtures/budget-request-toc-pdf-source-token-first/2024/p6-page-inventory.json';
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (inventory.uniquePdfs !== 15 || inventory.uniquePhysicalPages !== 17 || inventory.pages.length !== 17) throw new Error('Frozen population is not 15 PDFs / 17 pages');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.version !== '5.4.296') throw new Error(`Expected pdfjs-dist 5.4.296, got ${pdfjs.version}`);
  const inputs: PageInput[] = inventory.pages;
  const pdfHashes: Record<string, string> = {};
  for (const p of inputs) {
    const file = path.join(sourceRoot, p.sourcePdf);
    const hash = sha256(fs.readFileSync(file));
    pdfHashes[p.sourcePdf] = hash;
    if (hash !== p.sourcePdfSha256) throw new Error(`Canonical PDF hash mismatch for ${p.sourcePdf}: expected ${p.sourcePdfSha256}, got ${hash}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  async function extractPass() {
    const metadata: unknown[] = [];
    const allItems: ItemRecord[] = [];
    for (const input of inputs) {
      const pdfPath = path.join(sourceRoot, input.sourcePdf);
      const bytes = new Uint8Array(fs.readFileSync(pdfPath));
      const doc = await pdfjs.getDocument({ data: bytes, cMapUrl: `${PDFJS_ROOT}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_ROOT}/standard_fonts/`, verbosity: 0 }).promise;
      try {
        if (input.physicalPage < 1 || input.physicalPage > doc.numPages) throw new Error(`Page out of range: ${input.sourcePdf} p${input.physicalPage}/${doc.numPages}`);
        const page = await doc.getPage(input.physicalPage);
        const content = await page.getTextContent({ disableNormalization: true });
        const view = [...page.view] as [number, number, number, number];
        const rotate = page.rotate;
        const width = view[2] - view[0], height = view[3] - view[1];
        const styles = content.styles as unknown as RawTextStyles;
        let textIndex = 0, nonTextCount = 0;
        const pageItems: ItemRecord[] = [];
        for (const raw of content.items as unknown as Array<Record<string, unknown>>) {
          if (!('str' in raw)) { nonTextCount++; continue; }
          const item = raw as unknown as RawTextItem;
          const tuple = { pdfSha256: input.sourcePdfSha256, page: input.physicalPage, pdfjsVersion: pdfjs.version, optionsId: OPTIONS_ID, textItemIndex: textIndex };
          let bbox: unknown = null;
          if (rotate === 0) {
            try { bbox = toSourceToken(item, textIndex, pageMetaFrom(input.physicalPage, doc.numPages, view, rotate), styles).bbox; }
            catch { bbox = null; }
          }
          const idText = stable(tuple);
          const record: ItemRecord = { occurrenceId: tuple, occurrenceIdHash: sha256(idText), textItemIndex: textIndex, returnedOrder: textIndex,
            str: item.str, utf8TextSha256: sha256(Buffer.from(item.str, 'utf8')), transform: Array.from(item.transform), width: item.width,
            height: item.height, fontName: item.fontName, hasEOL: item.hasEOL, dir: item.dir, bbox,
            bboxGranularity: rotate === 0 && bbox !== null ? 'APPROXIMATE_ITEM_EM_BOX' : 'UNDETERMINED' };
          pageItems.push(record);
          allItems.push(record);
          textIndex++;
        }
        const uniqueTextCount = new Set(pageItems.map((item) => item.str)).size;
        const bboxAvailableItemCount = pageItems.filter((item) => item.bbox !== null).length;
        const transformAvailableItemCount = pageItems.filter((item) => Array.isArray(item.transform) && item.transform.length === 6 && item.transform.every(Number.isFinite)).length;
        metadata.push({ pageId: input.pageId, sourcePdf: input.sourcePdf, sourcePdfSha256: input.sourcePdfSha256,
          sourceCandidateIds: input.sourceCandidateIds, physicalPage: input.physicalPage, documentPageCount: doc.numPages,
          pageView: view, pageWidth: width, pageHeight: height, rotation: rotate, extractor: 'pdfjs-dist', pdfjsVersion: pdfjs.version,
          optionsId: OPTIONS_ID, getDocumentOptions: { cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
            standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', verbosity: 0 }, getTextContentOptions: { disableNormalization: true },
          totalContentItems: content.items.length, textItemCount: textIndex, uniqueTextCount, duplicateTextCount: textIndex - uniqueTextCount,
          bboxAvailableItemCount, transformAvailableItemCount, nonTextItemCount: nonTextCount, extractionStatus: 'SUCCESS', warnings: [] });
      } finally { await doc.destroy(); }
    }
    return { metadata, items: allItems };
  }
  const pass1 = await extractPass();
  const pass2 = await extractPass();
  const strictMismatches: Array<{ pageId: string; field: string; run1: unknown; run2: unknown }> = [];
  const ancillaryDifferences: Array<{ pageId: string; textItemIndex: number; field: string; run1: unknown; run2: unknown }> = [];
  const indexByPage = (run: typeof pass1) => new Map((run.metadata as Array<Record<string, any>>).map((m) => [m.pageId, m]));
  const m1 = indexByPage(pass1), m2 = indexByPage(pass2);
  for (const input of inputs) {
    const a = m1.get(input.pageId)!, b = m2.get(input.pageId)!;
    const ia = pass1.items.filter((x) => x.occurrenceId.page === input.physicalPage && x.occurrenceId.pdfSha256 === input.sourcePdfSha256);
    const ib = pass2.items.filter((x) => x.occurrenceId.page === input.physicalPage && x.occurrenceId.pdfSha256 === input.sourcePdfSha256);
    for (const field of Object.keys(a)) if (stable(a[field]) !== stable(b[field])) strictMismatches.push({ pageId: input.pageId, field, run1: a[field], run2: b[field] });
    if (ia.length !== ib.length) strictMismatches.push({ pageId: input.pageId, field: 'itemCount', run1: ia.length, run2: ib.length });
    const strictItemFields: Array<keyof ItemRecord> = ['occurrenceId', 'textItemIndex', 'returnedOrder', 'str', 'transform', 'bbox'];
    for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
      for (const field of strictItemFields) {
        if (stable(ia[i][field]) !== stable(ib[i][field])) strictMismatches.push({ pageId: input.pageId, field: `items[${i}].${field}`, run1: ia[i][field], run2: ib[i][field] });
      }
      for (const field of Object.keys(ia[i]) as Array<keyof ItemRecord>) {
        if (!strictItemFields.includes(field) && stable(ia[i][field]) !== stable(ib[i][field])) ancillaryDifferences.push({ pageId: input.pageId, textItemIndex: i, field, run1: ia[i][field], run2: ib[i][field] });
      }
    }
  }
  if (strictMismatches.length) throw new Error(`Frozen-contract comparison found ${strictMismatches.length} mismatch(es); stopping before output: ${JSON.stringify(strictMismatches.slice(0, 20))}`);
  const write = (name: string, data: unknown) => fs.writeFileSync(path.join(outputDir, name), JSON.stringify(data, null, 2) + '\n');
  write('page-metadata.json', pass1.metadata);
  write('run1-items.json', pass1.items);
  write('run2-items.json', pass2.items);
  write('reproducibility-summary.json', { schema: 'p6-pdf-native-reproducibility/v1', populationPages: inputs.length,
    totalTextItemsRun1: pass1.items.length, totalTextItemsRun2: pass2.items.length,
    nonTextItemsRun1: (pass1.metadata as Array<any>).reduce((n, p) => n + p.nonTextItemCount, 0),
    nonTextItemsRun2: (pass2.metadata as Array<any>).reduce((n, p) => n + p.nonTextItemCount, 0),
    strictComparisonFields: 'page metadata; per-page item counts; item order/index; exact text; occurrence tuple; transform; item bbox; timing excluded',
    strictMismatchCount: strictMismatches.length, strictMismatches,
    ancillaryCapturedFieldDifferenceCount: ancillaryDifferences.length,
    ancillaryCapturedFieldDifferences: ancillaryDifferences,
    fontNameInterpretation: 'fontName values are run-scoped generated aliases and are ancillary captured metadata; they are not stable source identity.',
    extractionErrors: [] });
  const outputHashes: Record<string, string> = {};
  for (const name of ['page-metadata.json', 'run1-items.json', 'run2-items.json', 'reproducibility-summary.json']) outputHashes[name] = sha256(fs.readFileSync(path.join(outputDir, name)));
  write('hashes.json', { canonicalSourceRoot: sourceRoot, sourcePdfHashes: pdfHashes, outputSha256: outputHashes });
  console.log(JSON.stringify({ pages: inputs.length, pdfs: Object.keys(pdfHashes).length, textItemsRun1: pass1.items.length, textItemsRun2: pass2.items.length,
    nonTextRun1: (pass1.metadata as Array<any>).reduce((n, p) => n + p.nonTextItemCount, 0), nonTextRun2: (pass2.metadata as Array<any>).reduce((n, p) => n + p.nonTextItemCount, 0),
    strictMismatches: strictMismatches.length, ancillaryCapturedFieldDifferences: ancillaryDifferences.length, outputDir }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
