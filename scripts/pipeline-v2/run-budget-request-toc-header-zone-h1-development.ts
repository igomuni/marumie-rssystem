/**
 * H1 の development-only 評価（explored development 34 page のみ）。#396 の held-out 23 page と将来 held-out（残り page）には実行しない。
 * 機械 trigger census、#393 baseline との差分 oracle、preregistered metric を記録する。visual GT は作らない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/run-budget-request-toc-header-zone-h1-development.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPage, ruleConfigSha256, type TocPageInput } from './lib/budget-request-toc-row-assembly';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import { diffPages, triggerCensus } from './lib/budget-request-toc-row-assembly-h1-differential';

const FREEZE = process.argv.includes('--freeze-fixture');
const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const PHYS = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const H1 = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const FROZEN = {
  h1Preregistration: '0c3a377ba9d32ec55701f8d0982ff9a48e8cd9f16ba8c81927fcedffcdec1b27',
  parser393Source: 'f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd',
  evaluationResult396: 'fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66',
  observations397: 'ec58bbb2564a5068d9feb21044f5097dfc6c88bcdb63de828ef5a9da6ebe27ad',
  families397: '000857fad4f2ef1328b037ac2e73d7b72c5b839cb67815c236344dd9d87782b5',
  preregistration391: '0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8',
  amendment395: '958985cc7d895071bb77ad6d57a45de0e82c65677ea45828fb3e916389933f00',
};

function main() {
  const bad: string[] = [];
  const chk = (n: string, a: string, e: string) => { if (a !== e) bad.push(n); };
  chk('h1Prereg', fileSha(path.join(H1, 'preregistration.json')), FROZEN.h1Preregistration);
  chk('parser393', fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts'), FROZEN.parser393Source);
  chk('result396', fileSha(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024', 'evaluation-result.json')), FROZEN.evaluationResult396);
  chk('obs397', fileSha(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-false-positive-failure-isolation', '2024', 'observations.json')), FROZEN.observations397);
  chk('fam397', fileSha(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-false-positive-failure-isolation', '2024', 'failure-families.json')), FROZEN.families397);
  chk('prereg391', fileSha(path.join(ASM, 'preregistration.json')), FROZEN.preregistration391);
  chk('amend395', fileSha(path.join(ASM, 'evaluation-protocol-amendment.json')), FROZEN.amendment395);
  if (bad.length) throw new Error(`STOP_FROZEN_ARTIFACT_INTEGRITY: ${bad.join(',')}`);

  type Inv = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: 'DIRECT' | 'INHERITED'; explored: { pr3aExplored: boolean; issue389Explored: boolean } };
  const inv = readJson<{ pages: Inv[] }>(path.join(PHYS, 'candidate-inventory.json'));
  const ledger390 = new Set(readJson<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(PHYS, 'development-explored-pages.json')).pages.map(key));
  const heldout = new Set(readJson<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(ASM, 'heldout-candidates.json')).pages.map(key)); // 除外判定のみ
  const dev = inv.pages.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored || ledger390.has(key(p)));
  if (dev.length !== 34) throw new Error(`development page count ${dev.length} != 34`);
  if (dev.some(p => heldout.has(key(p)))) throw new Error('STOP: held-out page in development set');

  const raw = readJson<{ documents: { localPdfPath: string; artifactPath: string }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const cache = new Map<string, { text: string; nonEmptyLines: { lineIndex: number; text: string }[] }[]>();
  const pagesOf = (p: string) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); cache.set(p, r); } return r; };

  const perPage = dev.sort((a, b) => cmp(key(a), key(b))).map(p => {
    const rp = pagesOf(p.localPdfPath)[p.physicalPage - 1];
    const input: TocPageInput = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: rp.text, nonEmptyLines: rp.nonEmptyLines };
    const baseline = assembleTocPage(input); const h1 = assembleTocPageH1(input);
    const census = triggerCensus(input, baseline);
    const rep = diffPages(input, baseline, h1, census);
    return { localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, classifierSource: p.classifierSource, pageState: baseline.pageState, census, report: rep, baselineOutputSha256: sha256Hex(JSON.stringify(baseline)), h1OutputSha256: sha256Hex(JSON.stringify(h1)), identicalToBaseline: JSON.stringify(baseline) === JSON.stringify(h1) };
  });
  const sum = (f: (r: (typeof perPage)[number]) => number) => perPage.reduce((a, r) => a + f(r), 0);
  const tokenTypes = { REQUEST: sum(r => r.census.tokenTypes.REQUEST), MARKER: sum(r => r.census.tokenTypes.MARKER), OTHER_CODE: sum(r => r.census.tokenTypes.OTHER_CODE) };
  const triggerLines = sum(r => r.census.triggerLines.length);
  const rightKinds: Record<string, number> = {}; const abstentionDelta: Record<string, number> = {};
  for (const r of perPage) { for (const [k, v] of Object.entries(r.report.rightKinds)) rightKinds[k] = (rightKinds[k] ?? 0) + v; for (const [k, v] of Object.entries(r.report.abstentionDelta)) abstentionDelta[k] = (abstentionDelta[k] ?? 0) + v; }
  const metrics = {
    primarySafety: { falseSplitCount: sum(r => r.report.falseSplits.length), provenanceMismatch: sum(r => r.report.provenanceMismatches), unrelatedRowOutputChanges: sum(r => r.report.undeclared.filter(u => u.startsWith('UNRELATED')).length), unexpectedPageStateChanges: sum(r => r.report.pageStateChanges), otherUndeclaredDifferences: sum(r => r.report.undeclared.filter(u => !u.startsWith('UNRELATED') && u !== 'PAGE_STATE_OR_BAND_CHANGED').length) },
    primaryTarget: { eligibleTriggerCount: triggerLines, expectedSplitCount: triggerLines, actualSplitCount: sum(r => r.report.triggerLineChanges), triggerMismatches: sum(r => r.report.triggerMismatches.length) },
    secondary: { abstentionDelta, leftTitleCount: sum(r => r.report.leftTitleCount), rightKindDistribution: rightKinds, negativeControlLines: sum(r => r.census.negativeControlLines.length), tokenlessLimitationRemains: 'negativeControlLines が whole-line のまま（H1 は token なし行を分割しない）', declaredDownstreamFragmentOwnerEffects: sum(r => r.report.declaredDownstreamFragments) },
  };
  const falsification = {
    safetyRegression: metrics.primarySafety.falseSplitCount + metrics.primarySafety.provenanceMismatch + metrics.primarySafety.unrelatedRowOutputChanges + metrics.primarySafety.unexpectedPageStateChanges + metrics.primarySafety.otherUndeclaredDifferences,
    triggerImplementationMismatch: metrics.primaryTarget.triggerMismatches + Math.abs(metrics.primaryTarget.expectedSplitCount - metrics.primaryTarget.actualSplitCount),
  };
  const devSyntheticOnly = triggerLines === 0;
  const judgment = falsification.safetyRegression > 0 ? 'STOP_H1_SAFETY_REGRESSION' : falsification.triggerImplementationMismatch > 0 ? 'STOP_H1_TRIGGER_IMPLEMENTATION_MISMATCH' : devSyntheticOnly ? 'READY_FOR_H1_SYNTHETIC_ONLY_FREEZE_AND_NEW_HELDOUT_GT' : 'READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT';
  const result = {
    schema: 'budget-request-toc-header-zone-h1-development-result/v0',
    scope: 'explored development 34 page のみ。#396 の held-out 23 と将来 held-out には未実行。formal evaluation ではない。visual GT は作らない',
    h1: { implementation: 'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts', sourceSha256: fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts'), ruleConfigSha256: ruleConfigSha256(), baseline393SourceSha256: FROZEN.parser393Source, preregistrationSha256: FROZEN.h1Preregistration },
    population: { developmentPages: perPage.length, heldout396Executed: 0, futureHeldoutExecuted: 0 },
    census: { triggerLines, triggerPages: perPage.filter(r => r.census.triggerLines.length > 0).length, tokenTypes, negativeControlLines: metrics.secondary.negativeControlLines },
    devSyntheticOnly,
    metrics, falsification,
    differentialSummary: { identicalToBaselinePages: perPage.filter(r => r.identicalToBaseline).length, pagesWithDifferences: perPage.filter(r => !r.identicalToBaseline).length },
    judgment,
    claimBoundary: 'development 結果のみ。H1 の安全性・有効性の主張は行わない（DEV_SYNTHETIC_ONLY の場合は特に development corpus に positive evidence がない）。#396 の severe 10 件が直るかは確認していない',
  };
  const differential = { schema: 'budget-request-toc-header-zone-h1-development-differential/v0', pages: perPage };
  if (FREEZE) {
    fs.writeFileSync(path.join(H1, 'development-result.json'), `${JSON.stringify(result, null, 1)}\n`);
    fs.writeFileSync(path.join(H1, 'development-differential.json'), `${JSON.stringify(differential, null, 1)}\n`);
  }
  console.log(JSON.stringify({ census: result.census, metrics, falsification, devSyntheticOnly, diff: result.differentialSummary, judgment }, null, 1));
}
main();
