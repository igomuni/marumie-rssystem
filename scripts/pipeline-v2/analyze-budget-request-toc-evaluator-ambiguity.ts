/**
 * Family C（evaluator の identity key 衝突）の corpus-level 機械的 failure isolation（analysis-only・read-only）。
 * commit 済み artifact（GT・parser 出力・既存評価結果）のみを読む。raw-text / PDF / data/download は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-evaluator-ambiguity.ts [--freeze-fixture] [--out <census.json のパス>]
 * --freeze-fixture を付けた時だけ書き込む（既定の出力先は tests/fixtures/budget-request-toc-evaluator-ambiguity-failure-isolation/2024/census.json）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageOut } from './lib/budget-request-toc-row-assembly';
import type { GtPage, PageResult } from './lib/budget-request-toc-row-assembly-evaluator';
import { censusPage, evaluateWithoutRaw, tally, type PageCensus } from './lib/budget-request-toc-evaluator-ambiguity';

const FREEZE = process.argv.includes('--freeze-fixture');
const outIdx = process.argv.indexOf('--out');
const FX = (...p: string[]) => path.join('tests', 'fixtures', ...p);
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : FX('budget-request-toc-evaluator-ambiguity-failure-isolation', '2024', 'census.json');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const FROZEN_OUT403 = '7d31dbb5e03b5c1984b2aa1af2c7f2ae09d74d3d213f673ee9f5f65b3e4f2316';
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type G = PageResult['groups'][number];
type CommittedPage = { localPdfPath: string; physicalPage: number; groups: G[]; fragments: PageResult['fragments']; instances: PageResult['instances'] };
const strip = (i: PageResult['instances']) => i.filter(x => x.family !== 'PROVENANCE_MISMATCH');

function main() {
  const outFile = FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-h1-output.json');
  const outHash = sha256Hex(fs.readFileSync(outFile));
  if (outHash !== FROZEN_OUT403) throw new Error('STOP: #403 output hash mismatch');
  const parser = new Map(read<{ pages: PageOut[] }>(outFile).pages.map(p => [key(p), p]));
  const status = read<{ pages: { localPdfPath: string; physicalPage: number; partition: string; classifierSource: string }[]; existingGtStatus: Record<string, any> }>(FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json'));
  const gt1 = read<{ counts: any; pages: GtPage[] }>(FX('budget-request-toc-row-assembly', '2024', 'ground-truth.json'));
  const gt2 = read<{ counts: any; pages: GtPage[] }>(FX('budget-request-toc-row-assembly-header-zone-right-row-h1', '2024', 'new-heldout-ground-truth.json'));
  const gtMap = new Map([...gt1.pages, ...gt2.pages].map(g => [key(g), g]));

  const pages: PageCensus[] = status.pages.map(m => {
    const pr = parser.get(key(m)); if (!pr) throw new Error(`STOP: parser output missing ${key(m)}`);
    return censusPage({ localPdfPath: m.localPdfPath, physicalPage: m.physicalPage, partition: m.partition, classifierSource: m.classifierSource }, pr, gtMap.get(key(m)) ?? null);
  });

  // ---- coverage / partition / GT accounting ----
  const part = (p: string) => pages.filter(x => x.partition === p);
  const gtPartOk = pages.every(p => (p.partition === 'FIRST_HELDOUT_POSTHOC') === gt1.pages.some(g => key(g) === key(p)) && (p.partition === 'NEW_HELDOUT_POSTHOC') === gt2.pages.some(g => key(g) === key(p)));
  const gtAcc = (g: { pages: GtPage[]; counts: any }) => {
    const rows = g.pages.flatMap(p => p.rows);
    return { pages: g.pages.length, rows: rows.length, request: rows.filter(r => r.rowKindVisual === 'REQUEST_NUMBER_ROW').length, marker: rows.filter(r => r.rowKindVisual === 'MARKER_ROW').length, plain: rows.filter(r => r.rowKindVisual === 'PLAIN_ROW').length, fragments: g.pages.reduce((a, p) => a + p.fragments.length, 0), committedCounts: g.counts };
  };

  // ---- committed 評価結果との整合 ----
  const obs = read<{ pages: any[] }>(FX('budget-request-toc-human-review-failure-isolation', '2024', 'observations.json'));
  const h3 = obs.pages.find(x => x.id === 'H3');
  const h3Key = `${h3.localPdfPath}#${h3.physicalPage}`;
  const h3Census = pages.find(p => key(p) === h3Key)!;
  const h3Ev = evaluateWithoutRaw(gtMap.get(h3Key)!, parser.get(h3Key)!);
  const h3Recomputed = { groupsNotOneToOne: h3Ev.groups.filter(g => !(g.n === 1 && g.m === 1)), pageOutcome: h3Ev.pageOutcome, rowStates: h3Ev.rowStates, fragments: h3Ev.fragments, instances: strip(h3Ev.instances).filter(i => i.family !== 'ABSTAINED_ROW').map(i => ({ family: i.family, gtRowId: i.gtRowId ?? null, gtKey: i.gtKey ?? null, parserUnit: i.parserUnit ?? null, state: i.state ?? null })) };
  const h3Match = eq(h3Recomputed, h3.gt.evaluation);

  const r396 = read<{ pages: CommittedPage[]; summary: any }>(FX('budget-request-toc-row-assembly-evaluation', '2024', 'evaluation-result.json'));
  const r396Groups = r396.pages.flatMap(p => p.groups.filter(g => !(g.n === 1 && g.m === 1)).map(g => ({ page: key(p), ...g })));
  const r396Fact = {
    nonOneToOneGroups: r396Groups.length, pages: new Set(r396Groups.map(g => g.page)).size,
    nEqMGroups: r396Groups.filter(g => g.n === g.m).length, n1m0MergeGroups: r396Groups.filter(g => g.n === 1 && g.m === 0).length, otherShapeGroups: r396Groups.filter(g => g.n !== g.m && !(g.n === 1 && g.m === 0)).map(g => ({ page: g.page, key: g.key, n: g.n, m: g.m, unmatchedState: g.unmatchedState })),
    unresolvedByFamily: r396.summary.unresolvedByFamily, ambiguousOwnerInstances: r396.pages.flatMap(p => p.instances.filter(i => i.family === 'AMBIGUOUS_OWNER_GROUP').map(i => ({ page: key(p), gtKey: i.gtKey ?? null, gtRowId: i.gtRowId ?? null, parserUnit: i.parserUnit ?? null }))),
    oldParserVsCurrentH1: r396Groups.map(g => { const c = pages.find(p => key(p) === g.page)!; const cur = c.collisions.find(x => x.key === g.key); const o = c.otherNonOneToOne.find(x => x.key === g.key); return { page: g.page, key: g.key, old: { n: g.n, m: g.m }, current: cur ? { n: cur.n, m: cur.m, classification: cur.classification } : o ? { n: o.n, m: o.m, nonDuplicateShape: o.shape } : { oneToOne: true } }; }),
  };

  const r402 = read<{ pages: CommittedPage[]; summary: any }>(FX('budget-request-toc-h1-formal-evaluation', '2024', 'formal-evaluation-result.json'));
  const r402Check = r402.pages.map(p => { const e = evaluateWithoutRaw(gtMap.get(key(p))!, parser.get(key(p))!); return { page: key(p), groups: eq(e.groups, p.groups), fragments: eq(e.fragments, p.fragments), instances: eq(strip(e.instances), strip(p.instances)) }; });
  const r402Groups = r402.pages.flatMap(p => p.groups.filter(g => !(g.n === 1 && g.m === 1)));

  const first23 = part('FIRST_HELDOUT_POSTHOC'), new25 = part('NEW_HELDOUT_POSTHOC'), dev34 = part('DEVELOPMENT_EXPLORED');
  const ex = status.existingGtStatus.first23_currentH1_posthoc;
  const evFirst = first23.reduce((a, p) => ({ unresolved: a.unresolved + (p.evaluator?.unresolvedFragments ?? 0), owner: a.owner + (p.evaluator?.ownerGroupInstances ?? 0) }), { unresolved: 0, owner: 0 });
  const dupGroups = (ps: PageCensus[]) => ps.flatMap(p => p.collisions);

  const census = {
    schema: 'toc-evaluator-ambiguity-family-c-census/v1',
    note: 'POST_HOC mechanical census。evaluator / parser / GT / #395 protocol は不変。raw-text 不使用（evaluatePage は dummy raw で呼び provenance 結果は破棄）。',
    method: 'evaluatePage を dummy raw（空 line）で呼び、groups / fragments / instances のみ使用。key multiplicity は export 済み primitive（gtKey / parserKey / isComparableGt）で集計',
    inputs: { h1OutputSha256: outHash },
    populations: { pages: pages.length, partitions: { DEVELOPMENT_EXPLORED: dev34.length, FIRST_HELDOUT_POSTHOC: first23.length, NEW_HELDOUT_POSTHOC: new25.length }, gtAvailable: pages.filter(p => p.gtAvailable).length, gtPartitionMatchesMembership: gtPartOk },
    gtAccounting: { first23: gtAcc(gt1), new25: gtAcc(gt2) },
    tallies: { all82: tally(pages), dev34_noGt: tally(dev34), first23_gt: tally(first23), new25_gt: tally(new25), gtPopulation48: tally([...first23, ...new25]) },
    pageStateByPartition: Object.fromEntries(['DEVELOPMENT_EXPLORED', 'FIRST_HELDOUT_POSTHOC', 'NEW_HELDOUT_POSTHOC'].map(k => [k, part(k).reduce((a: Record<string, number>, p) => ((a[p.parserState] = (a[p.parserState] ?? 0) + 1), a), {})])),
    dev34ParserOnly: { duplicateGroups: dupGroups(dev34).length, pages: dev34.filter(p => p.collisions.length).length, withParserFragmentRelation: dupGroups(dev34).filter(c => c.parserFragmentsOnKey > 0).length },
    validation: {
      h3: { id: h3.id, localPdfPath: h3.localPdfPath, physicalPage: h3.physicalPage, reproducesObservations404: h3Match, recomputed: h3Recomputed, observationsGroupsNotOneToOne: h3.gt.evaluation.groupsNotOneToOne, collisions: h3Census.collisions },
      committed396_oldParser_recordedFacts: r396Fact,
      committed402: { pagesCompared: r402Check.length, allGroupsFragmentsInstancesEqual: r402Check.every(c => c.groups && c.fragments && c.instances), nonOneToOneGroups: r402Groups.length, allNEqM: r402Groups.every(g => g.n === g.m && g.matched === g.n), unresolvedByFamily: r402.summary.unresolvedByFamily, blockingUnresolved: r402.summary.blockingUnresolved.count, perPage: r402Check, recomputedNew25DuplicateGroups: dupGroups(new25).length },
      committed403_first23_posthoc: { existingGtStatusFragmentsUnresolved: ex.fragments.unresolved, existingGtStatusUnresolvedByFamily: ex.unresolvedByFamily, recomputedFragmentsUnresolved: evFirst.unresolved, recomputedOwnerGroupInstances: evFirst.owner, equal: ex.fragments.unresolved === evFirst.unresolved && (ex.unresolvedByFamily.AMBIGUOUS_OWNER_GROUP ?? 0) === evFirst.owner, recomputedFirst23DuplicateGroups: dupGroups(first23).length },
    },
    pages,
  };
  const text = JSON.stringify(census, null, 2) + '\n';
  const t = census.tallies;
  console.log(JSON.stringify({ outSha256: sha256Hex(Buffer.from(text)), populations: census.populations, gtAccounting: census.gtAccounting, h3Match, dev34ParserOnly: census.dev34ParserOnly, tallies: { all82: t.all82, dev34: t.dev34_noGt, first23: t.first23_gt, new25: t.new25_gt }, r396: { ...r396Fact, oldParserVsCurrentH1: undefined }, c402: { ok: census.validation.committed402.allGroupsFragmentsInstancesEqual, groups: r402Groups.length }, c403: census.validation.committed403_first23_posthoc }, null, 1));
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
}
main();
