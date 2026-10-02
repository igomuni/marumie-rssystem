/**
 * DocumentHierarchy v2 failure isolation 実験 — 段階A（推論）の薄いランナー。GTを読まない。
 * 各実験のページを1回だけ抽出し、variant（v1 / v2-off-off / v2-A / v2-B / v2-AB）ごとに推論して別々のartifactに保存する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-request-document-hierarchy-v2.ts [year] [--group=development|regression|holdout|holdout-b2[,..]] [--only=<id>[,<id>]]
 * 出力: data/work/budget-request-document-hierarchy/{year}/v2-failure-isolation/{variant}/{id}.json（v1の既存artifactは上書きしない）
 * holdout は規則を固定した後に初めて実行する（実験計画）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets, type ExtractionTarget } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type HierarchyPageInput, type HierarchyView } from './lib/budget-request-document-hierarchy';
import { observeDocumentHierarchyV2, type HierarchyV2ExperimentalOptions } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const MHLW = 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf';
const METI = 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf';
const MEXT_SUMMARY = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_02.pdf';
const MEXT_DETAIL = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';
const ENV = 'https://www.env.go.jp/content/000157010.pdf';
const MAFF_FUKKO = 'https://www.maff.go.jp/j/budget/attach/pdf/230901-4.pdf';
const MLIT_FUKKO = 'https://www.mlit.go.jp/page/content/001630395.pdf';

type Group = 'development' | 'regression' | 'holdout' | 'holdout-b2';
export interface V2Experiment {
  id: string;
  group: Group;
  view: HierarchyView;
  canonicalUrl: string;
  pages: [number, number];
}

/** 実験計画で固定した走査範囲（親子関係を含まない） */
export const V2_EXPERIMENTS: V2Experiment[] = [
  { id: 'meti-detail', group: 'development', view: 'detail', canonicalUrl: METI, pages: [9, 106] },
  { id: 'meti-detail-narrow', group: 'development', view: 'detail', canonicalUrl: METI, pages: [66, 81] },
  { id: 'mext-detail-narrow', group: 'development', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1259] },
  { id: 'mhlw-detail-narrow', group: 'development', view: 'detail', canonicalUrl: MHLW, pages: [1555, 1602] },
  { id: 'mhlw-summary', group: 'regression', view: 'summary', canonicalUrl: MHLW, pages: [19, 20] },
  { id: 'mhlw-detail', group: 'regression', view: 'detail', canonicalUrl: MHLW, pages: [1555, 1700] },
  { id: 'meti-summary', group: 'regression', view: 'summary', canonicalUrl: METI, pages: [5, 8] },
  { id: 'mext-summary', group: 'regression', view: 'summary', canonicalUrl: MEXT_SUMMARY, pages: [1, 8] },
  { id: 'mext-detail', group: 'regression', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1339] },
  { id: 'meti-detail-pre-header', group: 'regression', view: 'detail', canonicalUrl: METI, pages: [9, 103] },
  { id: 'env-detail', group: 'holdout', view: 'detail', canonicalUrl: ENV, pages: [21, 193] },
  { id: 'maff-fukko-detail', group: 'holdout', view: 'detail', canonicalUrl: MAFF_FUKKO, pages: [7, 20] },
  /** 追加holdout（v2-Bのみ。規則固定後。v2-Aの対象ではない） */
  { id: 'mlit-fukko-detail', group: 'holdout-b2', view: 'detail', canonicalUrl: MLIT_FUKKO, pages: [7, 10] },
];

export const V2_VARIANTS: { name: string; options: HierarchyV2ExperimentalOptions | null }[] = [
  { name: 'v1', options: null },
  { name: 'v2-off-off', options: { headerCollisionHandling: 'off', singletonRootPlacement: 'off' } },
  { name: 'v2-A', options: { headerCollisionHandling: 'observational-filter', singletonRootPlacement: 'off' } },
  { name: 'v2-B', options: { headerCollisionHandling: 'off', singletonRootPlacement: 'lattice-supported' } },
  { name: 'v2-AB', options: { headerCollisionHandling: 'observational-filter', singletonRootPlacement: 'lattice-supported' } },
];

async function run(year: number, target: ExtractionTarget, e: V2Experiment): Promise<void> {
  const state = inspectTarget(target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
  const pages: HierarchyPageInput[] = [];
  for (let n = e.pages[0]; n <= e.pages[1]; n++) {
    const ex = await extractPageTokens(target.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  const pdfjs = await pdfjsVersion();
  const summary: string[] = [];
  for (const v of V2_VARIANTS) {
    const result = v.options ? observeDocumentHierarchyV2(e.view, pages, v.options) : observeDocumentHierarchy(e.view, pages, DEFAULT_HIERARCHY_OPTIONS);
    const out = {
      ...result,
      experimentId: e.id,
      variant: v.name,
      fiscalYear: year,
      source: { canonicalUrl: target.canonicalUrl, publisherDomain: target.publisherDomain, localPath: target.localPath },
      pdfjsVersion: pdfjs,
      pageRange: { from: e.pages[0], to: e.pages[1] },
      note: 'DocumentHierarchy v2 failure-isolation PoC artifact (experimental). Not a final schema.',
    };
    const file = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'v2-failure-isolation', v.name, `${e.id}.json`);
    nodeBudgetRequestFs.mkdirp(path.dirname(file));
    nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
    const d = result.diagnostics as { headingCandidateCount: number; placedCount: number; unplacedCount: number; nodeCountByLevel: Record<string, number>; edgeStatusCounts: Record<string, number>; excludedCount?: number };
    summary.push(`  ${v.name.padEnd(10)} headings=${d.headingCandidateCount} excluded=${d.excludedCount ?? '-'} placed=${d.placedCount} unplaced=${d.unplacedCount} levels=${JSON.stringify(d.nodeCountByLevel)} edges=${JSON.stringify(d.edgeStatusCounts)}`);
  }
  console.log(`[${e.id}] (${e.group}) pages ${e.pages[0]}-${e.pages[1]}\n${summary.join('\n')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const groups = args.find(a => a.startsWith('--group='))?.slice(8).split(',');
  const positional = args.filter(a => !a.startsWith('--'));
  const year = positional[0] ? Number(positional[0]) : 2024;
  const targets = listExtractionTargets(getBudgetRequestManifest(year));
  for (const e of V2_EXPERIMENTS) {
    if (only && !only.includes(e.id)) continue;
    if (groups && !groups.includes(e.group)) continue;
    const target = targets.find(t => t.canonicalUrl === e.canonicalUrl);
    if (!target) throw new Error(`manifestに無いcanonical URLです: ${e.canonicalUrl}`);
    await run(year, target, e);
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
