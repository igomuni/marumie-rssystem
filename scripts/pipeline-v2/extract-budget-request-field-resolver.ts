/**
 * FieldResolver v0 PoC — 推論CLI。Golden・hierarchy GT・human-observations は読まない。
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-request-field-resolver.ts [year] [--only=<documentKey>[,<documentKey>]]
 * 出力: data/work/budget-request-field-resolver/{documentKey}/field-resolution.json（決定的。時刻・絶対パスを含めない）
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, serializeFieldResolverResult, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_RUNS, HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';

async function main() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const year = Number(args.find(a => !a.startsWith('--')) ?? 2024);
  const targets = listExtractionTargets(getBudgetRequestManifest(year));
  const pdfjs = await pdfjsVersion();
  for (const run of FIELD_RESOLVER_RUNS) {
    if (only && !only.includes(run.documentKey)) continue;
    const target = targets.find(t => t.canonicalUrl === run.canonicalUrl);
    if (!target) throw new Error(`manifestに無いcanonical URLです: ${run.canonicalUrl}`);
    const state = inspectTarget(target, nodeBudgetRequestFs).state;
    if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
    const pages: FieldResolverPageInput[] = [];
    for (let n = run.pages[0]; n <= run.pages[1]; n++) {
      const ex = await extractPageTokens(target.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    let hierarchy: DocumentHierarchyV2Result | null = null;
    if (run.hierarchy) {
      hierarchy = observeDocumentHierarchyV2(run.hierarchy.view, pages.map(p => ({ meta: p.meta, tokens: p.tokens, geometry: p.geometry, logical: p.logical })), HIERARCHY_B_ONLY_OPTIONS);
    }
    const result = resolveFields({ pages, hierarchy });
    const out = {
      ...result,
      documentKey: run.documentKey,
      fiscalYear: year,
      source: { canonicalUrl: target.canonicalUrl },
      pdfjsVersion: pdfjs,
      pageRange: { from: run.pages[0], to: run.pages[1] },
      hierarchyInput: run.hierarchy ? { variant: 'v2-B-obs (singletonRootPlacement=lattice-supported, headerCollisionHandling=observe-only)', experimentId: run.hierarchy.experimentId } : null,
    };
    const file = path.join(FIELD_RESOLVER_WORK_DIR, run.documentKey, 'field-resolution.json');
    nodeBudgetRequestFs.mkdirp(path.dirname(file));
    // serialize は result の schema を含む。out は決定的（key順固定）
    nodeBudgetRequestFs.writeAtomic(file, Buffer.from(serializeFieldResolverResult(out as unknown as typeof result), 'utf8'));
    const c: Record<string, number> = {};
    for (const r of result.records) for (const f of [r.rowLocal.previousBudget, r.rowLocal.requestedBudget, r.rowLocal.difference]) c[f.status] = (c[f.status] ?? 0) + 1;
    console.log(`[${run.documentKey}] pages ${run.pages[0]}-${run.pages[1]} records=${result.records.length} amountStatus=${JSON.stringify(c)}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
