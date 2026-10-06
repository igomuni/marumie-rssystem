/**
 * Phase A（source-only）: 8.6pt ± 3.0pt 罫線基準の項候補（金額は条件にしない）の全 82 PDF 抽出。rotate ≠ 0 の page も表示向きに座標正規化して評価する。
 * protocol: docs/tasks/20261005_2115_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-rule-8p6-rotate-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { round1, round3, selectLeftRule, type SourceRecord, type VRule } from './lib/budget-request-rule-line-item-population';
import { isCandidate, universeRow, type UniverseRow } from './lib/budget-request-rule-8p6-candidate';
import { extractDisplayPage, normalizeLinePrimitives, type DisplayExtraction, type PdfjsPageLike } from './lib/budget-request-display-page';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { resolveFields, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const ISO = `${FX}/budget-request-hierarchy-failure-isolation/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const OUT = `${FX}/budget-request-rule-8p6-rotate90/2024`;
const PREV = `${FX}/budget-request-rule-8p6-item-candidate/2024/phaseA-universe.jsonl.gz`;
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const FROZEN: Record<string, string> = {
  [`${ISO}/paired-manifest.json`]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [`${BASE_FIX}/extraction-baseline.json`]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f', [`${BASE_FIX}/reconciliation-result.json`]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [`${ISO}/transition-evaluation.json`]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd', [`${ISO}/off-diagnostic.json`]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562',
  'scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts': '50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7', 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts': '39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262',
  'scripts/pipeline-v2/lib/stable-id.ts': '038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5',
  'scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts': 'd0ef587ffc9c76e7e8785c63fe93e3a7ee73b17736ebf17e073e714e14fbe247',
  'scripts/pipeline-v2/lib/budget-request-rule-8p6-candidate.ts': 'd6b3fc5eb423f085067e7d302070ff4e099efec7c02c271bdf1b29b14788fd31',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  [PREV]: '0c2c51cb695375cf17f1944278556069290b3b2206010d8695bb204fa3541712',
  'docs/tasks/20261005_2115_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Protocol.md': 'e56d6038feb53741549a3c9df12a9d887d3c00bfbcb267a6f9fa8dadd5453645',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface Doc { localPath: string; publisherAuthority: string; accountType: string; pages: number; sha256: string }
interface SegRes { pages: [number, number]; mode: string; status: string; error: string | null; outputs: { records: { path: string; sha256: string } } | null }
interface DocRes { status: string; segments: SegRes[] }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const docs = readJson<{ documents: Doc[] }>(`${BASE_FIX}/corpus-manifest.json`).documents;
  if (docs.length !== 82) throw new Error(`corpus 件数が 82 でない（STOP）: ${docs.length}`);
  const paired = new Set(readJson<{ documents: { localPath: string; class: string }[] }>(`${ISO}/paired-manifest.json`).documents.filter(d => d.class === 'paired_evaluable').map(d => d.localPath));
  const off = readJson<{ documents: { localPath: string; recordsSha256: string }[] }>(`${ISO}/off-diagnostic.json`);
  const prevCandidates = new Set(readGz<{ candidateId: string; isCandidate: boolean }>(PREV).filter(r => r.isCandidate).map(r => r.candidateId));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');

  const lines: string[] = [], perPdf: unknown[] = [], pageStatus: { localPath: string; page: number; status: string; reason: string }[] = [];
  const counts = { universe: 0, candidates: 0, ruleStatus: {} as Record<string, number>, account: {} as Record<string, number>, candidateByRotate: {} as Record<string, number>, universeByRotate: {} as Record<string, number> };
  const dist01: Record<string, number> = {};
  const ids = new Set<string>();
  const newCandidateIds = new Set<string>(), baselinePdfs = new Set<string>();
  let duplicates = 0, provenanceLoss = 0, geometryViolations = 0, nearestViolations = 0, ruleProvLoss = 0, unjoinable = 0;
  const pdfStatusCounts: Record<string, number> = {}, rotateByPdf: Record<string, Record<string, number>> = {};
  let tokenEquivalenceChecked = 0, tokenEquivalenceOk = 0;

  for (const d of docs) {
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`原本の hash 不一致（STOP）: ${d.localPath}`);
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    const res = fs.existsSync(f) ? readJson<DocRes>(f) : null;
    const fromBaseline = !!res && res.status === 'success';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const numPages = doc.numPages;
    const rot: Record<string, number> = {};
    const exCache = new Map<number, DisplayExtraction>();
    const getEx = async (n: number): Promise<DisplayExtraction> => { const c = exCache.get(n); if (c) return c; const page = await doc.getPage(n); const e = await extractDisplayPage(page as unknown as PdfjsPageLike, n, numPages); if (!fromBaseline || exCache.size < 5) exCache.set(n, e); return e; };
    let recs: SourceRecord[] = [];
    let source = '';
    const textStats = { tokens: 0, pagesWithoutTokens: 0, asciiDigitTokens: 0 };
    try {
      if (fromBaseline) {
        source = 'baseline_records';
        for (const s of res!.segments) {
          let file = s.outputs!.records.path;
          if (s.mode === 'hierarchy_enabled') { file = path.join(OFF_WORK, slugOf(d.localPath), `seg-${s.pages[0]}-${s.pages[1]}.records.jsonl.gz`); if (!paired.has(d.localPath) || fileSha(file) !== off.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${file}`); }
          else if (fileSha(file) !== s.outputs!.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${file}`);
          recs.push(...readGz<SourceRecord>(file));
        }
        baselinePdfs.add(d.localPath);
      } else {
        source = 'research_display_extraction';
        const pages: FieldResolverPageInput[] = [];
        for (let n = 1; n <= numPages; n++) {
          const ex = await getEx(n); inc(rot, String(ex.rotate));
          textStats.tokens += ex.tokens.length; if (ex.tokens.length === 0) textStats.pagesWithoutTokens++; textStats.asciiDigitTokens += ex.tokens.filter(t => /[0-9]/.test(t.rawText)).length;
          const geometry = buildTableGeometry(ex.tokens, ex.meta);
          pages.push({ meta: ex.meta, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.meta, geometry) });
        }
        recs = resolveFields({ pages, hierarchy: null }).records as unknown as SourceRecord[];
      }
    } catch (e) {
      await doc.destroy();
      pageStatus.push({ localPath: d.localPath, page: 0, status: 'unavailable_extraction_error', reason: String((e as Error).message).slice(0, 200) });
      inc(pdfStatusCounts, 'unavailable_extraction_error'); perPdf.push({ localPath: d.localPath, filename: d.localPath.split('/').pop(), publisherAuthority: d.publisherAuthority, account: d.accountType, pages: d.pages, source, status: 'unavailable_extraction_error', reason: String((e as Error).message).slice(0, 200) });
      continue;
    }
    const rows = recs.map(universeRow).filter((x): x is UniverseRow => x !== null);
    const byPage = new Map<number, UniverseRow[]>();
    for (const r of rows) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page)!.push(r); }
    const pdfRule: Record<string, number> = {};
    let pdfCandidates = 0;
    for (const [pn, prs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      if (pn < 1 || pn > numPages) { unjoinable += prs.length; continue; }
      const page = await doc.getPage(pn);
      const ex = await getEx(pn);
      if (fromBaseline && tokenEquivalenceChecked < 3 && page.rotate === 0) { tokenEquivalenceChecked++; const prod = await extractPageTokens(d.localPath, pn); const strip = (ts: typeof prod.tokens) => JSON.stringify(ts.map(({ fontName: _f, ...rest }) => rest)); if (strip(prod.tokens) === strip(ex.tokens)) tokenEquivalenceOk++; }
      inc(rot, String(page.rotate));
      const ol = await page.getOperatorList();
      const prims0 = extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[]);
      const prims = page.rotate === 0 ? prims0 : normalizeLinePrimitives(prims0, page.view as number[], ex.viewportTransform);
      const rules: VRule[] = mergeVerticalRules(prims).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax, lineWidths: r.lineWidths, sourcePaths: r.sourcePaths }));
      page.cleanup();
      for (const r of prs.sort((a, b) => a.logicalRowIndex - b.logicalRowIndex)) {
        const id = `${d.localPath}|p${r.page}|r${r.logicalRowIndex}`;
        if (ids.has(id)) duplicates++; ids.add(id);
        if (r.sourceTokenRefs.length === 0) provenanceLoss++;
        const sel = selectLeftRule(rules, r.codeX, r.rowBBox);
        let delta: number | null = null;
        if (sel.rule) {
          delta = r.codeX - sel.rule.x;
          if (!(sel.rule.x < r.codeX) || !(delta > 0)) geometryViolations++;
          const mid = (r.rowBBox.yMin + r.rowBBox.yMax) / 2;
          if (rules.some(q => q.x < r.codeX && q.yMin <= mid && mid <= q.yMax && q.x > sel.rule!.x)) nearestViolations++;
          if (sel.rule.sourcePaths.length === 0) ruleProvLoss++;
        }
        const cand = isCandidate(r, sel.status, delta);
        counts.universe++; inc(counts.ruleStatus, sel.status); inc(pdfRule, sel.status); inc(counts.universeByRotate, String(page.rotate));
        if (delta !== null) inc(dist01, round1(delta));
        if (cand) { counts.candidates++; pdfCandidates++; inc(counts.account, d.accountType); inc(counts.candidateByRotate, String(page.rotate)); newCandidateIds.add(id); }
        const rowText = ex.tokens.filter(t => { const c = (t.bbox.yMin + t.bbox.yMax) / 2; return c >= r.rowBBox.yMin && c <= r.rowBBox.yMax && t.rawText.trim() !== ''; }).sort((a, b) => a.bbox.xMin - b.bbox.xMin || a.index - b.index).map(t => t.rawText.trim()).join(' ');
        lines.push(JSON.stringify(sortDeep({
          candidateId: id, isCandidate: cand, localPath: d.localPath, filename: d.localPath.split('/').pop(), pdfSha256: d.sha256, account: d.accountType, ministry: d.publisherAuthority, page: r.page, rotate: page.rotate, logicalRowIndex: r.logicalRowIndex, rawRowText: rowText,
          code: r.codeRaw, codeX: r.codeX, requestShaped: false, nameRaw: r.nameRaw, nameNormalized: r.nameNormalized, nameComplete: r.nameComplete, nameClass: r.nameClass, nameStatus: r.nameStatus, nameReason: r.nameReason, nameTokenRefs: r.nameTokenRefs,
          ruleStatus: sel.status, eligibleRuleCount: sel.eligibleCount, ruleX: sel.rule?.x ?? null, ruleYStart: sel.rule?.yMin ?? null, ruleYEnd: sel.rule?.yMax ?? null, ruleLineWidth: sel.rule?.lineWidths ?? null, ruleSourceRefs: sel.rule?.sourcePaths ?? null,
          deltaX: delta, deltaX01: delta === null ? null : round1(delta), rowBBox: r.rowBBox, sourceTokenRefs: r.sourceTokenRefs, status: cand ? 'candidate' : sel.status === 'rule_linked' ? 'outside_band_or_name_unresolved' : sel.status,
        })));
      }
    }
    await doc.destroy();
    rotateByPdf[d.localPath] = rot;
    const status = source === 'research_display_extraction' && textStats.tokens === 0 ? 'unavailable_no_text_layer' : source === 'research_display_extraction' && textStats.asciiDigitTokens === 0 ? 'unavailable_text_not_decodable' : 'evaluated';
    inc(pdfStatusCounts, status);
    perPdf.push({ localPath: d.localPath, filename: d.localPath.split('/').pop(), publisherAuthority: d.publisherAuthority, account: d.accountType, pages: d.pages, source, status, textStats: source === 'research_display_extraction' ? textStats : null, pagesByRotate: rot, universeRows: rows.length, candidateRows: pdfCandidates, ruleStatus: pdfRule });
    console.log(`${d.localPath.split('/').pop()} [${source}] universe=${rows.length} candidates=${pdfCandidates} rotate=${JSON.stringify(rot)}`);
  }
  // 前回 Phase A の candidate（74 evaluable PDF）を再現するか
  const prevReproduced = [...prevCandidates].every(i => newCandidateIds.has(i)) && [...newCandidateIds].filter(i => baselinePdfs.has(i.split('|')[0])).length === prevCandidates.size;
  const gates = { duplicate_candidate_id_zero: duplicates === 0, unjoinable_zero: unjoinable === 0, source_provenance_loss_zero: provenanceLoss === 0, ruleX_lt_codeX_and_delta_positive: geometryViolations === 0, selected_rule_is_nearest_eligible: nearestViolations === 0, rule_raw_provenance: ruleProvLoss === 0, previous_916_candidates_reproduced_on_74_pdfs: prevReproduced, rotate0_tokens_equal_production: tokenEquivalenceOk === tokenEquivalenceChecked && tokenEquivalenceChecked > 0, all_82_pdfs_attempted: perPdf.length === 82 };
  const sortNum = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])));
  const gz = zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-universe.jsonl.gz`, gz);
  const evaluated = (perPdf as { status: string; candidateRows?: number; localPath: string }[]).filter(p => p.status === 'evaluated');
  const unavailable = (perPdf as { status: string; localPath: string; pages: number; textStats?: unknown }[]).filter(p => p.status !== 'evaluated').map(p => ({ localPath: p.localPath, pages: p.pages, status: p.status, textStats: p.textStats ?? null }));
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-8p6-rotate90-phaseA/v0',
    note: 'source-only。金額は条件にしない。rotate ≠ 0 の page は表示向きへ座標正規化して評価。MOF・hierarchy・manual・既存 item は未参照',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), universeGzSha256: sha(gz), scriptSha256: fileSha('scripts/pipeline-v2/run-budget-request-rule-8p6-rotate-phase-a.ts'), displayLibSha256: fileSha('scripts/pipeline-v2/lib/budget-request-display-page.ts'),
    corpus: { pdfs: docs.length, pages: docs.reduce((s, x) => s + x.pages, 0) }, pdfStatus: pdfStatusCounts, unavailablePdfs: unavailable, pageStatusExceptions: pageStatus,
    universeRows: counts.universe, candidateRows: counts.candidates, candidateByAccount: counts.account, candidateByPageRotate: counts.candidateByRotate, universeByPageRotate: counts.universeByRotate, ruleStatusUniverse: counts.ruleStatus,
    candidatePdfs: evaluated.filter(p => (p.candidateRows ?? 0) > 0).length, evaluatedPdfsWithoutCandidate: evaluated.filter(p => (p.candidateRows ?? 0) === 0).map(p => p.localPath),
    deltaX01: sortNum(dist01), gates, duplicates, provenanceLoss, perPdf,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-summary.json`, text);
  console.log(JSON.stringify({ sha: sha(text), gz: sha(gz), pdfStatus: pdfStatusCounts, universe: counts.universe, candidates: counts.candidates, account: counts.account, byRotate: counts.candidateByRotate, gates }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
