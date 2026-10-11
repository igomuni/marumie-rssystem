/**
 * P0 failure isolation survey for 総表 semantic hierarchy (read-only; observation only).
 *
 *   npx tsx scripts/pipeline-v2/analyze-budget-request-total-table-hierarchy-p0.ts [zipPath] [outputDir]
 *
 * Re-parses the archive with the frozen v0 parser (unchanged) and writes survey artifacts to
 * data/work/budget-request-semantic-hierarchy-p0/2024/. Spec of v0: docs/budget-request-total-table-csv.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { csvCell, parseSource } from './lib/budget-request-total-table';
import { buildPatternSummary, findAmbiguities, surveyBlocks, surveySource, type ContextSurvey, type RowSurvey } from './lib/budget-request-total-table-hierarchy-p0';

const zipPath = process.argv[2] ?? 'data/work/budget-request-plain-text.zip';
const outputRoot = process.argv[3] ?? 'data/work/budget-request-semantic-hierarchy-p0/2024';
const FROZEN_ZIP_SHA256 = '268f1020957b58362e1b224197b16944855c139efa1524c343a77abdf754e533';
const FROZEN = { sources: 82, blocks: 69, rows: 3531 };
const sha256 = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');

const zipBytes = fs.readFileSync(zipPath);
if (sha256(zipBytes) !== FROZEN_ZIP_SHA256) throw new Error('input archive hash differs from the frozen v0 evaluation input');
const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').filter(e => /^budget-request-plain-text\/2024\/[^/]+\.txt$/u.test(e)).sort();
const decoder = new TextDecoder('utf-8', { fatal: true });

const rows: RowSurvey[] = [];
const contexts: ContextSurvey[] = [];
const v0Results = [];
for (const entry of entries) {
  const text = decoder.decode(execFileSync('unzip', ['-p', zipPath, entry.replace(/[[\]*?\\]/gu, '\\$&')], { maxBuffer: 1 << 28 }));
  const v0 = parseSource(text, entry, path.basename(entry, '.txt'));
  v0Results.push(v0);
  const s = surveySource(text, v0);
  rows.push(...s.rows);
  contexts.push(...s.contexts);
}
const blockCount = v0Results.reduce((n, r) => n + r.blocks.length, 0);
if (entries.length !== FROZEN.sources || blockCount !== FROZEN.blocks || rows.length !== FROZEN.rows) {
  throw new Error(`corpus differs from frozen v0 baseline: ${entries.length}/${blockCount}/${rows.length}`);
}

const blocks = surveyBlocks(v0Results, rows, contexts);
const ambiguities = findAmbiguities(rows, contexts);
const summary = buildPatternSummary(rows, contexts, blocks, ambiguities);

const toCsv = <T extends object>(items: T[], columns?: (keyof T)[]) => {
  const cols = (columns ?? (items.length ? Object.keys(items[0]) as (keyof T)[] : []));
  return [cols.join(','), ...items.map(it => cols.map(c => csvCell(it[c])).join(','))].join('\n') + '\n';
};

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
const files: Record<string, string> = {
  'block-survey.csv': toCsv(blocks),
  'row-survey.csv': toCsv(rows),
  'context-survey.csv': toCsv(contexts),
  'ambiguous-cases.csv': toCsv(ambiguities),
  'pattern-summary.json': JSON.stringify({ input: { zipPath, zipSha256: FROZEN_ZIP_SHA256, sources: entries.length, blocks: blockCount, rows: rows.length }, ...summary }, null, 2) + '\n',
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(outputRoot, name), content);
fs.writeFileSync(path.join(outputRoot, 'output-manifest.json'), JSON.stringify(
  Object.fromEntries(Object.keys(files).sort().map(n => [n, sha256(files[n])])), null, 2) + '\n');
console.log(JSON.stringify({ outputRoot, blocks: blocks.length, rows: rows.length, contexts: contexts.length, ambiguities: ambiguities.length }));
