/**
 * DocumentHierarchy A2 最終実験 — 段階A（推論）の薄いランナー。GTを読まない。
 * 事前登録した A2（headerCollisionHandling='page-edge-domain'）を、v1 / v2-A（STOP・比較用）/ v2-B（凍結）/ A2 / B+A2 / B+観測のみ と並べて実行する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-request-document-hierarchy-a2.ts [year] [--only=<id>[,<id>]] [--variants=<name>[,<name>]] [--set=development|holdout]
 * 出力: data/work/budget-request-document-hierarchy/{year}/a2-final/{variant}/{id}.json
 * holdout の範囲は、規則固定と holdout GT のコミットの後でだけ定義・実行する（実験計画）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets, type ExtractionTarget } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type HierarchyPageInput } from './lib/budget-request-document-hierarchy';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { A2_EXPERIMENTS, A2_VARIANTS, type A2Experiment } from './lib/budget-request-document-hierarchy-a2-experiments';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

async function run(year: number, target: ExtractionTarget, e: A2Experiment, variants: string[]): Promise<void> {
  const state = inspectTarget(target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
  const pages: HierarchyPageInput[] = [];
  for (let n = e.pages[0]; n <= e.pages[1]; n++) {
    const ex = await extractPageTokens(target.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  const pdfjs = await pdfjsVersion();
  const lines: string[] = [];
  for (const v of A2_VARIANTS) {
    if (!variants.includes(v.name)) continue;
    const result = v.options ? observeDocumentHierarchyV2(e.view, pages, v.options) : observeDocumentHierarchy(e.view, pages, DEFAULT_HIERARCHY_OPTIONS);
    const out = {
      ...result,
      experimentId: e.id,
      variant: v.name,
      fiscalYear: year,
      source: { canonicalUrl: target.canonicalUrl, publisherDomain: target.publisherDomain, localPath: target.localPath },
      pdfjsVersion: pdfjs,
      pageRange: { from: e.pages[0], to: e.pages[1] },
      note: 'DocumentHierarchy A2 final-experiment PoC artifact (experimental). Not a final schema.',
    };
    const file = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'a2-final', v.name, `${e.id}.json`);
    nodeBudgetRequestFs.mkdirp(path.dirname(file));
    nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
    const d = result.diagnostics as { headingCandidateCount: number; placedCount: number; unplacedCount: number; excludedCount?: number; edgeStatusCounts: Record<string, number> };
    lines.push(`  ${v.name.padEnd(9)} headings=${d.headingCandidateCount} excluded=${d.excludedCount ?? '-'} placed=${d.placedCount} unplaced=${d.unplacedCount} edges=${JSON.stringify(d.edgeStatusCounts)}`);
  }
  console.log(`[${e.id}] (${e.set}) pages ${e.pages[0]}-${e.pages[1]}\n${lines.join('\n')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const variants = args.find(a => a.startsWith('--variants='))?.slice(11).split(',') ?? A2_VARIANTS.map(v => v.name);
  const sets = args.find(a => a.startsWith('--set='))?.slice(6).split(',');
  const positional = args.filter(a => !a.startsWith('--'));
  const year = positional[0] ? Number(positional[0]) : 2024;
  const targets = listExtractionTargets(getBudgetRequestManifest(year));
  for (const e of A2_EXPERIMENTS) {
    if (only && !only.includes(e.id)) continue;
    if (sets && !sets.includes(e.set)) continue;
    const target = targets.find(t => t.canonicalUrl === e.canonicalUrl);
    if (!target) throw new Error(`manifestに無いcanonical URLです: ${e.canonicalUrl}`);
    await run(year, target, e, variants);
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
