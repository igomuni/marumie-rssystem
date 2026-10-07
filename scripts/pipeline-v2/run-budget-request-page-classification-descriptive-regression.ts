/**
 * frozen Page Classification v0 実装の出力を、v3 cumulative benchmark（431 row、post-hoc / descriptive）に対して記述的に集計する。
 * classifier rule は変更しない。GT を見て調整しない。結果は descriptive regression であり、research validation / fresh held-out GO ではない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/run-budget-request-page-classification-descriptive-regression.ts [--freeze-fixture --impl-commit=<sha>]
 * 入力: data/work/budget-request-page-classification/2024/page-classification.jsonl（build-budget-request-page-classification.ts の出力）
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v0-descriptive-regression.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageClassificationRecord } from './lib/budget-request-page-classification';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const OUT = path.join(DIR, 'page-classification-v0-descriptive-regression.json');
const WORK = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const V3 = path.join(DIR, 'page-classification-v3-cumulative-benchmark.json');
const MANIFEST = path.join(DIR, 'page-classification-v0-implementation-manifest.json');
const KNOWN = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL'];

interface BenchRow { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; sourceVersion: string; sourceEvaluationRole: string; gt: { pageType: string }; directMatched: boolean; continuationMatched: boolean }
const pred = new Map((fs.readFileSync(WORK, 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l) as PageClassificationRecord)).map(r => [`${r.localPdfPath}#${r.physicalPage}`, r]));
const bench = JSON.parse(fs.readFileSync(V3, 'utf8')) as { rows: BenchRow[] };
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { summary: { corpusClassificationDigestSha256: string } };

interface Eval { row: BenchRow; predicted: string | null; resolved: boolean; correct: boolean; wrongFamily: boolean; source: string | null }
const evals: Eval[] = bench.rows.map(row => {
  const p = pred.get(`${row.localPdfPath}#${row.physicalPage}`);
  if (!p) throw new Error(`classification missing: ${row.localPdfPath}#${row.physicalPage}`);
  if (p.pdfSha256 !== row.pdfSha256 || p.rawText.textSha256 !== row.textSha256) throw new Error(`hash mismatch: ${row.localPdfPath}#${row.physicalPage}`);
  const resolved = p.classification.status === 'RESOLVED' && p.classification.pageType !== null && KNOWN.includes(p.classification.pageType);
  const predicted = resolved ? p.classification.pageType : null;
  const gtKnown = KNOWN.includes(row.gt.pageType);
  return { row, predicted, resolved, correct: resolved && predicted === row.gt.pageType, wrongFamily: resolved && gtKnown && predicted !== row.gt.pageType, source: p.classification.source };
});

const metrics = (es: Eval[]) => {
  const known = es.filter(e => KNOWN.includes(e.row.gt.pageType));
  const resolved = known.filter(e => e.resolved);
  const correct = resolved.filter(e => e.correct);
  return {
    rows: es.length, knownFormGtRows: known.length, resolved: resolved.length, abstained: known.length - resolved.length,
    exactPageTypeAccuracy: known.length ? correct.length / known.length : null,
    knownFormResolvedPrecision: resolved.length ? correct.length / resolved.length : null,
    knownFormCoverage: known.length ? resolved.length / known.length : null,
    wrongFamilyResolution: es.filter(e => e.wrongFamily).length,
    resolvedBySource: { DIRECT: resolved.filter(e => e.source === 'DIRECT').length, INHERITED: resolved.filter(e => e.source === 'INHERITED').length },
  };
};
const group = (f: (e: Eval) => string) => { const m = new Map<string, Eval[]>(); for (const e of evals) { const k = f(e); (m.get(k) ?? m.set(k, []).get(k)!).push(e); } return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, metrics(v)])); };

const wrong = evals.filter(e => e.wrongFamily).map(e => ({ localPdfPath: e.row.localPdfPath, physicalPage: e.row.physicalPage, sourceVersion: e.row.sourceVersion, gt: e.row.gt.pageType, predicted: e.predicted, source: e.source }));
const abstentionReasons: Record<string, number> = {};
for (const e of evals) if (KNOWN.includes(e.row.gt.pageType) && !e.resolved) { const p = pred.get(`${e.row.localPdfPath}#${e.row.physicalPage}`)!; const k = `${p.classification.status}:${(p.classification.reason ?? '').replace(/:.*/, '')}|gt=${e.row.gt.pageType}`; abstentionReasons[k] = (abstentionReasons[k] ?? 0) + 1; }
const overall = metrics(evals);
const out = {
  schema: 'budget-request-page-classification-v0-descriptive-regression/v0',
  scope: 'v3 cumulative benchmark（431 row、post-hoc / descriptive）に対する frozen v0 実装の記述的 regression。research validation / fresh held-out GO ではない。open-set safety は NOT EVALUATED',
  implementationCommit: arg('impl-commit') ?? null,
  corpusClassificationDigestSha256: manifest.summary.corpusClassificationDigestSha256,
  v3Fixture: { path: V3, sha256: sha256Hex(fs.readFileSync(V3)) },
  overall,
  byGtFamily: group(e => e.row.gt.pageType),
  bySourceVersion: group(e => e.row.sourceVersion),
  byOriginalEvaluationRole: group(e => `${e.row.sourceVersion}|${e.row.sourceEvaluationRole}`),
  directSubset: metrics(evals.filter(e => e.row.directMatched)),
  continuationSubset: metrics(evals.filter(e => e.row.continuationMatched)),
  abstentionReasonsOnKnownForm: Object.fromEntries(Object.entries(abstentionReasons).sort(([a], [b]) => (a < b ? -1 : 1))),
  wrongFamilyRows: wrong,
  otherOrUnresolvedGtRows: evals.filter(e => !KNOWN.includes(e.row.gt.pageType)).length,
  openSetSafety: 'NOT_EVALUATED',
  engineeringJudgment: wrong.length === 0 ? 'IMPLEMENTATION_CONFORMANT / STOP FOR REVIEW' : 'IMPLEMENTATION_STOP',
};
if (FREEZE) fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ overall: out.overall, byGtFamily: out.byGtFamily, bySourceVersion: out.bySourceVersion, byOriginalEvaluationRole: out.byOriginalEvaluationRole, directSubset: out.directSubset, continuationSubset: out.continuationSubset, abstentionReasonsOnKnownForm: out.abstentionReasonsOnKnownForm, wrongFamilyRows: wrong, judgment: out.engineeringJudgment }, null, 1));
