/**
 * 概算要求PDF（MHLW）の文書階層PoC — 段階B（評価）。段階Aのartifactと、評価専用GT（拡張GT・research GT）を突き合わせる。
 * GTを読むのはこのCLIだけ。推論（extract-budget-request-document-hierarchy.ts）はGTを参照しない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-document-hierarchy.ts [year] [--research-gt=<path>] [--tag=v1] [--no-name-tiebreak]
 * 出力: data/work/budget-request-document-hierarchy/{year}/evaluation-{tag}.json と標準出力の要約。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import type { DocumentHierarchyResult } from './lib/budget-request-document-hierarchy';
import { evaluateView, summarize, type Counts, type GtNode } from './lib/budget-request-document-hierarchy-eval';

const GT_PATH = path.join('tests', 'fixtures', 'budget-request-document-hierarchy', '2024', 'mhlw-toc-hierarchy-gt-extended.json');
const DEFAULT_RESEARCH_GT = path.join('..', 'marumie-rssystem-research', 'fixtures', 'document-understanding', 'engine-selection', 'mhlw-hierarchy-ground-truth.json');

const fmt = (c: Counts): string =>
  `edges exact ${c.exact}/${c.gtEdges} (${c.gtEdges ? Math.round((c.exact / c.gtEdges) * 1000) / 10 : '-'}%) false ${c.falseParent}/${c.gtEdges} unresolved ${c.unresolved}/${c.gtEdges} notFound ${c.childNotFound}/${c.gtEdges} | P=${c.precision ?? '-'} R=${c.recall ?? '-'} F1=${c.f1 ?? '-'} | ancestorExact ${c.ancestorExact.x}/${c.ancestorExact.n} | depthExact ${c.depthExact.x}/${c.depthExact.n} (matched ${c.depthExact.matched}) | nodesMatched ${c.nodesMatched.x}/${c.nodesMatched.n}`;

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positional = args.filter(a => !a.startsWith('--'));
  const year = positional[0] ? Number(positional[0]) : 2024;
  const tag = opt('tag') ?? 'v1';
  const researchPath = opt('research-gt') ?? DEFAULT_RESEARCH_GT;
  const nameTiebreak = !args.includes('--no-name-tiebreak');

  const gtFile = JSON.parse(fs.readFileSync(GT_PATH, 'utf8')) as { source: { printedToPhysicalPageOffset: number }; nodes: GtNode[] };
  const offset = gtFile.source.printedToPhysicalPageOffset;
  const gt = gtFile.nodes;

  // research GT（canonical）との整合: 全nodeが拡張GTのinResearchGTに1対1で対応すること
  let researchCheck: { path: string; sha256: string; nodes: number; unmatched: string[] } | { path: string; missing: true };
  if (fs.existsSync(researchPath)) {
    const raw = fs.readFileSync(researchPath);
    const r = JSON.parse(raw.toString('utf8')) as { nodes: { code: string; name: string; requestNo?: string; startsPrintedPage: string }[] };
    const unmatched = r.nodes
      .filter(n => gt.filter(g => g.inResearchGT && g.code === n.code.replace(/[‐-―−]/g, '-') && g.name === n.name && String(g.printedStartPage) === n.startsPrintedPage && g.requestNo === n.requestNo).length !== 1)
      .map(n => `${n.code} ${n.name}`);
    if (unmatched.length > 0 || gt.filter(g => g.inResearchGT).length !== r.nodes.length) throw new Error(`research GTと拡張GTが整合しません: ${unmatched.join(', ')}`);
    researchCheck = { path: researchPath, sha256: crypto.createHash('sha256').update(raw).digest('hex'), nodes: r.nodes.length, unmatched };
  } else researchCheck = { path: researchPath, missing: true };

  const outDir = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year));
  const out: Record<string, unknown> = { tag, nameTiebreak, evaluatedAgainst: { extendedGt: GT_PATH, researchGt: researchCheck }, views: {} };
  for (const view of ['summary', 'detail'] as const) {
    const result = JSON.parse(fs.readFileSync(path.join(outDir, `${view}.json`), 'utf8')) as DocumentHierarchyResult;
    const ev = evaluateView(result, gt, offset, nameTiebreak);
    const sets = {
      development: new Set(gt.filter(g => g.set === 'development').map(g => g.key)),
      holdout: new Set(gt.filter(g => g.set === 'holdout').map(g => g.key)),
    };
    const researchKeys = new Set(gt.filter(g => g.inResearchGT).map(g => g.key));
    const counts: Record<string, Counts> = {};
    for (const [name, keys] of Object.entries(sets)) {
      counts[`${name}/extended`] = summarize(result, gt, keys, ev);
      counts[`${name}/researchSubset`] = summarize(result, gt, new Set([...keys].filter(k => researchKeys.has(k))), ev);
    }
    const matchedIds = new Set([...ev.match.matched.values()].map(n => n.id));
    const outside = result.nodes.filter(n => !matchedIds.has(n.id));
    (out.views as Record<string, unknown>)[view] = {
      pages: result.pages,
      counts,
      edges: ev.edges,
      outsideGtNodes: { count: outside.length, byLevel: outside.reduce<Record<string, number>>((a, n) => ((a[String(n.xIndentEvidence.level)] = (a[String(n.xIndentEvidence.level)] ?? 0) + 1), a), {}) },
    };
    console.log(`\n== ${view} (pages ${result.pages[0]}-${result.pages[result.pages.length - 1]}) inferred nodes=${result.nodes.length}, outside-GT nodes=${outside.length}`);
    for (const [k, c] of Object.entries(counts)) console.log(`  ${k.padEnd(26)} ${fmt(c)}`);
    for (const e of ev.edges.filter(e => e.outcome !== 'exact')) console.log(`    ${e.outcome}: ${e.childKey} (gt parent ${e.gtParentKey}) → predicted ${e.predictedParentGtKey ?? e.predictedParentNodeId ?? '-'} status=${e.status ?? '-'}${e.note ? ` [${e.note}]` : ''}`);
  }
  const file = path.join(outDir, `evaluation-${tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\n→ ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
