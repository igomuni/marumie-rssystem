/**
 * FieldResolver v0 PoC — 評価CLI（Golden を読んでよいのはこのCLIと評価lib・テストだけ）。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-field-resolver.ts
 * 入力: data/work/budget-request-field-resolver/{documentKey}/field-resolution.json と tests/fixtures/budget-request-field-resolver/v0/golden.json
 * 出力: data/work/budget-request-field-resolver/evaluation/golden-v0.json / golden-v0.md（決定的）
 */
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { evaluateGolden, renderEvaluationMarkdown, type Golden } from './lib/budget-request-field-resolver-evaluator';
import { FIELD_RESOLVER_RUNS } from './lib/budget-request-field-resolver-runs';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';
import type { FieldResolverResult } from './lib/budget-request-field-resolver';

const GOLDEN_PATH = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'v0', 'golden.json');

function main() {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Golden;
  const results = FIELD_RESOLVER_RUNS.map(run => ({ run, result: JSON.parse(fs.readFileSync(path.join(FIELD_RESOLVER_WORK_DIR, run.documentKey, 'field-resolution.json'), 'utf8')) as FieldResolverResult }));
  const report = evaluateGolden(golden, sample => {
    // 文書URLとページが含まれる run のうち、hierarchy を持つものを優先する
    const hits = results.filter(x => x.run.canonicalUrl === sample.document.canonicalUrl && sample.sourcePage >= x.run.pages[0] && sample.sourcePage <= x.run.pages[1]);
    return (hits.find(x => x.run.hierarchy) ?? hits[0])?.result ?? null;
  });
  const dir = path.join(FIELD_RESOLVER_WORK_DIR, 'evaluation');
  nodeBudgetRequestFs.mkdirp(dir);
  nodeBudgetRequestFs.writeAtomic(path.join(dir, 'golden-v0.json'), Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'));
  nodeBudgetRequestFs.writeAtomic(path.join(dir, 'golden-v0.md'), Buffer.from(renderEvaluationMarkdown(report), 'utf8'));
  const o = report.overall;
  console.log(`targets=${report.golden.targetCount} notFound=${report.recordNotFound.length} overall: exact=${o.exact}/${o.gtResolvable} falseResolved=${o.falseResolved} wrongSource=${o.wrongSource} wrongNorm=${o.wrongNormalization} unresolved=${o.unresolved} ambiguous=${o.ambiguous} falseResolveRate=${o.falseResolveRate}`);
  for (const f of report.failures) console.log(`  [${f.outcome}] ${f.targetId} ${f.field}: ${f.detail}`);
}

main();
