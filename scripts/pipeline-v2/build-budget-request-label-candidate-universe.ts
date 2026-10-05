/**
 * Phase A: frozen label-shaped predicate の candidate universe（primary evaluable 9,145 page の全 candidate row）と F1〜F5 の feature を列挙する（事前登録 Label_Shaped_Predicate_Ambiguity_Protocol）。
 * predicate・alternative projection rule・normalization は変更せず再利用する。manual contract・MOF・existing ON kind・組織名辞書は使わない。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/build-budget-request-label-candidate-universe.ts
 * 出力: tests/fixtures/budget-request-label-candidate/2024/candidate-universe.json.gz（gzip level 9。内容の sha256 を結果に記録）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { classifyRow } from './lib/budget-request-header-label';
import { charCounts, countBin, deltaBin, populationOf, relativePosition, stageShapes, stepBin, type FeatureTable } from './lib/budget-request-label-candidate';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { leftmostThinAnchor, longRules, mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { titleOfPageAlt, type AltRow } from './lib/budget-request-alt-title-projection';
import { evidenceOf } from './lib/budget-request-title-ordering';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-label-candidate', '2024');
const ALT = `${FX}/budget-request-alt-title-projection/2024`;
const P = {
  manifest: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`, alt: `${ALT}/alt-title-projection.json`, primary: `${ALT}/primary-evaluation.json`, segment: `${ALT}/segment-structural-evaluation.json`, population: `${ALT}/population-manifest.json`,
  ordering: 'scripts/pipeline-v2/lib/budget-request-title-ordering.ts', header: 'scripts/pipeline-v2/lib/budget-request-header-label.ts', altLib: 'scripts/pipeline-v2/lib/budget-request-alt-title-projection.ts',
  protocol: 'docs/tasks/20261005_1200_Budget_Request_Label_Shaped_Predicate_Ambiguity_Protocol.md', anchor: 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts',
};
const FROZEN: Record<string, string> = {
  [P.manifest]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.alt]: 'cc071c770fb51a3bf6500a1a01937bbc427283865e3143552ebd7cc5b988c6cd', [P.primary]: '79e5a63ad474fbc0fdf497d59734072a97f1bfa58711346d53aadae75a6cff06',
  [P.segment]: '3eccc9ea6155d13290dd7dc3f25048ca00304eea1d7fed3115c4541323a7a005', [P.population]: 'ffac4a9d68c7fc4a2cd7883ecb89ed2c5f6009026dcc2fd2d24b6792d981c38d',
  [P.ordering]: 'e4b80f242bee6fd864e772a338a636d887246638ac7937084da90a8d4fa4ddc2', [P.header]: '16a2f720a726774f74a0a3b3123ad39dbf8d85112503d8fb095620a945e70721', [P.altLib]: '17cb97efb9861bb2b14f6103f1ebf640e23cc322d66417c6fa0a91bff9f6dbf4',
  [P.protocol]: '0d1e4bc8a6c0976e3903522c152a2ce32dfe76952acba3f67424917d1cd800cd',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const r1 = (x: number) => Math.round(x * 10) / 10;
interface Doc { localPath: string; sha256: string; pages: number; accountType: string }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const docs = [...(JSON.parse(fs.readFileSync(P.manifest, 'utf8')) as { documents: Doc[] }).documents].sort((a, b) => cmp(a.localPath, b.localPath));
  const candidates: Record<string, unknown>[] = [];
  const pagesOut: Record<string, unknown>[] = [];
  let evaluablePages = 0, ambiguousPages = 0;
  for (const [di, d] of docs.entries()) {
    if (!fs.existsSync(d.localPath) || fileSha(d.localPath) !== d.sha256) throw new Error(`PDF の hash 不一致（STOP）: ${d.localPath}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (page.rotate !== 0) { page.cleanup(); continue; }
        evaluablePages++;
        const content = await page.getTextContent({ disableNormalization: true });
        const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
        const tokens = toSourceTokens(content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[], meta, content.styles as unknown as RawTextStyles);
        const lr = resolveLogicalRows(tokens, meta, buildTableGeometry(tokens, meta));
        const rows = lr.logicalRowCandidates.map(r => { const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== ''); return { r, toks, alt: { logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index), texts: toks.map(t => t.rawText.trim()), x: Math.round((toks[0]?.bbox.xMin ?? 0) * 10) / 10, y: Math.round(r.bbox.yMin * 10) / 10 } as AltRow }; });
        const alt = titleOfPageAlt(rows.map(x => x.alt), meta.height);
        const evs = rows.map(x => evidenceOf({ index: x.alt.logicalRowIndex, x: x.alt.x, y: x.alt.y, texts: x.alt.texts, physicalRowIndexes: x.alt.physicalRowIndexes, tokenIndexes: x.alt.tokenIndexes }, meta.height));
        const labelIdx = evs.map((e, i) => (e.labelShaped ? i : -1)).filter(i => i >= 0);
        const fcPos = rows.findIndex(x => classifyRow(x.alt.texts) !== 'other');
        const firstCodeIndex = fcPos < 0 ? null : rows[fcPos].alt.logicalRowIndex;
        const pageAmbiguous = alt.basis === 'label_on_first_code_row' && alt.otherLabelRowsDifferingFromProjected > 0;
        if (pageAmbiguous) ambiguousPages++;
        const projectedIndex = alt.title.sourceRefs?.logicalRowIndex ?? null;
        pagesOut.push({ localPath: d.localPath, page: n, currentStatus: alt.basis === 'before_first_code_row' ? 'observed_nonblank' : 'observed_blank', altStatus: alt.title.status, basis: alt.basis, firstCodeRowIndex: firstCodeIndex, candidateCount: labelIdx.length, pageAmbiguous, rowCount: rows.length });
        if (labelIdx.length === 0) { page.cleanup(); continue; }
        // thin anchor（freeze 済み primitive。selection には使わない）
        const ol = await page.getOperatorList();
        const anchor = leftmostThinAnchor(longRules(mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])), meta.height));
        const anchorX = anchor.status === 'unique' ? anchor.x : null;
        const nb = (i: number, k: number) => { const j = i + k; if (j < 0 || j >= rows.length) return null; const x = rows[j]; return { i: x.alt.logicalRowIndex, code: /^\d{3}$/.test(x.alt.texts[0] ?? ''), request: classifyRow(x.alt.texts) === 'request', label: evs[j].labelShaped, x: x.alt.x, y: x.alt.y, tokens: x.alt.texts.length, raw: x.alt.texts.join(' ').slice(0, 60) }; };
        for (const i of labelIdx) {
          const x = rows[i], e = evs[i];
          const idx = x.alt.logicalRowIndex;
          const pos = relativePosition(idx, firstCodeIndex);
          const isProjected = projectedIndex === idx;
          const pop = populationOf(isProjected, alt.basis === 'label_on_first_code_row', pos, pageAmbiguous, e.normalized !== (alt.title.firstTitleNormalized ?? ''));
          const raw = e.raw, shapes = stageShapes(raw);
          const cr = charCounts(raw), cn = charCounts(e.normalized);
          const first = x.toks[0], last = x.toks[x.toks.length - 1];
          const selfCode = /^\d{3}$/.test(x.alt.texts[0] ?? ''), selfReq = classifyRow(x.alt.texts) === 'request';
          const prevCode = rows.slice(0, i).some(y => /^\d{3}$/.test(y.alt.texts[0] ?? '')), prevReq = rows.slice(0, i).some(y => classifyRow(y.alt.texts) === 'request');
          const top = x.r.bbox.yMin / meta.height;
          const neighbors = { m2: nb(i, -2), m1: nb(i, -1), p1: nb(i, 1), p2: nb(i, 2) };
          const nbf = (k: 'm2' | 'm1' | 'p1' | 'p2') => { const v = neighbors[k]; return v ? { code: String(v.code), request: String(v.request), label: String(v.label) } : { code: 'none', request: 'none', label: 'none' }; };
          const rowLocal: Record<string, string> = {
            selfCodeShaped: String(selfCode), selfRequestShaped: String(selfReq),
            topBin: stepBin(top, 0.02).slice(0, 5), minXBin: stepBin(x.r.bbox.xMin, 10), maxXBin: stepBin(x.r.bbox.xMax, 10), widthBin: stepBin(x.r.bbox.xMax - x.r.bbox.xMin, 20), heightBin: stepBin(x.r.bbox.yMax - x.r.bbox.yMin, 2), tokenCountBin: countBin(x.toks.length),
            firstTokenXBin: stepBin(first?.bbox.xMin ?? 0, 10), lastTokenXBin: stepBin(last?.bbox.xMin ?? 0, 10), anchorAvailable: String(anchorX !== null), firstTokenOffsetFromAnchorBin: anchorX === null ? 'not_available' : stepBin((first?.bbox.xMin ?? 0) - anchorX, 10),
            stageShapeRaw: String(shapes.raw), stageShapeNfkc: String(shapes.nfkc), stageShapeNoWhitespace: String(shapes.noWhitespace), stageShapeFinal: String(shapes.final), firstShapeStage: shapes.firstShapeStage, digitRemovalDependent: String(shapes.digitRemovalDependent),
          };
          for (const [k, v] of Object.entries(cr)) rowLocal[`raw_${k}`] = countBin(v);
          for (const [k, v] of Object.entries(cn)) rowLocal[`norm_${k}`] = countBin(v);
          const projectionContext: Record<string, string> = {
            relativePosition: pos, deltaToFirstCodeBin: firstCodeIndex === null ? 'not_available' : deltaBin(idx - firstCodeIndex), rowIndexBin: countBin(idx), rowsBeforeBin: countBin(i), rowsAfterBin: countBin(rows.length - 1 - i), pageRowCountBin: countBin(rows.length),
            positionFromTopBin: countBin(i), candidateCountOnPageBin: countBin(labelIdx.length), codeShapedRowBefore: String(prevCode), requestShapedRowBefore: String(prevReq),
            m2Code: nbf('m2').code, m2Request: nbf('m2').request, m2Label: nbf('m2').label, m1Code: nbf('m1').code, m1Request: nbf('m1').request, m1Label: nbf('m1').label, p1Code: nbf('p1').code, p1Request: nbf('p1').request, p1Label: nbf('p1').label, p2Code: nbf('p2').code, p2Request: nbf('p2').request, p2Label: nbf('p2').label,
          };
          const ft: FeatureTable = { rowLocal, projectionContext };
          candidates.push({
            id: `${d.localPath}|${n}|${idx}`, localPath: d.localPath, page: n, logicalRowIndex: idx, tokenIndexes: x.alt.tokenIndexes, raw, normalized: e.normalized, page_: { width: meta.width, height: meta.height, rotate: meta.rotate },
            bounds: { xMin: r1(x.r.bbox.xMin), xMax: r1(x.r.bbox.xMax), yMin: r1(x.r.bbox.yMin), yMax: r1(x.r.bbox.yMax) },
            frozen: { predicate: true, isProjected, isAdditional: !isProjected, pageAmbiguous, relativePosition: pos, currentStatus: alt.basis === 'before_first_code_row' ? 'observed_nonblank' : 'observed_blank', altStatus: alt.title.status, altBasis: alt.basis, firstCodeRowIndex: firstCodeIndex, candidateCountOnPage: labelIdx.length, population: pop },
            projection: { raw, normalized: e.normalized, shape: e.shape, stages: { nfkc: raw.normalize('NFKC'), noWhitespace: raw.normalize('NFKC').replace(/[\s　]+/g, ''), final: e.normalized }, shapes },
            features: ft, charCounts: { raw: cr, normalized: cn }, geometry: { anchorX, firstTokenX: r1(first?.bbox.xMin ?? 0), lastTokenX: r1(last?.bbox.xMin ?? 0), tokenCount: x.toks.length, top: Math.round(top * 1000) / 1000 }, neighbors,
          });
        }
        page.cleanup();
      }
    } finally { await doc.destroy(); }
    console.log(`${di + 1}/${docs.length} ${path.basename(d.localPath)} candidates=${candidates.length}`);
  }
  const ids = new Set(candidates.map(c => c.id as string));
  const byPop: Record<string, number> = {};
  for (const c of candidates) { const p = (c.frozen as { population: string }).population; byPop[p] = (byPop[p] ?? 0) + 1; }
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-label-candidate-universe/v0', note: 'frozen label-shaped predicate の candidate row の全件（primary evaluable page）。predicate・alternative rule・normalization は未変更。manual contract・MOF・existing ON kind・組織名辞書は未使用',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) }, accounting: { evaluablePages, ambiguousPages, candidateRows: candidates.length, uniqueIds: ids.size, byPopulation: byPop, candidatePages: new Set(candidates.map(c => `${c.localPath}|${c.page}`)).size },
    pages: pagesOut.filter(p => (p.candidateCount as number) > 0 || p.pageAmbiguous), candidates,
  }))}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  fs.writeFileSync(path.join(OUT, 'candidate-universe.json.gz'), gz);
  console.log(JSON.stringify({ contentSha256: sha(text), gzSha256: sha(gz), gzBytes: gz.length, evaluablePages, ambiguousPages, candidateRows: candidates.length, uniqueIds: ids.size, byPop }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
