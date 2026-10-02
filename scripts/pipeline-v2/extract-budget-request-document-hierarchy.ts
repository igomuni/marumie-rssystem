/**
 * 概算要求PDF（MHLW）の文書階層PoC — 段階A（推論）。SourceToken → TableGeometry → LogicalRow → 見出し候補・親子候補。
 * Ground Truthは読まない（評価は別CLI: evaluate-budget-request-document-hierarchy.ts）。DocumentHierarchyは最終schemaではない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-document-hierarchy.ts [year] --mhlw-poc
 *   npx tsx scripts/pipeline-v2/extract-budget-request-document-hierarchy.ts [year] --view=summary|detail --document=<canonicalUrl> --pages=<A-B>
 *
 * --mhlw-poc は固定した入力範囲（総表 p19-20 / 明細 p1555-1700。docs/data-pipeline-v2.md の DocumentHierarchy PoC 節）を使う。
 * 範囲は「走査範囲の指定」であり、親子関係の情報は含まない。
 *
 * 出力: data/work/budget-request-document-hierarchy/{year}/{view}.json（data/derivedには昇格しない）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets, type ExtractionTarget } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { DOCUMENT_HIERARCHY_WORK_DIR } from './lib/budget-request-document-hierarchy-paths';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type HierarchyPageInput, type HierarchyView } from './lib/budget-request-document-hierarchy';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { COORDINATE_SYSTEM } from './lib/budget-request-source-token';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const MHLW_URL = 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf';
const MHLW_POC: { view: HierarchyView; pages: [number, number] }[] = [
  { view: 'summary', pages: [19, 20] },
  { view: 'detail', pages: [1555, 1700] },
];

const USAGE = `usage: extract-budget-request-document-hierarchy.ts [year] (--mhlw-poc | --view=summary|detail --document=<canonicalUrl> --pages=A-B)
出力: ${DOCUMENT_HIERARCHY_WORK_DIR}/{year}/{view}.json`;

function fail(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

async function runView(year: number, target: ExtractionTarget, view: HierarchyView, from: number, to: number): Promise<void> {
  const state = inspectTarget(target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
  const pages: HierarchyPageInput[] = [];
  for (let n = from; n <= to; n++) {
    const ex = await extractPageTokens(target.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    const logical = resolveLogicalRows(ex.tokens, ex.page, geometry);
    pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical });
  }
  const result = observeDocumentHierarchy(view, pages, DEFAULT_HIERARCHY_OPTIONS);
  const out = {
    ...result,
    fiscalYear: year,
    source: { canonicalUrl: target.canonicalUrl, publisherDomain: target.publisherDomain, localPath: target.localPath },
    pdfjsVersion: await pdfjsVersion(),
    coordinateSystem: COORDINATE_SYSTEM,
    pageRange: { from, to },
    note: 'PoC observation/candidate artifact (budget-request-document-hierarchy-poc/v1). Not a final hierarchy schema and not a semantic record. Refs are page-local: SourceToken.index / PhysicalRowCandidate.rowIndex / LogicalRowCandidate.logicalRowIndex of the page given by sourcePage (rebuild with extract-budget-request-logical-row).',
  };
  const file = path.join(DOCUMENT_HIERARCHY_WORK_DIR, String(year), `${view}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  const d = result.diagnostics;
  console.log(
    `[${view}] pages ${from}-${to} logicalRows=${d.logicalRowCount} headingCandidates=${d.headingCandidateCount} (placed=${d.placedCount}, unplaced=${d.unplacedCount}) ` +
      `levels=${JSON.stringify(d.nodeCountByLevel)} edges=${JSON.stringify(d.edgeStatusCounts)}\n  clusters=${result.indentClusters.map(c => `${c.xMin}${c.xMax !== c.xMin ? `-${c.xMax}` : ''}(n=${c.memberCount},L${c.level ?? '-'})`).join(' ')}\n  → ${file}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = args.filter(a => a.startsWith('--') && a !== '--mhlw-poc' && !/^--(view|document|pages)=/.test(a));
  const positional = args.filter(a => !a.startsWith('--'));
  if (unknown.length > 0) return fail(`unknown option: ${unknown.join(' ')}`);
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d{4}$/.test(positional[0]))) return fail(`year must be a 4-digit fiscal year: ${positional.join(' ')}`);
  const year = positional[0] ? Number(positional[0]) : 2024;
  let targets: ExtractionTarget[];
  try {
    targets = listExtractionTargets(getBudgetRequestManifest(year));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const find = (url: string) => targets.find(t => t.canonicalUrl === url);

  if (args.includes('--mhlw-poc')) {
    const target = find(MHLW_URL);
    if (!target) return fail(`manifestに無いcanonical URLです: ${MHLW_URL}`);
    for (const v of MHLW_POC) await runView(year, target, v.view, v.pages[0], v.pages[1]);
    return;
  }
  const view = opt('view');
  const url = opt('document');
  const m = opt('pages')?.match(/^(\d+)-(\d+)$/);
  if ((view !== 'summary' && view !== 'detail') || !url || !m) return fail('--view=summary|detail, --document=, --pages=A-B が必要です');
  const target = find(url);
  if (!target) return fail(`manifestに無いcanonical URLです: ${url}`);
  const [from, to] = [Number(m[1]), Number(m[2])];
  if (from < 1 || to < from) return fail('--pages= は 1 <= A <= B の範囲で指定してください');
  await runView(year, target, view, from, to);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
