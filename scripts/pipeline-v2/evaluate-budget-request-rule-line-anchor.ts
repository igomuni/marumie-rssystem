/**
 * 罫線 anchor T1（thin な long vertical rule の最も左）の feasibility 評価（事前登録 Rule_Line_Anchor_Preregistration）。
 * --phase=sparse : 直前研究で range_request_x_unavailable だった detail range（sparse）での anchor の可用性（anchor / gate は freeze 済み。結果で変更しない）
 * --phase=decide : sparse を再計算して artifact と一致を確認し（決定性）、development artifact と合わせて gate F1..F6 と判定を計算する
 * MOF は使わない。sparse range で item 候補は数えない（frozen rule は request 行で layout variant を決めるため、request 5 件未満の range には適用しない）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { leftmostThinAnchor, longRules, mergeVerticalRules, rangeAnchor, type AnchorStatus } from './lib/budget-request-rule-line-anchor';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-rule-line-geometry', '2024');
const P = {
  fullEval: `${FX}/budget-request-range-local-item-extraction/2024/full-evaluation.json`, pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  inv: `${OUT}/rule-line-development-summary.json`, thin: `${OUT}/rule-line-thin-anchor-development.json`, prereg: 'docs/tasks/20261005_0850_Budget_Request_Rule_Line_Anchor_Preregistration.md',
};
const FROZEN: Record<string, string> = {
  [P.fullEval]: '421dbf8b3165057926ba21c84a7debb549a31941dfc8c62df2e39df651c9519d', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.inv]: '810b55f9dca750163fc3ddb74a1ff9a523bf48bcf68c16d19269a374b71d9de7', [P.thin]: 'a45951b54bd814c575ebd821d8edd2f7c13424ca1ed8503327500e887ec7ae86',
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
const json = (o: unknown) => `${JSON.stringify(sortDeep(o), null, 1)}\n`;
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null } } }
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
interface FullPdf { localPath: string; accountType: string; publisherAuthority: string; ranges: { from: number; to: number; signature: string; status: string; requests: number }[] }

function guard() { for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`); }

async function computeSparse(): Promise<string> {
  guard();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const full = readJson<{ perPdf: FullPdf[] }>(P.fullEval).perPdf.filter(p => p.ranges.some(r => r.status === 'range_request_x_unavailable')).sort((a, b) => cmp(a.localPath, b.localPath));
  const rows: Record<string, unknown>[] = [];
  const xHist: Record<string, number> = {}, reqOff: Record<string, number> = {};
  const tot = { ranges: 0, available: 0, unavailable: 0, pages: 0, uniquePages: 0, disagreeingPages: 0, requestRows: 0 };
  for (const pdf of full) {
    const slug = slugOf(pdf.localPath);
    const baseRes = readJson<{ segments: { outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slug, 'result.json'));
    const all: Rec[] = [];
    for (const s of baseRes.segments) all.push(...readGz<Rec>(s.outputs.records.path));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (const range of pdf.ranges.filter(r => r.status === 'range_request_x_unavailable')) {
        const anchors: { status: AnchorStatus; x: number | null }[] = [];
        for (let n = range.from; n <= range.to; n++) {
          const page = await doc.getPage(n);
          const ol = await page.getOperatorList();
          anchors.push(leftmostThinAnchor(longRules(mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])), page.view[3] - page.view[1])));
          page.cleanup();
        }
        const ra = rangeAnchor(anchors);
        const disagree = ra.x === null ? anchors.length : anchors.filter(a => a.status !== 'unique' || r1(a.x as number) !== r1(ra.x as number)).length;
        const off: Record<string, number> = {};
        for (const r of all.filter(r => r.anchor.page >= range.from && r.anchor.page <= range.to && r.recordKind === 'request')) { const x = codeX(r); tot.requestRows++; if (x !== null && ra.x !== null) { inc(off, r1(x - ra.x)); inc(reqOff, r1(x - ra.x)); } }
        tot.ranges++; ra.status === 'available' ? tot.available++ : tot.unavailable++; tot.pages += anchors.length; tot.uniquePages += anchors.filter(a => a.status === 'unique').length; tot.disagreeingPages += disagree;
        if (ra.x !== null) inc(xHist, r1(ra.x));
        rows.push({ localPath: pdf.localPath, accountType: pdf.accountType, from: range.from, to: range.to, requestsInRange: range.requests, rangeAnchor: ra, pagesDisagreeing: disagree, requestOffsetsToAnchor: off });
      }
    } finally { await doc.destroy(); }
  }
  return json({ schema: 'budget-request-rule-line-sparse-evaluation/v0', scope: 'range_request_x_unavailable の detail range（38）での T1 anchor の可用性。item 候補は数えない（frozen rule は request 行を必要とし、5 件未満条件は緩和しない）。request 行は anchor との整合の diagnostic のみ', frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), prereg: fileSha(P.prereg) }, totals: tot, anchorXHistogram: xHist, requestOffsetsToAnchor: reqOff, ranges: rows });
}

function decide(sparseText: string) {
  guard();
  const thin = readJson<{ ranges: { localPath: string; accountType: string; from: number; to: number; variant: string; rangeAnchor: { status: string; x: number | null }; pagesDisagreeingWithRangeAnchor: number; pages: number }[]; relativeToRangeAnchor: { controlByAccountAndOnKind: Record<string, Record<string, Record<string, number>>>; requestByAccountVariant: Record<string, Record<string, number>>; joinable: { items: number; itemsWithRangeAnchor: number } } }>(P.thin);
  const sparse = JSON.parse(sparseText) as { totals: { ranges: number; available: number } };
  // F5: control の plain3 行（lexical `^\d{3}$`）で、item の offset クラスタ（0.1pt）に入る非 item 行の割合（range anchor 基準）
  const paired = readJson<{ documents: { localPath: string; class: string; hierarchySegment: [number, number] }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable');
  const ctl = new Map(paired.map(d => [d.localPath, d]));
  const rows: { kind: string; off: string }[] = [];
  const recCache = new Map<string, Rec[]>();
  for (const r of thin.ranges) {
    const c = ctl.get(r.localPath); if (!c || r.rangeAnchor.x === null) continue;
    if (!recCache.has(r.localPath)) { const res = readJson<{ segments: { outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slugOf(r.localPath), 'result.json')); recCache.set(r.localPath, res.segments.flatMap(s => readGz<Rec>(s.outputs.records.path))); }
    for (const rec of recCache.get(r.localPath)!) {
      const x = codeX(rec); const raw = rec.rowLocal.code.value?.raw;
      if (x === null || !raw || !/^\d{3}$/.test(raw) || rec.anchor.page < Math.max(r.from, c.hierarchySegment[0]) || rec.anchor.page > Math.min(r.to, c.hierarchySegment[1])) continue;
      rows.push({ kind: rec.recordKind, off: r1(x - r.rangeAnchor.x) });
    }
  }
  const itemClusters = new Set(rows.filter(x => x.kind === 'item').map(x => x.off));
  const atItem = rows.filter(x => itemClusters.has(x.off));
  const nonItemAtItem = atItem.filter(x => x.kind !== 'item');
  const contamination = atItem.length ? nonItemAtItem.length / atItem.length : null;
  const devRanges = thin.ranges.length;
  const availableDev = thin.ranges.filter(r => r.rangeAnchor.status === 'available').length;
  const devPages = thin.ranges.reduce((n, r) => n + r.pages, 0), disagree = thin.ranges.reduce((n, r) => n + r.pagesDisagreeingWithRangeAnchor, 0);
  const reqClusters = new Set(Object.values(thin.relativeToRangeAnchor.requestByAccountVariant).flatMap(h => Object.keys(h)));
  const byKind: Record<string, number> = {};
  for (const x of nonItemAtItem) inc(byKind, x.kind);
  const gates = {
    F1_dev_ranges_with_anchor: { value: availableDev, of: devRanges, threshold: '>= 31', pass: availableDev >= 31 },
    F2_items_joinable: { value: thin.relativeToRangeAnchor.joinable.itemsWithRangeAnchor, of: 97, threshold: '= 97', pass: thin.relativeToRangeAnchor.joinable.itemsWithRangeAnchor === 97 },
    F3_dev_pages_agreeing: { value: devPages - disagree, of: devPages, threshold: '>= 0.99', pass: (devPages - disagree) / devPages >= 0.99 },
    F4_offset_clusters: { itemClusters: [...itemClusters].sort(), requestClusters: [...reqClusters].sort(), threshold: 'item <= 2 and request <= 2', pass: itemClusters.size <= 2 && reqClusters.size <= 2 },
    F5_contamination: { itemRows: rows.filter(x => x.kind === 'item').length, rowsAtItemOffsets: atItem.length, nonItemAtItemOffsets: nonItemAtItem.length, nonItemByKind: byKind, share: contamination, threshold: '<= 0.05', pass: contamination !== null && contamination <= 0.05 },
    F6_sparse_ranges_with_anchor: { value: sparse.totals.available, of: sparse.totals.ranges, threshold: '>= 36 of 38', pass: sparse.totals.ranges === 38 && sparse.totals.available >= 36 },
  };
  const det = true;
  const g = gates;
  let decision: string, rule: number;
  if (!det) { decision = 'INCONCLUSIVE'; rule = 1; }
  else if (!(g.F1_dev_ranges_with_anchor.pass && g.F2_items_joinable.pass && g.F3_dev_pages_agreeing.pass)) { decision = 'RULE_LINE_SOURCE_INSUFFICIENT'; rule = 2; }
  else if (Object.values(g).every(x => x.pass)) { decision = 'RULE_LINE_ANCHOR_FEASIBLE'; rule = 3; }
  else { decision = 'RULE_LINE_PRESENT_BUT_SEMANTICALLY_INSUFFICIENT'; rule = 4; }
  return json({ schema: 'budget-request-rule-line-anchor-decision/v0', gates, decision, rule, sparseSha256: sha(sparseText) });
}

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  fs.mkdirSync(OUT, { recursive: true });
  if (phase === 'sparse') { const t = await computeSparse(); fs.writeFileSync(path.join(OUT, 'rule-line-sparse-evaluation.json'), t); console.log(t.split('\n').slice(0, 30).join('\n')); console.log(`sha256 ${sha(t)}`); }
  else if (phase === 'decide') {
    const stored = fs.readFileSync(path.join(OUT, 'rule-line-sparse-evaluation.json'), 'utf8');
    const again = await computeSparse();
    if (again !== stored) throw new Error('sparse 評価の再計算が artifact と一致しない（決定性違反、STOP）');
    const t = decide(stored); fs.writeFileSync(path.join(OUT, 'rule-line-decision.json'), t); console.log(t);
  } else throw new Error('--phase=sparse|decide が必要');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
