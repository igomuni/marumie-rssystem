/**
 * Phase A: page header / first title line の source-only label projection（事前登録 Page_Header_Label_Segment_Protocol）。
 * manual range・existing kind・MOF・layout を使わない。全 82 PDF の全 page を対象にし、rotate≠0 の page は unavailable_rotate90、例外は other_unavailable（補完・bridge しない）。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/project-budget-request-header-labels.ts
 * 出力: tests/fixtures/budget-request-header-label/2024/{header-label-projection,header-label-summary}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { segmentize, titleOfPage, type PageProjection, type PageTitle } from './lib/budget-request-header-label';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-header-label', '2024');
const MANIFEST = `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`;
const PROTOCOL = 'docs/tasks/20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md';
const FROZEN: Record<string, string> = { [MANIFEST]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [PROTOCOL]: 'fed6229169503ce7b1e167bba09a0dab35d67d72b1960cdc703386a1c55a5493' };
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface Doc { localPath: string; canonicalUrl: string; publisherAuthority: string; accountType: string; sha256: string; pages: number }

async function projectPdf(d: Doc): Promise<PageProjection[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const unavailable = (status: PageTitle['status']): PageTitle => ({ status, blankReason: null, firstTitleRaw: null, firstTitleNormalized: null, shape: null, sourceRefs: null });
  if (!fs.existsSync(d.localPath) || fileSha(d.localPath) !== d.sha256) return Array.from({ length: d.pages }, (_, i) => ({ page: i + 1, title: unavailable('unavailable_upstream') }));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  const out: PageProjection[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n);
        if (page.rotate !== 0) { out.push({ page: n, title: unavailable('unavailable_rotate90') }); page.cleanup(); continue; }
        const content = await page.getTextContent({ disableNormalization: true });
        const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
        const items = content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[];
        const tokens = toSourceTokens(items, meta, content.styles as unknown as RawTextStyles);
        const geom = buildTableGeometry(tokens, meta);
        const lr = resolveLogicalRows(tokens, meta, geom);
        const rows = lr.logicalRowCandidates.map(r => {
          const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== '');
          return { logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index), texts: toks.map(t => t.rawText.trim()) };
        });
        out.push({ page: n, title: titleOfPage(rows) });
        page.cleanup();
      } catch { out.push({ page: n, title: unavailable('other_unavailable') }); }
    }
  } finally { await doc.destroy(); }
  return out;
}

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { corpus: { pdfs: number; totalPages: number }; documents: Doc[] };
  if (manifest.corpus.pdfs !== 82 || manifest.corpus.totalPages !== 9899) throw new Error('corpus が 82 PDF / 9,899 page でない（STOP）');
  const docs = [...manifest.documents].sort((a, b) => cmp(a.localPath, b.localPath));
  const pdfs: Record<string, unknown>[] = [];
  const agg = { pdfs: docs.length, pages: 0, status: {} as Record<string, number>, blankReason: {} as Record<string, number>, rawLabels: new Set<string>(), normLabels: new Set<string>(), shapes: {} as Record<string, number>, parenthesized: 0, segments: 0, transitions: 0, nonContiguousReappear: 0, blankBetweenTransitions: 0, page1HasLabel: 0 };
  const perPdfStats: Record<string, unknown>[] = [];
  const segLen: Record<string, number> = {};
  for (const [i, d] of docs.entries()) {
    const projection = await projectPdf(d);
    const segs = segmentize(projection);
    const group = hierarchyContractFor(d.canonicalUrl) ? 'discovery' : 'non_discovery';
    const st: Record<string, number> = {};
    const labels = new Set<string>();
    for (const p of projection) { inc(st, p.title.status); inc(agg.status, p.title.status); agg.pages++; if (p.title.blankReason) inc(agg.blankReason, p.title.blankReason); if (p.title.status === 'observed_nonblank') { agg.rawLabels.add(p.title.firstTitleRaw as string); agg.normLabels.add(p.title.firstTitleNormalized as string); labels.add(p.title.firstTitleNormalized as string); const sh = p.title.shape!; inc(agg.shapes, sh.parenthesized ? `prefix(inner) prefix${sh.prefixLength} inner${sh.innerLength}` : 'other'); if (sh.parenthesized) agg.parenthesized++; } }
    const labelSegs = segs.filter(s => s.kind === 'label');
    const seen = new Map<string, number>();
    let reappear = 0;
    for (const s of labelSegs) { if (seen.has(s.state)) reappear++; seen.set(s.state, (seen.get(s.state) ?? 0) + 1); inc(segLen, s.pages >= 10 ? '10+' : String(s.pages)); }
    let trans = 0, blankBetween = 0;
    for (let k = 1; k < segs.length; k++) { if (segs[k - 1].kind === 'label' && segs[k].kind === 'label') trans++; }
    for (let k = 1; k + 1 < segs.length; k++) if (segs[k].kind !== 'label' && segs[k - 1].kind === 'label' && segs[k + 1].kind === 'label' && segs[k - 1].state !== segs[k + 1].state) blankBetween++;
    agg.segments += labelSegs.length; agg.transitions += trans; agg.nonContiguousReappear += reappear; agg.blankBetweenTransitions += blankBetween;
    if (projection[0]?.title.status === 'observed_nonblank') agg.page1HasLabel++;
    perPdfStats.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, group, pages: d.pages, status: st, uniqueLabels: labels.size, labelSegments: labelSegs.length, directLabelTransitions: trans, blankBetweenDifferentLabels: blankBetween, nonContiguousReappear: reappear, page1HasLabel: projection[0]?.title.status === 'observed_nonblank' });
    pdfs.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, group, pages: d.pages, segments: segs, projection: projection.map(p => ({ p: p.page, s: p.title.status, br: p.title.blankReason, raw: p.title.firstTitleRaw, n: p.title.firstTitleNormalized, sh: p.title.shape ? [p.title.shape.length, p.title.shape.parenthesized ? 1 : 0, p.title.shape.prefixLength, p.title.shape.innerLength] : null, ref: p.title.sourceRefs ? [p.title.sourceRefs.logicalRowIndex, ...p.title.sourceRefs.tokenIndexes] : null })) });
    console.log(`${i + 1}/${docs.length} ${path.basename(d.localPath)} ${JSON.stringify(st)} segs=${labelSegs.length}`);
  }
  const evaluable = agg.pages - (agg.status.unavailable_rotate90 ?? 0) - (agg.status.unavailable_upstream ?? 0) - (agg.status.other_unavailable ?? 0);
  const summary = sortDeep({
    schema: 'budget-request-header-label-summary/v0', frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) },
    coverage: { pdfs: agg.pdfs, pages: agg.pages, evaluablePages: evaluable, byStatus: agg.status, blankReason: agg.blankReason },
    vocabulary: { distinctRawLabels: agg.rawLabels.size, distinctNormalizedLabels: agg.normLabels.size, lexicalShapes: agg.shapes, parenthesizedPages: agg.parenthesized },
    segments: { labelSegments: agg.segments, directLabelTransitions: agg.transitions, nonContiguousReappearances: agg.nonContiguousReappear, blankBetweenDifferentLabels: agg.blankBetweenTransitions, lengthDistribution: segLen, pdfsWithLabelOnPage1: agg.page1HasLabel },
    perPdf: perPdfStats,
  });
  const projText = `${JSON.stringify(sortDeep({ schema: 'budget-request-header-label-projection/v0', note: 'source-only。manual range・existing kind・MOF・layout は未使用。raw は first title line の token 連結。n は NFKC + 空白・数字除去。segments は blank / unavailable を bridge しない', pdfs }))}\n`;
  const sumText = `${JSON.stringify(summary, null, 1)}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'header-label-projection.json'), projText);
  fs.writeFileSync(path.join(OUT, 'header-label-summary.json'), sumText);
  console.log(JSON.stringify({ projectionSha: sha(projText), summarySha: sha(sumText), coverage: (summary as { coverage: unknown }).coverage, vocabulary: (summary as { vocabulary: unknown }).vocabulary, segments: (summary as { segments: unknown }).segments }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
