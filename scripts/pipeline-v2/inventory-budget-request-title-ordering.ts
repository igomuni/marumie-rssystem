/**
 * Phase A: 前回 observed_blank page の title ordering source-only inventory（事前登録 Page_Header_Blank_Title_Ordering_Protocol）。
 * manual contract・layout 境界・existing hierarchy kind・MOF を使わない。current projection（前回と同じ code path）を再現して frozen projection と照合し、不一致なら STOP。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/inventory-budget-request-title-ordering.ts
 * 出力: tests/fixtures/budget-request-title-ordering/2024/page-ordering-inventory.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { titleOfPage, type LogicalRowText } from './lib/budget-request-header-label';
import { blankReasonOf, classifyOrdering, decidePhaseA, evidenceOf, TOP_BAND_FRACTION, type OrderClass, type OrderRow, type RowEvidence } from './lib/budget-request-title-ordering';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-title-ordering', '2024');
const MANIFEST = `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`;
const PROJECTION = `${FX}/budget-request-header-label/2024/header-label-projection.json`;
const PROTOCOL = 'docs/tasks/20261005_1117_Budget_Request_Page_Header_Blank_Title_Ordering_Protocol.md';
const FROZEN: Record<string, string> = { [MANIFEST]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [PROJECTION]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5', [PROTOCOL]: 'b3ed79803f9d60a72bbd2b9b068d8893e042fb915958f287d4c1f2cf9af4f2f8' };
const RULE_VERSION = 'title-ordering-v1';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const incN = (m: Record<string, Record<string, number>>, a: string, b: string) => { inc((m[a] ??= {}), b); };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface Doc { localPath: string; publisherAuthority: string; accountType: string; sha256: string; pages: number }
interface Proj { p: number; s: string }
interface PageResult { page: number; currentStatus: string; cls: OrderClass; blankReason: string | null; labelRows: number; codeRows: number; label: RowEvidence | null; code: RowEvidence | null; titleLikeRows: number }

async function scanPdf(d: Doc): Promise<PageResult[] | 'unavailable_upstream'> {
  if (!fs.existsSync(d.localPath) || fileSha(d.localPath) !== d.sha256) return 'unavailable_upstream';
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  const out: PageResult[] = [];
  const un = (page: number, status: string): PageResult => ({ page, currentStatus: status, cls: 'unavailable', blankReason: null, labelRows: 0, codeRows: 0, label: null, code: null, titleLikeRows: 0 });
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n);
        if (page.rotate !== 0) { out.push(un(n, 'unavailable_rotate90')); page.cleanup(); continue; }
        const content = await page.getTextContent({ disableNormalization: true });
        const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
        const items = content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[];
        const tokens = toSourceTokens(items, meta, content.styles as unknown as RawTextStyles);
        const geom = buildTableGeometry(tokens, meta);
        const lr = resolveLogicalRows(tokens, meta, geom);
        const texts: LogicalRowText[] = [];
        const orderRows: OrderRow[] = [];
        for (const r of lr.logicalRowCandidates) {
          const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== '');
          texts.push({ logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index), texts: toks.map(t => t.rawText.trim()) });
          orderRows.push({ index: r.logicalRowIndex, x: Math.round((toks[0]?.bbox.xMin ?? 0) * 10) / 10, y: Math.round(r.bbox.yMin * 10) / 10, texts: toks.map(t => t.rawText.trim()), physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index) });
        }
        const title = titleOfPage(texts);
        const rows = orderRows.map(r => evidenceOf(r, meta.height));
        const c = classifyOrdering(rows);
        out.push({
          page: n, currentStatus: title.status, cls: c.cls, blankReason: title.status === 'observed_blank' ? blankReasonOf(true, c.cls, rows) : null, labelRows: c.labelRows, codeRows: c.codeRows,
          label: rows.find(r => r.labelShaped) ?? null, code: rows.find(r => r.codeShaped) ?? null, titleLikeRows: rows.filter(r => r.titleLike).length,
        });
        page.cleanup();
      } catch { out.push(un(n, 'other_unavailable')); }
    }
  } finally { await doc.destroy(); }
  return out;
}

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { corpus: { pdfs: number; totalPages: number }; documents: Doc[] };
  const prev = new Map((JSON.parse(fs.readFileSync(PROJECTION, 'utf8')) as { pdfs: { localPath: string; projection: Proj[] }[] }).pdfs.map(p => [p.localPath, p.projection]));
  const docs = [...manifest.documents].sort((a, b) => cmp(a.localPath, b.localPath));
  const per: Record<string, unknown>[] = [];
  const counts = { pages: 0, evaluable: 0, prevBlank: 0, prevNonblank: 0, mismatches: 0 };
  const blankReason: Record<string, number> = {}, blankClass: Record<string, number> = {}, cutoffByClass: Record<string, number> = {}, orderBlank: Record<string, number> = {}, orderNonblank: Record<string, number> = {};
  const seq = { labelBlankSame: 0, labelBlankDifferent: 0, blankToLabel: 0, labelToBlank: 0, blankRuns: {} as Record<string, number>, recurrenceDistance: {} as Record<string, number> };
  const byAccount: Record<string, Record<string, number>> = {}, byPdfReason: Record<string, Record<string, number>> = {};
  const samples = new Map<string, { localPath: string; page: number; label: RowEvidence | null; code: RowEvidence | null; currentStatus: string }[]>();
  const all: { localPath: string; account: string; r: PageResult }[] = [];
  for (const [i, d] of docs.entries()) {
    const res = await scanPdf(d);
    const pr = prev.get(d.localPath)!;
    if (res === 'unavailable_upstream') throw new Error(`PDF が無い・hash 不一致（STOP）: ${d.localPath}`);
    const pages: Record<string, unknown>[] = [];
    for (const r of res) {
      counts.pages++;
      const prevS = pr.find(x => x.p === r.page)!.s;
      if (prevS !== r.currentStatus) counts.mismatches++;
      if (r.currentStatus === 'observed_nonblank') { counts.prevNonblank++; counts.evaluable++; inc(orderNonblank, r.cls); }
      if (r.currentStatus === 'observed_blank') { counts.prevBlank++; counts.evaluable++; inc(blankReason, r.blankReason!); inc(blankClass, r.cls); if (r.blankReason === 'projection_cutoff_before_label') inc(cutoffByClass, r.cls); inc(orderBlank, r.cls); incN(byPdfReason, path.basename(d.localPath), r.blankReason!); incN(byAccount, d.accountType, r.blankReason!); }
      all.push({ localPath: d.localPath, account: d.accountType, r });
      pages.push({ p: r.page, st: r.currentStatus, cls: r.cls, br: r.blankReason, nl: r.labelRows, nc: r.codeRows, tl: r.titleLikeRows, label: r.label ? [r.label.index, r.label.x, r.label.y, r.label.raw, r.label.normalized, r.label.shape?.prefixLength ?? null, r.label.shape?.innerLength ?? null, r.label.tokenIndexes] : null, code: r.code ? [r.code.index, r.code.x, r.code.y, r.code.raw, r.code.tokenIndexes] : null });
      const key = `${r.currentStatus === 'observed_blank' ? 'blank:' + r.blankReason : r.currentStatus}|${r.cls}`;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key)!.push({ localPath: d.localPath, page: r.page, label: r.label, code: r.code, currentStatus: r.currentStatus });
    }
    per.push({ localPath: d.localPath, accountType: d.accountType, pages: d.pages, evidence: pages });
    console.log(`${i + 1}/${docs.length} ${path.basename(d.localPath)}`);
  }
  if (counts.mismatches !== 0 || counts.prevBlank !== 2950 || counts.prevNonblank !== 6195) throw new Error(`current projection が再現しない（STOP）: ${JSON.stringify(counts)}`);

  // sequence（label の normalized は frozen projection から取る。補完しない）
  const projFull = JSON.parse(fs.readFileSync(PROJECTION, 'utf8')) as { pdfs: { localPath: string; projection: { p: number; s: string; n: string | null }[] }[] };
  for (const pdf of projFull.pdfs) {
    const ps = pdf.projection;
    let run = 0;
    const lastSeen = new Map<string, number>();
    for (let k = 0; k < ps.length; k++) {
      const cur = ps[k], isL = cur.s === 'observed_nonblank', isB = cur.s === 'observed_blank';
      if (isB) run++; else { if (run > 0) inc(seq.blankRuns, run >= 10 ? '10+' : String(run)); run = 0; }
      if (isL) { if (lastSeen.has(cur.n as string)) { const dist = k - (lastSeen.get(cur.n as string) as number); inc(seq.recurrenceDistance, dist === 1 ? '1' : dist === 2 ? '2' : dist <= 5 ? '3-5' : dist <= 20 ? '6-20' : '21+'); } lastSeen.set(cur.n as string, k); }
      if (isB && k > 0 && ps[k - 1].s === 'observed_nonblank') seq.labelToBlank++;
      if (isL && k > 0 && ps[k - 1].s === 'observed_blank') seq.blankToLabel++;
    }
    if (run > 0) inc(seq.blankRuns, run >= 10 ? '10+' : String(run));
    for (let k = 1; k + 1 < ps.length; k++) if (ps[k].s === 'observed_blank' && ps[k - 1].s === 'observed_nonblank' && ps[k + 1].s === 'observed_nonblank') ps[k - 1].n === ps[k + 1].n ? seq.labelBlankSame++ : seq.labelBlankDifferent++;
  }
  // PDF 分布
  const pdfConc = Object.entries(byPdfReason).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0), v.projection_cutoff_before_label ?? 0] as [string, number, number]).sort((a, b) => b[1] - a[1]);
  const pdfsWithBlank = pdfConc.filter(x => x[1] > 0).length, pdfsWithCutoff = pdfConc.filter(x => x[2] > 0).length;
  const examples: Record<string, unknown> = {};
  for (const [k, v] of [...samples.entries()].sort(([a], [b]) => cmp(a, b))) examples[k] = v.sort((a, b) => cmp(a.localPath, b.localPath) || a.page - b.page).slice(0, 3).map(x => ({ localPath: x.localPath, page: x.page, label: x.label ? { index: x.label.index, x: x.label.x, y: x.label.y, raw: x.label.raw, normalized: x.label.normalized, tokenIndexes: x.label.tokenIndexes } : null, code: x.code ? { index: x.code.index, x: x.code.x, y: x.code.y, raw: x.code.raw, tokenIndexes: x.code.tokenIndexes } : null }));
  const decision = decidePhaseA(true, counts.prevBlank, blankReason);
  const summary = {
    schema: 'budget-request-title-ordering-phaseA/v0', ruleVersion: RULE_VERSION, topBandFraction: TOP_BAND_FRACTION, note: 'source-only。manual contract・layout 境界・existing hierarchy kind・MOF は未使用。blank に label を補完していない',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) },
    corpus: { pdfs: docs.length, pages: counts.pages, evaluablePages: counts.evaluable, previousObservedBlank: counts.prevBlank, previousObservedNonblank: counts.prevNonblank, projectionReproduced: counts.mismatches === 0 },
    blankReasonDistribution: { denominator: counts.prevBlank, byReason: blankReason, byPrimaryClass: blankClass, projectionCutoffByPrimaryClass: cutoffByClass },
    orderingClass: { observedBlank: orderBlank, observedNonblank: orderNonblank },
    sequence: seq, pdfDistribution: { pdfsWithBlank, pdfsWithCutoffReason: pdfsWithCutoff, topPdfsByBlank: pdfConc.slice(0, 12), byAccountBlankReason: byAccount },
    examples, decision,
  };
  const text = `${JSON.stringify(sortDeep({ ...summary, perPdf: per }))}\n`;
  const sumText = `${JSON.stringify(sortDeep(summary), null, 1)}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'page-ordering-inventory.json'), text);
  fs.writeFileSync(path.join(OUT, 'page-ordering-summary.json'), sumText);
  console.log(JSON.stringify({ inventorySha: sha(text), summarySha: sha(sumText), corpus: summary.corpus, blank: summary.blankReasonDistribution, ordering: summary.orderingClass, sequence: seq, pdf: { pdfsWithBlank, pdfsWithCutoff, top: pdfConc.slice(0, 6), byAccount }, decision }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
