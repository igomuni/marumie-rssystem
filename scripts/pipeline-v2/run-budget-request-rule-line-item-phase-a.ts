/**
 * Phase A（source-only）: 罫線 → NNN → 名称 → 金額列 の構造を持つ row の全 corpus inventory と、罫線から NNN 先頭までの距離。
 * protocol: docs/tasks/20261005_1930_Budget_Request_RuleLine_Item_Population_Inventory_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-rule-line-item-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { round1, round3, selectLeftRule, structuralRow, type SourceRecord, type StructuralRow, type VRule } from './lib/budget-request-rule-line-item-population';

const FX = 'tests/fixtures';
const ISO = `${FX}/budget-request-hierarchy-failure-isolation/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const OUT = `${FX}/budget-request-rule-line-item-population/2024`;
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const FROZEN: Record<string, string> = {
  [`${ISO}/paired-manifest.json`]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [`${BASE_FIX}/extraction-baseline.json`]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f', [`${BASE_FIX}/reconciliation-result.json`]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [`${ISO}/transition-evaluation.json`]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd', [`${ISO}/off-diagnostic.json`]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562',
  'scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts': '50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7', 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts': '39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262',
  'scripts/pipeline-v2/lib/stable-id.ts': '038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5',
  'docs/tasks/20261005_1930_Budget_Request_RuleLine_Item_Population_Inventory_Protocol.md': '3b04ce00a8f1d991077d94fe740efff06c0d03819e24ac1a1e528e4f4ff9f0c0',
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
  const paired = new Set(readJson<{ documents: { localPath: string; class: string }[] }>(`${ISO}/paired-manifest.json`).documents.filter(d => d.class === 'paired_evaluable').map(d => d.localPath));
  const off = readJson<{ documents: { localPath: string; recordsSha256: string }[] }>(`${ISO}/off-diagnostic.json`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');

  const coverage: Record<string, { pdfs: number; pages: number }> = {};
  const cov = (k: string, pages: number) => { (coverage[k] ??= { pdfs: 0, pages: 0 }); coverage[k].pdfs++; coverage[k].pages += pages; };
  const lines: string[] = [], perPdf: unknown[] = [];
  const counts = { structural: 0, ruleStatus: {} as Record<string, number>, nameStatus: {} as Record<string, number>, amountPattern: {} as Record<string, number>, account: {} as Record<string, number>, ministry: {} as Record<string, number> };
  const dist001: Record<string, { n: number; pdfs: Set<string>; account: Record<string, number>; pattern: Record<string, number> }> = {};
  const dist01: Record<string, { n: number; pdfs: Set<string>; account: Record<string, number>; pattern: Record<string, number> }> = {};
  const ids = new Set<string>();
  let duplicates = 0, provenanceLoss = 0, geometryViolations = 0, nearestViolations = 0, ruleProvLoss = 0, rawMin = Infinity, rawMax = -Infinity;

  for (const d of docs) {
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    if (!fs.existsSync(f)) { cov('unscannable_missing_upstream_artifact', d.pages); perPdf.push({ localPath: d.localPath, scan: 'unscannable_missing_upstream_artifact' }); continue; }
    const res = readJson<DocRes>(f);
    if (res.status !== 'success') { const rot = res.segments.some(s => s.error?.includes('rotate=90')); cov(rot ? 'unscannable_rotate90' : 'unscannable_other', d.pages); perPdf.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, scan: rot ? 'unscannable_rotate90' : 'unscannable_other', pages: d.pages }); continue; }
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
    cov('scannable', d.pages);
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`原本の hash 不一致（STOP）: ${d.localPath}`);
    const rows = recs.map(structuralRow).filter((x): x is StructuralRow => x !== null);
    const byPage = new Map<number, StructuralRow[]>();
    for (const r of rows) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page)!.push(r); }
    const pdfRule: Record<string, number> = {};
    const doc = rows.length === 0 ? null : await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (const [pn, prs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
        const page = await doc!.getPage(pn);
        const rotated = page.rotate !== 0;
        let rules: VRule[] = [];
        if (!rotated) { const ol = await page.getOperatorList(); rules = mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax, lineWidths: r.lineWidths, sourcePaths: r.sourcePaths })); }
        page.cleanup();
        for (const r of prs.sort((a, b) => a.logicalRowIndex - b.logicalRowIndex)) {
          const id = `${d.localPath}|p${r.page}|r${r.logicalRowIndex}`;
          if (ids.has(id)) duplicates++; ids.add(id);
          if (r.sourceTokenRefs.length === 0 || r.amountTokenRefs.length === 0) provenanceLoss++;
          const sel = rotated ? { status: 'unavailable_rotate90' as const, rule: null, eligibleCount: 0 } : selectLeftRule(rules, r.codeX, r.rowBBox);
          let distRaw: number | null = null;
          if (sel.rule) {
            distRaw = r.codeX - sel.rule.x;
            if (!(sel.rule.x < r.codeX) || !(distRaw > 0)) geometryViolations++;
            const mid = (r.rowBBox.yMin + r.rowBBox.yMax) / 2;
            if (rules.some(q => q.x < r.codeX && q.yMin <= mid && mid <= q.yMax && q.x > sel.rule!.x)) nearestViolations++;
            if (sel.rule.sourcePaths.length === 0) ruleProvLoss++;
            rawMin = Math.min(rawMin, distRaw); rawMax = Math.max(rawMax, distRaw);
          }
          counts.structural++; inc(counts.ruleStatus, sel.status); inc(counts.nameStatus, r.nameStatus); inc(counts.amountPattern, r.amountPattern); inc(counts.account, d.accountType); inc(counts.ministry, d.publisherAuthority); inc(pdfRule, sel.status);
          const d1 = distRaw === null ? null : round1(distRaw), d3 = distRaw === null ? null : round3(distRaw).toFixed(3);
          if (d1 !== null && d3 !== null) for (const [m, k] of [[dist01, d1], [dist001, d3]] as const) { const e = (m[k] ??= { n: 0, pdfs: new Set(), account: {}, pattern: {} }); e.n++; e.pdfs.add(d.localPath); inc(e.account, d.accountType); inc(e.pattern, r.amountPattern); }
          lines.push(JSON.stringify(sortDeep({
            candidateId: id, localPath: d.localPath, pdfSha256: d.sha256, account: d.accountType, ministry: d.publisherAuthority, page: r.page, logicalRowIndex: r.logicalRowIndex, requestShaped: false,
            codeRaw: r.codeRaw, codeNormalized: r.codeNormalized, codeX: r.codeX, nameRaw: r.nameRaw, nameNormalized: r.nameNormalized, nameStatus: r.nameStatus, nameTokenRefs: r.nameTokenRefs,
            amountEvidence: r.amountEvidence, previousBudgetEvidence: r.previousBudgetEvidence, requestBudgetEvidence: r.requestBudgetEvidence, differenceEvidence: r.differenceEvidence, amountPattern: r.amountPattern, amountStatuses: r.amountStatuses, amountTokenRefs: r.amountTokenRefs,
            ruleStatus: sel.status, eligibleRuleCount: sel.eligibleCount, leftRuleX: sel.rule?.x ?? null, leftRuleYStart: sel.rule?.yMin ?? null, leftRuleYEnd: sel.rule?.yMax ?? null, leftRuleWidth: sel.rule?.lineWidths ?? null, leftRuleSourceRefs: sel.rule?.sourcePaths ?? null,
            ruleToCodeDistanceRaw: distRaw, ruleToCodeDistance001: d3, ruleToCodeDistance01: d1, rowBBox: r.rowBBox, sourceTokenRefs: r.sourceTokenRefs,
          })));
        }
      }
    } finally { if (doc) await doc.destroy(); }
    perPdf.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, scan: 'scannable', pages: d.pages, structuralRows: rows.length, ruleStatus: pdfRule });
    console.log(`${d.localPath.split('/').pop()} rows=${rows.length} ${JSON.stringify(pdfRule)}`);
  }
  const gates = { A_duplicate_candidate_id_zero: duplicates === 0, A_source_provenance_loss_zero: provenanceLoss === 0, A_leftRuleX_lt_codeX_and_distance_positive: geometryViolations === 0, A_selected_rule_is_nearest_eligible: nearestViolations === 0, A_rule_raw_provenance: ruleProvLoss === 0 };
  const fin = (m: typeof dist01) => Object.fromEntries(Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k, { candidates: v.n, pdfs: v.pdfs.size, accountBreakdown: v.account, amountPatterns: v.pattern }]));
  const gz = zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-candidates.jsonl.gz`, gz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-line-item-population-phaseA/v0',
    note: 'source-only。MOF・hierarchy・manual contract・existing item・既知の indent 定数は未参照。罫線距離の閾値は置かない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), candidatesGzSha256: sha(gz), scriptSha256: fileSha('scripts/pipeline-v2/run-budget-request-rule-line-item-phase-a.ts'), libSha256: fileSha('scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts'),
    coverage, structuralRows: counts.structural, ruleStatus: counts.ruleStatus, nameStatus: counts.nameStatus, amountPattern: counts.amountPattern, byAccount: counts.account, byMinistry: counts.ministry,
    distance: { rawMin: Number.isFinite(rawMin) ? rawMin : null, rawMax: Number.isFinite(rawMax) ? rawMax : null, distinct01: Object.keys(dist01).length, distinct001: Object.keys(dist001).length, by01: fin(dist01), by001: fin(dist001) },
    gates, perPdf,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-summary.json`, text);
  console.log(JSON.stringify({ sha: sha(text), gz: sha(gz), coverage, structural: counts.structural, ruleStatus: counts.ruleStatus, gates, distinct01: Object.keys(dist01).length }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
