/**
 * Build 歳出概算要求額明細表 CSVs (excluding 備考) from the plain-text archive (read-only input). The parser is the FY2024 v0
 * parser unchanged (its header vocabulary still says ６年度); --year only selects the archive entries, the frozen
 * manifest used for the integrity diagnostic, the default output directory and the scope label.
 *
 *   npx tsx scripts/pipeline-v2/build-budget-request-detail-table-csv.ts [inputDir] [outputDir] [--year=2024]
 *
 * Defaults: data/work/budget-request-plain-text/{year}/ → tests/fixtures/budget-request-csv/{year}/detail-table/
 * Spec: docs/budget-request-detail-table-csv.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  csvCell,
  parseDetailSource,
  renderRowsCsv,
  renderUnresolvedCsv,
  type DetailRow,
  type SourceResult,
} from './lib/budget-request-detail-table';

const yearArg = process.argv.find(a => a.startsWith('--year='))?.slice('--year='.length) ?? '2024';
if (!/^\d{4}$/u.test(yearArg)) throw new Error(`--year must be a 4-digit fiscal year: ${yearArg}`);
const year = Number(yearArg);
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const inputDir = positional[0] ?? `data/work/budget-request-plain-text/${year}`;
const outputRoot = positional[1] ?? `tests/fixtures/budget-request-csv/${year}/detail-table`;
const manifestOverride = process.argv.find(a => a.startsWith('--manifest='))?.slice('--manifest='.length); // 凍結済みの年度に後から足した PDF の補遺（plain-text-manifest.json）を使うとき
const manifestPath = manifestOverride ? manifestOverride : `tests/fixtures/budget-request-plain-text/${year}/plain-text-manifest.json`;
const sha256 = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');

if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) throw new Error(`input directory not found: ${inputDir} (build it with build-budget-request-plain-text.ts --year=${year})`);
const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.txt')).sort();
if (files.length === 0) throw new Error(`no *.txt files in ${inputDir}`);
// 出力に残る source_file は従来どおり `budget-request-plain-text/{year}/{file}` の形（入力が zip だった頃と同じ）
const entries = files.map(f => `budget-request-plain-text/${year}/${f}`);
const inputBytes = new Map(files.map(f => [f, fs.readFileSync(path.join(inputDir, f))]));
const inputSha256 = sha256([...inputBytes].map(([f, b]) => `${f}\t${sha256(b)}\n`).join(''));

// Frozen raw-text manifest: integrity diagnostic only (the plain-text files are the source of truth for this parser).
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestBySlug = new Map<string, { pageCount: number; pageTextSha256: string[] }>(
  manifest.documents
    .filter((d: { status: string }) => d.status === 'EXTRACTED')
    .map((d: { localPdfPath: string; pageCount: number; pageTextSha256: string[] }) => [
      d.localPdfPath.replace(/^data\/download\//u, '').replace(/\.pdf$/iu, '').replace(/\//gu, '__'), d,
    ]),
);

const decoder = new TextDecoder('utf-8', { fatal: true });
const results: SourceResult[] = [];
const integrity: { source_file: string; status: string }[] = [];
const noTextLayer: { source_file: string; pageCount: number }[] = [];
for (const entry of entries) {
  const bytes = inputBytes.get(path.basename(entry))!;
  const text = decoder.decode(bytes);
  const slug = path.basename(entry, '.txt');
  const result = parseDetailSource(text, entry);
  results.push(result);

  const frozen = manifestBySlug.get(slug);
  const pages = text.split('\f');
  if (text.endsWith('\f')) pages.pop();
  if (pages.every(p => p.trim() === '')) noTextLayer.push({ source_file: entry, pageCount: pages.length });
  integrity.push({
    source_file: entry,
    status: !frozen ? 'NOT_IN_FROZEN_MANIFEST'
      : frozen.pageCount !== pages.length ? 'PAGE_COUNT_MISMATCH'
        : pages.every((p, i) => sha256(p) === frozen.pageTextSha256[i]) ? 'MATCH' : 'PAGE_HASH_MISMATCH',
  });
}

// ---------- write outputs (directory is owned by this script and fully regenerated) ----------
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outputRoot, 'sources'), { recursive: true });
const written: string[] = [];
const write = (rel: string, content: string) => { fs.writeFileSync(path.join(outputRoot, rel), content); written.push(rel); };

const allRows: DetailRow[] = results.flatMap(r => r.rows);
const allUnresolved = results.flatMap(r => r.unresolved);
for (const r of results) {
  if (r.detailPages.length === 0) continue;
  write(`sources/${path.basename(r.source_file, '.txt')}.csv`, renderRowsCsv(r.rows));
}
write('unresolved.csv', renderUnresolvedCsv(allUnresolved));
const mismatches = results.flatMap(r => r.arithmeticMismatchRows);
write('arithmetic-diagnostics.csv', [
  'source_file,source_page,source_line_start,row_index,request_total-previous_total=difference,expected_from_other_cells,extracted_value',
  ...mismatches.map(r => [r.source_file, r.source_page, r.source_line_start, r.row_index, 'request-previous=difference', '', `${r.cells.previous} / ${r.cells.request} / ${r.cells.difference}`].map(csvCell).join(',')),
].join('\n') + '\n');

const count = <T>(items: T[], key: (t: T) => string) =>
  Object.fromEntries([...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const classCounts: Record<string, number> = {};
for (const r of results) for (const [k, v] of Object.entries(r.lineClassCounts)) classCounts[k] = (classCounts[k] ?? 0) + v;
const accounted = Object.values(classCounts).reduce((a, b) => a + b, 0);
const nonBlank = results.reduce((n, r) => n + r.nonBlankLinesInDetailPages, 0);
// Every non-blank physical line of a detail page is either a row, a continuation, a recognised furniture/備考 line or unresolved.
// (A CONTEXT row and the physical line it comes from are one line; a continuation line is one physical line.)
if (accounted !== nonBlank) throw new Error(`line accounting mismatch: classified ${accounted} != non-blank ${nonBlank}`);

const summary = {
  scope: `FY${year} 令和${year - 2018}年度歳出概算要求額明細表 (excluding 備考) raw text → logical rows (v0 deterministic parser; descriptive counts, not an accuracy score)`,
  input: { inputDir, inputSha256, txtEntries: entries.length },
  frozenManifestIntegrity: count(integrity, i => i.status),
  frozenManifestIntegrityDetail: integrity.filter(i => i.status !== 'MATCH'),
  sourceFileCount: results.length,
  detailTableSourceCount: results.filter(r => r.detailPages.length > 0).length,
  detailTablePageCount: results.reduce((n, r) => n + r.detailPages.length, 0),
  sourcesWithoutDetailTable: results.filter(r => r.detailPages.length === 0).length,
  sourcesWithNoTextLayer: noTextLayer,
  pagesWithoutHeaderBoundary: results.reduce((n, r) => n + r.pagesWithoutBoundary.length, 0),
  nonBlankLinesInDetailPages: nonBlank,
  lineClassCounts: classCounts,
  logicalRowCount: allRows.length,
  rowTypeCounts: count(allRows, r => r.row_type),
  parseStatusCounts: count(allRows, r => r.parse_status),
  rowsByBlankCells: count(allRows, r => `blank:${(['previous', 'request', 'difference'] as const).filter(c => r.cells[c] === '').join('+') || 'none'}`),
  rowsWithContinuation: allRows.filter(r => r.continuationLines > 0).length,
  unresolvedCount: allUnresolved.length,
  unresolvedByReason: count(allUnresolved, u => u.reason),
  arithmeticDiagnostics: { rowsWithMismatch: mismatches.length },
  sources: results.filter(r => r.detailPages.length > 0).map(r => ({
    source_file: r.source_file,
    pageCount: r.pageCount,
    detailPages: r.detailPages.length,
    pagesWithoutBoundary: r.pagesWithoutBoundary,
    rows: r.rows.length,
    unresolved: r.unresolved.length,
    lineClassCounts: r.lineClassCounts,
  })),
};
write('summary.json', JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(outputRoot, 'output-manifest.json'), JSON.stringify(
  Object.fromEntries(written.sort().map(rel => [rel, sha256(fs.readFileSync(path.join(outputRoot, rel)))])), null, 2) + '\n');

console.log(JSON.stringify({
  outputRoot, sources: summary.sourceFileCount, detailSources: summary.detailTableSourceCount, detailPages: summary.detailTablePageCount,
  rows: summary.logicalRowCount, rowTypes: summary.rowTypeCounts, parseStatus: summary.parseStatusCounts,
  unresolved: summary.unresolvedCount, unresolvedByReason: summary.unresolvedByReason, arithmeticMismatchRows: mismatches.length,
  lineClassCounts: classCounts, integrity: summary.frozenManifestIntegrity,
}, null, 1));
