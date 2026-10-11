import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  coverTables,
  renderCoverCsv,
  renderCoverEntriesCsv,
  renderTocCsv,
  tocPage,
  type AuditFragment,
  type SourceTrace,
} from './lib/budget-request-plain-text-csv';
import { deterministicPdfSlug } from './lib/budget-request-plain-text';

const rawRoot = 'data/work/budget-request-plain-text/2024';
const outputRoot = 'data/work/budget-request-csv/2024';
const manifestPath = 'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json';
const inventoryPath = 'tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json';
const developmentPath = 'tests/fixtures/budget-request-toc-physical-row/2024/development-sample.json';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const development = JSON.parse(fs.readFileSync(developmentPath, 'utf8'));
if (manifest.documents?.length !== 82) throw new Error(`expected 82 frozen source PDFs, found ${manifest.documents?.length ?? 'invalid'}`);
if (inventory.frozenInput?.rawTextCorpusDigestSha256 !== '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052') throw new Error('Cover inventory frozen raw-text corpus digest mismatch');
if (development.inspectionRole !== 'DEVELOPMENT_EXPLORATION（held-out ではない・formal preregistration ではない）') throw new Error('unexpected TOC development sample role');
const manifestByPdf = new Map<string, any>(manifest.documents.map((doc: any) => [doc.localPdfPath, doc]));
const coverPages = inventory.pages.filter((p: any) => p.classifierPageType === 'COVER');
if (coverPages.length !== 69) throw new Error(`expected 69 Cover pages, found ${coverPages.length}`);
const tocSelections = development.pages.filter((p: any) => p.role === 'NEW_DEVELOPMENT' && p.classifierPageType === 'TOC');
if (tocSelections.length !== 6) throw new Error(`expected the fixed six TOC development pages, found ${tocSelections.length}`);
const expectedToc = new Set([
  'data/download/env.go.jp/content/000157010.pdf|3',
  'data/download/jinji.go.jp/content/900024096.pdf|3',
  'data/download/mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf|7',
  'data/download/mlit.go.jp/page/content/001630995.pdf|6',
  'data/download/mlit.go.jp/page/content/001630995.pdf|7',
  'data/download/reconstruction.go.jp/files/user/topics/2023_fukkochougaisansaisyutsu.pdf|3',
]);
if (new Set(tocSelections.map((p: any) => `${p.localPdfPath}|${p.physicalPage}`)).size !== 6 || tocSelections.some((p: any) => !expectedToc.has(`${p.localPdfPath}|${p.physicalPage}`))) throw new Error('TOC development sample differs from the fixed six-page population');

fs.mkdirSync(outputRoot, { recursive: true });
for (const name of fs.readdirSync(outputRoot)) {
  if (/^(?:cover(?:_entries)?|toc-.+|audit|record-provenance|development-validation)\.(?:csv|tsv|json)$/u.test(name)) fs.rmSync(path.join(outputRoot, name));
}
const coverRecords: ReturnType<typeof coverTables>['cover'][] = [];
const coverEntries: ReturnType<typeof coverTables>['entries'] = [];
const audits: AuditFragment[] = [];
const traces: SourceTrace[] = [];
const pageValidation: any[] = [];
function verifiedPage(pdfPath: string, physicalPage: number, expectedPdf?: string, expectedText?: string) {
  const doc = manifestByPdf.get(pdfPath);
  if (!doc) throw new Error(`PDF missing from frozen raw-text manifest: ${pdfPath}`);
  const pdf = fs.readFileSync(pdfPath);
  if (sha256(pdf) !== doc.pdfSha256 || (expectedPdf && expectedPdf !== doc.pdfSha256)) throw new Error(`PDF SHA-256 mismatch: ${pdfPath}`);
  const textPath = path.join(rawRoot, `${deterministicPdfSlug(pdfPath)}.txt`);
  const textBytes = fs.readFileSync(textPath);
  if (!textBytes.toString('utf8').endsWith('\f')) throw new Error(`TXT lacks terminal Form Feed: ${textPath}`);
  const text = textBytes.toString('utf8');
  const pages = text.split('\f');
  if (pages.length - 1 !== doc.pageCount || doc.pageTextSha256.length !== doc.pageCount) throw new Error(`TXT page-count/Form Feed mismatch: ${pdfPath}`);
  const pageText = pages[physicalPage - 1];
  if (pageText === undefined || sha256(pageText) !== doc.pageTextSha256[physicalPage - 1]) throw new Error(`frozen page text SHA mismatch: ${pdfPath} page ${physicalPage}`);
  if (expectedText && expectedText !== doc.pageTextSha256[physicalPage - 1]) throw new Error(`development sample text SHA mismatch: ${pdfPath} page ${physicalPage}`);
  return { doc, textPath, pageText };
}
for (const page of coverPages) {
  const { pageText } = verifiedPage(page.localPdfPath, page.physicalPage);
  const parsed = coverTables(pageText, page.localPdfPath, page.physicalPage);
  coverRecords.push(parsed.cover);
  coverEntries.push(...parsed.entries);
  audits.push(...parsed.audit);
  traces.push(...parsed.provenance);
  pageValidation.push({ kind: 'cover', sourcePdf: page.localPdfPath, physicalPage: page.physicalPage, entries: parsed.entries.length, auditEntries: parsed.audit.length, unresolved: parsed.audit.filter(a => !a.reason.startsWith('excluded:')).length });
}
for (const selection of tocSelections) {
  const { pageText } = verifiedPage(selection.localPdfPath, selection.physicalPage, selection.pdfSha256, selection.textSha256);
  const parsed = tocPage(pageText, selection.localPdfPath, selection.physicalPage);
  const slug = deterministicPdfSlug(selection.localPdfPath);
  fs.writeFileSync(path.join(outputRoot, `toc-${slug}-p${selection.physicalPage}.csv`), renderTocCsv(parsed.records));
  audits.push(...parsed.audit);
  traces.push(...parsed.provenance);
  pageValidation.push({ kind: 'toc', sourcePdf: selection.localPdfPath, physicalPage: selection.physicalPage, leftRecords: parsed.provenance.filter(x => x.side === 'left' && x.role === 'item').length, rightRecords: parsed.provenance.filter(x => x.side === 'right' && x.role === 'item').length, records: parsed.records.length, auditEntries: parsed.audit.length, unresolved: parsed.audit.filter(a => !a.reason.startsWith('excluded')).length });
}
fs.writeFileSync(path.join(outputRoot, 'cover.csv'), renderCoverCsv(coverRecords));
fs.writeFileSync(path.join(outputRoot, 'cover_entries.csv'), renderCoverEntriesCsv(coverEntries));
const auditCsv = ['scope,source_pdf,physical_page,raw_line_index,raw_text,reason', ...audits.map(a => [a.scope ?? '', a.sourcePdf, a.page, a.rawLineIndex, JSON.stringify(a.rawText), a.reason].map(quote).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(outputRoot, 'audit.csv'), auditCsv);
const provenanceCsv = ['scope,record_type,source_pdf,physical_page,csv_record_index,raw_line_index,side,role', ...traces.map(t => [t.scope, t.recordType ?? t.scope, t.sourcePdf, t.page, t.csvRecordIndex + 1, t.rawLineIndex, t.side ?? '', t.role].map(quote).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(outputRoot, 'record-provenance.csv'), provenanceCsv);
fs.writeFileSync(path.join(outputRoot, 'development-validation.json'), JSON.stringify({ scope: 'FY2024 descriptive development validation; not held-out accuracy or formal generalization', coverPagesExpected: 69, coverRecords: coverRecords.length, coverEntryRecords: coverEntries.length, coverPagesUnresolved: pageValidation.filter(p => p.kind === 'cover' && p.unresolved > 0).length, tocDevelopmentPageCount: tocSelections.length, tocRecordCount: pageValidation.filter(p => p.kind === 'toc').reduce((sum, p) => sum + p.records, 0), auditEntryCount: audits.length, unresolvedCount: pageValidation.reduce((sum, p) => sum + p.unresolved, 0), excludedOrHeaderLineCount: audits.length - pageValidation.reduce((sum, p) => sum + p.unresolved, 0), coverEntryKindCounts: { numberedTableReference: coverEntries.filter(e => /^[0-9]{1,2}[.)．、]/u.test(e.区分)).length, marker: coverEntries.filter(e => /（(?:組織|会計|所管|勘定|項)）/u.test(e.区分)).length, other: coverEntries.filter(e => !/^[0-9]{1,2}[.)．、]/u.test(e.区分) && !/（(?:組織|会計|所管|勘定|項)）/u.test(e.区分)).length }, pages: pageValidation }, null, 2) + '\n');
