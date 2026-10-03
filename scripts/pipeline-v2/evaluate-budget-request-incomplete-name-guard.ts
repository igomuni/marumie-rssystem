/**
 * incomplete-name safety guard — P3 凍結評価 CLI。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard.ts --gt-freeze-commit=587a477
 * 評価前に、凍結した P1/P2 の成果物（標本・GT・作業リスト・baseline・事前登録・LogicalRow）が freeze commit と一致することを確認し、不一致なら評価しない。
 * 出力: tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/p3-evaluation.json（決定的。時刻・絶対パスなし）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, type FieldResolverPageInput, type FieldResolverResult, type RecordFieldResolution } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_RUNS, HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { evaluateGolden, type Golden } from './lib/budget-request-field-resolver-evaluator';
import { evaluateHeldout, type HeldoutReport } from './lib/budget-request-field-resolver-heldout-evaluator';
import type { HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';
import { verifyFreeze } from './lib/budget-request-field-resolver-freeze';
import { differential, GUARD_EVAL_SCHEMA, GUARD_PREDICATE_VERSION, guardMetrics, judge, unitOutcomes, type GtUnit, type SampleUnit } from './lib/budget-request-incomplete-name-guard-evaluator';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const OUT = path.join(DIR, 'p3-evaluation.json');
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

type Mode = 'off' | 'on';

async function main() {
  const freezeCommit = process.argv.find(a => a.startsWith('--gt-freeze-commit='))?.slice('--gt-freeze-commit='.length);
  if (!freezeCommit) { console.error('STOP: --gt-freeze-commit が必要'); process.exitCode = 1; return; }
  const frozen = [
    path.join(DIR, 'sample.json'), path.join(DIR, 'visual-gt.json'), path.join(DIR, 'gt-worklist.json'), path.join(DIR, 'baseline-artifacts.json'),
    'docs/tasks/20261003_1321_FieldResolver_v0_Incomplete_Name_Safety_Guard_Preregistration.md',
    'docs/tasks/20261003_1437_FieldResolver_v0_Incomplete_Name_Safety_Guard_Preregistration_Supplement.md',
    'scripts/pipeline-v2/lib/budget-request-logical-row.ts',
  ];
  const fv = verifyFreeze(freezeCommit, frozen);
  if (!fv.allMatch) { console.error(`STOP: 凍結した成果物が ${freezeCommit} と一致しない\n${JSON.stringify(fv.entries.filter(e => !e.match), null, 1)}`); process.exitCode = 1; return; }

  const sampleFile = readJson<{ sample: (SampleUnit & { canonicalUrl: string })[] }>(path.join(DIR, 'sample.json'));
  const gtFile = readJson<{ units: (GtUnit & { canonicalUrl: string; physicalPage: number })[] }>(path.join(DIR, 'visual-gt.json'));
  const idOf = (s: { documentKey: string; page: number; logicalRowIndex: number }) => `${s.documentKey}:${s.page}:${s.logicalRowIndex}`;
  const sample = new Map(sampleFile.sample.map(s => [idOf(s), s as SampleUnit]));
  if (gtFile.units.length !== 43 || sampleFile.sample.length !== 43 || gtFile.units.some(g => !sample.has(g.unitId))) { console.error('STOP: 43 unit の identity が一致しない'); process.exitCode = 1; return; }

  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const pathOf = (url: string) => targets.find(t => t.canonicalUrl === url)!.localPath;
  const pageInput = async (url: string, n: number): Promise<FieldResolverPageInput> => {
    const ex = await extractPageTokens(pathOf(url), n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    return { meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) };
  };

  // contexts: 開発用の run（範囲全体・hierarchy あり）、held-out の 16 ページ（1 ページずつ）、標本の additional ページ（1 ページずつ）
  const byKey = new Map<string, Record<Mode, FieldResolverResult[]>>();
  const unitRecords: Record<Mode, Map<string, RecordFieldResolution | undefined>> = { off: new Map(), on: new Map() };
  const all: Record<Mode, FieldResolverResult[]> = { off: [], on: [] };
  const run = (pages: FieldResolverPageInput[], hierarchy: ReturnType<typeof observeDocumentHierarchyV2> | null): Record<Mode, FieldResolverResult> => ({
    off: resolveFields({ pages, hierarchy }),
    on: resolveFields({ pages, hierarchy, incompleteNameGuard: true }),
  });
  const register = (key: string, r: Record<Mode, FieldResolverResult>) => {
    for (const m of ['off', 'on'] as Mode[]) {
      all[m].push(r[m]);
      for (const rec of r[m].records) {
        const id = `${key}:${rec.anchor.page}:${rec.anchor.logicalRowIndex}`;
        if (sample.has(id)) unitRecords[m].set(id, rec);
      }
    }
  };
  const devResults = new Map<string, Record<Mode, FieldResolverResult>>();
  for (const r of FIELD_RESOLVER_RUNS) {
    const pages: FieldResolverPageInput[] = [];
    for (let n = r.pages[0]; n <= r.pages[1]; n++) pages.push(await pageInput(r.canonicalUrl, n));
    const hierarchy = r.hierarchy ? observeDocumentHierarchyV2(r.hierarchy.view, pages, HIERARCHY_B_ONLY_OPTIONS) : null;
    const res = run(pages, hierarchy);
    devResults.set(r.documentKey, res);
    register(r.documentKey, res);
  }
  const manifest = readJson<HeldoutManifest>(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0', 'manifest.json'));
  const heldPage = new Map<string, Record<Mode, FieldResolverResult>>();
  for (const d of manifest.documents) for (const p of d.pages) {
    const res = run([await pageInput(d.canonicalUrl, p.physicalPage)], null);
    heldPage.set(`${d.canonicalUrl}#${p.physicalPage}`, res);
    // 標本の held-out v0 ページ（環境省 p75）は documentKey が moe-ippan
    register(d.documentId, res);
  }
  const added = [...new Map(sampleFile.sample.filter(s => s.documentKey.endsWith('-additional')).map(s => [`${s.documentKey}#${s.page}`, s])).values()];
  for (const s of added) {
    const res = run([await pageInput(s.canonicalUrl, s.page)], null);
    register(s.documentKey, res);
    void byKey;
  }

  const os = unitOutcomes(gtFile.units, sample, unitRecords.off, unitRecords.on);
  const metrics = guardMetrics(os);
  const known = ['moe-ippan:75:7', 'moe-ippan:75:27', 'moe-ippan:75:31'];
  const knownFri = os.filter(o => known.includes(o.unitId) && o.afterStatus === 'resolved').length;
  const diff = differential(all.off, all.on);

  // development Golden（20 target）: guard off / on の評価を同じ evaluator で比べる
  const golden = readJson<Golden>(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'v0', 'golden.json'));
  const goldenEval = (m: Mode) => evaluateGolden(golden, sample2 => {
    const hits = FIELD_RESOLVER_RUNS.filter(r => r.canonicalUrl === sample2.document.canonicalUrl && sample2.sourcePage >= r.pages[0] && sample2.sourcePage <= r.pages[1]);
    const h = hits.find(r => r.hierarchy) ?? hits[0];
    return h ? devResults.get(h.documentKey)![m] : null;
  });
  const gOff = goldenEval('off'), gOn = goldenEval('on');
  const outcomeKey = (o: { targetId: string; field: string; outcome: string }) => `${o.targetId}|${o.field}|${o.outcome}`;
  const gOffSet = new Set(gOff.outcomes.map(outcomeKey));
  const goldenChanges = gOn.outcomes.filter(o => !gOffSet.has(outcomeKey(o))).map(outcomeKey);

  // held-out（16 ページ・52 target）
  const heldGolden = readJson<never>(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0', 'golden.json'));
  const heldEval = (m: Mode): HeldoutReport => evaluateHeldout(heldGolden, s2 => {
    const x = s2 as unknown as { sourcePage: number; document: { canonicalUrl: string } };
    return heldPage.get(`${x.document.canonicalUrl}#${x.sourcePage}`)?.[m] ?? null;
  });
  const hOff = heldEval('off'), hOn = heldEval('on');
  const hOffSet = new Set(hOff.outcomes.map(outcomeKey));
  const heldChanges = hOn.outcomes.filter(o => !hOffSet.has(outcomeKey(o))).map(outcomeKey);

  const gComplete = os.filter(o => o.stratum === 'G' && o.visualGt === 'complete_on_current_logical_row').length;
  const verdict = judge({
    metrics,
    knownFailuresFalseResolved: knownFri,
    firedCompleteInGStratum: { complete: gComplete },
    differential: diff,
    goldenOutcomeChanges: goldenChanges.length,
    goldenOnSafety: { falseResolved: gOn.overall.falseResolved, wrongSource: gOn.overall.wrongSource, wrongNormalization: gOn.overall.wrongNormalization },
    heldoutOnSafety: { wrongSource: hOn.overall.wrongSource, wrongNormalization: hOn.overall.wrongNormalization, blankAsZero: hOn.confusion.blankConfirmedAsZero, zeroAsBlank: hOn.confusion.zeroConfirmedAsBlank },
    beforeMismatches: os.filter(o => !o.beforeNameMatchesFrozenBaseline).length,
  });

  const out = {
    schema: GUARD_EVAL_SCHEMA,
    baseCommit: freezeCommit,
    guardOption: { name: 'incompleteNameGuard', default: false, evaluatedAs: 'on' },
    predicateVersion: GUARD_PREDICATE_VERSION,
    resolverSourceSha256: sha256('scripts/pipeline-v2/lib/budget-request-field-resolver.ts'),
    sample: { path: path.join(DIR, 'sample.json'), units: sampleFile.sample.length, sha256: sha256(path.join(DIR, 'sample.json')) },
    visualGt: { path: path.join(DIR, 'visual-gt.json'), units: gtFile.units.length, sha256: sha256(path.join(DIR, 'visual-gt.json')) },
    freezeVerification: fv,
    metrics,
    confusionMatrix: {
      incomplete: { guardFires: os.filter(o => o.visualGt === 'incomplete_continues_below' && o.guardFired).length, doesNotFire: os.filter(o => o.visualGt === 'incomplete_continues_below' && !o.guardFired).length },
      complete: { guardFires: os.filter(o => o.visualGt === 'complete_on_current_logical_row' && o.guardFired).length, doesNotFire: os.filter(o => o.visualGt === 'complete_on_current_logical_row' && !o.guardFired).length },
    },
    knownP75Failures: Object.fromEntries(known.map(k => [k, os.find(o => o.unitId === k)])),
    differential: diff,
    developmentGolden: { off: gOff.overall, on: gOn.overall, changedOutcomes: goldenChanges },
    heldout: { off: hOff.overall, on: hOn.overall, changedOutcomes: heldChanges, offFalseResolved: hOff.failures.filter(f => f.outcome === 'false_resolved').map(f => `${f.targetId}.${f.field}`), onFalseResolved: hOn.failures.filter(f => f.outcome === 'false_resolved').map(f => `${f.targetId}.${f.field}`) },
    verdict,
    units: os,
  };
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ verdict: verdict.verdict, metrics, confusion: out.confusionMatrix, differential: diff, goldenChanged: goldenChanges.length, heldoutChanged: heldChanges }, null, 1));
  for (const c of verdict.checks.filter(c => !c.pass)) console.log(`FAILED CHECK: ${c.name} -> ${c.detail}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
