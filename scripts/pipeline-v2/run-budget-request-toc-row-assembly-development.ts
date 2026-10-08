/**
 * TOC A 層 row assembly parser の development-only regression 実行（explored development 34 page のみ）。
 * held-out candidate 23 page には parser を走らせない（membership は除外判定にのみ使い、GT は読まない）。
 * 結果は rule の descriptive regression であり、accuracy / coverage / safety の評価ではない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/run-budget-request-toc-row-assembly-development.ts [--freeze-fixture]
 * 出力（--freeze-fixture のとき）: tests/fixtures/budget-request-toc-row-assembly-parser/2024/development-regression.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPage, ruleConfigSha256, type TocPageInput } from './lib/budget-request-toc-row-assembly';

const FREEZE = process.argv.includes('--freeze-fixture');
const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const PHYS = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024', 'development-regression.json');
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function main() {
  type Inv = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: 'DIRECT' | 'INHERITED'; explored: { pr3aExplored: boolean; issue389Explored: boolean } };
  const inv = readJson<{ pages: Inv[] }>(path.join(PHYS, 'candidate-inventory.json'));
  const ledger390 = new Set(readJson<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(PHYS, 'development-explored-pages.json')).pages.map(key));
  const heldout = new Set(readJson<{ pages: { localPdfPath: string; physicalPage: number }[] }>(path.join(ASM, 'heldout-candidates.json')).pages.map(key)); // 除外判定のみ
  const dev = inv.pages.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored || ledger390.has(key(p)));
  if (dev.length !== 34) throw new Error(`development page count ${dev.length} != 34`);
  if (dev.some(p => heldout.has(key(p)))) throw new Error('held-out page in development set');

  const raw = readJson<{ documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const cache = new Map<string, Record<string, unknown>[]>();
  const pagesOf = (p: string) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); cache.set(p, r); } return r; };

  const results = dev.sort((a, b) => cmp(key(a), key(b))).map(p => {
    const rp = pagesOf(p.localPdfPath)[p.physicalPage - 1] as { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] };
    const input: TocPageInput = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: rp.text, nonEmptyLines: rp.nonEmptyLines };
    const out = assembleTocPage(input);
    const byKind: Record<string, number> = {}; const byReason: Record<string, number> = {};
    for (const r of out.rows) { byKind[r.rowKind] = (byKind[r.rowKind] ?? 0) + 1; if (r.abstentionReason) byReason[r.abstentionReason] = (byReason[r.abstentionReason] ?? 0) + 1; }
    return { localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, classifierSource: p.classifierSource, pageState: out.pageState, pageAbstentionReason: out.pageAbstentionReason, rightBandEdge: out.rightBandEdge, rows: out.rows.length, fragmentsAttached: out.rows.reduce((a, r) => a + r.fragments.length, 0), byKind, rowAbstentionByReason: byReason, outputSha256: sha256Hex(JSON.stringify(out)) };
  });
  const total = (f: (r: (typeof results)[number]) => number) => results.reduce((a, r) => a + f(r), 0);
  const pageStates: Record<string, number> = {}; const pageReasons: Record<string, number> = {}; const rowReasons: Record<string, number> = {};
  for (const r of results) { pageStates[r.pageState] = (pageStates[r.pageState] ?? 0) + 1; if (r.pageAbstentionReason) pageReasons[r.pageAbstentionReason] = (pageReasons[r.pageAbstentionReason] ?? 0) + 1; for (const [k, v] of Object.entries(r.rowAbstentionByReason)) rowReasons[k] = (rowReasons[k] ?? 0) + v; }
  const fixture = {
    schema: 'budget-request-toc-row-assembly-development-regression/v0',
    scope: 'explored development 34 page のみの descriptive regression（rule のコード化・決定性・abstention の確認）。held-out 23 page は未実行。accuracy / coverage / safety の評価ではない',
    ruleConfigSha256: ruleConfigSha256(),
    developmentPages: results.length, heldoutPagesExecuted: 0,
    summary: { pageStates, pageAbstentionReasons: pageReasons, rows: total(r => r.rows), fragmentsAttached: total(r => r.fragmentsAttached), rowAbstentionByReason: rowReasons },
    pages: results,
  };
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 1)}\n`); }
  console.log(JSON.stringify({ summary: fixture.summary, pageStatesByPage: results.map(r => `${r.pageState}${r.pageAbstentionReason ? ':' + r.pageAbstentionReason : ''}`).reduce((a: Record<string, number>, k) => ((a[k] = (a[k] ?? 0) + 1), a), {}) }, null, 1));
}
main();
