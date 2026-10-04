/**
 * development inventory（V1..V4: page の long rule の左から k 番目）で、k 番目が page 枠の太い線（線幅 1）の有無で動くことが分かったため、
 * 線幅（観測された 0.333 / 1 の 2 種）で page 枠を除いた候補 T1（thin な long rule の最も左）と、range 内の最頻値 range-anchor を development 上で評価する（post-inventory の追加候補）。
 * 同じ 32 development range・control の既存 item 97 等だけを使い、MOF・sparse range は使わない。anchor の選択・gate の固定は別の preregistration で行う。
 * 使い方: npx tsx scripts/pipeline-v2/inventory-budget-request-rule-line-thin-anchor.ts
 * 出力: tests/fixtures/budget-request-rule-line-geometry/2024/rule-line-thin-anchor-development.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { leftmostThinAnchor, longRules, mergeVerticalRules, rangeAnchor, type AnchorStatus } from './lib/budget-request-rule-line-anchor';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-rule-line-geometry', '2024');
const P = { fullEval: `${FX}/budget-request-range-local-item-extraction/2024/full-evaluation.json`, pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, inv: `${OUT}/rule-line-development-summary.json` };
const FROZEN: Record<string, string> = { [P.fullEval]: '421dbf8b3165057926ba21c84a7debb549a31941dfc8c62df2e39df651c9519d', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [P.inv]: '810b55f9dca750163fc3ddb74a1ff9a523bf48bcf68c16d19269a374b71d9de7' };
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
interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: { status: string; evidence: { bboxUnion: { xMin: number } } | null } } }
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
interface FullPdf { localPath: string; accountType: string; publisherAuthority: string; ranges: { from: number; to: number; signature: string; status: string; refX: number | null }[] }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const full = readJson<{ perPdf: FullPdf[] }>(P.fullEval).perPdf.filter(p => p.ranges.some(r => r.status === 'evaluable_detail_range')).sort((a, b) => cmp(a.localPath, b.localPath));
  const contract = new Map(readJson<{ documents: { localPath: string; class: string; hierarchySegment: [number, number] }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable').map(d => [d.localPath, d]));
  const pageStatus: Record<string, number> = {}, pageX: Record<string, number> = {};
  const rangeRows: Record<string, unknown>[] = [];
  const reqOff: Record<string, Record<string, number>> = {}; // `${account}|${variant}` -> offset hist（range anchor 基準）
  const ctrlOff: Record<string, Record<string, Record<string, number>>> = {}; // account -> ON kind -> hist
  const cfaOrg: Record<string, number> = {}; const cfaItemSamePdf: Record<string, number> = {};
  const pagesDisagree = { pages: 0, rangesWithDisagreement: 0 };
  const joinable = { items: 0, itemsWithRangeAnchor: 0, requests: 0, requestsWithRangeAnchor: 0 };
  for (const pdf of full) {
    const slug = slugOf(pdf.localPath);
    const baseRes = readJson<{ segments: { outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slug, 'result.json'));
    const all: Rec[] = [];
    for (const s of baseRes.segments) all.push(...readGz<Rec>(s.outputs.records.path));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const ctl = contract.get(pdf.localPath);
    try {
      for (const range of pdf.ranges.filter(r => r.status === 'evaluable_detail_range')) {
        const variant = range.signature.split('|R:')[1] ?? '?';
        const anchors: { status: AnchorStatus; x: number | null }[] = [];
        for (let n = range.from; n <= range.to; n++) {
          const page = await doc.getPage(n);
          const ol = await page.getOperatorList();
          const long = longRules(mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])), page.view[3] - page.view[1]);
          page.cleanup();
          const a = leftmostThinAnchor(long);
          anchors.push(a); inc(pageStatus, a.status); if (a.x !== null) inc(pageX, r1(a.x));
        }
        const ra = rangeAnchor(anchors);
        const disagree = ra.x === null ? 0 : anchors.filter(a => a.status !== 'unique' || r1(a.x as number) !== r1(ra.x as number)).length;
        pagesDisagree.pages += disagree; if (disagree > 0) pagesDisagree.rangesWithDisagreement++;
        rangeRows.push({ localPath: pdf.localPath, accountType: pdf.accountType, from: range.from, to: range.to, variant, rangeAnchor: ra, pagesDisagreeingWithRangeAnchor: disagree, pages: range.to - range.from + 1 });
        for (const r of all.filter(r => r.anchor.page >= range.from && r.anchor.page <= range.to)) {
          const x = codeX(r); if (x === null || ra.x === null) { if (r.recordKind === 'request') joinable.requests++; continue; }
          const off = r1(x - ra.x);
          const key = `${pdf.accountType}|${variant}`;
          if (r.recordKind === 'request') { joinable.requests++; joinable.requestsWithRangeAnchor++; inc((reqOff[key] ??= {}), off); }
          const onKind = ctl && r.anchor.page >= ctl.hierarchySegment[0] && r.anchor.page <= ctl.hierarchySegment[1] ? r.recordKind : null;
          if (onKind) { inc(((ctrlOff[pdf.accountType] ??= {})[onKind] ??= {}), off); if (onKind === 'item') { joinable.items++; joinable.itemsWithRangeAnchor++; } if (onKind === 'organization' && /cfa\.go\.jp/.test(pdf.localPath)) inc(cfaOrg, off); }
        }
      }
    } finally { await doc.destroy(); }
    console.log(`done ${path.basename(pdf.localPath)}`);
  }
  const summary = sortDeep({
    schema: 'budget-request-rule-line-thin-anchor-development/v0',
    scope: 'post-inventory 追加候補 T1（thin な long rule の最も左）と range-anchor（range 内最頻値）の development 評価。同じ 32 development range のみ',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) },
    pageLevel: { status: pageStatus, x: pageX }, pagesDisagree, ranges: rangeRows,
    relativeToRangeAnchor: { requestByAccountVariant: reqOff, controlByAccountAndOnKind: ctrlOff, cfaOrganization: cfaOrg, joinable },
  });
  const text = `${JSON.stringify(summary, null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'rule-line-thin-anchor-development.json'), text);
  console.log(JSON.stringify({ sha: sha(text), pageLevel: { pageStatus, pageX }, pagesDisagree, joinable, req: reqOff, ctrl: ctrlOff, cfaOrg }));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
