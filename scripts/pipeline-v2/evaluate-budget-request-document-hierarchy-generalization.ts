/**
 * DocumentHierarchy v1（frozen）の他省庁 generalization 実験 — 段階B（評価）。
 * 段階Aのartifact（generalization-v1/{id}.json）と、評価専用GT（{meti,mext}-toc-hierarchy-gt.json）を突き合わせる。GTを読むのはこのCLIだけ。
 * 判定基準・照合モードは実験計画で事前に固定済み（結果を見て変えない）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-document-hierarchy-generalization.ts [year] [--tag=v1]
 * 出力: data/work/budget-request-document-hierarchy/{year}/generalization-v1/evaluation-{tag}.json と標準出力の要約。
 */
import * as fs from 'fs';
import * as path from 'path';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import type { DocumentHierarchyResult } from './lib/budget-request-document-hierarchy';
import { evaluateView, summarize, verdictOf, type Counts, type GtNode, type MatchOptions, type SummaryMatchMode, type Verdict } from './lib/budget-request-document-hierarchy-eval';

const FIX = path.join('tests', 'fixtures', 'budget-request-document-hierarchy', '2024');
type Scope = (n: GtNode, rootOf: (k: string) => string) => boolean;

interface Config {
  id: string;
  ministry: 'METI' | 'MEXT';
  view: 'summary' | 'detail';
  gtFile: string;
  scope: Scope;
  /** 判定に使う（narrowは感度診断なので判定に入れない） */
  inVerdict: boolean;
}
const all: Scope = () => true;
const inRange: Scope = n => n.inDetailRange !== false;
const subtree = (orgKey: string): Scope => (n, rootOf) => rootOf(n.key) === orgKey;
const CONFIGS: Config[] = [
  { id: 'meti-summary', ministry: 'METI', view: 'summary', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, inVerdict: true },
  { id: 'meti-detail', ministry: 'METI', view: 'detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, inVerdict: true },
  { id: 'mext-summary', ministry: 'MEXT', view: 'summary', gtFile: 'mext-toc-hierarchy-gt.json', scope: all, inVerdict: true },
  { id: 'mext-detail', ministry: 'MEXT', view: 'detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: inRange, inVerdict: true },
  { id: 'meti-detail-narrow', ministry: 'METI', view: 'detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: subtree('org-035'), inVerdict: false },
  { id: 'mext-detail-narrow', ministry: 'MEXT', view: 'detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: subtree('org-030'), inVerdict: false },
];

const pct = (x: number, n: number): string => (n ? `${Math.round((x / n) * 1000) / 10}%` : '-');
const fmt = (c: Counts): string =>
  `exact ${c.exact}/${c.gtEdges} (${pct(c.exact, c.gtEdges)}) false ${c.falseParent}/${c.gtEdges} unresolved ${c.unresolved}/${c.gtEdges} notFound ${c.childNotFound}/${c.gtEdges} | ancestor ${c.ancestorExact.x}/${c.ancestorExact.n} | depth ${c.depthExact.x}/${c.depthExact.n} | matched ${c.nodesMatched.x}/${c.nodesMatched.n} | P=${c.precision ?? '-'} R=${c.recall ?? '-'} F1=${c.f1 ?? '-'}`;

function crossPage(r: DocumentHierarchyResult) {
  const resolved = r.edges.filter(e => e.status === 'resolved_by_indent_sequence');
  const get = (e: (typeof r.edges)[number], kind: string, key: string): number | boolean | string | null | undefined => e.evidence.find(x => x.kind === kind)?.detail[key];
  const cross = resolved.filter(e => get(e, 'page_transition', 'parentOnSamePage') === false);
  return {
    resolvedEdges: resolved.length,
    crossPageParentEdges: cross.length,
    maxLogicalRowsBetween: Math.max(0, ...resolved.map(e => Number(get(e, 'document_order', 'logicalRowsBetween') ?? 0))),
    maxPagesBetween: Math.max(0, ...resolved.map(e => Number(get(e, 'page_transition', 'pagesBetween') ?? 0))),
  };
}

/** GT外candidateの記述的な分類（x帯 / ページ上下端）。判定には使わない。 */
function classifyOutside(r: DocumentHierarchyResult & { nodeGeometry?: { id: string; yMin: number; yMax: number; pageWidth: number; pageHeight: number }[] }, ids: Set<string>) {
  const geo = new Map((r.nodeGeometry ?? []).map(g => [g.id, g]));
  const byClass: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  for (const n of r.nodes) {
    if (!ids.has(n.id)) continue;
    const g = geo.get(n.id);
    const lv = String(n.xIndentEvidence.level);
    byLevel[lv] = (byLevel[lv] ?? 0) + 1;
    let cls = 'unclassified';
    if (g) {
      const rx = n.xIndentEvidence.keyTokenXMin / g.pageWidth;
      if (g.yMin / g.pageHeight < 0.08 || g.yMax / g.pageHeight > 0.94) cls = 'page_header_footer_band';
      else if (rx < 0.4) cls = 'left_body';
      else if (rx < 0.6) cls = 'middle';
      else cls = 'right_remarks_or_calc';
    }
    byClass[cls] = (byClass[cls] ?? 0) + 1;
  }
  return { count: ids.size, byLevel, byClass };
}

/** preregistered=実験計画で事前に固定した照合（判定に使う）。posthoc=結果を見た後に追加した評価側の診断（判定には使わない。v1の推論は変更していない） */
const VARIANTS: { name: 'preregistered' | 'posthoc'; opts: MatchOptions }[] = [
  { name: 'preregistered', opts: {} },
  { name: 'posthoc', opts: { nameOnly: true, ordinalTiebreak: true } },
];

async function main() {
  const args = process.argv.slice(2);
  const tag = args.find(a => a.startsWith('--tag='))?.slice(6) ?? 'v1';
  const year = Number(args.filter(a => !a.startsWith('--'))[0] ?? 2024);
  const dir = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'generalization-v1');
  const out: Record<string, unknown> = {
    tag,
    verdictCriteria: 'frozen in the experiment plan: SUCCESS exact>=90% & false<=5% & depth>=90%; PARTIAL exact>=50% & false<=10%; FAIL otherwise; BLOCKED if matched<50%. Official verdicts use the preregistered matcher; posthoc is a diagnostic added after seeing results.',
    experiments: {},
    verdicts: {},
  };
  const verdicts: Record<string, Record<string, Verdict>> = { preregistered: {}, posthoc: {} };
  for (const cfg of CONFIGS) {
    const gtFile = JSON.parse(fs.readFileSync(path.join(FIX, cfg.gtFile), 'utf8')) as { detailPrintedToPhysicalPageOffset: number; nodes: GtNode[] };
    const result = JSON.parse(fs.readFileSync(path.join(dir, `${cfg.id}.json`), 'utf8')) as DocumentHierarchyResult;
    const byKey = new Map(gtFile.nodes.map(n => [n.key, n]));
    const rootOf = (k: string): string => {
      let cur = byKey.get(k) as GtNode;
      while (cur.parent) cur = byKey.get(cur.parent) as GtNode;
      return cur.key;
    };
    const scoped = gtFile.nodes.filter(n => cfg.scope(n, rootOf));
    const keys = new Set(scoped.map(n => n.key));
    const modes: SummaryMatchMode[] = cfg.view === 'summary' ? ['codeName', 'pageRef'] : ['pageRef'];
    const perVariant: Record<string, Record<string, unknown>> = {};
    for (const variant of VARIANTS) {
      const perMode: Record<string, unknown> = {};
      for (const mode of modes) {
        const ev = evaluateView(result, gtFile.nodes, gtFile.detailPrintedToPhysicalPageOffset, true, mode, variant.opts);
        const c = summarize(result, gtFile.nodes, keys, ev);
        const matchedIds = new Set([...ev.match.matched.entries()].filter(([k]) => keys.has(k)).map(([, n]) => n.id));
        const outsideIds = new Set(result.nodes.filter(n => !matchedIds.has(n.id)).map(n => n.id));
        const orgs = scoped.filter(n => n.depth === 1).map(n => n.key);
        const perOrg: Record<string, Counts> = {};
        for (const o of orgs) perOrg[o] = summarize(result, gtFile.nodes, new Set(scoped.filter(n => rootOf(n.key) === o).map(n => n.key)), ev);
        const failures = ev.edges.filter(e => keys.has(e.childKey) && e.outcome !== 'exact').slice(0, 40);
        perMode[mode] = { counts: c, verdict: verdictOf(c), perOrg, outsideGt: classifyOutside(result as never, outsideIds), failureExamples: failures };
        console.log(`[${cfg.id}] ${variant.name}/${mode} -> ${verdictOf(c)}\n  ${fmt(c)} | outside-GT=${outsideIds.size}`);
        if (mode === modes[0] && cfg.inVerdict) verdicts[variant.name][cfg.id] = verdictOf(c);
      }
      perVariant[variant.name] = perMode;
    }
    const diag = { ...result.diagnostics, indentClusters: result.indentClusters, ...crossPage(result) };
    console.log(`  diagnostics: logicalRows=${diag.logicalRowCount} headings=${diag.headingCandidateCount} placed=${diag.placedCount} unplaced=${diag.unplacedCount} levels=${JSON.stringify(diag.nodeCountByLevel)} edges=${JSON.stringify(diag.edgeStatusCounts)} crossPage=${diag.crossPageParentEdges} maxRowsBetween=${diag.maxLogicalRowsBetween} maxPagesBetween=${diag.maxPagesBetween}\n`);
    (out.experiments as Record<string, unknown>)[cfg.id] = { ministry: cfg.ministry, view: cfg.view, gtNodesInScope: scoped.length, primaryMode: modes[0], variants: perVariant, diagnostics: diag };
  }
  const overallOf = (vs: Verdict[]): string => (vs.includes('EVALUATION BLOCKED') ? 'EVALUATION BLOCKED' : vs.every(v => v === 'SUCCESS') ? 'GENERALIZES' : vs.includes('SUCCESS') ? 'PARTIAL' : 'FAILS');
  out.verdicts = { preregistered: verdicts.preregistered, posthoc: verdicts.posthoc };
  out.overall = { preregistered: overallOf(Object.values(verdicts.preregistered)), posthoc: overallOf(Object.values(verdicts.posthoc)) };
  console.log(`verdicts: ${JSON.stringify(out.verdicts)}\noverall: ${JSON.stringify(out.overall)}`);
  const file = path.join(dir, `evaluation-${tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`→ ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
