/**
 * PR-2 Phase A: EXTRACTED 文書内の EMPTY page（PR-1 frozen）の failure isolation。観測の inventory と決定的な集計だけを行う。
 * page type は分類しない。OCR / Route C は使わない。frozen fixture・data/download は変更しない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/run-budget-request-empty-page-failure-isolation.ts [--render-dir=<dir>]
 * 出力: data/work/budget-request-empty-page-failure-isolation/machine-observation.json（git 管理外）
 *       tests/fixtures/budget-request-page-classification/2024/empty-page-failure-isolation.json（--freeze-fixture のときだけ）
 *   --render-dir を指定すると各対象 page の低解像度 PNG を書く（目視確認用。git 管理外に置くこと）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { sha256Hex } from './lib/budget-request-raw-text';

const FIXTURE = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const OUT = path.join('data', 'work', 'budget-request-empty-page-failure-isolation', 'machine-observation.json');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const renderDir = process.argv.find(a => a.startsWith('--render-dir='))?.slice(13);
const DPI = 50;
const FIXTURE_OUT = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'empty-page-failure-isolation.json');
const FREEZE = process.argv.includes('--freeze-fixture');
const SCHEMA = 'budget-request-empty-page-failure-isolation/v0';
/** 作業者が render 画像を目視した page（目視は page type の判断ではなく、見た目の state の記録だけ） */
const EYE_VIEWED: Record<string, { status: 'VISUALLY_BLANK' | 'VISIBLE_CONTENT'; note: string }> = {
  'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf#1044': { status: 'VISIBLE_CONTENT', note: '表罫線・見出し・数値様の文字・黒塗り矩形を含む page 全面の画像。text layer は無い' },
  'data/download/moj.go.jp/content/001402819.pdf#2': { status: 'VISUALLY_BLANK', note: '何も描画されていない' },
  'data/download/caa.go.jp/policies/budget/assets/cms_caa205_230914_02.pdf#2': { status: 'VISUALLY_BLANK', note: '何も描画されていない（content stream に text/image op なし）' },
  'data/download/courts.go.jp/vc-files/courts/2023/R06saisyutsu_gaisanyoukyusyo_720kb.pdf#112': { status: 'VISUALLY_BLANK', note: '何も描画されていない（content stream に op なし）' },
};
interface PageRec { localPdfPath: string; physicalPage: number; machineObservation: Obs; context: { emptyRunLength: number; positionInDocument: string; [k: string]: unknown }; [k: string]: unknown }
type Cat = 'VISUALLY_BLANK' | 'RASTER_OR_IMAGE_DOMINANT' | 'UNRESOLVED';
interface Obs { showTextOps: number; imageOps: number; pathOps: number; pdfjsTextNonWhitespaceChars: number; pdffontsFontsOnPage: number; render: { nonWhitePixels: number; nonWhiteRatio: number; [k: string]: unknown }; [k: string]: unknown }
/** machine 観測だけから決まる deterministic rule。原因は断定しない */
function categoryOf(o: Obs): Cat {
  if (o.render.nonWhitePixels === 0) return 'VISUALLY_BLANK'; // 50dpi の gray render が全画素 255（整数画素数で判定。表示用 ratio は丸め値で判定に使わない）
  if (o.imageOps > 0 && o.showTextOps === 0 && o.pdffontsFontsOnPage === 0 && o.pdfjsTextNonWhitespaceChars === 0) return 'RASTER_OR_IMAGE_DOMINANT';
  return 'UNRESOLVED';
}

interface Doc { logicalDocumentIndex: number; localPdfPath: string; pdfSha256: string; pageCount: number; status: string; emptyPages: number[]; pageTextSha256: string[] }

/** pdftoppm の PGM 出力から non-white 画素率を測る。文字の復元には使わない */
function pixelStats(pdf: string, page: number): { width: number; height: number; nonWhitePixels: number; nonWhiteRatio: number; darkRatio: number } {
  const buf = execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(DPI), '-gray', '-singlefile', pdf], { maxBuffer: 1 << 28 });
  // P5\n<w> <h>\n255\n<data>
  let pos = 0; const tok: string[] = [];
  while (tok.length < 4) { while (/\s/.test(String.fromCharCode(buf[pos]))) pos++; let s = ''; while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]); tok.push(s); }
  pos++;
  const [, w, h] = tok; const data = buf.subarray(pos);
  let nw = 0, dark = 0;
  for (const v of data) { if (v < 255) nw++; if (v < 128) dark++; }
  return { width: Number(w), height: Number(h), nonWhitePixels: nw, nonWhiteRatio: nw / data.length, darkRatio: dark / data.length };
}

async function main() {
  const m = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: Doc[] };
  if (m.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('frozen corpus digest mismatch');
  const rawDocs = m.documents;
  const docs = m.documents.filter(d => d.status === 'EXTRACTED' && d.emptyPages.length > 0);
  const targets = docs.flatMap(d => d.emptyPages.map(p => ({ d, p })));
  if (targets.length !== 117) throw new Error(`target population ${targets.length} != 117`);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  const root = path.join('node_modules', 'pdfjs-dist');
  const group = (names: string[]) => new Set(names.map(n => OPS[n]).filter(x => x !== undefined));
  const TEXT = group(['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText']);
  const IMAGE = group(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintImageMaskXObjectGroup', 'paintSolidColorImageMask']);
  const PATH = group(['constructPath', 'stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']);
  const FORM = group(['paintFormXObjectBegin']);

  let hashMismatch = 0;
  const pages: PageRec[] = [];
  for (const d of docs) {
    const bytes = fs.readFileSync(d.localPdfPath);
    if (sha256Hex(bytes) !== d.pdfSha256) { hashMismatch++; continue; }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const imgList = execFileSync('pdfimages', ['-list', d.localPdfPath], { encoding: 'utf8' }).split('\n').slice(2).map(l => l.trim().split(/\s+/)).filter(a => a.length > 3);
    const emptyRuns = new Set(d.emptyPages);
    for (const p of d.emptyPages) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const ol = await page.getOperatorList();
      const count = (s: Set<number>) => ol.fnArray.filter(f => s.has(f)).length;
      const tc = await page.getTextContent();
      const textItems = tc.items.filter(i => 'str' in i) as { str: string }[];
      const annots = await page.getAnnotations();
      const ft = execFileSync('pdffonts', ['-f', String(p), '-l', String(p), d.localPdfPath], { encoding: 'utf8' }).split('\n').slice(2).filter(l => l.trim()).length;
      const ps = pixelStats(d.localPdfPath, p);
      if (renderDir) {
        fs.mkdirSync(renderDir, { recursive: true });
        const slug = d.localPdfPath.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
        execFileSync('pdftoppm', ['-f', String(p), '-l', String(p), '-r', '60', '-png', '-singlefile', d.localPdfPath, path.join(renderDir, `${slug}__p${String(p).padStart(4, '0')}`)]);
      }
      let run = 1; for (let q = p - 1; emptyRuns.has(q); q--) run++; for (let q = p + 1; emptyRuns.has(q); q++) run++;
      const st = (q: number) => (q < 1 || q > d.pageCount ? null : emptyRuns.has(q) ? 'EMPTY' : 'EXTRACTED');
      pages.push({
        localPdfPath: d.localPdfPath, pdfSha256: d.pdfSha256, physicalPage: p, pageCount: d.pageCount, textSha256: d.pageTextSha256[p - 1], rawTextStatus: 'EMPTY',
        machineObservation: {
          widthPt: Math.round(vp.width * 100) / 100, heightPt: Math.round(vp.height * 100) / 100, rotate: page.rotate,
          showTextOps: count(TEXT), imageOps: count(IMAGE), pathOps: count(PATH), formXObjectOps: count(FORM), totalOps: ol.fnArray.length,
          pdfjsTextItems: textItems.length, pdfjsTextNonWhitespaceChars: textItems.reduce((n, i) => n + i.str.replace(/\s/g, '').length, 0),
          annotations: annots.length, pdffontsFontsOnPage: ft,
          pdfimagesOnPage: imgList.filter(a => Number(a[0]) === p).length,
          render: { dpi: DPI, widthPx: ps.width, heightPx: ps.height, nonWhitePixels: ps.nonWhitePixels, nonWhiteRatio: Math.round(ps.nonWhiteRatio * 1e5) / 1e5, darkRatio: Math.round(ps.darkRatio * 1e5) / 1e5 },
        },
        context: { previousPageRawTextStatus: st(p - 1), nextPageRawTextStatus: st(p + 1), emptyRunLength: run, positionInDocument: p === 1 ? 'first' : p === d.pageCount ? 'last' : 'middle' },
      });
    }
    await doc.destroy();
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ pdfjsVersion: (pdfjs as unknown as { version: string }).version, hashMismatch, pages }, null, 1)}\n`);
  const out = pages.map(pg => {
    const o = pg.machineObservation;
    const cat = categoryOf(o);
    const eye = EYE_VIEWED[`${pg.localPdfPath}#${pg.physicalPage}`];
    return {
      ...pg,
      visualObservation: eye
        ? { status: eye.status, method: 'eye-viewed render (60dpi png) + pixel stats', note: eye.note }
        : { status: o.render.nonWhitePixels === 0 ? 'VISUALLY_BLANK' : 'UNRESOLVED', method: 'pixel stats only（目視していない）', note: o.render.nonWhitePixels === 0 ? '50dpi render が全画素白' : '' },
      isolationCategory: cat,
      causeStatus: cat === 'UNRESOLVED' ? 'UNRESOLVED' : 'EVIDENCED',
    };
  });
  const tally = (f: (p: (typeof out)[number]) => string) => Object.fromEntries([...out.reduce((m2, p) => m2.set(f(p), (m2.get(f(p)) ?? 0) + 1), new Map<string, number>())].sort());
  const perPdf = tally(p => String(p.localPdfPath));
  const perPdfSet = new Set(Object.keys(perPdf));
  const result = {
    schema: SCHEMA,
    scope: 'EXTRACTED 文書内の EMPTY page の failure isolation。page type は分類しない。OCR・Route C 不使用',
    generator: 'scripts/pipeline-v2/run-budget-request-empty-page-failure-isolation.ts',
    frozenInput: { rawTextCorpusDigestSha256: FROZEN_DIGEST, targetPages: out.length, rawTextManifest: FIXTURE },
    tools: { pdfjs: (pdfjs as unknown as { version: string }).version, render: 'pdftoppm -r 50 -gray（poppler）', others: ['pdfimages -list', 'pdffonts'] },
    categoryRule: "VISUALLY_BLANK: 50dpi gray render が全画素 255 / RASTER_OR_IMAGE_DOMINANT: image op > 0 かつ showText op・font・pdfjs text 文字が 0 / それ以外 UNRESOLVED",
    summary: {
      physicalPdfs: Object.keys(perPdf).length,
      logicalDocuments: new Set(rawDocs.filter(d => perPdfSet.has(d.localPdfPath)).map(d => d.logicalDocumentIndex)).size,
      hashMismatch,
      byCategory: tally(p => p.isolationCategory),
      byCause: tally(p => p.causeStatus),
      byRunLength: tally(p => String(p.context.emptyRunLength)),
      byPosition: tally(p => p.context.positionInDocument),
      byPhysicalPageParity: tally(p => p.physicalPage % 2 === 0 ? 'even' : 'odd'),
      byMachineSignature: tally(p => { const o = p.machineObservation; return `showTextOps=${o.showTextOps},imageOps=${o.imageOps},pathOps=${o.pathOps},pdfjsTextChars=${o.pdfjsTextNonWhitespaceChars}`; }),
      eyeViewedPages: out.filter(p => (p.visualObservation.method as string).startsWith('eye')).length,
      unresolved: out.filter(p => p.isolationCategory === 'UNRESOLVED').length,
      perPdfEmptyPages: perPdf,
    },
    pages: out,
  };
  if (FREEZE) {
    fs.mkdirSync(path.dirname(FIXTURE_OUT), { recursive: true });
    fs.writeFileSync(FIXTURE_OUT, `${JSON.stringify(result, null, 1)}\n`);
  }
  console.log(JSON.stringify({ ...result.summary, perPdfEmptyPages: undefined, pages: undefined }, null, 1));
}
main();
