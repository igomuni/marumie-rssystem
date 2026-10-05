/**
 * 全 82 PDF の source 走査: PDF 単位の representation と、frozen unmatched 59 項の名称ヒット（位置・形・左隣 code・現行 candidate / universe row との関係）。
 * protocol: docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-unmatched59-scan.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDisplayPage, type PdfjsPageLike } from './lib/budget-request-display-page';
import { classifyRepresentation, findNameHits, leftCodeOf, normalizeText, type PdfRepresentation } from './lib/budget-request-unmatched-source-search';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-unmatched-59/2024`, R = `${FX}/budget-request-rule-8p6-rotate90/2024`, MC = `${FX}/budget-request-mext-continuation/2024`, LA = `${FX}/budget-request-item-layout-anchor/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const FROZEN: Record<string, string> = {
  [`${OUT}/baseline.json`]: '7f7e219245849b4dcec9a7352dfdda70eeb09f0f404047d18f5a979ff1e24bb4', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  'docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md': '047427e984ad8cb0350b58a5610b6a75e943447e6c13bb7d558d99e93ab4bcca',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface UniRow { candidateId: string; isCandidate: boolean; localPath: string; page: number; logicalRowIndex: number; code: string; nameRaw: string | null; nameClass: string; ruleStatus: string; deltaX01: string | null; rowBBox: { yMin: number; yMax: number } }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${R}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
  const baseline = readJson<{ unmatchedMof: { mofSectionId: string; name: string; normalized: string }[] }>(`${OUT}/baseline.json`);
  const docs = readJson<{ documents: { localPath: string; sha256: string; pages: number; publisherAuthority: string; accountType: string }[] }>(`${BASE_FIX}/corpus-manifest.json`).documents;
  if (docs.length !== 82) throw new Error('corpus 件数が 82 でない（STOP）');
  const names = baseline.unmatchedMof.map(m => ({ id: m.mofSectionId, norm: normalizeText(m.name) }));
  // 現行 candidate / universe（continuation 発火後の candidate 名称）
  const fired = new Map(readGz<{ candidateId: string; afterName: string }>(`${MC}/continuation-fired.jsonl.gz`).map(f => [f.candidateId, f.afterName]));
  const uni = readGz<UniRow>(`${R}/phaseA-universe.jsonl.gz`);
  const uniByPage = new Map<string, UniRow[]>();
  for (const u of uni) { const k = `${u.localPath}|${u.page}`; uniByPage.set(k, [...(uniByPage.get(k) ?? []), u]); }
  const profileCandPages = new Set(readGz<{ localPath: string; page: number }>(`${LA}/profile-candidates.jsonl.gz`).map(c => `${c.localPath}|${c.page}`));

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const O = pdfjs.OPS as unknown as Record<string, number>;
  const opName = (n: number) => Object.keys(O).find(k => O[k] === n) ?? String(n);
  const root = path.join('node_modules', 'pdfjs-dist');
  const pdfInv: unknown[] = [], hitsOut: Record<string, unknown[]> = Object.fromEntries(names.map(n => [n.id, []])), hitCounts: Record<string, number> = Object.fromEntries(names.map(n => [n.id, 0]));
  for (const d of docs) {
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`原本の hash 不一致（STOP）: ${d.localPath}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const rot: Record<string, number> = {};
    let tokens = 0, digits = 0, pagesWithoutTokens = 0, sampledImages = 0, sampledPaths = 0, sampledPages = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      rot[pg.rotate] = (rot[pg.rotate] ?? 0) + 1;
      const ex = await extractDisplayPage(pg as unknown as PdfjsPageLike, n, doc.numPages);
      const toks = ex.tokens.map(t => ({ index: t.index, rawText: t.rawText, bbox: t.bbox, fontSize: t.fontSize }));
      const nonBlank = toks.filter(t => t.rawText.trim() !== '');
      tokens += nonBlank.length; digits += nonBlank.filter(t => /[0-9]/.test(t.rawText)).length; if (nonBlank.length === 0) pagesWithoutTokens++;
      if (nonBlank.length === 0 && sampledPages < 3) { sampledPages++; const ol = await pg.getOperatorList(); for (let k = 0; k < ol.fnArray.length; k++) { const nm = opName(ol.fnArray[k]); if (nm.startsWith('paintImage') || nm === 'paintInlineImageXObject') sampledImages++; else if (nm === 'constructPath') sampledPaths++; } }
      pg.cleanup();
      if (nonBlank.length === 0) continue;
      for (const nm of names) {
        for (const h of findNameHits(toks, nm.norm)) {
          hitCounts[nm.id]++;
          const first = h.tokens[0];
          const lc = leftCodeOf(toks, first);
          const cy = (first.bbox.yMin + first.bbox.yMax) / 2;
          const urow = (uniByPage.get(`${d.localPath}|${n}`) ?? []).find(u => cy >= u.rowBBox.yMin - 1 && cy <= u.rowBBox.yMax + 1);
          if ((hitsOut[nm.id] as unknown[]).length < 20) (hitsOut[nm.id] as unknown[]).push({
            pdfPath: d.localPath, page: n, kind: h.kind, tokens: h.tokens.map(t => ({ index: t.index, text: t.rawText, bbox: t.bbox })), leftCode: lc,
            universeRow: urow ? { candidateId: urow.candidateId, isCandidate: urow.isCandidate, code: urow.code, nameClass: urow.nameClass, ruleStatus: urow.ruleStatus, deltaX01: urow.deltaX01, currentCandidateName: urow.isCandidate ? fired.get(urow.candidateId) ?? urow.nameRaw : null, universeNameRaw: urow.nameRaw } : null,
            pageHasProfileCandidates: profileCandPages.has(`${d.localPath}|${n}`),
          });
        }
      }
    }
    await doc.destroy();
    const representation: PdfRepresentation = classifyRepresentation({ tokens, asciiDigitTokens: digits, sampledImages, sampledPaths, sampledPages });
    pdfInv.push({ localPath: d.localPath, sha256: d.sha256, pages: d.pages, publisherAuthority: d.publisherAuthority, accountType: d.accountType, rotation: rot, tokens, asciiDigitTokens: digits, pagesWithoutTokens, sampledOperatorCounts: sampledPages > 0 ? { pages: sampledPages, images: sampledImages, constructPath: sampledPaths } : null, representation });
    console.log(`${d.localPath.split('/').pop()} ${representation} tokens=${tokens}`);
  }
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(sortDeep({ hitCounts, hits: hitsOut })), 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/source-search-hits.json.gz`, gz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-unmatched59-pdf-scan/v0', note: '全 82 PDF の representation と、unmatched 59 項の名称ヒット。新しい抽出 rule は無い。ヒット詳細は source-search-hits.json.gz',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), hitsGzSha256: sha(gz), pdfs: pdfInv,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/source-pdf-scan.json`, text);
  console.log(JSON.stringify({ sha: sha(text), hitsGz: sha(gz), repr: (pdfInv as { representation: string }[]).reduce((m: Record<string, number>, p) => { m[p.representation] = (m[p.representation] ?? 0) + 1; return m; }, {}), withHits: Object.values(hitCounts).filter(x => x > 0).length }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
