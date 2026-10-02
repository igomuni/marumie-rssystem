/**
 * FieldResolver v0 held-out — 評価CLI。評価の前に freeze verification を実行し、1ファイルでも不一致なら評価せず STOP する。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-field-resolver-heldout.ts --gt-freeze-commit=<sha>
 *   --gt-freeze-commit: held-out の manifest / GT がその commit から変わっていないことも検証する
 * 出力: data/work/budget-request-field-resolver/heldout-v0/{freeze-verification,evaluation}.json / evaluation.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { evaluateHeldout, renderHeldoutMarkdown } from './lib/budget-request-field-resolver-heldout-evaluator';
import { FREEZE_COMMIT, validateHeldoutManifest, type HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';
import { summarizeHeldoutGt, validateHeldoutGolden, type HeldoutGolden } from './lib/budget-request-field-resolver-heldout-gt';
import { INFERENCE_FREEZE_FILES, verifyFreeze } from './lib/budget-request-field-resolver-freeze';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';
import type { FieldResolverResult } from './lib/budget-request-field-resolver';

const FIXTURE_DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0');
const OUT_DIR = path.join(FIELD_RESOLVER_WORK_DIR, 'heldout-v0');
const write = (f: string, s: string) => nodeBudgetRequestFs.writeAtomic(path.join(OUT_DIR, f), Buffer.from(s, 'utf8'));

function main() {
  const gtFreeze = process.argv.find(a => a.startsWith('--gt-freeze-commit='))?.slice('--gt-freeze-commit='.length);
  nodeBudgetRequestFs.mkdirp(OUT_DIR);
  const inference = verifyFreeze(FREEZE_COMMIT, INFERENCE_FREEZE_FILES);
  const gtFiles = [path.join(FIXTURE_DIR, 'manifest.json'), path.join(FIXTURE_DIR, 'golden.json')];
  const gt = gtFreeze ? verifyFreeze(gtFreeze, gtFiles) : null;
  write('freeze-verification.json', `${JSON.stringify({ inference, heldoutGt: gt }, null, 2)}\n`);
  if (!inference.allMatch || (gt && !gt.allMatch) || !gt) {
    console.error('STOP: freeze verification が一致しない（または --gt-freeze-commit が無い）。評価を実行しない。');
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as HeldoutManifest;
  const golden = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'golden.json'), 'utf8')) as HeldoutGolden;
  const errors = [...validateHeldoutManifest(manifest), ...validateHeldoutGolden(golden, manifest)];
  if (errors.length > 0) { console.error(`STOP: manifest / GT の検証に失敗\n${errors.join('\n')}`); process.exitCode = 1; return; }
  const report = evaluateHeldout(golden as never, sample => {
    const s = sample as unknown as { sourcePage: number; document: { canonicalUrl: string } };
    const d = manifest.documents.find(x => x.canonicalUrl === s.document.canonicalUrl);
    if (!d) return null;
    const f = path.join(OUT_DIR, `${d.documentId}-p${s.sourcePage}`, 'field-resolution.json');
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as FieldResolverResult) : null;
  });
  const full = { ...report, gtSummary: summarizeHeldoutGt(golden) };
  write('evaluation.json', `${JSON.stringify(full, null, 2)}\n`);
  write('evaluation.md', renderHeldoutMarkdown(report));
  const o = report.overall;
  console.log(`targets=${report.targetCount} notFound=${report.recordNotFound.length} exact=${o.exact}/${o.gtResolvable} falseResolved=${o.falseResolved} wrongSource=${o.wrongSource} wrongNorm=${o.wrongNormalization} unresolved=${o.unresolved} ambiguous=${o.ambiguous}`);
}

main();
