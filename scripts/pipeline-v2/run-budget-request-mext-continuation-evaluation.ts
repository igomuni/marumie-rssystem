/**
 * 項名称の source-only continuation を既存 8.6pt candidate 全体に適用し、MOF name-only exact の before / after を評価する。
 * protocol: docs/tasks/20261006_0640_Budget_Request_MEXT_Item_Name_Continuation_Protocol.md / preregistration: docs/tasks/20261006_0655_Budget_Request_MEXT_Item_Name_Continuation_Preregistration.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-mext-continuation-evaluation.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDisplayPage, type PdfjsPageLike } from './lib/budget-request-display-page';
import { layoutForPage, observeColumnLayout, type ColumnLayout, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { composeContinuation, joinedName, rowTokensOf, type ContinuationResult } from './lib/budget-request-name-continuation';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const LA = `${FX}/budget-request-item-layout-anchor/2024`, R = `${FX}/budget-request-rule-8p6-rotate90/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`, OUT = `${FX}/budget-request-mext-continuation/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const FROZEN: Record<string, string> = {
  [`${OUT}/baseline.json`]: 'b8362971a408304d37065a753183a2c3b0e969db40797de004673794b6ad4a90', [`${OUT}/phaseA-isolation.json`]: 'c562ddc0396cffb42d17d8d20599f99e0659c5f0b5961f914eae5b479ba79dc7',
  [`${LA}/after-evaluation.json`]: 'fa216afd5da6b42bc90b1c38eae7090d434fabb98b02853e827eb55905f1a2fc', [`${LA}/profile-candidates.jsonl.gz`]: 'bbd828b2d0005bde638b3f22aa60a4db3056ed502012efdce3c8502cd50f4ce1',
  [`${R}/phaseA-universe.jsonl.gz`]: '', [JIKOU]: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224', 'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'docs/tasks/20261006_0640_Budget_Request_MEXT_Item_Name_Continuation_Protocol.md': '5fd155d9b8a6dac27a664f35368c10ab94dc8862b789e3fd1865d5ef19551fbb', 'docs/tasks/20261006_0655_Budget_Request_MEXT_Item_Name_Continuation_Preregistration.md': 'b36bfae06f5bafadc45d3eafae68f25036d3fd84a78da7e90235601523cd6d5f',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');

interface Cand { candidateId: string; localPath: string; filename: string; account: string; ministry: string; page: number; logicalRowIndex: number; code: string; codeX: number; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; nameClass?: string; ruleX: number | null; deltaX: number | null; origin: string }
interface Sec { id: string; code: string; name: string; norm: string; ministry: string }

async function main() {
  const universePath = `${R}/phaseA-universe.jsonl.gz`;
  const baseline = readJson<{ exactCoveredMofRows: number; exactCoveredMofRowIds: string[]; unmatchedMofRows: number; candidateRows: number; mextUnmatched: { mofSectionId: string; name: string; sourceClass: string }[]; unmatchedByMinistry: Record<string, number> }>(`${OUT}/baseline.json`);
  for (const [p, h] of Object.entries(FROZEN)) if (p !== universePath && fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${R}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
  const docs = readJson<{ documents: { localPath: string; sha256: string; pages: number }[] }>(`${BASE_FIX}/corpus-manifest.json`).documents;

  const universeCands = readGz<Cand & { isCandidate: boolean }>(universePath).filter(r => r.isCandidate).map(r => ({ ...r, origin: 'existing_8p6_band' }));
  const profileCands = readGz<Cand>(`${LA}/profile-candidates.jsonl.gz`);
  const before: Cand[] = [...universeCands, ...profileCands];
  if (before.length !== baseline.candidateRows) throw new Error('candidate population が baseline と一致しない（STOP）');

  // MOF
  const secMap = new Map<string, Sec>();
  for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !secMap.has(j.parentSectionId)) secMap.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry });
  if (secMap.size !== 784) throw new Error('MOF 一般会計 784 でない（STOP）');
  const secs = [...secMap.values()].sort((a, b) => cmp(a.id, b.id));
  const byNorm = new Map<string, string[]>();
  for (const s of secs) byNorm.set(s.norm, [...(byNorm.get(s.norm) ?? []), s.id]);
  const evalSet = (cs: Cand[]) => {
    const covered = new Map<string, Cand[]>(), cls: Record<string, number> = {};
    for (const c of cs.filter(x => x.account === 'general')) {
      if (!c.nameComplete || !c.nameNormalized) { inc(cls, 'name_unavailable'); continue; }
      const m = byNorm.get(normalizeKey(c.nameNormalized)) ?? [];
      if (m.length === 0) { inc(cls, 'no_exact_name_match'); continue; }
      inc(cls, m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous');
      for (const i of m) covered.set(i, [...(covered.get(i) ?? []), c]);
    }
    return { covered, cls, distinctNames: new Set([...covered.keys()].map(i => secMap.get(i)!.norm)).size };
  };
  const B = evalSet(before);
  if (B.covered.size !== baseline.exactCoveredMofRows || JSON.stringify([...B.covered.keys()].sort()) !== JSON.stringify(baseline.exactCoveredMofRowIds)) throw new Error('before の exact identity が baseline と一致しない（STOP）');

  // continuation の適用（既存 8.6pt candidate）
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const byPdf = new Map<string, Cand[]>();
  for (const c of universeCands) byPdf.set(c.localPath, [...(byPdf.get(c.localPath) ?? []), c]);
  const updates = new Map<string, { raw: string; normalized: string }>();
  const fired: unknown[] = [];
  let unjoinable = 0, baseMismatch = 0, baseChecked = 0, appendedLinesMax = 0, provenanceLoss = 0;
  const firedByPdf: Record<string, number> = {}, linesDist: Record<string, number> = {}, baseMismatchSamples: unknown[] = [];

  for (const d of docs) {
    const cs = byPdf.get(d.localPath); if (!cs) continue;
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`原本の hash 不一致（STOP）: ${d.localPath}`);
    const resFile = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    const res = fs.existsSync(resFile) ? readJson<{ status: string; segments: { pages: [number, number] }[] }>(resFile) : null;
    const segments: [number, number][] = res && res.status === 'success' ? res.segments.map(s => s.pages) : [[1, d.pages]];
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const candByPage = new Map<number, Cand[]>();
    for (const c of cs) candByPage.set(c.page, [...(candByPage.get(c.page) ?? []), c]);
    const lastPage = Math.max(...candByPage.keys());
    for (const [a, b] of segments) {
      if (a > lastPage) continue;
      let lastLayout: ColumnLayout | null = null;
      for (let n = a; n <= Math.min(b, lastPage); n++) {
        const pg = await doc.getPage(n);
        const ex = await extractDisplayPage(pg as unknown as PdfjsPageLike, n, doc.numPages);
        pg.cleanup();
        const own = observeColumnLayout(n, ex.tokens); if (own) lastLayout = own;
        const here = candByPage.get(n); if (!here) continue;
        const geometry = buildTableGeometry(ex.tokens, ex.meta);
        const page: FieldResolverPageInput = { meta: ex.meta, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.meta, geometry) };
        const { layout } = layoutForPage(n, own, lastLayout, geometry);
        for (const c of here) {
          const ri = page.logical.logicalRowCandidates.findIndex(r => r.logicalRowIndex === c.logicalRowIndex);
          const codeTok = ri < 0 ? undefined : rowTokensOf(page, ri).find(x => x.token.rawText.trim() === c.code && Math.abs(x.token.bbox.xMin - c.codeX) < 0.01)?.token;
          if (ri < 0 || !codeTok || !layout) { unjoinable++; continue; }
          const r: ContinuationResult = composeContinuation(page, layout, ri, codeTok.index);
          const jn = joinedName(r);
          const baseNorm = normalizeKey(r.baseLines.map(l => l.text).join(''));
          if (c.nameComplete && c.nameNormalized !== null) { baseChecked++; if (baseNorm !== c.nameNormalized) { baseMismatch++; if (baseMismatchSamples.length < 5) baseMismatchSamples.push({ id: c.candidateId, baseNorm, before: c.nameNormalized, fired: r.fired }); } }
          if (!r.fired) continue;
          const after = normalizeKey(jn.concatenated);
          // before が resolved なら、基底名称は before の名称と一致していなければならない（異なれば別の構成になっている）
          updates.set(c.candidateId, { raw: jn.raw, normalized: after });
          const nLines = r.appended.reduce((s, x) => s + x.lines.length, 0);
          appendedLinesMax = Math.max(appendedLinesMax, nLines); inc(linesDist, String(nLines)); inc(firedByPdf, d.localPath);
          const toks = r.appended.flatMap(x => x.lines.flatMap(l => l.tokens));
          if (toks.length === 0 || toks.some(t => !page.tokens[t.index] || page.tokens[t.index].rawText !== t.text)) provenanceLoss++;
          fired.push({
            candidateId: c.candidateId, localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, code: c.code, beforeName: c.nameRaw, beforeNameNormalized: c.nameNormalized, beforeNameClass: c.nameClass ?? null,
            appendedSourceText: r.appended.flatMap(x => x.lines.map(l => l.text)), appendedLines: nLines, afterName: jn.raw, afterNameNormalized: after,
            firedReason: 'existing guard A(directly below) ∧ B(name start x aligned) ∧ ¬C(no code) ∧ ¬D(no amount) satisfied for each appended row', stop: r.stop,
            continuationTokens: r.appended.flatMap(x => x.lines.flatMap(l => l.tokens.map(t => ({ logicalRowIndex: x.logicalRowIndex, index: t.index, text: t.text, bbox: t.bbox })))), guardPerAppendedRow: r.appended.map(x => ({ logicalRowIndex: x.logicalRowIndex, ...x.guard })),
            baseEquivalentToBefore: c.nameNormalized === null ? null : baseNorm === c.nameNormalized,
          });
        }
      }
    }
    await doc.destroy();
    console.log(`${d.localPath.split('/').pop()} candidates=${cs.length} fired(so far)=${firedByPdf[d.localPath] ?? 0}`);
  }

  // after
  const after: Cand[] = before.map(c => { const u = updates.get(c.candidateId); return u ? { ...c, nameRaw: u.raw, nameNormalized: u.normalized, nameComplete: true } : c; });
  const A = evalSet(after);
  const newly = secs.filter(s => A.covered.has(s.id) && !B.covered.has(s.id)), lost = secs.filter(s => B.covered.has(s.id) && !A.covered.has(s.id));
  const nonFiredNameChanged = after.filter((c, i) => !updates.has(c.candidateId) && (c.nameRaw !== before[i].nameRaw || c.nameNormalized !== before[i].nameNormalized)).length;
  const otherFieldChanged = after.filter((c, i) => c.candidateId !== before[i].candidateId || c.code !== before[i].code || c.codeX !== before[i].codeX || c.ruleX !== before[i].ruleX || c.deltaX !== before[i].deltaX || c.localPath !== before[i].localPath || c.page !== before[i].page).length;
  const firedPdfs = new Set(Object.keys(firedByPdf));
  const unrelatedChanged = after.filter((c, i) => !firedPdfs.has(c.localPath) && (c.nameRaw !== before[i].nameRaw || c.nameNormalized !== before[i].nameNormalized)).length;
  const dup = after.length - new Set(after.map(c => c.candidateId)).size;
  const absentIds = baseline.mextUnmatched.filter(m => m.sourceClass === 'SOURCE_FULL_NAME_ABSENT').map(m => m.mofSectionId);
  const negativeGenerated = absentIds.filter(i => A.covered.has(i));
  const unmatchedAfter = secs.filter(s => !A.covered.has(s.id));
  const byMinistry: Record<string, number> = {}; for (const s of unmatchedAfter) inc(byMinistry, s.ministry);
  const mextAfter = unmatchedAfter.filter(s => s.ministry === '文部科学省').map(s => ({ mofSectionId: s.id, code: s.code, name: s.name, baselineSourceClass: baseline.mextUnmatched.find(m => m.mofSectionId === s.id)?.sourceClass ?? null }));
  const newMatches = newly.flatMap(s => A.covered.get(s.id)!.filter(c => updates.has(c.candidateId)).map(c => ({ mofSectionId: s.id, mofMinistry: s.ministry, mofCode: s.code, mofName: s.name, candidateId: c.candidateId, localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, pdfCode: c.code, beforeName: before.find(b => b.candidateId === c.candidateId)!.nameRaw, afterName: c.nameRaw, deltaX: c.deltaX, codeMatchesMof: s.code === c.code })));
  const gates = {
    baseline_reproduced_717_of_784: B.covered.size === 717, unjoinable_zero: unjoinable === 0, base_name_equivalent_to_production_on_resolved_candidates: baseMismatch === 0,
    rule_fired_at_least_once: fired.length > 0, at_least_one_of_three_items_recovered: newly.some(s => baseline.mextUnmatched.some(m => m.mofSectionId === s.id && m.sourceClass.startsWith('SPLIT'))), coverage_increased: A.covered.size > B.covered.size,
    lost_exact_mof_rows_zero: lost.length === 0, negative_five_not_generated: negativeGenerated.length === 0, unrelated_pdf_changed_zero: unrelatedChanged === 0, non_fired_name_changed_zero: nonFiredNameChanged === 0, code_and_anchor_unchanged: otherFieldChanged === 0, no_duplicate: dup === 0, provenance_loss_zero: provenanceLoss === 0,
  };
  const go = Object.values(gates).every(Boolean);
  fs.mkdirSync(OUT, { recursive: true });
  const gzF = zlib.gzipSync(Buffer.from(fired.map(f => JSON.stringify(sortDeep(f))).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/continuation-fired.jsonl.gz`, gzF);
  const gzN = zlib.gzipSync(Buffer.from(newMatches.map(m => JSON.stringify(sortDeep(m))).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/new-exact-matches.jsonl.gz`, gzN);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-mext-continuation-after/v0', note: 'source-only continuation（既存 guard predicate A∧B∧¬C∧¬D）を既存 8.6pt candidate 全体に適用した after 評価。MOF・金額 0 は continuation の判定に使っていない',
    frozen: Object.fromEntries(Object.keys(FROZEN).filter(p => p !== universePath).map(p => [p, fileSha(p)])), scriptSha256: fileSha('scripts/pipeline-v2/run-budget-request-mext-continuation-evaluation.ts'), libSha256: fileSha('scripts/pipeline-v2/lib/budget-request-name-continuation.ts'),
    scope: { candidatesEvaluated: universeCands.length, profileCandidatesUnchanged: profileCands.length, pdfsEvaluated: byPdf.size },
    rule: { firedCandidates: fired.length, firedPdfs: firedPdfs.size, firedByPdf, appendedLinesDistribution: linesDist, appendedLinesMax, continuationFiredGzSha256: sha(gzF), baseNameChecked: baseChecked, baseNameMismatches: baseMismatch, baseMismatchSamples },
    beforeAfter: { mofTotal: { before: 784, after: 784 }, exactCoveredMofRows: { before: B.covered.size, after: A.covered.size, delta: A.covered.size - B.covered.size }, unmatchedMofRows: { before: secs.length - B.covered.size, after: secs.length - A.covered.size, delta: -(A.covered.size - B.covered.size) }, mextUnmatched: { before: baseline.mextUnmatched.length, after: mextAfter.length, delta: mextAfter.length - baseline.mextUnmatched.length }, distinctNormalizedNamesCovered: { before: B.distinctNames, after: A.distinctNames, delta: A.distinctNames - B.distinctNames }, candidateClassCounts: { before: B.cls, after: A.cls } },
    newlyExactMofRows: newly.length, newExactMatchesGzSha256: sha(gzN), newlyExactMof: newMatches,
    regression: { lostExactMofRows: lost.length, nonFiredCandidateNameChanged: nonFiredNameChanged, unrelatedPdfNameChanged: unrelatedChanged, codeOrAnchorChanged: otherFieldChanged, duplicateCandidateIds: dup, provenanceLoss, unjoinable },
    negativeEvidence: { sourceFullNameAbsentCount: absentIds.length, generatedAsExact: negativeGenerated, stillUnmatched: absentIds.filter(i => !A.covered.has(i)).length },
    unmatchedAfter: { total: unmatchedAfter.length, byMinistry: Object.fromEntries(Object.entries(byMinistry).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))), mext: mextAfter }, gates, go,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/after-evaluation.json`, text);
  console.log(JSON.stringify({ sha: sha(text), fired: fired.length, firedPdfs: firedPdfs.size, linesDist, beforeAfter: [B.covered.size, A.covered.size], newly: newMatches.map(m => [m.mofName, m.page]), lost: lost.length, baseMismatch, baseChecked, unjoinable, negativeGenerated, mextAfter: mextAfter.length, byMinistry, gates, go }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
