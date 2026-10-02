/**
 * DocumentHierarchy A2 最終実験 — 段階B（評価）。GTを読むのはこのCLIだけ。判定は実験計画（A2実験計画）で事前登録した基準を機械的に適用する。
 * 同じ照合を全variantに適用（主=posthoc、事前固定も併記）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-document-hierarchy-a2.ts [year] [--tag=development] [--stage=development]
 * 出力: data/work/budget-request-document-hierarchy/{year}/a2-final/evaluation-{tag}.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import type { DocumentHierarchyResult } from './lib/budget-request-document-hierarchy';
import { countExcludedGtMatches, evaluateView, summarize, type Counts, type GtNode, type MatchOptions, type SummaryMatchMode } from './lib/budget-request-document-hierarchy-eval';
import { A2_EXPERIMENTS } from './lib/budget-request-document-hierarchy-a2-experiments';

const FIX = path.join('tests', 'fixtures', 'budget-request-document-hierarchy', '2024');
type Scope = (n: GtNode, rootOf: (k: string) => string) => boolean;
const all: Scope = () => true;
const inRange: Scope = n => n.inDetailRange !== false;
const subtree = (orgKey: string): Scope => (n, rootOf) => rootOf(n.key) === orgKey;

interface Config {
  id: string;
  gtFile: string;
  scope: Scope;
  summaryMode: SummaryMatchMode;
}
export const A2_EVAL_CONFIGS: Config[] = [
  { id: 'meti-detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'env-detail', gtFile: 'env-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'maff-fukko-detail', gtFile: 'maff-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mlit-fukko-detail', gtFile: 'mlit-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mhlw-summary', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mhlw-detail', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'meti-summary', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-summary', gtFile: 'mext-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: inRange, summaryMode: 'pageRef' },
  { id: 'meti-detail-pre-header', gtFile: 'meti-toc-hierarchy-gt.json', scope: n => n.printedStartPage + 4 <= 103, summaryMode: 'pageRef' },
  { id: 'meti-detail-narrow', gtFile: 'meti-toc-hierarchy-gt.json', scope: subtree('org-035'), summaryMode: 'pageRef' },
  { id: 'mext-detail-narrow', gtFile: 'mext-toc-hierarchy-gt.json', scope: subtree('org-030'), summaryMode: 'pageRef' },
  { id: 'mhlw-detail-narrow', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: subtree('org-070'), summaryMode: 'pageRef' },
];
const MATCHERS: { name: 'preregistered' | 'posthoc'; opts: MatchOptions }[] = [
  { name: 'preregistered', opts: {} },
  { name: 'posthoc', opts: { nameOnly: true, ordinalTiebreak: true } },
];
export const sigOf = (c: Counts): string => JSON.stringify([c.gtEdges, c.exact, c.falseParent, c.unresolved, c.childNotFound, c.ancestorExact, c.depthExact, c.nodesMatched]);
const line = (c: Counts): string => `exact ${c.exact}/${c.gtEdges} false ${c.falseParent}/${c.gtEdges} unres ${c.unresolved}/${c.gtEdges} notFound ${c.childNotFound}/${c.gtEdges} anc ${c.ancestorExact.x}/${c.ancestorExact.n} depth ${c.depthExact.x}/${c.depthExact.n} matched ${c.nodesMatched.x}/${c.nodesMatched.n}`;

type Cell = { counts: Record<'preregistered' | 'posthoc', Counts>; excludedNodeIds: string[]; gtExcluded: { excluded: number; keys: string[] }; excludedCount: number; unplaced: number };

async function main() {
  const args = process.argv.slice(2);
  const tag = args.find(a => a.startsWith('--tag='))?.slice(6) ?? 'development';
  const year = Number(args.filter(a => !a.startsWith('--'))[0] ?? 2024);
  const dir = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'a2-final');
  const variants = ['v1', 'v2-A', 'v2-A2', 'v2-B', 'v2-B-obs'] as const;
  const cells: Record<string, Record<string, Cell>> = {};
  for (const cfg of A2_EVAL_CONFIGS) {
    const exp = A2_EXPERIMENTS.find(e => e.id === cfg.id);
    if (!exp) continue;
    const gtRaw = JSON.parse(fs.readFileSync(path.join(FIX, cfg.gtFile), 'utf8')) as { detailPrintedToPhysicalPageOffset?: number; source?: { printedToPhysicalPageOffset?: number }; nodes: GtNode[] };
    const offset = gtRaw.detailPrintedToPhysicalPageOffset ?? gtRaw.source?.printedToPhysicalPageOffset ?? 0;
    const byKey = new Map(gtRaw.nodes.map(n => [n.key, n]));
    const rootOf = (k: string): string => {
      let cur = byKey.get(k) as GtNode;
      while (cur.parent) cur = byKey.get(cur.parent) as GtNode;
      return cur.key;
    };
    const keys = new Set(gtRaw.nodes.filter(n => cfg.scope(n, rootOf)).map(n => n.key));
    cells[cfg.id] = {};
    console.log(`\n=== ${cfg.id} (${exp.set}, GT nodes in scope ${keys.size})`);
    for (const v of variants) {
      const result = JSON.parse(fs.readFileSync(path.join(dir, v, `${cfg.id}.json`), 'utf8')) as DocumentHierarchyResult & { headerCollisionObservation?: { excludedNodeIds: string[] }; diagnostics: { excludedCount?: number; unplacedCount: number } };
      const counts = {} as Record<'preregistered' | 'posthoc', Counts>;
      for (const m of MATCHERS) counts[m.name] = summarize(result, gtRaw.nodes, keys, evaluateView(result, gtRaw.nodes, offset, true, cfg.summaryMode, m.opts));
      const gtExcluded = countExcludedGtMatches(result, gtRaw.nodes.filter(n => keys.has(n.key)), offset, cfg.summaryMode, MATCHERS[1].opts);
      cells[cfg.id][v] = { counts, excludedNodeIds: result.headerCollisionObservation?.excludedNodeIds ?? [], gtExcluded, excludedCount: result.diagnostics.excludedCount ?? 0, unplaced: result.diagnostics.unplacedCount };
      console.log(`  ${v.padEnd(9)} posthoc: ${line(counts.posthoc)} | excluded=${cells[cfg.id][v].excludedCount} gtExcluded=${gtExcluded.excluded}`);
    }
  }

  // ---- 事前登録した development / negative / regression 基準 ----
  const sameSig = (id: string, a: string, b: string): boolean => (['preregistered', 'posthoc'] as const).every(m => sigOf(cells[id][a].counts[m]) === sigOf(cells[id][b].counts[m]));
  const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every(x => b.includes(x));
  const checks: Record<string, boolean> = {};
  const ids = Object.keys(cells);
  for (const id of ['meti-detail', 'env-detail'].filter(i => cells[i])) {
    checks[`positive ${id}: A2 excluded rows == v2-A excluded rows (preregistered prediction P1)`] = sameSet(cells[id]['v2-A2'].excludedNodeIds, cells[id]['v2-A'].excludedNodeIds) && cells[id]['v2-A2'].excludedNodeIds.length > 0;
    checks[`positive ${id}: metrics == v2-A`] = sameSig(id, 'v2-A2', 'v2-A');
  }
  for (const id of ['maff-fukko-detail', 'mlit-fukko-detail'].filter(i => cells[i])) {
    checks[`negative ${id}: no erroneous exclusion (excluded = 0)`] = cells[id]['v2-A2'].excludedCount === 0;
    checks[`negative ${id}: metrics == v1 (P2)`] = sameSig(id, 'v2-A2', 'v1');
  }
  for (const id of ids.filter(i => A2_EXPERIMENTS.find(e => e.id === i)?.set === 'regression')) checks[`regression ${id}: A2 == v1 (P3)`] = sameSig(id, 'v2-A2', 'v1');
  checks['no GT hierarchy node excluded by A2 (all experiments)'] = ids.every(id => cells[id]['v2-A2'].gtExcluded.excluded === 0);
  checks['no false-parent increase vs v1 (A2, all experiments)'] = ids.every(id => cells[id]['v2-A2'].counts.posthoc.falseParent <= cells[id].v1.counts.posthoc.falseParent && cells[id]['v2-A2'].counts.preregistered.falseParent <= cells[id].v1.counts.preregistered.falseParent);
  checks['B-only metrics frozen: v2-B-obs == v2-B (observe-only does not change decisions)'] = ids.every(id => sameSig(id, 'v2-B-obs', 'v2-B'));
  const developmentJudgment = Object.values(checks).every(Boolean) ? 'GO' : 'STOP';
  console.log('\n=== development checks (pre-registered)');
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  console.log(`\ndevelopment checkpoint: ${developmentJudgment}`);
  const file = path.join(dir, `evaluation-${tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ tag, primaryMatcher: 'posthoc (defined in #364; same matcher for all variants)', cells, checks, developmentJudgment }, null, 2)}\n`);
  console.log(`→ ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
