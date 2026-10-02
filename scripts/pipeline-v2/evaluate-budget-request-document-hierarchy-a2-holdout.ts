/**
 * DocumentHierarchy A2 最終実験 — holdout の評価と（A2 = GO のときだけ）B+A2 の統合確認。GTを読むのはこのCLIだけ。
 * 分類・判定は lib/budget-request-document-hierarchy-a2-eval-config.ts に、実行前にコード化したものを機械的に適用する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-document-hierarchy-a2-holdout.ts [year] [--tag=holdout] [--integration]
 * 出力: data/work/budget-request-document-hierarchy/{year}/a2-final/evaluation-{tag}.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import type { DocumentHierarchyResult } from './lib/budget-request-document-hierarchy';
import { countExcludedGtMatches, evaluateView, summarize, type Counts, type GtNode } from './lib/budget-request-document-hierarchy-eval';
import { A2_EVAL_CONFIGS, A2_MATCHERS, a2Judgment, classifyHoldout, integrationOk, type HoldoutClass } from './lib/budget-request-document-hierarchy-a2-eval-config';
import { A2_EXPERIMENTS } from './lib/budget-request-document-hierarchy-a2-experiments';

const FIX = path.join('tests', 'fixtures', 'budget-request-document-hierarchy', '2024');
const line = (c: Counts): string => `exact ${c.exact}/${c.gtEdges} false ${c.falseParent}/${c.gtEdges} unres ${c.unresolved}/${c.gtEdges} notFound ${c.childNotFound}/${c.gtEdges} anc ${c.ancestorExact.x}/${c.ancestorExact.n} depth ${c.depthExact.x}/${c.depthExact.n} matched ${c.nodesMatched.x}/${c.nodesMatched.n}`;

interface Row {
  counts: Record<'preregistered' | 'posthoc', Counts>;
  excludedCount: number;
  gtExcluded: { excluded: number; keys: string[] };
  allExcludedHaveThreeEvidence: boolean;
  excludedNodeIds: string[];
  headerEvidenceNodes: number;
  unplaced: number;
  levelGap: number;
  provenanceOk: boolean;
}

function cellFor(dir: string, variant: string, id: string, gt: { detailPrintedToPhysicalPageOffset?: number; nodes: GtNode[] }, keys: Set<string>, summaryMode: 'pageRef' | 'codeName'): Row {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, variant, `${id}.json`), 'utf8')) as {
    nodes: { id: string; hierarchyEligibility?: string; exclusionEvidence?: { kind: string }[]; sourcePage: number; sourceRowRefs?: unknown; sourceTokenRefs?: unknown; hierarchyResolutionContext?: unknown }[];
    headerCollisionObservation?: { excludedNodeIds: string[]; nodesWithHeaderEvidence: string[] };
    diagnostics: { excludedCount?: number; unplacedCount: number; edgeStatusCounts: Record<string, number> };
  };
  const result = raw as unknown as DocumentHierarchyResult;
  const offset = gt.detailPrintedToPhysicalPageOffset ?? 0;
  const counts = {} as Record<'preregistered' | 'posthoc', Counts>;
  for (const m of A2_MATCHERS) counts[m.name] = summarize(result, gt.nodes, keys, evaluateView(result, gt.nodes, offset, true, summaryMode, m.opts));
  const excluded = raw.nodes.filter(n => n.hierarchyEligibility === 'excluded');
  return {
    counts,
    excludedCount: excluded.length,
    gtExcluded: countExcludedGtMatches(result, gt.nodes.filter(n => keys.has(n.key)), offset, summaryMode, A2_MATCHERS[1].opts),
    allExcludedHaveThreeEvidence: excluded.every(n => new Set((n.exclusionEvidence ?? []).map(e => e.kind)).size === 3),
    excludedNodeIds: raw.headerCollisionObservation?.excludedNodeIds ?? [],
    headerEvidenceNodes: raw.headerCollisionObservation?.nodesWithHeaderEvidence.length ?? 0,
    unplaced: raw.diagnostics.unplacedCount,
    levelGap: raw.diagnostics.edgeStatusCounts.level_gap ?? 0,
    // provenance: 除外した行も node として残り、参照を保持している
    provenanceOk: excluded.every(n => n.sourceRowRefs !== undefined && n.sourceTokenRefs !== undefined && n.hierarchyResolutionContext !== undefined),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const tag = args.find(a => a.startsWith('--tag='))?.slice(6) ?? 'holdout';
  const integration = args.includes('--integration');
  const year = Number(args.filter(a => !a.startsWith('--'))[0] ?? 2024);
  const dir = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'a2-final');
  const out: Record<string, unknown> = { tag, primaryMatcher: 'posthoc (defined in #364; same matcher for all variants)' };

  // ---- A2 holdout ----
  const holdoutIds = A2_EXPERIMENTS.filter(e => e.set === 'a2-holdout').map(e => e.id);
  const classes: HoldoutClass[] = [];
  const holdout: Record<string, unknown> = {};
  for (const id of holdoutIds) {
    const cfg = A2_EVAL_CONFIGS.find(c => c.id === id) as (typeof A2_EVAL_CONFIGS)[number];
    const gt = JSON.parse(fs.readFileSync(path.join(FIX, cfg.gtFile), 'utf8')) as { detailPrintedToPhysicalPageOffset?: number; nodes: GtNode[] };
    const keys = new Set(gt.nodes.map(n => n.key));
    const v1 = cellFor(dir, 'v1', id, gt, keys, cfg.summaryMode);
    const a2 = cellFor(dir, 'v2-A2', id, gt, keys, cfg.summaryMode);
    const cl = classifyHoldout({ v1: v1.counts.posthoc, a2: a2.counts.posthoc, gtExcluded: a2.gtExcluded.excluded, allExcludedHaveThreeEvidence: a2.allExcludedHaveThreeEvidence });
    classes.push(cl.cls);
    holdout[id] = { v1, a2, classification: cl, headerCollisionActuallyPresent: v1.headerEvidenceNodes > 0 || a2.excludedCount > 0, a2Activated: a2.excludedCount > 0 };
    console.log(`\n=== ${id} (GT nodes ${gt.nodes.length})`);
    console.log(`  v1  posthoc: ${line(v1.counts.posthoc)} | level_gap=${v1.levelGap} unplaced=${v1.unplaced}`);
    console.log(`  A2  posthoc: ${line(a2.counts.posthoc)} | excluded=${a2.excludedCount} gtExcluded=${a2.gtExcluded.excluded} level_gap=${a2.levelGap} unplaced=${a2.unplaced} provenanceOk=${a2.provenanceOk}`);
    console.log(`  v1  prereg : ${line(v1.counts.preregistered)}`);
    console.log(`  A2  prereg : ${line(a2.counts.preregistered)}`);
    console.log(`  → ${cl.cls} (informative=${cl.informative}): ${cl.reasons.join('; ')}`);
  }
  const dev = JSON.parse(fs.readFileSync(path.join(dir, 'evaluation-development.json'), 'utf8')) as { developmentJudgment: string };
  const judgment = a2Judgment({ developmentPassed: dev.developmentJudgment === 'GO', holdouts: classes });
  out.holdout = holdout;
  out.a2Judgment = judgment;
  console.log(`\nA2 judgment: ${judgment}  (development=${dev.developmentJudgment}; holdouts=${classes.join(', ')})`);

  // ---- B+A2 統合確認（A2 = GO のときだけ） ----
  if (integration) {
    if (judgment !== 'GO') throw new Error(`統合確認は A2 = GO のときだけ実行する（現在: ${judgment}）`);
    const set = new Set(['b-development', 'a2-development', 'a2-holdout', 'regression']);
    const rows: Record<string, unknown> = {};
    let allOk = true;
    for (const e of A2_EXPERIMENTS.filter(x => set.has(x.set))) {
      const cfg = A2_EVAL_CONFIGS.find(c => c.id === e.id) as (typeof A2_EVAL_CONFIGS)[number];
      const gt = JSON.parse(fs.readFileSync(path.join(FIX, cfg.gtFile), 'utf8')) as { detailPrintedToPhysicalPageOffset?: number; source?: { printedToPhysicalPageOffset?: number }; nodes: GtNode[] };
      const gtN = { ...gt, detailPrintedToPhysicalPageOffset: gt.detailPrintedToPhysicalPageOffset ?? gt.source?.printedToPhysicalPageOffset ?? 0 };
      const byKey = new Map(gt.nodes.map(n => [n.key, n]));
      const rootOf = (k: string): string => {
        let cur = byKey.get(k) as GtNode;
        while (cur.parent) cur = byKey.get(cur.parent) as GtNode;
        return cur.key;
      };
      const keys = new Set(gt.nodes.filter(n => cfg.scope(n, rootOf)).map(n => n.key));
      const v1 = cellFor(dir, 'v1', e.id, gtN, keys, cfg.summaryMode);
      const b = cellFor(dir, 'v2-B', e.id, gtN, keys, cfg.summaryMode);
      const a2 = cellFor(dir, 'v2-A2', e.id, gtN, keys, cfg.summaryMode);
      const ba2 = cellFor(dir, 'v2-B-A2', e.id, gtN, keys, cfg.summaryMode);
      const ok = (['preregistered', 'posthoc'] as const).map(m => integrationOk({ v1: v1.counts[m], b: b.counts[m], a2: a2.counts[m], ba2: ba2.counts[m], gtExcluded: ba2.gtExcluded.excluded }));
      const pass = ok.every(x => x.ok) && ba2.provenanceOk;
      allOk &&= pass;
      rows[e.id] = { set: e.set, v1: v1.counts.posthoc, b: b.counts.posthoc, a2: a2.counts.posthoc, ba2: ba2.counts.posthoc, excludedBA2: ba2.excludedCount, gtExcluded: ba2.gtExcluded.excluded, provenanceOk: ba2.provenanceOk, pass, reasons: ok.flatMap(x => x.reasons) };
      console.log(`  integration ${e.id.padEnd(24)} ${pass ? 'PASS' : 'FAIL'}  B+A2: ${line(ba2.counts.posthoc)} | excl=${ba2.excludedCount}${pass ? '' : '  ' + ok.flatMap(x => x.reasons).join('; ')}`);
    }
    out.integration = { rows, passed: allOk };
    console.log(`\nB+A2 integration: ${allOk ? 'PASS' : 'STOP'}`);
  }
  const file = path.join(dir, `evaluation-${tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`→ ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
