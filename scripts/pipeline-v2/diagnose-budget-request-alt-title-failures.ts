/**
 * post-hoc diagnostic（primary evaluation の後。rule は拡張しない）: C2 の ambiguous / unresolved page の構造を分類する。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/diagnose-budget-request-alt-title-failures.ts
 * 出力: tests/fixtures/budget-request-alt-title-projection/2024/c2-failure-diagnostic.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { classifyRow } from './lib/budget-request-header-label';
import { evidenceOf } from './lib/budget-request-title-ordering';

const OUT = path.join('tests', 'fixtures', 'budget-request-alt-title-projection', '2024');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const pop = JSON.parse(fs.readFileSync(path.join(OUT, 'population-manifest.json'), 'utf8')) as { members: Record<string, Record<string, number[]>> };
  const evalP = JSON.parse(fs.readFileSync(path.join(OUT, 'primary-evaluation.json'), 'utf8')) as { failureSamples: Record<string, { first: { localPath: string; page: number }[] }> };
  void evalP;
  const targets = pop.members.C2_target_same_row;
  const pairs: Record<string, number> = {}, where: Record<string, number> = {}, otherCode: Record<string, number> = {}, perPdf: Record<string, number> = {};
  const unresolved: unknown[] = [];
  for (const [lp, pages] of Object.entries(targets).sort(([a], [b]) => cmp(a, b))) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(lp)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (const n of pages) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent({ disableNormalization: true });
        const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
        const tokens = toSourceTokens(content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[], meta, content.styles as unknown as RawTextStyles);
        const lr = resolveLogicalRows(tokens, meta, buildTableGeometry(tokens, meta));
        const rows = lr.logicalRowCandidates.map(r => { const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== ''); return { index: r.logicalRowIndex, x: toks[0]?.bbox.xMin ?? 0, y: r.bbox.yMin, texts: toks.map(t => t.rawText.trim()), physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index) }; });
        const evs = rows.map(r => evidenceOf(r, meta.height));
        const fc = rows.findIndex(r => classifyRow(r.texts) !== 'other');
        if (fc < 0 || !evs[fc].labelShaped) { unresolved.push({ localPath: lp, page: n, firstCodeRowByCurrentDefinition: fc, rows: rows.slice(0, 6).map((r, i) => ({ index: r.index, cls: classifyRow(r.texts), codeShaped: evs[i].codeShaped, labelShaped: evs[i].labelShaped, raw: evs[i].raw.slice(0, 50) })) }); continue; }
        const others = evs.map((e, i) => ({ e, i })).filter(x => x.i !== fc && x.e.labelShaped && x.e.normalized !== evs[fc].normalized);
        if (others.length === 0) continue;
        inc(perPdf, path.basename(lp));
        for (const o of others) { inc(pairs, `${evs[fc].normalized} | ${o.e.normalized}`.slice(0, 60)); inc(where, o.i < fc ? 'other_before_first_code_row' : 'other_after_first_code_row'); inc(otherCode, o.e.codeShaped ? 'other_is_code_shaped' : 'other_not_code_shaped'); }
        page.cleanup();
      }
    } finally { await doc.destroy(); }
  }
  const top = Object.entries(pairs).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 15);
  const out = { schema: 'budget-request-alt-title-c2-failure-diagnostic/v0', note: 'post-hoc diagnostic。rule は拡張しない', unresolvedPages: unresolved, ambiguousOtherLabelRows: { position: where, codeShaped: otherCode, topProjectedAndOtherNormalized: top, pagesByPdfTop: Object.entries(perPdf).sort((a, b) => b[1] - a[1]).slice(0, 10) } };
  fs.writeFileSync(path.join(OUT, 'c2-failure-diagnostic.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
