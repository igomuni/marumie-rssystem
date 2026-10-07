/**
 * Page Classification v3 cumulative pre-implementation benchmark の builder（benchmark aggregation / adequacy 計算のみ。classifier ではない）。
 * v0 / v1 / v2 の既存 GT を original role を保持したまま union し、v2 から継承した threshold で adequacy を機械的に判定する。新規 GT は作らない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-page-classification-v3-cumulative-benchmark.ts [--freeze-fixture --prereg-commit=<sha>]
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v3-cumulative-benchmark.json（--freeze-fixture のときだけ）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { CONTINUATION_STRATUM, DIRECT_STRATUM, buildVersionRows, computeAdequacy, judge, keyOf, overlapOf, type CandidateRow, type CumulativeRow, type GtRow, type SourceVersion } from './lib/budget-request-page-classification-v3-cumulative';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const OUT = path.join(DIR, 'page-classification-v3-cumulative-benchmark.json');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const EXPECTED_COUNTS = { v0: 172, v1: 89, v2: 170 };

const FILES: Record<SourceVersion, { cand: string; gt: string }> = {
  v0: { cand: 'page-classification-v0-candidates.json', gt: 'page-classification-v0-visual-gt.json' },
  v1: { cand: 'page-classification-v1-eval-candidates.json', gt: 'page-classification-v1-eval-visual-gt.json' },
  v2: { cand: 'page-classification-v2-candidates.json', gt: 'page-classification-v2-visual-gt.json' },
};
const DOCS = [
  'docs/tasks/20261007_1925_Budget_Request_Page_Classification_v0_Preregistration.md',
  'docs/tasks/20261007_2105_Budget_Request_Page_Classification_v1_Evaluation_Preregistration.md',
  'docs/tasks/20261007_2330_Budget_Request_Page_Classification_v2_Closed_Scope_Preregistration.md',
];
const SPEC_SOURCES = ['scripts/pipeline-v2/lib/budget-request-page-classification-direct.ts'];
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PHASE_A = path.join(DIR, 'empty-page-failure-isolation.json');
const hashOf = (f: string) => sha256Hex(fs.readFileSync(f));
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const tally = (rows: CumulativeRow[], f: (r: CumulativeRow) => string[]) => { const o: Record<string, number> = {}; for (const r of rows) for (const k of f(r)) o[k] = (o[k] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };

function main() {
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(RAW_MANIFEST);
  if (raw.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('raw text corpus digest mismatch');
  const docMap = new Map(raw.documents.map(d => [d.localPdfPath, d]));

  const perVersion = {} as Record<SourceVersion, CumulativeRow[]>;
  const sourceCounts: Record<string, number> = {};
  for (const v of ['v0', 'v1', 'v2'] as SourceVersion[]) {
    const gt = readJson<{ rows: GtRow[] }>(path.join(DIR, FILES[v].gt)).rows;
    const cand = readJson<{ rows: CandidateRow[] }>(path.join(DIR, FILES[v].cand)).rows;
    if (gt.length !== EXPECTED_COUNTS[v]) throw new Error(`${v} GT rows ${gt.length} != ${EXPECTED_COUNTS[v]}`);
    sourceCounts[v] = gt.length;
    perVersion[v] = buildVersionRows(v, gt, cand);
  }
  const overlap = overlapOf({ v0: new Set(perVersion.v0.map(keyOf)), v1: new Set(perVersion.v1.map(keyOf)), v2: new Set(perVersion.v2.map(keyOf)) });
  const all = [...perVersion.v0, ...perVersion.v1, ...perVersion.v2];
  const unique = new Set(all.map(keyOf));
  const duplicateOrAmbiguous = all.length - unique.size;
  if (Object.values(overlap).some(n => n !== 0) || duplicateOrAmbiguous !== 0) throw new Error(`overlap/duplicate: ${JSON.stringify(overlap)} dup=${duplicateOrAmbiguous}`);
  if (unique.size !== 431) throw new Error(`unique ${unique.size} != 431`);

  // frozen Raw Text manifest との hash 一貫性
  let hashMismatch = 0;
  for (const r of all) { const d = docMap.get(r.localPdfPath); if (!d || d.pdfSha256 !== r.pdfSha256 || d.pageTextSha256[r.physicalPage - 1] !== r.textSha256) hashMismatch++; }
  if (hashMismatch !== 0) throw new Error(`hash mismatch vs raw text manifest: ${hashMismatch}`);

  const rows = [...all].sort((a, b) => (a.localPdfPath < b.localPdfPath ? -1 : a.localPdfPath > b.localPdfPath ? 1 : a.physicalPage - b.physicalPage));
  const adequacy = computeAdequacy(rows);
  const judgment = judge(adequacy, hashMismatch + duplicateOrAmbiguous);
  const out = {
    schema: 'budget-request-page-classification-v3-cumulative-benchmark/v0',
    scope: 'CUMULATIVE_PRE_IMPLEMENTATION_BENCHMARK_V3。既存 v0/v1/v2 GT の機械的 union と adequacy 判定のみ。fresh held-out ではない。classifier は未実装。open-set safety は NOT EVALUATED',
    generator: 'scripts/pipeline-v2/build-budget-request-page-classification-v3-cumulative-benchmark.ts',
    preregistrationCommit: arg('prereg-commit') ?? null,
    frozenInput: {
      rawTextCorpusDigestSha256: FROZEN_DIGEST,
      files: Object.fromEntries([RAW_MANIFEST, PHASE_A, ...(['v0', 'v1', 'v2'] as SourceVersion[]).flatMap(v => [path.join(DIR, FILES[v].cand), path.join(DIR, FILES[v].gt)]), ...DOCS, ...SPEC_SOURCES].map(f => [f, hashOf(f)])),
    },
    mapping: { directStratum: DIRECT_STRATUM, continuationStratum: CONTINUATION_STRATUM },
    summary: {
      sourceRows: sourceCounts, uniqueRows: unique.size, pairwiseOverlap: overlap, duplicateOrAmbiguousJoin: duplicateOrAmbiguous, hashMismatch,
      bySourceVersion: tally(rows, r => [r.sourceVersion]),
      bySourceEvaluationRole: tally(rows, r => [`${r.sourceVersion}|${r.sourceEvaluationRole}`]),
      byGtFamily: tally(rows, r => [r.gt.pageType]),
      bySourceStratum: tally(rows, r => r.sourceStrata.map(s => `${r.sourceVersion}|${s}`)),
    },
    adequacy: { ...adequacy, judgment },
    rows,
  };
  if (FREEZE) {
    if (!arg('prereg-commit')) throw new Error('--prereg-commit is required with --freeze-fixture');
    fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  }
  console.log(JSON.stringify({ summary: out.summary, adequacy: out.adequacy }, null, 1));
}
main();
