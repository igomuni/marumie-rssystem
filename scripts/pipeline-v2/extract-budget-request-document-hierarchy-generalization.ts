/**
 * DocumentHierarchy v1（frozen）の他省庁 generalization 実験 — 段階A（推論）の薄いランナー。
 * 推論は既存の observeDocumentHierarchy() をそのまま使う（v1のルール・係数は変更しない）。このファイルはGTを読まない。
 * 入力範囲はここで宣言した走査範囲の指定で、親子情報を含まない（docs/data-pipeline-v2.md の DocumentHierarchy PoC 節）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-request-document-hierarchy-generalization.ts [year] [--only=<id>[,<id>]]
 * 出力: data/work/budget-request-document-hierarchy/{year}/generalization-v1/{id}.json
 *   （推論結果 + 実行メタ + 補助注記 nodeGeometry。nodeGeometry は heading行のbbox/ページ寸法の参照情報で、推論の入力でも出力の一部でもない）
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets, type ExtractionTarget } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type HierarchyPageInput, type HierarchyView } from './lib/budget-request-document-hierarchy';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const METI = 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf';
const MEXT_SUMMARY = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_02.pdf';
const MEXT_DETAIL = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';

export interface GeneralizationExperiment {
  id: string;
  view: HierarchyView;
  canonicalUrl: string;
  pages: [number, number];
}

/** 実験計画で固定した走査範囲（親子関係を含まない） */
const EXPERIMENTS: GeneralizationExperiment[] = [
  { id: 'meti-summary', view: 'summary', canonicalUrl: METI, pages: [5, 8] },
  { id: 'meti-detail', view: 'detail', canonicalUrl: METI, pages: [9, 106] },
  { id: 'mext-summary', view: 'summary', canonicalUrl: MEXT_SUMMARY, pages: [1, 8] },
  { id: 'mext-detail', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1339] },
  { id: 'meti-detail-narrow', view: 'detail', canonicalUrl: METI, pages: [66, 81] },
  { id: 'mext-detail-narrow', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1259] },
];

async function run(year: number, target: ExtractionTarget, e: GeneralizationExperiment): Promise<void> {
  const state = inspectTarget(target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
  const pages: HierarchyPageInput[] = [];
  for (let n = e.pages[0]; n <= e.pages[1]; n++) {
    const ex = await extractPageTokens(target.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  const result = observeDocumentHierarchy(e.view, pages, DEFAULT_HIERARCHY_OPTIONS);
  const byPage = new Map(pages.map(p => [p.meta.number, p]));
  const nodeGeometry = result.nodes.map(n => {
    const p = byPage.get(n.sourcePage) as HierarchyPageInput;
    const b = p.logical.logicalRowCandidates[n.sourceRowRefs.logicalRowIndex].bbox;
    return { id: n.id, yMin: b.yMin, yMax: b.yMax, pageWidth: p.meta.width, pageHeight: p.meta.height };
  });
  const out = {
    ...result,
    experimentId: e.id,
    fiscalYear: year,
    source: { canonicalUrl: target.canonicalUrl, publisherDomain: target.publisherDomain, localPath: target.localPath },
    pdfjsVersion: await pdfjsVersion(),
    pageRange: { from: e.pages[0], to: e.pages[1] },
    nodeGeometry,
    note: 'v1 (frozen) out-of-sample run; PoC observation/candidate artifact, not a final schema. nodeGeometry is reference metadata for descriptive classification only.',
  };
  const file = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), 'generalization-v1', `${e.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  const d = result.diagnostics;
  console.log(
    `[${e.id}] pages ${e.pages[0]}-${e.pages[1]} logicalRows=${d.logicalRowCount} headingCandidates=${d.headingCandidateCount} (placed=${d.placedCount}, unplaced=${d.unplacedCount}) levels=${JSON.stringify(d.nodeCountByLevel)} edges=${JSON.stringify(d.edgeStatusCounts)}\n  clusters=${result.indentClusters.map(c => `${c.xMin}${c.xMax !== c.xMin ? `-${c.xMax}` : ''}(n=${c.memberCount},L${c.level ?? '-'})`).join(' ')}\n  → ${file}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const positional = args.filter(a => !a.startsWith('--'));
  const year = positional[0] ? Number(positional[0]) : 2024;
  const targets = listExtractionTargets(getBudgetRequestManifest(year));
  for (const e of EXPERIMENTS) {
    if (only && !only.includes(e.id)) continue;
    const target = targets.find(t => t.canonicalUrl === e.canonicalUrl);
    if (!target) throw new Error(`manifestに無いcanonical URLです: ${e.canonicalUrl}`);
    await run(year, target, e);
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
