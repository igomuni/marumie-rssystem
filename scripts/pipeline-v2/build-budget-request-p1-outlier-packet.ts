/**
 * Phase A: P1 outlier 2 row と frozen control の source-only evidence packet と source-only 分類（事前登録 P1_Outlier_Failure_Isolation_Protocol §3・§4）。
 * visual inspection の前に作る。predicate・threshold・production は変更しない。manual contract・MOF・raw text の意味は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-p1-outlier-packet.ts
 * 出力: tests/fixtures/budget-request-p1-outlier/2024/source-evidence-packet.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { classifyRow, titleOfPage } from './lib/budget-request-header-label';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { classifyPosition, frameOf } from './lib/budget-request-p1-outlier';
import { longRules, mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { titleOfPageAlt, type AltRow } from './lib/budget-request-alt-title-projection';
import { evidenceOf } from './lib/budget-request-title-ordering';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-p1-outlier', '2024');
const FREEZE = `${OUT}/population-freeze.json`;
const FREEZE_SHA = 'db22a783aa02a0b6c35f0962f270fccfad5256a14027136c09306d72a9aade5a';
const UNIVERSE = `${FX}/budget-request-label-candidate/2024/candidate-universe.json.gz`;
const LAYOUT = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`;
const PROTOCOL = 'docs/tasks/20261005_1255_Budget_Request_P1_Outlier_Failure_Isolation_Protocol.md';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortDeep(x)])) : v);
const r1 = (x: number) => Math.round(x * 10) / 10;

interface Cand { id: string; localPath: string; page: number; logicalRowIndex: number; tokenIndexes: number[]; raw: string; normalized: string; bounds: { xMin: number; xMax: number; yMin: number; yMax: number }; page_: { width: number; height: number; rotate: number }; frozen: Record<string, unknown>; features: unknown; geometry: unknown; neighbors: unknown }

async function pageData(file: string, n: number, pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')) {
  const root = path.join('node_modules', 'pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  try {
    if (n < 1 || n > doc.numPages) return null;
    const page = await doc.getPage(n);
    const content = await page.getTextContent({ disableNormalization: true });
    const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
    const tokens = toSourceTokens(content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[], meta, content.styles as unknown as RawTextStyles);
    const lr = resolveLogicalRows(tokens, meta, buildTableGeometry(tokens, meta));
    const rows = lr.logicalRowCandidates.map(r => { const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== ''); return { alt: { logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index), texts: toks.map(t => t.rawText.trim()), x: Math.round((toks[0]?.bbox.xMin ?? 0) * 10) / 10, y: Math.round(r.bbox.yMin * 10) / 10 } as AltRow, bbox: r.bbox }; });
    const ol = await page.getOperatorList();
    const prims = extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], pdfjs.OPS as unknown as OpsTable, page.view as number[]);
    return { meta, rows, prims, doc: null };
  } finally { await doc.destroy(); }
}

async function main() {
  if (sha(fs.readFileSync(FREEZE)) !== FREEZE_SHA) throw new Error('population-freeze が frozen 値と一致しない（STOP）');
  const fr = JSON.parse(fs.readFileSync(FREEZE, 'utf8')) as { outliers: { id: string }[]; controls: { outlierId: string; controlId: string }[] };
  const universe = JSON.parse(zlib.gunzipSync(fs.readFileSync(UNIVERSE)).toString('utf8')) as { candidates: Cand[] };
  const byId = new Map(universe.candidates.map(c => [c.id, c]));
  const layout = new Map((JSON.parse(fs.readFileSync(LAYOUT, 'utf8')) as { perPdf: { localPath: string; ranges: { from: number; to: number; signature: string }[] }[] }).perPdf.map(p => [p.localPath, p]));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const items: { role: string; id: string; outlierId: string | string[] | null }[] = [];
  fr.outliers.forEach(o => items.push({ role: 'outlier', id: o.id, outlierId: null }));
  for (const cid of [...new Set(fr.controls.map(c => c.controlId))]) items.push({ role: 'control', id: cid, outlierId: fr.controls.filter(c => c.controlId === cid).map(c => c.outlierId) });
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('candidate id が重複（STOP）');
  const packets: Record<string, unknown>[] = [];
  const classification: Record<string, unknown>[] = [];
  const cache = new Map<string, NonNullable<Awaited<ReturnType<typeof pageData>>>>();
  const get = async (lp: string, n: number) => { const k = `${lp}#${n}`; if (!cache.has(k)) { const d = await pageData(lp, n, pdfjs); if (d) cache.set(k, d); else return null; } return cache.get(k)!; };
  const adjacent = async (lp: string, n: number) => {
    const out: Record<string, unknown> = {};
    for (const k of [-1, 0, 1]) {
      const d = await get(lp, n + k);
      if (!d) { out[String(k)] = null; continue; }
      const alt = titleOfPageAlt(d.rows.map(r => r.alt), d.meta.height);
      const cur = titleOfPage(d.rows.map(r => r.alt));
      const labels = d.rows.map(r => ({ r, e: evidenceOf({ index: r.alt.logicalRowIndex, x: r.alt.x, y: r.alt.y, texts: r.alt.texts, physicalRowIndexes: r.alt.physicalRowIndexes, tokenIndexes: r.alt.tokenIndexes }, d.meta.height) })).filter(x => x.e.labelShaped).map(x => ({ index: x.r.alt.logicalRowIndex, raw: x.e.raw.slice(0, 60) }));
      const rng = layout.get(lp)?.ranges.find(r => n + k >= r.from && n + k <= r.to);
      out[String(k)] = { page: n + k, width: d.meta.width, height: d.meta.height, firstLogicalRows: d.rows.slice(0, 3).map(r => ({ index: r.alt.logicalRowIndex, raw: r.alt.texts.join(' ').slice(0, 60), y: r.alt.y })), currentProjectedTitleRaw: cur.firstTitleRaw, currentStatus: cur.status, alternativeProjectedTitleRaw: alt.title.firstTitleRaw, alternativeBasis: alt.basis, labelShapedCandidates: labels, layoutRangeSignature: rng?.signature ?? null };
    }
    return out;
  };
  for (const it of items) {
    const c = byId.get(it.id)!;
    const d = (await get(c.localPath, c.page))!;
    const idx = d.rows.findIndex(r => r.alt.logicalRowIndex === c.logicalRowIndex);
    const alt = titleOfPageAlt(d.rows.map(r => r.alt), d.meta.height);
    const cur = titleOfPage(d.rows.map(r => r.alt));
    const win = d.rows.slice(Math.max(0, idx - 10), idx + 11).map((r, k) => {
      const e = evidenceOf({ index: r.alt.logicalRowIndex, x: r.alt.x, y: r.alt.y, texts: r.alt.texts, physicalRowIndexes: r.alt.physicalRowIndexes, tokenIndexes: r.alt.tokenIndexes }, d.meta.height);
      return { rel: Math.max(0, idx - 10) + k - idx, index: r.alt.logicalRowIndex, raw: e.raw.slice(0, 80), codeShaped: e.codeShaped, requestShaped: classifyRow(r.alt.texts) === 'request', labelShaped: e.labelShaped, tokenIndexes: r.alt.tokenIndexes, x: r.alt.x, y: r.alt.y, yMax: r1(r.bbox.yMax), inCurrentProjection: cur.sourceRefs?.logicalRowIndex === r.alt.logicalRowIndex, inAlternativeProjection: alt.title.sourceRefs?.logicalRowIndex === r.alt.logicalRowIndex };
    });
    const merged = mergeVerticalRules(d.prims), long = longRules(merged, d.meta.height);
    const longV = long.map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax, lineWidths: r.lineWidths }));
    const horiz = d.prims.filter(p => p.kind === 'line' && p.orientation === 'horizontal' && p.paint === 'stroke' && p.length >= 0.5 * d.meta.width).map(p => ({ y: p.y1, xMin: Math.min(p.x1, p.x2), xMax: Math.max(p.x1, p.x2), lineWidth: p.lineWidth })).sort((a, b) => a.y - b.y);
    const above = horiz.filter(h => h.y <= c.bounds.yMin + 0.5).slice(-1)[0] ?? null, below = horiz.filter(h => h.y >= c.bounds.yMax - 0.5)[0] ?? null;
    const frame = frameOf(long.map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax })));
    const cls = classifyPosition(c.bounds, frame);
    packets.push(sortDeep({
      role: it.role, controlForOutliers: it.outlierId, id: c.id,
      identity: { localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, tokenIndexes: c.tokenIndexes, raw: c.raw, normalized: c.normalized, pageGeometry: c.page_ },
      geometry: { bounds: c.bounds, rowLocalFeatures: (c.features as { rowLocal: unknown }).rowLocal, universeGeometry: c.geometry },
      projectionContext: { note: '診断用。row-local predicate evidence と分離', frozen: c.frozen, projectionContextFeatures: (c.features as { projectionContext: unknown }).projectionContext, universeNeighbors: c.neighbors },
      pageLocalStructure: win,
      drawing: { longVerticalRules: longV, longHorizontalRules: horiz, nearestHorizontalRuleAtOrAboveCandidateTop: above, nearestHorizontalRuleAtOrBelowCandidateBottom: below, frame },
      adjacentPages: await adjacent(c.localPath, c.page),
      sourceOnlyClassification: cls,
    }) as Record<string, unknown>);
    classification.push({ role: it.role, id: c.id, bounds: c.bounds, frame, classification: cls.classification, basis: cls.basis });
  }
  const text = `${JSON.stringify(sortDeep({ schema: 'budget-request-p1-outlier-source-evidence/v0', note: 'source-only。visual inspection の前。P1 は human GT ではない。MOF・manual contract は未使用', frozen: { populationFreezeSha256: FREEZE_SHA, protocolSha256: sha(fs.readFileSync(PROTOCOL)) }, classification, packets }), null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'source-evidence-packet.json'), text);
  console.log(JSON.stringify({ sha: sha(text), classification }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
