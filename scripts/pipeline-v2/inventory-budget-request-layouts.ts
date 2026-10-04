/**
 * FY2024 概算要求 82 PDF の layout / geometry inventory（read-only）。入力は baseline の row-local な records / pageDiagnostics（column layout）と、pdf.js の page メタ（サイズ・rotate。text 抽出はしない）。
 * hierarchy・MOF・項の意味は使わない。production code は変更しない。weak population の同定のみ凍結済みの candidate-count artifact を参照する（分類には使わない）。
 * 使い方: npx tsx scripts/pipeline-v2/inventory-budget-request-layouts.ts --phase=development|full
 * 出力: tests/fixtures/budget-request-layout-hierarchy-inventory/2024/{development-inventory,layout-page-inventory,layout-summary}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { A2_EXPERIMENTS } from './lib/budget-request-document-hierarchy-a2-experiments';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { buildRanges, contractAlignment, decideLayout, headerSignatureRequestClusters, pdfStatus, summarizePage, DOMINANCE_TOLERANCE, SIGNATURE_QUANTUM, type InvColumnLayout, type InvRecord, type PageGeometry, type PageSummary } from './lib/budget-request-layout-inventory';

const OUT = path.join('tests', 'fixtures', 'budget-request-layout-hierarchy-inventory', '2024');
const BASE_FIX = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const CAND = path.join('tests', 'fixtures', 'budget-request-pdf-item-candidate-count', '2024', 'candidate-count.json');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const FROZEN: Record<string, string> = {
  [path.join(BASE_FIX, 'corpus-manifest.json')]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [path.join(BASE_FIX, 'extraction-baseline.json')]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f',
  [CAND]: '35ffc096496ff9af7ab62ac5848b2ddef19ae0211f441193bf05598e7990d508',
  [path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024', 'transition-evaluation.json')]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd',
};
const DEVELOPMENT_SHA = '817ade1a3e10de2a64b8aa0f9306c075dfccc17318fb171861bb2e0e5e6af91f';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface Doc { localPath: string; canonicalUrl: string; publisherAuthority: string; accountType: string; pages: number }
interface SegRes { pages: [number, number]; mode: string; status: string; error: string | null; outputs: { records: { path: string; sha256: string } } | null }
interface DocRes { status: string; segments: SegRes[] }
type Coverage = 'inventory_evaluable' | 'unavailable_rotate90' | 'unavailable_upstream' | 'insufficient_layout_evidence' | 'other';

async function pageGeometries(file: string): Promise<Map<number, PageGeometry>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  const out = new Map<number, PageGeometry>();
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      out.set(n, { width: Math.round((x1 - x0) * 100) / 100, height: Math.round((y1 - y0) * 100) / 100, rotate: page.rotate });
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out;
}

async function inventoryDoc(d: Doc) {
  const slug = slugOf(d.localPath);
  const f = path.join(BASE_WORK, slug, 'result.json');
  if (!fs.existsSync(f)) return { doc: d, coverage: 'unavailable_upstream' as Coverage, pages: [] as PageSummary[], reason: 'baseline result が無い' };
  const res = JSON.parse(fs.readFileSync(f, 'utf8')) as DocRes;
  const geoms = await pageGeometries(d.localPath);
  if (res.status !== 'success') {
    const rotate = res.segments.some(s => s.error?.includes('rotate=90'));
    const pages = [...geoms.entries()].map(([page, g]) => ({ page, width: g.width, height: g.height, rotate: g.rotate }));
    return { doc: d, coverage: (rotate ? 'unavailable_rotate90' : 'other') as Coverage, pages: [] as PageSummary[], reason: res.status, rawPageMeta: pages };
  }
  const pages: PageSummary[] = [];
  for (const s of res.segments) {
    if (!s.outputs) throw new Error(`成功区間に records が無い: ${d.localPath}`);
    if (sha(fs.readFileSync(s.outputs.records.path)) !== s.outputs.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${s.outputs.records.path}`);
    const recs = readGz<InvRecord>(s.outputs.records.path);
    const meta = JSON.parse(fs.readFileSync(s.outputs.records.path.replace('.records.jsonl.gz', '.meta.json'), 'utf8')) as { pageDiagnostics: { page: number; columnLayout: InvColumnLayout | null }[] };
    const byPage = new Map<number, InvRecord[]>();
    for (const r of recs) { if (!byPage.has(r.anchor.page)) byPage.set(r.anchor.page, []); byPage.get(r.anchor.page)!.push(r); }
    for (const pd of meta.pageDiagnostics) {
      const g = geoms.get(pd.page);
      if (!g) throw new Error(`page メタが無い: ${d.localPath} p${pd.page}`);
      pages.push(summarizePage(pd.page, byPage.get(pd.page) ?? [], pd.columnLayout, g));
    }
  }
  pages.sort((a, b) => a.page - b.page);
  return { doc: d, coverage: 'inventory_evaluable' as Coverage, pages, reason: null as string | null };
}

function docEntry(r: Awaited<ReturnType<typeof inventoryDoc>>) {
  const { ranges, transitions, leadingUnassigned, trailingUnassigned } = buildRanges(r.pages);
  const status = r.coverage === 'inventory_evaluable' ? pdfStatus(ranges) : null;
  const coverage: Coverage = r.coverage === 'inventory_evaluable' && status === 'insufficient_evidence' ? 'insufficient_layout_evidence' : r.coverage;
  const contract = hierarchyContractFor(r.doc.canonicalUrl);
  const contractCheck = contract && r.pages.length ? { id: contract.id, pages: contract.pages, ...contractAlignment(ranges, r.doc.pages, contract.pages[0], contract.pages[1]) } : null;
  const lex = { plain3: 0, request_like: 0, hyphen_other: 0, other_numeric: 0, non_code: 0 };
  for (const p of r.pages) for (const k of Object.keys(lex) as (keyof typeof lex)[]) lex[k] += p.lexical[k];
  return { entry: { localPath: r.doc.localPath, publisherAuthority: r.doc.publisherAuthority, accountType: r.doc.accountType, totalPages: r.doc.pages, coverage, layoutStatus: status, reason: r.reason, evaluablePages: r.pages.length, assignedPages: r.pages.filter(p => p.signature).length, lexicalTotals: lex, ranges, transitions, leadingUnassigned, trailingUnassigned, hierarchyContract: contractCheck, rawPageMeta: (r as { rawPageMeta?: unknown }).rawPageMeta }, pages: r.pages };
}

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  if (phase !== 'development' && phase !== 'full') throw new Error('--phase=development|full が必要');
  for (const [p, h] of Object.entries(FROZEN)) if (sha(fs.readFileSync(p)) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const docs = (JSON.parse(fs.readFileSync(path.join(BASE_FIX, 'corpus-manifest.json'), 'utf8')) as { documents: Doc[] }).documents;
  const cand = JSON.parse(fs.readFileSync(CAND, 'utf8')) as { perPdf: { localPath: string; group: string; scan: string; referenceX: number | null; reference?: string }[] };
  const weakA = cand.perPdf.filter(p => p.group === 'hierarchy_less_pdf' && p.scan === 'scannable' && p.referenceX !== null && Math.abs(p.referenceX - 55.22) < 0.005).map(p => p.localPath).sort(cmp);
  const weakB = cand.perPdf.filter(p => p.scan === 'scannable' && p.reference === 'no_reference').map(p => p.localPath).sort(cmp);
  const contractPdfs = docs.filter(d => hierarchyContractFor(d.canonicalUrl)).map(d => d.localPath).sort(cmp);

  if (phase === 'development') {
    // 選択規則（事前登録）: hierarchy 契約あり 8 PDF + weak A の localPath 辞書順で先頭 3 + weak B の同 3
    const sel = [...new Set([...contractPdfs, ...weakA.slice(0, 3), ...weakB.slice(0, 3)])];
    const entries: unknown[] = [];
    for (const p of sel) { const d = docs.find(x => x.localPath === p)!; const r = docEntry(await inventoryDoc(d)); entries.push({ ...r.entry, pages: r.pages }); console.log(`dev ${path.basename(p)}: ${r.entry.layoutStatus} ranges=${r.entry.ranges.length}`); }
    const text = `${JSON.stringify(sortDeep({ schema: 'budget-request-layout-inventory-development/v0', selection: { rule: 'hierarchy 契約あり 8 PDF + weak A（hierarchy 契約なし・基準 x=55.22 の 26 PDF）の localPath 辞書順で先頭 3 + weak B（基準 x を決められなかった 23 PDF）の同 3', contract: contractPdfs, weakAFirst3: weakA.slice(0, 3), weakBFirst3: weakB.slice(0, 3) }, documents: entries }), null, 1)}\n`;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'development-inventory.json'), text);
    console.log(`sha256 ${sha(text)}`);
    return;
  }

  // ---- full ----
  const all = [] as ReturnType<typeof docEntry>[];
  for (const [i, d] of docs.entries()) { all.push(docEntry(await inventoryDoc(d))); if ((i + 1) % 10 === 0) console.log(`${i + 1}/${docs.length}`); }
  const entries = all.map(x => x.entry);
  const allPages = all.flatMap(x => x.pages.map(p => ({ doc: x.entry, p })));

  const coverage: Record<string, { pdfs: number; pages: number }> = {};
  for (const e of entries) { (coverage[e.coverage] ??= { pdfs: 0, pages: 0 }); coverage[e.coverage].pdfs++; coverage[e.coverage].pages += e.totalPages; }
  const evaluable = entries.filter(e => e.coverage === 'inventory_evaluable');
  const pdfLevel: Record<string, number> = {};
  for (const e of evaluable) inc(pdfLevel, e.layoutStatus!);
  const pageLevel = { evaluablePages: allPages.length, signatureAssigned: allPages.filter(x => x.p.signature).length, noHeaderGeometry: allPages.filter(x => !x.p.signature).length, transitions: entries.reduce((n, e) => n + e.transitions.length, 0), ranges: entries.reduce((n, e) => n + e.ranges.length, 0) };
  const rangesPerPdf: Record<string, number> = {};
  for (const e of evaluable) inc(rangesPerPdf, String(e.ranges.length));
  const mixed = evaluable.filter(e => e.layoutStatus === 'mixed_layout_like');

  // variant（signature）表
  const headerClusters = headerSignatureRequestClusters(allPages.map(x => x.p));
  const variants = new Map<string, { pdfs: Set<string>; pages: number; ranges: number; general: Set<string>; special: Set<string>; reqDominantX: Record<string, number>; plain3Offset: Record<string, number>; withRequest: number; withPlain3: number }>();
  for (const e of entries) for (const r of e.ranges) {
    const v = variants.get(r.signature) ?? { pdfs: new Set(), pages: 0, ranges: 0, general: new Set(), special: new Set(), reqDominantX: {}, plain3Offset: {}, withRequest: 0, withPlain3: 0 };
    v.pdfs.add(e.localPath); (e.accountType === 'general' ? v.general : v.special).add(e.localPath); v.ranges++; v.pages += r.assignedPages; variants.set(r.signature, v);
  }
  for (const { p } of allPages) {
    if (!p.signature) continue;
    const v = variants.get(p.signature)!;
    if (p.requestDominantX !== null) inc(v.reqDominantX, p.requestDominantX.toFixed(1));
    if (p.lexical.request_like > 0) v.withRequest++;
    if (p.lexical.plain3 > 0) v.withPlain3++;
    if (p.requestDominantX !== null) for (const [x, n] of p.plain3X) inc(v.plain3Offset, (Math.round((x - p.requestDominantX) * 10) / 10).toFixed(1), n);
  }
  const variantRows = [...variants.entries()].sort((a, b) => b[1].pages - a[1].pages || cmp(a[0], b[0])).map(([signature, v]) => ({ signature, pdfs: v.pdfs.size, assignedPages: v.pages, ranges: v.ranges, general: v.general.size, special: v.special.size, pagesWithRequest: v.withRequest, pagesWithPlain3: v.withPlain3, requestDominantX: v.reqDominantX, plain3XMinusRequestX: v.plain3Offset }));

  // 既存 hierarchy 契約
  const contractRows = entries.filter(e => e.hierarchyContract).map(e => ({ localPath: e.localPath, ...e.hierarchyContract!, allContractEntries: A2_EXPERIMENTS.filter(x => x.canonicalUrl === docs.find(d => d.localPath === e.localPath)!.canonicalUrl).map(x => ({ id: x.id, set: x.set, view: x.view, pages: x.pages })) }));
  const contractAligned = contractRows.filter(c => c.startAligned && c.endAligned).length;

  // weak populations
  const entryOf = new Map(entries.map(e => [e.localPath, e]));
  const weakView = (p: string) => { const e = entryOf.get(p)!; return { localPath: p, publisherAuthority: e.publisherAuthority, accountType: e.accountType, layoutStatus: e.layoutStatus, evaluablePages: e.evaluablePages, assignedPages: e.assignedPages, signatures: [...new Set(e.ranges.map(r => r.signature))], ranges: e.ranges.length, requestLikeRows: e.lexicalTotals.request_like, plain3Rows: e.lexicalTotals.plain3 }; };
  const weakAView = weakA.map(weakView);
  const bCategory = (w: ReturnType<typeof weakView>) => (w.requestLikeRows === 0 ? (w.plain3Rows === 0 ? 'no_request_rows_no_plain3' : 'no_request_rows_plain3_present') : w.layoutStatus === 'single_layout_like' ? 'few_requests_single_layout' : 'few_requests_mixed_or_insufficient_layout');
  const weakBView = weakB.map(p => { const w = weakView(p); return { ...w, category: bCategory(w) }; });
  const weakBTally: Record<string, number> = {};
  for (const w of weakBView) inc(weakBTally, w.category);
  const weakASig: Record<string, number> = {};
  for (const w of weakAView) for (const s of w.signatures) inc(weakASig, s);
  const weakAOffset: Record<string, number> = {};
  for (const w of weakAView) for (const { p, doc } of allPages.filter(x => x.doc.localPath === w.localPath)) for (const [x, n] of p.plain3X) inc(weakAOffset, (Math.round((x - 55.2) * 10) / 10).toFixed(1), n);

  // 001630395.pdf
  const mlit = all.find(x => x.entry.localPath.endsWith('001630395.pdf'))!;
  const mlitPages = mlit.pages.map(p => ({ page: p.page, signature: p.signature, requestEvidence: p.requestEvidence, requestDominantX: p.requestDominantX, plain3X: p.plain3X, header: p.header, requestLike: p.lexical.request_like, plain3: p.lexical.plain3 }));

  // evidence coverage（hierarchy source 候補の観測 coverage。evaluable pages 基準）
  const ev = { evaluablePages: allPages.length, pagesWithHeaderGeometry: pageLevel.signatureAssigned, pagesWithRequestLikeRows: allPages.filter(x => x.p.lexical.request_like > 0).length, pagesWithPlain3Rows: allPages.filter(x => x.p.lexical.plain3 > 0).length, pagesWithRequestAndPlain3: allPages.filter(x => x.p.lexical.request_like > 0 && x.p.lexical.plain3 > 0).length, pagesRequestDominant: allPages.filter(x => x.p.requestEvidence === 'dominant').length, pagesRequestMultimodal: allPages.filter(x => x.p.requestEvidence === 'multimodal').length };

  // development 確認: development artifact が freeze 値と一致し、その PDF の range が full 実行の結果と一致（決定的）、001630395 が複数 range に分かれる
  const devBytes = fs.readFileSync(path.join(OUT, 'development-inventory.json'));
  const dev = JSON.parse(devBytes.toString('utf8')) as { documents: { localPath: string; ranges: unknown; pages: unknown[] }[] };
  const developmentOk = sha(devBytes) === DEVELOPMENT_SHA && dev.documents.every(dd => JSON.stringify(sortDeep(dd.ranges)) === JSON.stringify(sortDeep(entryOf.get(dd.localPath)!.ranges)) && dd.pages.length > 0) && (entryOf.get(contractPdfs.find(x => x.endsWith('001630395.pdf'))!)!.ranges.length >= 2);
  const facts = { developmentOk, evaluablePdfs: evaluable.length + entries.filter(e => e.coverage === 'insufficient_layout_evidence').length, unavailablePdfs: entries.filter(e => e.coverage.startsWith('unavailable')).length, pagesRequestMultimodal: ev.pagesRequestMultimodal, pagesRequestDominant: ev.pagesRequestDominant, contractPdfs: contractRows.length, contractAligned };
  const byAccount: Record<string, Record<string, number>> = {};
  for (const e of entries) { (byAccount[e.accountType] ??= {}); inc(byAccount[e.accountType], e.coverage); if (e.layoutStatus) inc(byAccount[e.accountType], e.layoutStatus); }
  const byPublisher: Record<string, Record<string, number>> = {};
  for (const e of entries) { (byPublisher[e.publisherAuthority] ??= {}); inc(byPublisher[e.publisherAuthority], e.coverage); if (e.layoutStatus) inc(byPublisher[e.publisherAuthority], e.layoutStatus); }
  const summary = sortDeep({
    schema: 'budget-request-layout-inventory-summary/v0', frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, sha(fs.readFileSync(p))])), protocol: { signatureQuantum: SIGNATURE_QUANTUM, dominanceTolerance: DOMINANCE_TOLERANCE } },
    coverage, pdfLevel, pageLevel, rangesPerPdfDistribution: rangesPerPdf, headerSignatureRequestXClusters: headerClusters, mixedPdfs: mixed.length, variantCount: variants.size, variants: variantRows, byAccount, byPublisher,
    mixedLayoutPdfs: mixed.map(e => ({ localPath: e.localPath, accountType: e.accountType, ranges: e.ranges.map(r => ({ from: r.from, to: r.to, signature: r.signature, assignedPages: r.assignedPages })), transitions: e.transitions })),
    hierarchyContractInventory: contractRows, evidenceCoverage: ev,
    weakPopulations: { requestX55_22: { pdfs: weakAView.length, signatures: weakASig, plain3XMinus55_2: weakAOffset, perPdf: weakAView }, noReferenceX: { pdfs: weakBView.length, categories: weakBTally, perPdf: weakBView } },
    mlit001630395: { entry: mlit.entry.ranges, transitions: mlit.entry.transitions, pages: mlitPages },
    decisionFacts: facts, decision: decideLayout(facts),
    perPdf: entries,
  });
  const pageText = JSON.stringify(sortDeep({ schema: 'budget-request-layout-page-inventory/v0', note: '行 = PDF の評価可能 page。x は 0.1pt 単位の histogram（[x, 行数]）', pdfs: all.filter(x => x.pages.length).map(x => ({ localPath: x.entry.localPath, pages: x.pages })) }));
  const text = `${JSON.stringify(summary, null, 1)}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'layout-summary.json'), text);
  fs.writeFileSync(path.join(OUT, 'layout-page-inventory.json'), `${pageText}\n`);
  console.log(JSON.stringify({ summarySha: sha(text), pageSha: sha(`${pageText}\n`), coverage, pdfLevel, pageLevel, rangesPerPdf, variants: variants.size, headerClusters, contract: contractRows.map(c => [c.id, c.pages, c.startAligned, c.endAligned, c.rangesInside]), weakBTally, weakASig, facts, decision: (summary as { decision: unknown }).decision }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
