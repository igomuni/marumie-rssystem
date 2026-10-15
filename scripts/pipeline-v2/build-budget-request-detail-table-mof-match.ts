/**
 * 明細表 CSV × MOF 事項の突合（J1 単一 + K2）。仕様: docs/budget-request-detail-table-mof-match.md
 *   npx tsx scripts/pipeline-v2/build-budget-request-detail-table-mof-match.ts --year=2025 --mof=<jikou.jsonl> [--detail=<dir>] [--out=<dir>]
 * 既定: --detail=tests/fixtures/budget-request-csv/{year}/detail-table → --out=tests/fixtures/budget-request-csv/{year}/detail-table-mof-match
 * 明細表の source CSV は、同じディレクトリの output-manifest.json と集合・SHA-256 が一致しなければ止まる。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  indexMofByMinistryName,
  matchDetailSource,
  parseCsv,
  renderMatchCsv,
  type DetailCsvRow,
  type MatchRow,
  type MofJikouRecord,
} from './lib/budget-request-detail-table-mof-match';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const yearArg = arg('year');
if (!yearArg || !/^\d{4}$/u.test(yearArg)) throw new Error('--year=<4-digit fiscal year> is required');
const mofPath = arg('mof');
if (!mofPath) throw new Error('--mof=<MOF jikou JSONL> is required');
const detailRoot = arg('detail') ?? `tests/fixtures/budget-request-csv/${yearArg}/detail-table`;
const outputRoot = arg('out') ?? `tests/fixtures/budget-request-csv/${yearArg}/detail-table-mof-match`;
const sha256 = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');

const manifestBytes = fs.readFileSync(path.join(detailRoot, 'output-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, string>;
const listed = Object.keys(manifest).filter(k => k.startsWith('sources/') && k.endsWith('.csv')).sort();
const actual = fs.readdirSync(path.join(detailRoot, 'sources')).filter(f => f.endsWith('.csv')).map(f => `sources/${f}`).sort();
if (listed.join('\n') !== actual.join('\n')) throw new Error('sources/*.csv set differs from output-manifest.json');

const mofBytes = fs.readFileSync(mofPath);
const mof: MofJikouRecord[] = mofBytes.toString('utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l));
const mofIndex = indexMofByMinistryName(mof);

const rows: MatchRow[] = [];
for (const rel of actual) {
  const bytes = fs.readFileSync(path.join(detailRoot, rel));
  if (sha256(bytes) !== manifest[rel]) throw new Error(`${rel} SHA-256 differs from output-manifest.json`);
  rows.push(...matchDetailSource(path.basename(rel, '.csv'), parseCsv(bytes.toString('utf8')) as unknown as DetailCsvRow[], mofIndex));
}

const count = <T>(items: T[], key: (t: T) => string) =>
  Object.fromEntries([...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const summary = {
  scope: `FY${yearArg} 明細表 DETAIL × MOF 事項: J1（所管・事項名 exact）単一候補を K2（項 X と sectionName の exact）で確認したものだけを採用。J1 複数は AMBIGUOUS のまま`,
  input: { detailOutputManifestSha256: sha256(manifestBytes), sourceCsvs: actual.length, mofPath, mofSha256: sha256(mofBytes), mofRecords: mof.length },
  detailRows: rows.length,
  statusCounts: count(rows, r => r.status),
  ambiguousK2Diagnostic: count(rows.filter(r => r.status === 'AMBIGUOUS_J1_MULTI'),
    r => `${r.x_source || 'no X'} | ${r.k2_candidates === null ? '-' : r.k2_candidates >= 2 ? '2+' : String(r.k2_candidates)}`),
  xSourceOfK2Supported: count(rows.filter(r => r.status === 'K2_SUPPORTED'), r => r.x_source),
};

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
const written: Record<string, string> = {};
const write = (rel: string, content: string) => { fs.writeFileSync(path.join(outputRoot, rel), content); written[rel] = sha256(content); };
write('matches.csv', renderMatchCsv(rows));
write('summary.json', JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(outputRoot, 'output-manifest.json'), JSON.stringify(written, null, 2) + '\n');
console.log(JSON.stringify({ outputRoot, ...summary }, null, 1));
