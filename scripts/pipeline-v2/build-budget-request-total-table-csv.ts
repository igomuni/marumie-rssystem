/**
 * Build 歳出概算要求額総表 CSVs from the plain-text archive (read-only input). --year selects the archive entries, the frozen
 * manifest used for the integrity diagnostic, the default output directory, the scope label and the request-year digit in
 * the amount column names (令和7年度 → `７年度概算要求額_…`). The parser matches the request-year heading year-agnostically.
 *
 *   npx tsx scripts/pipeline-v2/build-budget-request-total-table-csv.ts [inputDir] [outputDir] [--year=2024]
 *
 * Defaults: data/work/budget-request-plain-text/{year}/ → tests/fixtures/budget-request-csv/{year}/total-table/
 * Spec: docs/budget-request-total-table-csv.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  AMOUNT_FIELDS,
  arithmeticMismatches,
  csvCell,
  parseSource,
  renderAuditCsv,
  renderRowsCsv,
  requestYearLabel,
  renderUnresolvedCsv,
  type LogicalRow,
  type SourceResult,
} from './lib/budget-request-total-table';

const yearArg = process.argv.find(a => a.startsWith('--year='))?.slice('--year='.length) ?? '2024';
if (!/^\d{4}$/u.test(yearArg)) throw new Error(`--year must be a 4-digit fiscal year: ${yearArg}`);
const year = Number(yearArg);
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const inputDir = positional[0] ?? `data/work/budget-request-plain-text/${year}`;
const outputRoot = positional[1] ?? `tests/fixtures/budget-request-csv/${year}/total-table`;
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
for (const entry of entries) {
  const bytes = inputBytes.get(path.basename(entry))!;
  const text = decoder.decode(bytes);
  const slug = path.basename(entry, '.txt');
  const result = parseSource(text, entry, slug);
  results.push(result);

  const frozen = manifestBySlug.get(slug);
  const pages = text.split('\f');
  if (text.endsWith('\f')) pages.pop();
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

const allRows = results.flatMap(r => r.rows);
const allUnresolved = results.flatMap(r => r.unresolved);
for (const r of results) {
  if (r.blocks.length === 0) continue;
  write(`sources/${path.basename(r.source_file, '.txt')}.csv`, renderRowsCsv(r.rows, requestYearLabel(year)));
}
write('unresolved.csv', renderUnresolvedCsv(allUnresolved));
write('line-audit.csv', renderAuditCsv(results.flatMap(r => r.audit)));

const diagnostics = allRows.flatMap(row => arithmeticMismatches(row).map(m => ({ row, ...m })));
write('arithmetic-diagnostics.csv', [
  'source_file,source_page,source_line_start,table_block_id,row_index,row_type,check,expected_from_other_cells,extracted_value',
  ...diagnostics.map(d => [d.row.source_file, d.row.source_page, d.row.source_line_start, d.row.table_block_id, d.row.row_index, d.row.row_type, d.check, d.expected, d.actual].map(csvCell).join(',')),
].join('\n') + '\n');

const count = <T>(items: T[], key: (t: T) => string) =>
  Object.fromEntries([...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const audit = results.flatMap(r => r.audit);
const signedCellsByColumn = Object.fromEntries(AMOUNT_FIELDS.map(f => [f, allRows.filter(r => r.cells[f].sign_raw === '△').length]));
const detailPageShape = count(allRows, (r: LogicalRow) => (r.detail_page_raw === '' ? '<blank>' : r.detail_page_raw.replace(/[0-9]+/gu, 'N')));

const summary = {
  scope: `FY${year} 令和${year - 2018}年度歳出概算要求額総表 raw text → logical rows (v0 deterministic parser; descriptive counts, not an accuracy score)`,
  input: { inputDir, inputSha256, txtEntries: entries.length },
  frozenManifestIntegrity: count(integrity, i => i.status),
  frozenManifestIntegrityDetail: integrity.filter(i => i.status !== 'MATCH'),
  sourceFileCount: results.length,
  candidateTotalTableSourceCount: results.filter(r => r.candidatePages.length > 0).length,
  candidateTotalTablePageCount: results.reduce((n, r) => n + r.candidatePages.length, 0),
  tableBlockCount: results.reduce((n, r) => n + r.blocks.length, 0),
  titleOnlyPageCount: results.reduce((n, r) => n + r.titleOnlyPages.length, 0),
  logicalRowCount: allRows.length,
  rowTypeCounts: count(allRows, r => r.row_type),
  parseStatusCounts: count(allRows, r => r.parse_status),
  rowsWithContinuation: count(allRows.filter(r => r.continuationLines > 0), r => r.row_type),
  continuationLineCount: count(audit.filter(a => a.line_class === 'CONTINUATION'), a => a.detail),
  unresolvedCount: allUnresolved.length,
  unresolvedByReason: count(allUnresolved, u => u.reason),
  numericTailFailureCount: allUnresolved.filter(u => u.reason === 'MALFORMED_NUMERIC_TAIL').length,
  unknownRowHeadCount: allUnresolved.filter(u => u.reason === 'UNMATCHED_NUMERIC_HEAD' || u.reason === 'NUMERIC_TAIL_AMBIGUOUS_HEAD_ENDS_WITH_NUMBER').length,
  lineClassCounts: count(audit, a => a.line_class),
  blankLinesInCandidatePages: results.reduce((n, r) => n + r.blankLinesInCandidatePages, 0),
  signedCellsByColumn,
  detailPageShape,
  arithmeticDiagnostics: { rowsWithMismatch: new Set(diagnostics.map(d => d.row)).size, byCheck: count(diagnostics, d => d.check) },
  sources: results.map(r => ({
    source_file: r.source_file,
    pageCount: r.pageCount,
    endsWithFormFeed: r.endsWithFormFeed,
    candidatePages: r.candidatePages,
    titleOnlyPages: r.titleOnlyPages,
    blocks: r.blocks,
    rows: r.rows.length,
    unresolved: r.unresolved.length,
  })),
};
write('summary.json', JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(outputRoot, 'output-manifest.json'), JSON.stringify(
  Object.fromEntries(written.sort().map(rel => [rel, sha256(fs.readFileSync(path.join(outputRoot, rel)))])), null, 2) + '\n');

console.log(JSON.stringify({
  outputRoot, sources: summary.sourceFileCount, candidateSources: summary.candidateTotalTableSourceCount,
  candidatePages: summary.candidateTotalTablePageCount, blocks: summary.tableBlockCount, rows: summary.logicalRowCount,
  rowTypes: summary.rowTypeCounts, unresolved: summary.unresolvedCount, integrity: summary.frozenManifestIntegrity,
}));
