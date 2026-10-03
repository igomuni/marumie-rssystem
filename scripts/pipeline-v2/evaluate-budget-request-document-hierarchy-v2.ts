/**
 * DocumentHierarchy v2 failure isolation 実験 — 段階B（評価）。段階Aのvariant別artifactと評価専用GTを突き合わせる。GTを読むのはこのCLIだけ。
 * 同じ照合を全variantに適用する。v2比較の主は posthoc 照合（#364で定義済みのnameOnly+ordinalTiebreak）。事前固定の照合も併記。
 * 成功条件・判定は実験計画で事前に固定済み（結果を見て変えない）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-document-hierarchy-v2.ts [year] [--tag=v2] [--group=development,regression,holdout]
 * 出力: data/work/budget-request-document-hierarchy/{year}/v2-failure-isolation/evaluation-{tag}.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import type { DocumentHierarchyResult } from './lib/budget-request-document-hierarchy';
import { classifyBHoldout, countExcludedGtMatches, evaluateView, summarize, type Counts, type GtNode, type MatchOptions, type SummaryMatchMode } from './lib/budget-request-document-hierarchy-eval';

const FIX = path.join('tests', 'fixtures', 'budget-request-document-hierarchy', '2024');
type Scope = (n: GtNode, rootOf: (k: string) => string) => boolean;
const all: Scope = () => true;
const inRange: Scope = n => n.inDetailRange !== false;
const subtree = (orgKey: string): Scope => (n, rootOf) => rootOf(n.key) === orgKey;

interface Config {
  id: string;
  group: 'development' | 'regression' | 'holdout' | 'holdout-b2';
  view: 'summary' | 'detail';
  gtFile: string;
  scope: Scope;
  summaryMode: SummaryMatchMode;
  /** development/holdout で「根」とみなすGT org key（rootのlevelを確認する対象） */
  orgKey?: string;
}
const CONFIGS: Config[] = [
  { id: 'meti-detail', group: 'development', view: 'detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'meti-detail-narrow', group: 'development', view: 'detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: subtree('org-035'), summaryMode: 'pageRef', orgKey: 'org-035' },
  { id: 'mext-detail-narrow', group: 'development', view: 'detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: subtree('org-030'), summaryMode: 'pageRef', orgKey: 'org-030' },
  { id: 'mhlw-detail-narrow', group: 'development', view: 'detail', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: subtree('org-070'), summaryMode: 'pageRef', orgKey: 'org-070' },
  { id: 'mhlw-summary', group: 'regression', view: 'summary', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mhlw-detail', group: 'regression', view: 'detail', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'meti-summary', group: 'regression', view: 'summary', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-summary', group: 'regression', view: 'summary', gtFile: 'mext-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-detail', group: 'regression', view: 'detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: inRange, summaryMode: 'pageRef' },
  { id: 'meti-detail-pre-header', group: 'regression', view: 'detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: n => n.printedStartPage + 4 <= 103, summaryMode: 'pageRef' },
  { id: 'env-detail', group: 'holdout', view: 'detail', gtFile: 'env-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'maff-fukko-detail', group: 'holdout', view: 'detail', gtFile: 'maff-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef', orgKey: 'org-010' },
  { id: 'mlit-fukko-detail', group: 'holdout-b2', view: 'detail', gtFile: 'mlit-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef', orgKey: 'org-010' },
];
const VARIANTS = ['v1', 'v2-off-off', 'v2-A', 'v2-B', 'v2-AB'] as const;
type Variant = (typeof VARIANTS)[number];
const MATCHERS: { name: 'preregistered' | 'posthoc'; opts: MatchOptions }[] = [
  { name: 'preregistered', opts: {} },
  { name: 'posthoc', opts: { nameOnly: true, ordinalTiebreak: true } },
];

const KEYS: (keyof Counts | 'ancestor' | 'depth' | 'matched')[] = ['exact', 'falseParent', 'unresolved', 'childNotFound'];
const sig = (c: Counts): string => JSON.stringify([c.gtEdges, c.exact, c.falseParent, c.unresolved, c.childNotFound, c.ancestorExact, c.depthExact, c.nodesMatched]);
const pct = (x: number, n: number): number => (n ? x / n : 0);
void KEYS;
const line = (c: Counts): string =>
  `exact ${c.exact}/${c.gtEdges} false ${c.falseParent}/${c.gtEdges} unres ${c.unresolved}/${c.gtEdges} notFound ${c.childNotFound}/${c.gtEdges} anc ${c.ancestorExact.x}/${c.ancestorExact.n} depth ${c.depthExact.x}/${c.depthExact.n} matched ${c.nodesMatched.x}/${c.nodesMatched.n}`;

type Cell = {
  counts: Record<'preregistered' | 'posthoc', Counts>;
  gtExcluded: { excluded: number; keys: string[] };
  rootLevels: Record<string, number | null>;
  edgeOutcomes: Record<string, string>;
  diag: Record<string, unknown>;
  outsideGtPosthoc: number;
};

async function main() {
  const args = process.argv.slice(2);
  const tag = args.find(a => a.startsWith('--tag='))?.slice(6) ?? 'v2';
  const groups = args.find(a => a.startsWith('--group='))?.slice(8).split(',');
  const year = Number(args.filter(a => !a.startsWith('--'))[0] ?? 2024);
  const dir = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'v2-failure-isolation');
  const cells: Record<string, Record<Variant, Cell>> = {};
  for (const cfg of CONFIGS) {
    if (groups && !groups.includes(cfg.group)) continue;
    const gtRaw = JSON.parse(fs.readFileSync(path.join(FIX, cfg.gtFile), 'utf8')) as { detailPrintedToPhysicalPageOffset?: number; source?: { printedToPhysicalPageOffset?: number }; nodes: GtNode[] };
    const offset = gtRaw.detailPrintedToPhysicalPageOffset ?? gtRaw.source?.printedToPhysicalPageOffset ?? 0;
    const byKey = new Map(gtRaw.nodes.map(n => [n.key, n]));
    const rootOf = (k: string): string => {
      let cur = byKey.get(k) as GtNode;
      while (cur.parent) cur = byKey.get(cur.parent) as GtNode;
      return cur.key;
    };
    const keys = new Set(gtRaw.nodes.filter(n => cfg.scope(n, rootOf)).map(n => n.key));
    cells[cfg.id] = {} as Record<Variant, Cell>;
    console.log(`\n=== ${cfg.id} (${cfg.group}, GT nodes in scope ${keys.size})`);
    for (const v of VARIANTS) {
      const result = JSON.parse(fs.readFileSync(path.join(dir, v, `${cfg.id}.json`), 'utf8')) as DocumentHierarchyResult & { indentClusters: { xMin: number; level: number | null }[]; diagnostics: Record<string, unknown> };
      const counts = {} as Record<'preregistered' | 'posthoc', Counts>;
      let posthocEv: ReturnType<typeof evaluateView> | null = null;
      for (const m of MATCHERS) {
        const ev = evaluateView(result, gtRaw.nodes, offset, true, cfg.summaryMode, m.opts);
        counts[m.name] = summarize(result, gtRaw.nodes, keys, ev);
        if (m.name === 'posthoc') posthocEv = ev;
      }
      const ev = posthocEv as ReturnType<typeof evaluateView>;
      const rootLevels: Record<string, number | null> = {};
      for (const n of gtRaw.nodes) if (n.depth === 1 && keys.has(n.key)) rootLevels[n.key] = ev.match.matched.get(n.key)?.xIndentEvidence.level ?? null;
      const edgeOutcomes: Record<string, string> = {};
      for (const e of ev.edges) if (keys.has(e.childKey)) edgeOutcomes[e.childKey] = e.outcome;
      const matchedIds = new Set([...ev.match.matched.entries()].filter(([k]) => keys.has(k)).map(([, n]) => n.id));
      const gtExcluded = countExcludedGtMatches(result, gtRaw.nodes.filter(n => keys.has(n.key)), offset, cfg.summaryMode, MATCHERS[1].opts);
      cells[cfg.id][v] = {
        counts, gtExcluded, rootLevels, edgeOutcomes, diag: result.diagnostics,
        outsideGtPosthoc: result.nodes.filter(n => !matchedIds.has(n.id) && (n as unknown as { hierarchyEligibility?: string }).hierarchyEligibility !== 'excluded').length,
      };
      const d = result.diagnostics as { excludedCount?: number; unplacedCount: number; edgeStatusCounts: Record<string, number> };
      console.log(`  ${v.padEnd(10)} posthoc: ${line(counts.posthoc)} | outsideGT=${cells[cfg.id][v].outsideGtPosthoc} excluded=${d.excludedCount ?? 0} unplaced=${d.unplacedCount} gtExcluded=${gtExcluded.excluded}`);
      console.log(`  ${''.padEnd(10)} prereg : ${line(counts.preregistered)}`);
    }
  }

  // ---- 事前登録の成功条件の機械判定 ----
  const has = (id: string) => cells[id] !== undefined;
  const c = (id: string, v: Variant, m: 'preregistered' | 'posthoc' = 'posthoc') => cells[id][v].counts[m];
  const depthOk = (x: Counts) => pct(x.depthExact.x, x.depthExact.n) >= 0.9;
  const exactOk = (x: Counts) => pct(x.exact, x.gtEdges) >= 0.9 && pct(x.falseParent, x.gtEdges) <= 0.05;
  const checks: Record<string, boolean | null> = {};
  const regIds = CONFIGS.filter(x => x.group === 'regression' && has(x.id)).map(x => x.id);
  const regressionUnchanged = (v: Variant): boolean => regIds.every(id => (['preregistered', 'posthoc'] as const).every(m => sig(c(id, v, m)) === sig(c(id, 'v1', m))));
  const noGtExcluded = (v: Variant): boolean => Object.values(cells).every(row => row[v].gtExcluded.excluded === 0);
  const noFalseIncrease = (v: Variant): boolean => Object.keys(cells).every(id => c(id, v).falseParent <= c(id, 'v1').falseParent);
  checks['baseline: v2-off-off == v1 (all experiments, both matchers)'] = Object.keys(cells).every(id => (['preregistered', 'posthoc'] as const).every(m => sig(c(id, 'v2-off-off', m)) === sig(c(id, 'v1', m))));
  for (const v of ['v2-A', 'v2-B', 'v2-AB'] as const) {
    checks[`regression unchanged: ${v}`] = regressionUnchanged(v);
    checks[`no GT node excluded: ${v}`] = noGtExcluded(v);
    checks[`no false-parent increase vs v1: ${v}`] = noFalseIncrease(v);
  }
  if (has('meti-detail')) {
    const a = c('meti-detail', 'v2-A');
    checks['A dev: depth>=90% & exact>=90% & false<=5% (meti-detail, v2-A)'] = depthOk(a) && exactOk(a);
    checks['A dev: item 063 and 080 edges exact (level_gap resolved)'] = ['item-060-063', 'item-060-080'].every(k => cells['meti-detail']['v2-A'].edgeOutcomes[k] === 'exact');
    checks['A dev: all GT organizations at level 1 (no extra root level)'] = Object.values(cells['meti-detail']['v2-A'].rootLevels).every(l => l === 1);
    checks['A isolation: v2-B alone does not reach depth 90% on meti-detail'] = !depthOk(c('meti-detail', 'v2-B'));
  }
  const narrow = ['meti-detail-narrow', 'mext-detail-narrow', 'mhlw-detail-narrow'].filter(has);
  if (narrow.length) {
    for (const id of narrow) {
      const b = c(id, 'v2-B');
      const org = CONFIGS.find(x => x.id === id)?.orgKey as string;
      checks[`B dev: ${id} root placed at level 1`] = cells[id]['v2-B'].rootLevels[org] === 1;
      checks[`B dev: ${id} depth>=90%`] = depthOk(b);
      checks[`B dev: ${id} unresolved < v1 and false <= v1`] = b.unresolved < c(id, 'v1').unresolved && b.falseParent <= c(id, 'v1').falseParent;
      checks[`B isolation: v2-A alone does not reach depth 90% on ${id}`] = !depthOk(c(id, 'v2-A'));
    }
  }
  if (has('env-detail')) checks['A holdout: env-detail v2-A depth>=90% & false<=5%'] = depthOk(c('env-detail', 'v2-A')) && pct(c('env-detail', 'v2-A').falseParent, c('env-detail', 'v2-A').gtEdges) <= 0.05;
  if (has('maff-fukko-detail')) {
    const b = c('maff-fukko-detail', 'v2-B');
    checks['B holdout: maff-fukko-detail v2-B depth>=90% & exact>=90%'] = depthOk(b) && pct(b.exact, b.gtEdges) >= 0.9;
  }
  const pick = (re: RegExp) => Object.entries(checks).filter(([k]) => re.test(k));
  const allTrue = (e: [string, boolean | null][]) => e.length > 0 && e.every(([, v]) => v === true);
  const aChecks = [...pick(/^A /), ...pick(/regression unchanged: v2-A/), ...pick(/no GT node excluded: v2-A/), ...pick(/no false-parent increase vs v1: v2-A/), ...pick(/^baseline/)];
  const bChecks = [...pick(/^B /), ...pick(/regression unchanged: v2-B/), ...pick(/no GT node excluded: v2-B/), ...pick(/no false-parent increase vs v1: v2-B/), ...pick(/^baseline/)];
  const abChecks = [...pick(/regression unchanged: v2-AB/), ...pick(/no GT node excluded: v2-AB/), ...pick(/no false-parent increase vs v1: v2-AB/)];
  const stop = (v: Variant) => !checks[`regression unchanged: ${v}`] || !checks[`no GT node excluded: ${v}`] || !checks[`no false-parent increase vs v1: ${v}`] || !checks['baseline: v2-off-off == v1 (all experiments, both matchers)'];
  const hasHoldout = has('env-detail') && has('maff-fukko-detail');
  const judge = (ok: boolean, st: boolean): string => (st ? 'STOP' : ok && hasHoldout ? 'GO' : 'INCONCLUSIVE');
  const abEffects = has('meti-detail') && narrow.length > 0 && hasHoldout
    ? sig(c('meti-detail', 'v2-AB')) === sig(c('meti-detail', 'v2-A')) && narrow.every(id => sig(c(id, 'v2-AB')) === sig(c(id, 'v2-B'))) && sig(c('env-detail', 'v2-AB')) === sig(c('env-detail', 'v2-A')) && sig(c('maff-fukko-detail', 'v2-AB')) === sig(c('maff-fukko-detail', 'v2-B'))
    : false;
  checks['AB: effects equal each single effect (meti-detail=A, narrow=B, env=A, maff=B)'] = abEffects;
  const judgments = {
    A: judge(allTrue(aChecks), stop('v2-A')),
    B: judge(allTrue(bChecks), stop('v2-B')),
    AB: ((): string => {
      const a = judge(allTrue(aChecks), stop('v2-A'));
      const b = judge(allTrue(bChecks), stop('v2-B'));
      if (a === 'STOP' || b === 'STOP' || stop('v2-AB')) return 'STOP';
      return a === 'GO' && b === 'GO' && allTrue(abChecks) && abEffects ? 'GO' : 'INCONCLUSIVE';
    })(),
  };
  console.log('\n=== checks (pre-registered success criteria)');
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  console.log(`\njudgments: ${JSON.stringify(judgments)}${hasHoldout ? '' : '  (holdout not yet run → at most INCONCLUSIVE)'}`);
  let bHoldout: unknown = null;
  if (has('mlit-fukko-detail')) {
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, 'v2-B', 'mlit-fukko-detail.json'), 'utf8')) as { latticeDiagnostics: { finalOutcome: string; steps: { reason: string }[] } };
    const gtRaw = JSON.parse(fs.readFileSync(path.join(FIX, 'mlit-fukko-toc-hierarchy-gt.json'), 'utf8')) as { nodes: GtNode[] };
    const cl = classifyBHoldout({
      singleOrganization: gtRaw.nodes.filter(n => n.depth === 1).length === 1,
      activated: artifact.latticeDiagnostics.finalOutcome === 'activated',
      lastReason: artifact.latticeDiagnostics.steps.length ? artifact.latticeDiagnostics.steps[artifact.latticeDiagnostics.steps.length - 1].reason : null,
      v1: c('mlit-fukko-detail', 'v1'),
      v2b: c('mlit-fukko-detail', 'v2-B'),
      rootLevelV2b: cells['mlit-fukko-detail']['v2-B'].rootLevels['org-010'] ?? null,
      regressionUnchanged: regIds.length > 0 ? regressionUnchanged('v2-B') : true,
    });
    bHoldout = { ...cl, regressionChecked: regIds.length > 0, latticeDiagnostics: artifact.latticeDiagnostics };
    console.log(`\nB holdout (mlit-fukko-detail): ${cl.classification} → ${cl.label}\n  ${cl.reasons.join('; ')}${regIds.length > 0 ? '' : '  (regression group not evaluated in this run)'}`);
  }
  const file = path.join(dir, `evaluation-${tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ tag, bHoldout, primaryMatcher: 'posthoc (nameOnly+ordinalTiebreak, defined in #364, applied identically to all variants)', cells, checks, judgments }, null, 2)}\n`);
  console.log(`→ ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
