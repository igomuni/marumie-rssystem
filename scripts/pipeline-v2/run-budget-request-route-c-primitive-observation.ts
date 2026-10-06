/**
 * Route C preregistration 用の representation observation（文字復元アルゴリズムは試さない）。法務省 / 金融庁の drawing-path 型 PDF について、
 * path 数・operator 種類・rotate・bbox・drawing command の特徴・font / text object の有無・marked content の有無などだけを記録する。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-route-c-primitive-observation.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';

const OUT = 'tests/fixtures/budget-request-route-c-drawing-path/2024';
const PDFS = [
  { id: 'moj', path: 'data/download/moj.go.jp/content/001402818.pdf', gtPages: [3, 4], sha256: 'bd5ce9c5dee48b03407e9a8d4050f3992c8a515f510c0339364316448dd9cf8c' },
  { id: 'fsa', path: 'data/download/fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf', gtPages: [2], sha256: '9803cfd8e2f33592ae01612cce6e570e56208f1a758027b09d69055cff91cb9b' },
];
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const O = pdfjs.OPS as unknown as Record<string, number>;
  const opName = new Map(Object.entries(O).map(([k, v]) => [v, k]));
  const root = 'node_modules/pdfjs-dist';
  const out: unknown[] = [];
  for (const p of PDFS) {
    if (sha(fs.readFileSync(p.path)) !== p.sha256) throw new Error(`原本の hash 不一致（STOP）: ${p.path}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(p.path)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const outline = await doc.getOutline().catch(() => null);
    const attachments = await doc.getAttachments().catch(() => null);
    const labels = await doc.getPageLabels().catch(() => null);
    const rot: Record<string, number> = {}, opUnion = new Set<string>(), pathCounts: number[] = [];
    let textItemsTotal = 0, annotationsTotal = 0, markedContentOps = 0, actualTextProps = 0, imageOps = 0, showTextOps = 0, setFontOps = 0;
    const perGt: Record<string, unknown> = {};
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      rot[pg.rotate] = (rot[pg.rotate] ?? 0) + 1;
      const tc = await pg.getTextContent({ disableNormalization: true });
      textItemsTotal += tc.items.filter((i: unknown) => typeof i === 'object' && i !== null && 'str' in (i as object)).length;
      annotationsTotal += (await pg.getAnnotations()).length;
      const ol = await pg.getOperatorList();
      let paths = 0; const hist: Record<string, number> = {};
      for (let k = 0; k < ol.fnArray.length; k++) {
        const nm = opName.get(ol.fnArray[k]) ?? String(ol.fnArray[k]);
        hist[nm] = (hist[nm] ?? 0) + 1; opUnion.add(nm);
        if (nm === 'constructPath') paths++;
        if (nm === 'beginMarkedContent' || nm === 'beginMarkedContentProps') { markedContentOps++; if (JSON.stringify(ol.argsArray[k] ?? '').includes('ActualText')) actualTextProps++; }
        if (nm.startsWith('paintImage') || nm === 'paintInlineImageXObject') imageOps++;
        if (nm === 'showText' || nm === 'showSpacedText') showTextOps++;
        if (nm === 'setFont') setFontOps++;
      }
      pathCounts.push(paths);
      if (p.gtPages.includes(n)) {
        // fill path の bbox（constructPath の minMax = args[2]）と、形状 signature（平行移動を除いた path data の丸め）の重複度
        const bbs: number[][] = [], sigs = new Map<string, number>(); let fills = 0, strokes = 0;
        for (let k = 0; k < ol.fnArray.length; k++) {
          if ((opName.get(ol.fnArray[k]) ?? '') !== 'constructPath') continue;
          const [paintOp, pathArgs, minMax] = ol.argsArray[k] as [number, ArrayLike<number>[], ArrayLike<number>];
          const pn = opName.get(paintOp) ?? String(paintOp);
          if (pn === 'fill' || pn === 'eoFill') fills++; else if (pn === 'stroke') strokes++;
          const data = Array.from(pathArgs[0] ?? []);
          if (minMax && minMax.length >= 4) bbs.push([minMax[0], minMax[1], minMax[2], minMax[3]]);
          const x0 = minMax ? minMax[0] : 0, y0 = minMax ? minMax[1] : 0;
          const sig = data.length > 0 ? data.map((v, i) => (i % 3 === 0 ? v : Math.round((v - (i % 3 === 1 ? x0 : y0)) * 100) / 100)).join(',') : 'empty';
          sigs.set(sig, (sigs.get(sig) ?? 0) + 1);
        }
        const hs = bbs.map(b => b[3] - b[1]).filter(h => h > 0);
        perGt[String(n)] = { operatorHistogram: hist, constructPath: paths, fillPaths: fills, strokePaths: strokes, distinctShapeSignatures: sigs.size, shapeSignatureRepeatMax: Math.max(0, ...sigs.values()), pathsWithBBox: bbs.length, bboxHeightMedian: Math.round(median(hs) * 100) / 100, bboxUnion: bbs.length ? [Math.min(...bbs.map(b => b[0])), Math.min(...bbs.map(b => b[1])), Math.max(...bbs.map(b => b[2])), Math.max(...bbs.map(b => b[3]))] : null, viewport: pg.view, rotate: pg.rotate, textItems: tc.items.filter((i: unknown) => typeof i === 'object' && i !== null && 'str' in (i as object)).length };
      }
      pg.cleanup();
    }
    await doc.destroy();
    out.push({ id: p.id, path: p.path, sha256: p.sha256, pages: doc.numPages, rotation: rot, producer: info.Producer ?? null, creator: info.Creator ?? null, pdfFormatVersion: info.PDFFormatVersion ?? null, hasOutline: !!outline && outline.length > 0, outlineEntries: outline ? outline.length : 0, attachments: attachments ? Object.keys(attachments).length : 0, hasPageLabels: !!labels,
      totals: { textItems: textItemsTotal, annotations: annotationsTotal, markedContentOps, markedContentActualText: actualTextProps, imageOps, showTextOps, setFontOps }, operatorTypesUnion: [...opUnion].sort(),
      constructPathPerPage: { min: Math.min(...pathCounts), median: median(pathCounts), max: Math.max(...pathCounts), pagesWithZeroPaths: pathCounts.filter(c => c === 0).length }, gtPages: perGt });
    console.log(p.id, doc.numPages);
  }
  const text = `${JSON.stringify(sortDeep({ schema: 'budget-request-route-c-primitive-observation/v0', note: 'representation observation のみ。文字復元アルゴリズムは未試行', pdfs: out }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/primitive-observation.json`, text);
  console.log(sha(text));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
