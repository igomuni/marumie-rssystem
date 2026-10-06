/**
 * Phase A（source-only）: 8.6pt ± 3.0pt 罫線基準の項候補（金額は条件にしない）の全 corpus 抽出。pre-band universe（band 外も deltaX 付きで保存）と candidate。
 * protocol: docs/tasks/20261005_2040_Budget_Request_8p6pt_Item_Candidate_Full_Corpus_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-rule-8p6-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { round1, round3, selectLeftRule, type SourceRecord, type VRule } from './lib/budget-request-rule-line-item-population';
import { isCandidate, universeRow, type UniverseRow } from './lib/budget-request-rule-8p6-candidate';

const FX = 'tests/fixtures';
const ISO = `${FX}/budget-request-hierarchy-failure-isolation/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const OUT = `${FX}/budget-request-rule-8p6-item-candidate/2024`;
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const FROZEN: Record<string, string> = {
  [`${ISO}/paired-manifest.json`]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [`${BASE_FIX}/extraction-baseline.json`]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f', [`${BASE_FIX}/reconciliation-result.json`]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [`${ISO}/transition-evaluation.json`]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd', [`${ISO}/off-diagnostic.json`]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562',
  'scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts': '50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7', 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts': '39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262',
  'scripts/pipeline-v2/lib/stable-id.ts': '038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5',
  'scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts': 'd0ef587ffc9c76e7e8785c63fe93e3a7ee73b17736ebf17e073e714e14fbe247',
  'docs/tasks/20261005_2040_Budget_Request_8p6pt_Item_Candidate_Full_Corpus_Protocol.md': 'ad022eeb14a763da4a61cd159fab078461a640bbc56619bbf71500318857b21a',
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
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');

  const coverage: Record<string, { pdfs: number; pages: number }> = {};
  const cov = (k: string, pages: number) => { (coverage[k] ??= { pdfs: 0, pages: 0 }); coverage[k].pdfs++; coverage[k].pages += pages; };
  const lines: string[] = [], perPdf: unknown[] = [], perPage: Record<string, Record<string, number>> = {};
  const counts = { universe: 0, candidates: 0, ruleStatus: {} as Record<string, number>, candidateNameClass: {} as Record<string, number>, universeNameClass: {} as Record<string, number>, account: {} as Record<string, number> };
  const dist01: Record<string, number> = {}, dist001: Record<string, number> = {};
  const ids = new Set<string>();
  let duplicates = 0, unjoinable = 0, provenanceLoss = 0, geometryViolations = 0, nearestViolations = 0, ruleProvLoss = 0, rawMin = Infinity, rawMax = -Infinity, rotatedPages = 0, candidatePdfs = 0, evaluablePdfsWithoutCandidate = 0;

  for (const d of docs) {
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    if (!fs.existsSync(f)) { cov('unavailable_upstream', d.pages); perPdf.push({ localPath: d.localPath, scan: 'unavailable_upstream' }); continue; }
    const res = readJson<DocRes>(f);
    if (res.status !== 'success') { const rot = res.segments.some(s => s.error?.includes('rotate=90')); cov(rot ? 'unavailable_rotate90' : 'unavailable_upstream', d.pages); perPdf.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, scan: rot ? 'unavailable_rotate90' : 'unavailable_upstream', pages: d.pages }); continue; }
    const recs: SourceRecord[] = [];
    for (const s of res.segments) {
      if (!s.outputs) throw new Error(`成功区間に records が無い: ${d.localPath}`);
      let file = s.outputs.records.path;
      if (s.mode === 'hierarchy_enabled') {
        if (!paired.has(d.localPath)) throw new Error(`paired でない PDF に hierarchy 区間がある: ${d.localPath}`);
        file = path.join(OFF_WORK, slugOf(d.localPath), `seg-${s.pages[0]}-${s.pages[1]}.records.jsonl.gz`);
        if (fileSha(file) !== off.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${file}`);
      } else if (fileSha(file) !== s.outputs.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${file}`);
      recs.push(...readGz<SourceRecord>(file));
    }
    cov('evaluable', d.pages);
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`原本の hash 不一致（STOP）: ${d.localPath}`);
    const rows = recs.map(universeRow).filter((x): x is UniverseRow => x !== null);
    const byPage = new Map<number, UniverseRow[]>();
    for (const r of rows) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page)!.push(r); }
    const pdfRule: Record<string, number> = {};
    let pdfCandidates = 0;
    const doc = rows.length === 0 ? null : await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (const [pn, prs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
        const page = await doc!.getPage(pn);
        const rotated = page.rotate !== 0;
        if (rotated) rotatedPages++;
        let rules: VRule[] = [];
        if (!rotated) { const ol = await page.getOperatorList(); rules = mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax, lineWidths: r.lineWidths, sourcePaths: r.sourcePaths })); }
        page.cleanup();
        for (const r of prs.sort((a, b) => a.logicalRowIndex - b.logicalRowIndex)) {
          const id = `${d.localPath}|p${r.page}|r${r.logicalRowIndex}`;
          if (ids.has(id)) duplicates++; ids.add(id);
          if (r.sourceTokenRefs.length === 0) provenanceLoss++;
          if (r.page < 1 || r.page > d.pages) unjoinable++;
          const sel = rotated ? { status: 'unavailable_rotate90' as const, rule: null, eligibleCount: 0 } : selectLeftRule(rules, r.codeX, r.rowBBox);
          let delta: number | null = null;
          if (sel.rule) {
            delta = r.codeX - sel.rule.x;
            if (!(sel.rule.x < r.codeX) || !(delta > 0)) geometryViolations++;
            const mid = (r.rowBBox.yMin + r.rowBBox.yMax) / 2;
            if (rules.some(q => q.x < r.codeX && q.yMin <= mid && mid <= q.yMax && q.x > sel.rule!.x)) nearestViolations++;
            if (sel.rule.sourcePaths.length === 0) ruleProvLoss++;
            rawMin = Math.min(rawMin, delta); rawMax = Math.max(rawMax, delta);
          }
          const cand = isCandidate(r, sel.status, delta);
          counts.universe++; inc(counts.ruleStatus, sel.status); inc(counts.universeNameClass, r.nameClass); inc(pdfRule, sel.status);
          if (delta !== null) { inc(dist01, round1(delta)); inc(dist001, round3(delta).toFixed(3)); }
          if (cand) { counts.candidates++; pdfCandidates++; inc(counts.candidateNameClass, r.nameClass); inc(counts.account, d.accountType); ((perPage[d.localPath] ??= {})[String(r.page)] = (perPage[d.localPath][String(r.page)] ?? 0) + 1); }
          lines.push(JSON.stringify(sortDeep({
            candidateId: id, isCandidate: cand, localPath: d.localPath, pdfSha256: d.sha256, account: d.accountType, ministry: d.publisherAuthority, page: r.page, logicalRowIndex: r.logicalRowIndex,
            code: r.codeRaw, codeX: r.codeX, nameRaw: r.nameRaw, nameNormalized: r.nameNormalized, nameComplete: r.nameComplete, nameClass: r.nameClass, nameStatus: r.nameStatus, nameReason: r.nameReason, nameTokenRefs: r.nameTokenRefs,
            ruleStatus: sel.status, eligibleRuleCount: sel.eligibleCount, ruleX: sel.rule?.x ?? null, ruleYStart: sel.rule?.yMin ?? null, ruleYEnd: sel.rule?.yMax ?? null, ruleLineWidth: sel.rule?.lineWidths ?? null, ruleSourceRefs: sel.rule?.sourcePaths ?? null,
            deltaX: delta, deltaX001: delta === null ? null : round3(delta).toFixed(3), deltaX01: delta === null ? null : round1(delta), rowBBox: r.rowBBox, sourceTokenRefs: r.sourceTokenRefs,
          })));
        }
      }
    } finally { if (doc) await doc.destroy(); }
    if (pdfCandidates > 0) candidatePdfs++; else evaluablePdfsWithoutCandidate++;
    perPdf.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, scan: 'evaluable', pages: d.pages, universeRows: rows.length, candidateRows: pdfCandidates, ruleStatus: pdfRule });
    console.log(`${d.localPath.split('/').pop()} universe=${rows.length} candidates=${pdfCandidates}`);
  }
  const gates = { duplicate_candidate_id_zero: duplicates === 0, unjoinable_zero: unjoinable === 0, source_provenance_loss_zero: provenanceLoss === 0, ruleX_lt_codeX_and_delta_positive: geometryViolations === 0, selected_rule_is_nearest_eligible: nearestViolations === 0, rule_raw_provenance: ruleProvLoss === 0 };
  const sortNum = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])));
  const gz = zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-universe.jsonl.gz`, gz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-8p6-item-candidate-phaseA/v0',
    note: 'source-only。金額は条件にしない。MOF・hierarchy・manual・既存 item は未参照。band 5.6 <= deltaX <= 11.6 を candidate とし、band 外も universe に保存',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), universeGzSha256: sha(gz), scriptSha256: fileSha('scripts/pipeline-v2/run-budget-request-rule-8p6-phase-a.ts'), libSha256: fileSha('scripts/pipeline-v2/lib/budget-request-rule-8p6-candidate.ts'),
    corpus: { pdfs: docs.length, pages: docs.reduce((s, x) => s + x.pages, 0) }, coverage, rotatedPagesInEvaluablePdfs: rotatedPages,
    universeRows: counts.universe, candidateRows: counts.candidates, candidatePdfs, evaluablePdfsWithoutCandidate, ruleStatusUniverse: counts.ruleStatus, universeNameClass: counts.universeNameClass, candidateNameClass: counts.candidateNameClass, candidateByAccount: counts.account,
    deltaX: { rawMin: Number.isFinite(rawMin) ? rawMin : null, rawMax: Number.isFinite(rawMax) ? rawMax : null, by01: sortNum(dist01), by001: sortNum(dist001) },
    perPageCandidates: perPage, gates, duplicates, provenanceLoss, perPdf,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-summary.json`, text);
  console.log(JSON.stringify({ sha: sha(text), gz: sha(gz), corpus: [docs.length], coverage, universe: counts.universe, candidates: counts.candidates, candidatePdfs, evaluablePdfsWithoutCandidate, ruleStatus: counts.ruleStatus, gates, by01: dist01 }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
