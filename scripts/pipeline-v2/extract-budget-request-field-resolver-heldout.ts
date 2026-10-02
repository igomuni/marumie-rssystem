/**
 * FieldResolver v0 held-out — 推論CLI（freeze した resolveFields を、選定済みの各ページに 1 ページずつ適用する。Golden を読まない）。
 * 入力: tests/fixtures/budget-request-field-resolver/heldout-v0/manifest.json（ページの選定。値の真値ではない）
 * 出力: data/work/budget-request-field-resolver/heldout-v0/{documentId}-p{page}/field-resolution.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, serializeFieldResolverResult } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';
import type { HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';

const HELDOUT_WORK_DIR = path.join(FIELD_RESOLVER_WORK_DIR, 'heldout-v0');

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0', 'manifest.json'), 'utf8')) as HeldoutManifest;
  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const pdfjs = await pdfjsVersion();
  for (const d of manifest.documents) {
    const target = targets.find(t => t.canonicalUrl === d.canonicalUrl);
    if (!target) throw new Error(`manifestに無いcanonical URLです: ${d.canonicalUrl}`);
    const state = inspectTarget(target, nodeBudgetRequestFs).state;
    if (state !== 'FOUND') throw new Error(`原本が${state}です: ${target.localPath}`);
    for (const p of d.pages) {
      const ex = await extractPageTokens(target.localPath, p.physicalPage);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      const logical = resolveLogicalRows(ex.tokens, ex.page, geometry);
      const result = resolveFields({ pages: [{ meta: ex.page, tokens: ex.tokens, geometry, logical }], hierarchy: null });
      const out = { ...result, documentId: d.documentId, source: { canonicalUrl: d.canonicalUrl }, pdfjsVersion: pdfjs, pageRange: { from: p.physicalPage, to: p.physicalPage }, hierarchyInput: null };
      const file = path.join(HELDOUT_WORK_DIR, `${d.documentId}-p${p.physicalPage}`, 'field-resolution.json');
      nodeBudgetRequestFs.mkdirp(path.dirname(file));
      nodeBudgetRequestFs.writeAtomic(file, Buffer.from(serializeFieldResolverResult(out as unknown as typeof result), 'utf8'));
      console.log(`[${d.documentId} p${p.physicalPage}] records=${result.records.length}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
