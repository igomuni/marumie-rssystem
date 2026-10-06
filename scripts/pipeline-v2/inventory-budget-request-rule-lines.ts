/**
 * 概算要求PDFの罫線（描画 primitive）geometry の research-only inventory（development）。
 * 直前研究の evaluable_detail_range 32 range の page について、pdf.js の operator list から primitive を取り出し、merged vertical rule・long rule・候補 anchor V1..V4 を作り、
 * control の既存 item 97 / organization / request / detail_line / unclassified と dev ranges の request 行の相対座標を集計する。anchor は選ばない（候補の列挙と安定性の計測のみ）。
 * MOF・sparse range は使わない。production code は変更しない。
 * 使い方: npx tsx scripts/pipeline-v2/inventory-budget-request-rule-lines.ts
 * 出力: tests/fixtures/budget-request-rule-line-geometry/2024/{rule-line-development-pages,rule-line-development-summary}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { longRules, mergeVerticalRules, ordinalAnchor, LONG_RULE_FRACTION } from './lib/budget-request-rule-line-anchor';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-rule-line-geometry', '2024');
const P = {
  fullEval: `${FX}/budget-request-range-local-item-extraction/2024/full-evaluation.json`, layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`,
  pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, off: `${FX}/budget-request-hierarchy-failure-isolation/2024/off-diagnostic.json`, corpus: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`,
  control: `${FX}/budget-request-range-local-item-extraction/2024/control-evaluation.json`, protocol: 'docs/tasks/20261005_0839_Budget_Request_Rule_Line_Geometry_Inventory_Protocol.md',
};
const FROZEN: Record<string, string> = {
  [P.fullEval]: '421dbf8b3165057926ba21c84a7debb549a31941dfc8c62df2e39df651c9519d', [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.off]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562', [P.corpus]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.control]: '8dc35f02cf299cc0585216bc319f532c153ed060c48a1472b801a99a5781e7fb',
};
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null } } }
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
interface RangeRow { from: number; to: number; signature: string; status: string; refX: number | null }
interface FullPdf { localPath: string; accountType: string; publisherAuthority: string; pdfStatus: string; ranges: RangeRow[] }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const full = readJson<{ perPdf: FullPdf[] }>(P.fullEval).perPdf;
  const paired = readJson<{ documents: { localPath: string; class: string; hierarchySegment: [number, number]; baselineOnRecordsSha256: string }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable');
  const contract = new Map(paired.map(d => [d.localPath, d]));
  const dev = full.filter(p => p.ranges.some(r => r.status === 'evaluable_detail_range')).sort((a, b) => cmp(a.localPath, b.localPath));
  const K = [1, 2, 3, 4];

  const pagesOut: unknown[] = [];
  const prim: Record<string, number> = {}, lw: Record<string, number> = {}, sizes: Record<string, number> = {};
  const longXByVariant: Record<string, Record<string, number>> = {};
  const vk: Record<string, { status: Record<string, number>; x: Record<string, number>; byVariant: Record<string, Record<string, number>>; rangesWithAnyUnavailable: number; rangeXClusters: Record<string, number> }> = {};
  for (const k of K) vk[`V${k}`] = { status: {}, x: {}, byVariant: {}, rangesWithAnyUnavailable: 0, rangeXClusters: {} };
  const reqOff: Record<string, Record<string, Record<string, number>>> = {}; // V -> variant -> offset hist
  const ctrlOff: Record<string, Record<string, Record<string, number>>> = {}; // V -> onKind -> offset hist
  const itemOffByPdf: Record<string, Record<string, Record<string, number>>> = {}; // V -> pdf -> hist（items）
  const orgOffCfa: Record<string, Record<string, number>> = {};
  const baselineRel: Record<string, Record<string, number>> = { item: {}, organization: {} }; // itemCodeX - range refX（control の現行基準の再現確認）
  const joinable = { items: { total: 0, byV: {} as Record<string, number> }, requests: { total: 0, byV: {} as Record<string, number> } };
  const mlit: unknown[] = [];

  for (const pdf of dev) {
    const slug = slugOf(pdf.localPath);
    const baseRes = readJson<{ segments: { pages: [number, number]; mode: string; outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slug, 'result.json'));
    const all: Rec[] = [];
    for (const s of baseRes.segments) all.push(...readGz<Rec>(s.outputs.records.path)); // row-local の x・request 行・（control の ON kind）は baseline（ON）の records を使う
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const ctl = contract.get(pdf.localPath);
    try {
      for (const range of pdf.ranges.filter(r => r.status === 'evaluable_detail_range')) {
        const variant = range.signature.split('|R:')[1] ?? '?';
        const vkInRange: Record<string, Set<string>> = Object.fromEntries(K.map(k => [`V${k}`, new Set<string>()]));
        let anyUnavail = Object.fromEntries(K.map(k => [`V${k}`, false]));
        const pagePrims: unknown[] = [];
        for (let n = range.from; n <= range.to; n++) {
          const page = await doc.getPage(n);
          const ol = await page.getOperatorList();
          const ps = extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[]);
          page.cleanup();
          const height = page.view[3] - page.view[1];
          inc(sizes, `${Math.round(page.view[2] - page.view[0])}x${Math.round(height)} rot${page.rotate}`);
          for (const p of ps) { inc(prim, `${p.kind}/${p.paint}/${p.orientation}`); if (p.lineWidth !== null && p.kind === 'line') inc(lw, String(Math.round(p.lineWidth * 1000) / 1000)); }
          const merged = mergeVerticalRules(ps);
          const long = longRules(merged, height);
          const anchors: Record<string, { status: string; x: number | null }> = {};
          for (const k of K) { const a = ordinalAnchor(long, k); anchors[`V${k}`] = a; inc(vk[`V${k}`].status, a.status); inc(vk[`V${k}`].byVariant[variant] ??= {}, a.status); if (a.x !== null) { inc(vk[`V${k}`].x, r1(a.x)); vkInRange[`V${k}`].add(r1(a.x)); } if (a.status !== 'unique') anyUnavail[`V${k}`] = true; }
          for (const r of long) inc((longXByVariant[variant] ??= {}), r1(r.x));
          const pageRows = all.filter(r => r.anchor.page === n);
          // 相対座標
          for (const r of pageRows) {
            const x = codeX(r); if (x === null) continue;
            const isReq = r.recordKind === 'request';
            const onKind = ctl && n >= ctl.hierarchySegment[0] && n <= ctl.hierarchySegment[1] ? r.recordKind : null;
            if (isReq) joinable.requests.total++;
            if (onKind === 'item') joinable.items.total++;
            for (const k of K) {
              const a = anchors[`V${k}`]; if (a.status !== 'unique' || a.x === null) continue;
              const off = r1(x - a.x);
              if (isReq) { inc(((reqOff[`V${k}`] ??= {})[variant] ??= {}), off); inc(joinable.requests.byV, `V${k}`); }
              if (onKind) { inc(((ctrlOff[`V${k}`] ??= {})[onKind] ??= {}), off); if (onKind === 'item') { inc(joinable.items.byV, `V${k}`); inc(((itemOffByPdf[`V${k}`] ??= {})[path.basename(pdf.localPath)] ??= {}), off); } if (onKind === 'organization' && /cfa\.go\.jp/.test(pdf.localPath)) inc((orgOffCfa[`V${k}`] ??= {}), off); }
            }
            if (onKind === 'item' || onKind === 'organization') inc(baselineRel[onKind], r1(x - (range.refX as number)));
          }
          pagePrims.push({ p: n, h: Math.round(height), n: ps.length, long: long.map(r => [r.x, r.yMin, r.yMax]), v: Object.fromEntries(K.map(k => [`V${k}`, anchors[`V${k}`].status === 'unique' ? anchors[`V${k}`].x : anchors[`V${k}`].status])) });
          if (pdf.localPath.endsWith('001630395.pdf')) mlit.push({ page: n, variant, anchors });
        }
        for (const k of K) { const key = `V${k}`; if (anyUnavail[key]) vk[key].rangesWithAnyUnavailable++; inc(vk[key].rangeXClusters, String(vkInRange[key].size)); }
        pagesOut.push({ localPath: pdf.localPath, accountType: pdf.accountType, from: range.from, to: range.to, signature: range.signature, pages: pagePrims });
      }
    } finally { await doc.destroy(); }
    console.log(`done ${path.basename(pdf.localPath)}`);
  }

  const summary = sortDeep({
    schema: 'budget-request-rule-line-development-summary/v0',
    scope: 'development population: 直前研究の evaluable_detail_range 32 range（anchor は選ばず、候補 V1..V4 の可用性・安定性・相対座標を列挙）',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), protocol: { longRuleFraction: LONG_RULE_FRACTION, candidates: 'V1..V4 = page の long rule を x 昇順で k 番目' } },
    population: { pdfs: dev.length, ranges: pagesOut.length, pages: (pagesOut as { pages: unknown[] }[]).reduce((n, r) => n + r.pages.length, 0) },
    primitiveCounts: prim, lineWidths: lw, pageSizes: sizes, longRuleXByVariant: longXByVariant, candidates: vk,
    relativeCoordinates: { requestCodeXMinusVk_byVariant: reqOff, controlCodeXMinusVk_byOnKind: ctrlOff, itemCodeXMinusVk_byPdf: itemOffByPdf, cfaOrganizationCodeXMinusVk: orgOffCfa, currentBaselineCodeXMinusRangeRefX: baselineRel, joinable },
    mlit001630395: mlit,
  });
  const text = `${JSON.stringify(summary, null, 1)}\n`;
  const pageText = `${JSON.stringify(sortDeep({ schema: 'budget-request-rule-line-development-pages/v0', note: 'long = [x, yMin, yMax]（merged vertical rule のうち長さが page 高さの 0.5 倍以上）。v = 候補 anchor（unique の x または unavailable/ambiguous）', ranges: pagesOut }))}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'rule-line-development-summary.json'), text);
  fs.writeFileSync(path.join(OUT, 'rule-line-development-pages.json'), pageText);
  console.log(JSON.stringify({ summarySha: sha(text), pagesSha: sha(pageText), population: (summary as { population: unknown }).population }));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
