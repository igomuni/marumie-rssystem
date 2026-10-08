/**
 * FY2024 TOC 82 page の POST_HOC full-corpus status assessment（現在の frozen H1 を全件に適用した機械的な棚卸し）。
 * formal held-out evaluation ではない。#396 / #402 の formal result は変更・再判定しない。H1 / #393 / GT / #395 evaluator / 閾値は変更しない。
 * 使い方: BASE_MAIN_SHA=<sha> npx tsx scripts/pipeline-v2/run-budget-request-toc-full-corpus-status.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import { type PageOut, type TocPageInput } from './lib/budget-request-toc-row-assembly';
import { aggregate, evaluatePage, type GtPage, type PageResult } from './lib/budget-request-toc-row-assembly-evaluator';
import { h1TriggerCensus } from './lib/budget-request-toc-h1-formal-evaluation';
import { CANDIDATE_REASONS, candidateReasons, observePage, summarize, type Partition } from './lib/budget-request-toc-full-corpus-status';

const FREEZE = process.argv.includes('--freeze-fixture');
const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const PHYS = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const H1D = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const F396 = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024', 'evaluation-result.json');
const F402 = path.join('tests', 'fixtures', 'budget-request-toc-h1-formal-evaluation', '2024', 'formal-evaluation-result.json');
const F402OUT = path.join('tests', 'fixtures', 'budget-request-toc-h1-formal-evaluation', '2024', 'new-heldout-h1-output.json');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-full-corpus-status', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const FROZEN = { h1Source: 'ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343', result396: 'fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66', result402: '7b024a25dd3f62b4987126fd275f9275b4afbf40b7569df490175fb9c83f2283', output402: '64f344ff43728b8957fe695046a5a60ac8951703824051bc06a83078f257f366', newMembershipDigest: '06c2e68d7ac178e7e0561d16976c47936ab9d52b59d91710cab145fa8822ab28', firstMembershipDigest: '8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156' };

function main() {
  const bad: string[] = [];
  const chk = (n: string, a: string, e: string) => { if (a !== e) bad.push(n); };
  chk('h1Source', fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts'), FROZEN.h1Source);
  chk('result396', fileSha(F396), FROZEN.result396); chk('result402', fileSha(F402), FROZEN.result402); chk('output402', fileSha(F402OUT), FROZEN.output402);
  const res402 = read<{ finalJudgment: string; formalExecutionCount: number }>(F402);
  if (res402.finalJudgment !== 'SAFETY_PASS_COVERAGE_REPORTED' || res402.formalExecutionCount !== 1) bad.push('#402 judgment/count');
  const firstHeld = read<{ membershipDigestSha256: string; pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(ASM, 'heldout-candidates.json'));
  const newMem = read<{ digestSha256: string; members: { localPdfPath: string; physicalPage: number }[] }>(path.join(H1D, 'new-heldout-membership.json'));
  chk('firstDigest', firstHeld.membershipDigestSha256, FROZEN.firstMembershipDigest); chk('newDigest', newMem.digestSha256, FROZEN.newMembershipDigest);
  type Inv = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: 'DIRECT' | 'INHERITED'; publisherDomain: string; explored: { pr3aExplored: boolean; issue389Explored: boolean } };
  const inv = read<{ pages: Inv[] }>(path.join(PHYS, 'candidate-inventory.json')).pages;
  const ledger390 = new Set(read<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(PHYS, 'development-explored-pages.json')).pages.map(key));
  const dev = new Set(inv.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored || ledger390.has(key(p))).map(key));
  const first = new Set(firstHeld.pages.map(key)); const nw = new Set(newMem.members.map(key));
  const all = new Set(inv.map(key)); const union = new Set([...dev, ...first, ...nw]);
  const inter = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
  if (dev.size !== 34 || first.size !== 23 || nw.size !== 25 || union.size !== 82 || all.size !== 82 || inter(dev, first) + inter(dev, nw) + inter(first, nw) !== 0 || [...union].some(k => !all.has(k))) bad.push('partition');
  if (bad.length) throw new Error(`STOP: ${bad.join(',')}`);
  const partitionOf = (k: string): Partition => (dev.has(k) ? 'DEVELOPMENT_EXPLORED' : first.has(k) ? 'FIRST_HELDOUT_POSTHOC' : 'NEW_HELDOUT_POSTHOC');

  const rawManifest = read<{ documents: { localPdfPath: string; artifactPath: string; logicalDocumentIndex?: number }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(rawManifest.documents.map(d => [d.localPdfPath, d]));
  const cache = new Map<string, { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }[]>();
  const pageOf = (p: string, n: number) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); cache.set(p, r); } return r[n - 1]; };
  const sorted = [...inv].sort((a, b) => cmp(key(a), key(b)));
  const inputs: TocPageInput[] = sorted.map(p => { const rp = pageOf(p.localPdfPath, p.physicalPage); return { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: rp.text, nonEmptyLines: rp.nonEmptyLines }; });
  const run = () => inputs.map(i => assembleTocPageH1(i));
  const outputs: PageOut[] = run();
  const outText = `${JSON.stringify({ schema: 'budget-request-toc-full-corpus-h1-output/v0', status: 'POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT', note: 'frozen H1 を TOC 82 page 全件に適用した raw output（formal held-out evaluation ではない）', pages: outputs }, null, 1)}\n`;
  const deterministic = sha256Hex(outText) === sha256Hex(`${JSON.stringify({ schema: 'budget-request-toc-full-corpus-h1-output/v0', status: 'POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT', note: 'frozen H1 を TOC 82 page 全件に適用した raw output（formal held-out evaluation ではない）', pages: run() }, null, 1)}\n`);
  // #402 formal output との整合（new 25: 同一 H1・同一入力なので一致するはず）
  const o402 = read<{ pages: PageOut[] }>(F402OUT).pages;
  const same402 = o402.every(p => JSON.stringify(p) === JSON.stringify(outputs[inputs.findIndex(i => key(i) === key(p))]));

  const meta = new Map(inv.map(p => [key(p), p.publisherDomain]));
  const obs = inputs.map((inp, i) => observePage({ localPdfPath: inp.localPdfPath, physicalPage: inp.physicalPage, publisherDomain: meta.get(key(inp)) ?? null, partition: partitionOf(key(inp)), classifierSource: inp.classifierSource, pdfSha256: inp.pdfSha256, textSha256: inp.textSha256 }, outputs[i], h1TriggerCensus(inp.nonEmptyLines, outputs[i]), inp.nonEmptyLines));

  // 既存 GT（first 23: #392、new 25: #401）に #395 evaluator を変更せず適用（POST_HOC_STATUS_ONLY）
  const gtFirst = read<{ pages: GtPage[] }>(path.join(ASM, 'ground-truth.json')).pages;
  const gtNew = read<{ pages: GtPage[] }>(path.join(H1D, 'new-heldout-ground-truth.json')).pages;
  const gtOf = new Map<string, GtPage>([...gtFirst, ...gtNew].map(g => [key(g), g]));
  const evalByKey = new Map<string, PageResult>();
  inputs.forEach((inp, i) => { const g = gtOf.get(key(inp)); if (g) evalByKey.set(key(inp), evaluatePage(g, outputs[i], { pdfSha256: inp.pdfSha256, textSha256: inp.textSha256, lines: inp.nonEmptyLines }, [])); });
  const evalFor = (part: Partition) => [...evalByKey.entries()].filter(([k]) => partitionOf(k) === part).map(([, v]) => v);
  const evFirst = evalFor('FIRST_HELDOUT_POSTHOC'), evNew = evalFor('NEW_HELDOUT_POSTHOC');
  const agg = (ps: PageResult[]) => aggregate(ps);
  const gtSummary = (a: ReturnType<typeof aggregate>) => ({ pages: a.pages, pageStates: a.pageStates, pageOutcomes: a.pageOutcomes, rows: a.rows, severe: { FALSE_POSITIVE_ROW_ASSEMBLY: a.severe.FALSE_POSITIVE_ROW_ASSEMBLY.count, WRONG_COLUMN_ASSIGNMENT: a.severe.WRONG_COLUMN_ASSIGNMENT.count, WRONG_FRAGMENT_ATTACHMENT: a.severe.WRONG_FRAGMENT_ATTACHMENT.count, PROVENANCE_MISMATCH: a.severe.PROVENANCE_MISMATCH.count, total: a.severe.total }, fragments: a.fragments, provenance: a.provenance, unresolvedByFamily: a.unresolvedByFamily, blockingUnresolved: a.blockingUnresolved.count });

  const queue = obs.map(o => ({ o, reasons: candidateReasons(o, evalByKey.get(key(o)) ?? null) })).filter(x => x.reasons.length > 0).map(({ o, reasons }) => ({
    localPdfPath: o.localPdfPath, physicalPage: o.physicalPage, partition: o.partition, classifierSource: o.classifierSource, pageState: o.pageState, candidateReasons: reasons,
    machineCounts: { units: o.units, rowKinds: o.rowKinds, abstainedUnits: o.abstainedUnits, fragmentsAttached: o.fragmentsAttached, h1TriggerLines: o.h1.triggerLines.length, h1NegativeControlLines: o.h1.negativeControlLines.length },
    gtStatus: evalByKey.has(key(o)) ? 'GT_AVAILABLE' : 'GT_UNAVAILABLE',
    formalHistory: o.partition === 'DEVELOPMENT_EXPLORED' ? ['development / explored（visual GT なし）'] : o.partition === 'FIRST_HELDOUT_POSTHOC' ? ['#396 first held-out（旧 parser #393 の formal result は STOP_SAFETY。不変）'] : ['#402 new held-out（H1 の one-shot formal result は SAFETY_PASS_COVERAGE_REPORTED。不変）'],
  }));
  const reasonCounts: Record<string, number> = Object.fromEntries(CANDIDATE_REASONS.map(r => [r, queue.filter(q => q.candidateReasons.includes(r)).length]));

  const part = (p?: Partition) => summarize(obs.filter(o => !p || o.partition === p));
  const devObs = obs.filter(o => o.partition === 'DEVELOPMENT_EXPLORED');
  const devComparableUnits = devObs.reduce((a, o) => a + (o.rowKinds.REQUEST_NUMBER_ROW ?? 0) + (o.rowKinds.MARKER_ROW ?? 0), 0);
  const a23 = agg(evFirst), a25 = agg(evNew), a48 = agg([...evFirst, ...evNew]);
  const status = {
    schema: 'budget-request-toc-full-corpus-status/v0',
    status: 'POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT',
    claimBoundary: 'POST_HOC の機械的な現状地図。formal held-out evaluation ではない（#396 / #402 の formal result は不変・再判定なし）。正しさの証明・production GO・B 層 GO ではない。GT のない development 34 page を correct とは判定していない。failure の原因は決めていない',
    population: { total: obs.length, DEVELOPMENT_EXPLORED: dev.size, FIRST_HELDOUT_POSTHOC: first.size, NEW_HELDOUT_POSTHOC: nw.size, overlaps: 0, deterministicRerunIdentical: deterministic, new25OutputIdenticalToFormal402Output: same402 },
    byPartition: { ALL: part(), DEVELOPMENT_EXPLORED: part('DEVELOPMENT_EXPLORED'), FIRST_HELDOUT_POSTHOC_POSTHOC_REEXECUTION: part('FIRST_HELDOUT_POSTHOC'), NEW_HELDOUT_POSTHOC_POSTHOC_REEXECUTION: part('NEW_HELDOUT_POSTHOC') },
    existingGtStatus: {
      label: 'POST_HOC_STATUS_ONLY',
      first23_currentH1_posthoc: gtSummary(a23), new25_currentH1_posthoc: gtSummary(a25),
      combined48: { label: 'DESCRIPTIVE_AGGREGATE_ONLY_NOT_A_FORMAL_HELDOUT_RESULT', ...gtSummary(a48) },
      note: '23 と 25 は formal population として結合しない。first23 は旧 parser #393 の formal result（STOP_SAFETY）とは別の、現在の H1 による post-hoc 再実行',
    },
    observability: {
      A_pageStructuralResolution: part().pageState,
      B_rightColumnObservability: part().rightBand,
      C_tokenRowObservability: { gtPagesComparableRows: a48.rows.gtComparable, matched: a48.rows.matched, correct: a48.rows.states.CORRECT, incorrect: a48.rows.states.INCORRECT, abstained: a48.rows.states.ABSTAINED, unresolved: a48.rows.states.UNRESOLVED, developmentParserComparableUnitsWithoutGt: devComparableUnits },
      D_fragmentObservability: { fragmentsAttachedAllPages: part().fragmentsAttached, gtPages: a48.fragments },
      E_evaluationApplicability: { comparableRowsOnGtPages: a48.rows.gtComparable, notComparable: a48.rows.notComparable, pageLevelNotComparable: a48.rows.pageLevelNotComparable, gtUnavailablePages: dev.size, gtUnavailableParserComparableUnits: devComparableUnits },
    },
    machineObservedStatusTaxonomy: {
      note: '既存 evaluator から直接導けるものだけを分類。development 34 は GT がないため GT_UNAVAILABLE（正常そうとは判定しない）',
      OBSERVED_CORRECT_UNDER_EXISTING_GT: a48.rows.states.CORRECT, OBSERVED_INCORRECT_UNDER_EXISTING_GT: a48.rows.states.INCORRECT,
      EXPECTED_ABSTENTION: a48.rows.states.ABSTAINED + a48.pageStates.PAGE_ABSTAINED, UNRESOLVED: a48.rows.states.UNRESOLVED,
      NOT_COMPARABLE: a48.rows.notComparable.plainRow, GT_UNAVAILABLE: devComparableUnits,
      MACHINE_CONTROL_CASE: { h1TriggerLines: part().h1.triggerLines, h1NegativeControlLines: part().h1.negativeControlLines },
    },
    humanReviewQueue: { pages: queue.length, candidateReasonCounts: reasonCounts, note: '候補理由は failure diagnosis ではない（例: H1_TRIGGER_PRESENT は control 候補）。priority は付けない' },
    pages: obs,
  };
  const queueDoc = { schema: 'budget-request-toc-human-review-queue/v0', note: '機械観測のみから抽出した次の human review の候補。priority・severity・next hypothesis は付けていない。候補理由は failure diagnosis ではない', candidateReasonEnum: CANDIDATE_REASONS, pages: queue };
  const statusText = `${JSON.stringify(status, null, 1)}\n`, queueText = `${JSON.stringify(queueDoc, null, 1)}\n`;
  if (FREEZE) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'full-corpus-h1-output.json'), outText); fs.writeFileSync(path.join(OUT, 'full-corpus-status.json'), statusText); fs.writeFileSync(path.join(OUT, 'human-review-queue.json'), queueText);
    const manifest = {
      schema: 'budget-request-toc-full-corpus-status-assessment-manifest/v0', status: 'POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT',
      createdAt: process.env.ASSESSMENT_CREATED_AT ?? new Date().toISOString(), baseMainSha: process.env.BASE_MAIN_SHA ?? null,
      h1SourceSha256: FROZEN.h1Source, parser393SourceSha256: fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts'), evaluatorSourceSha256: fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-evaluator.ts'),
      partitions: { development: { count: 34, digestSha256: sha256Hex([...dev].sort().join('\n')) }, firstHeldout: { count: 23, membershipDigestSha256: FROZEN.firstMembershipDigest }, newHeldout: { count: 25, membershipDigestSha256: FROZEN.newMembershipDigest }, total: 82, overlaps: 0 },
      formalResultHashes: { result396: FROZEN.result396, result402: FROZEN.result402, newHeldoutH1Output402: FROZEN.output402 },
      outputHashes: { fullCorpusH1Output: sha256Hex(outText), fullCorpusStatus: sha256Hex(statusText), humanReviewQueue: sha256Hex(queueText) },
      assessmentSources: { runner: fileSha('scripts/pipeline-v2/run-budget-request-toc-full-corpus-status.ts'), helper: fileSha('scripts/pipeline-v2/lib/budget-request-toc-full-corpus-status.ts') },
      deterministicRerunIdentical: deterministic, new25OutputIdenticalToFormal402Output: same402, h1ExecutionsOnFullCorpus: 'POST_HOC（formal evaluation ではない。one-shot 制約なし）',
      claimBoundary: status.claimBoundary, judgment: 'READY_FOR_HUMAN_FAILURE_ISOLATION_REVIEW',
    };
    fs.writeFileSync(path.join(OUT, 'assessment-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  }
  console.log(JSON.stringify({ population: status.population, all: status.byPartition.ALL, dev: status.byPartition.DEVELOPMENT_EXPLORED, first: status.byPartition.FIRST_HELDOUT_POSTHOC_POSTHOC_REEXECUTION, new: status.byPartition.NEW_HELDOUT_POSTHOC_POSTHOC_REEXECUTION, gt23: status.existingGtStatus.first23_currentH1_posthoc, gt25: status.existingGtStatus.new25_currentH1_posthoc, gt48: status.existingGtStatus.combined48, queue: status.humanReviewQueue }, null, 1));
}
main();
