/**
 * 項の物理 anchor が 1 段シフトした layout（内閣府 0.pdf）の profile を source から導出して項 candidate を追加し、MOF 名称 only exact coverage の before / after を評価する。
 * protocol: docs/tasks/20261005_2245_Budget_Request_Item_Layout_Anchor_Coverage_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-item-layout-anchor-evaluation.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { extractDisplayPage, type PdfjsPageLike } from './lib/budget-request-display-page';
import { deriveProfile, findOrgSubtotalMarkers, isItemRow, rowNameFromTokens, assignLevels, type OrgSubtotalMarker, type ProfileRow } from './lib/budget-request-item-layout-profile';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { selectLeftRule, type SourceRecord, type VRule } from './lib/budget-request-rule-line-item-population';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const R = `${FX}/budget-request-rule-8p6-rotate90/2024`, OUT = `${FX}/budget-request-item-layout-anchor/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl'), ITEMS = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-items.jsonl');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const PROFILE_PDF = 'data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf';
const MEXT_PDF = 'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';
const FROZEN: Record<string, string> = {
  [`${OUT}/baseline.json`]: '68e601fcd16aab9b92ed685ddb11abe6384133233c9bee1b35eb57c09d766f24', [JIKOU]: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e',
  [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', 'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'docs/tasks/20261005_2245_Budget_Request_Item_Layout_Anchor_Coverage_Protocol.md': '8ee523588d43ced7a40b78f872ae6e408f9719303edcd27684e5b331acf8ebf4',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Cand { candidateId: string; localPath: string; filename: string; account: string; ministry: string; page: number; logicalRowIndex: number; code: string; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; ruleX: number | null; codeX: number; deltaX: number | null; origin: 'existing_8p6_band' | 'layout_profile_item_anchor' }
interface Sec { id: string; code: string; name: string; norm: string; ministry: string; organization: string; naturalKey: string }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${R}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
  const baseline = readJson<{ exactCoveredMofRows: number; unmatchedMofRows: number; candidateRows: number; unmatchedMof: { mofSectionId: string }[]; unmatchedByMinistry: Record<string, number> }>(`${OUT}/baseline.json`);
  const manifestDocs = readJson<{ documents: { localPath: string; sha256: string; accountType: string; publisherAuthority: string }[] }>(`${BASE_FIX}/corpus-manifest.json`).documents;
  const profileDoc = manifestDocs.find(d => d.localPath === PROFILE_PDF)!;
  if (fileSha(PROFILE_PDF) !== profileDoc.sha256) throw new Error(`原本の hash 不一致（STOP）: ${PROFILE_PDF}`);

  // MOF 一般会計 784 項
  const secMap = new Map<string, Sec>();
  for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !secMap.has(j.parentSectionId)) secMap.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry, organization: j.organization, naturalKey: j.sectionNaturalKey });
  if (secMap.size !== 784) throw new Error(`MOF 一般会計の項が 784 でない（STOP）: ${secMap.size}`);
  const secs = [...secMap.values()].sort((a, b) => cmp(a.id, b.id));
  const byNorm = new Map<string, Sec[]>();
  for (const s of secs) { if (!byNorm.has(s.norm)) byNorm.set(s.norm, []); byNorm.get(s.norm)!.push(s); }

  // before: 既存 candidate（frozen universe）
  const universe = readGz<{ isCandidate: boolean; candidateId: string; localPath: string; filename: string; account: string; ministry: string; page: number; logicalRowIndex: number; code: string; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; ruleX: number | null; codeX: number; deltaX: number | null }>(`${R}/phaseA-universe.jsonl.gz`);
  const before: Cand[] = universe.filter(r => r.isCandidate).map(r => ({ candidateId: r.candidateId, localPath: r.localPath, filename: r.filename, account: r.account, ministry: r.ministry, page: r.page, logicalRowIndex: r.logicalRowIndex, code: r.code, nameRaw: r.nameRaw, nameNormalized: r.nameNormalized, nameComplete: r.nameComplete, ruleX: r.ruleX, codeX: r.codeX, deltaX: r.deltaX, origin: 'existing_8p6_band' }));

  // profile PDF: records + rules + tokens
  const res = readJson<{ segments: { outputs: { records: { path: string; sha256: string } } }[] }>(path.join(BASE_WORK, slugOf(PROFILE_PDF), 'result.json'));
  const recs: SourceRecord[] = [];
  for (const s of res.segments) { if (fileSha(s.outputs.records.path) !== s.outputs.records.sha256) throw new Error('baseline artifact の hash 不一致'); recs.push(...readGz<SourceRecord>(s.outputs.records.path)); }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(PROFILE_PDF)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  interface RowInfo extends ProfileRow { rec: SourceRecord; rules: VRule[]; tokens: Awaited<ReturnType<typeof extractDisplayPage>>['tokens']; rightBoundary: number }
  const rowInfos: RowInfo[] = [], markers: OrgSubtotalMarker[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const ex = await extractDisplayPage(page as unknown as PdfjsPageLike, n, doc.numPages);
    const ol = await page.getOperatorList();
    const rules: VRule[] = mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax, lineWidths: r.lineWidths, sourcePaths: r.sourcePaths }));
    page.cleanup();
    markers.push(...findOrgSubtotalMarkers(n, ex.tokens));
    for (const r of recs.filter(x => x.anchor.page === n)) {
      const c = r.rowLocal.code; const raw = c.status === 'resolved' ? c.value?.raw ?? null : null;
      if (!raw || !c.evidence) continue;
      const kind = /^\d{3}$/.test(raw) && r.recordKind !== 'request' ? 'plain3' : r.recordKind === 'request' && /^\d{2}-\d{2,5}$/.test(raw) ? 'request' : null;
      if (!kind) continue;
      const sel = selectLeftRule(rules, c.evidence.bboxUnion.xMin, r.anchorBBox);
      const mid = (r.anchorBBox.yMin + r.anchorBBox.yMax) / 2;
      const rb = Math.min(...rules.filter(q => q.x > c.evidence!.bboxUnion.xMin && q.yMin <= mid && mid <= q.yMax).map(q => q.x), Infinity);
      rowInfos.push({ page: n, y: r.anchorBBox.yMin, kind, deltaX: sel.rule ? c.evidence.bboxUnion.xMin - sel.rule.x : null, ruleX: sel.rule?.x ?? null, rec: r, rules, tokens: ex.tokens, rightBoundary: rb });
    }
  }
  await doc.destroy();
  const profile = deriveProfile(rowInfos, markers);
  const levelOf = new Map(assignLevels(rowInfos, markers).map(l => [l.row, l.level]));
  const profileCands: (Cand & { rawRowText: string; level: string; profileId: string })[] = [];
  let excludedEmptyName = 0;
  if (profile.valid) for (const ri of rowInfos) {
    if (!isItemRow(ri, profile)) continue;
    const c = ri.rec.rowLocal.code.evidence!;
    const name = rowNameFromTokens(ri.tokens, ri.rec.anchorBBox, (c.bboxUnion as unknown as { xMax: number }).xMax, ri.rightBoundary);
    if (name === '') { excludedEmptyName++; continue; }
    const mid = (ri.rec.anchorBBox.yMin + ri.rec.anchorBBox.yMax) / 2;
    const rawRowText = ri.tokens.filter(t => t.rawText.trim() !== '' && (t.bbox.yMin + t.bbox.yMax) / 2 >= ri.rec.anchorBBox.yMin && (t.bbox.yMin + t.bbox.yMax) / 2 <= ri.rec.anchorBBox.yMax).sort((a, b) => a.bbox.xMin - b.bbox.xMin || a.index - b.index).map(t => t.rawText.trim()).join(' ');
    void mid;
    profileCands.push({ candidateId: `${PROFILE_PDF}|p${ri.page}|r${ri.rec.anchor.logicalRowIndex}`, localPath: PROFILE_PDF, filename: '0.pdf', account: profileDoc.accountType, ministry: profileDoc.publisherAuthority, page: ri.page, logicalRowIndex: ri.rec.anchor.logicalRowIndex, code: ri.rec.rowLocal.code.value!.raw, nameRaw: name, nameNormalized: normalizeKey(name), nameComplete: true, ruleX: ri.ruleX, codeX: c.bboxUnion.xMin, deltaX: ri.deltaX, origin: 'layout_profile_item_anchor', rawRowText, level: levelOf.get(ri) ?? 'unknown', profileId: `${PROFILE_PDF}#derived` });
  }
  const after: Cand[] = [...before, ...profileCands];

  // MOF 名称 only exact（前回と同じ分類）
  const evalSet = (cs: Cand[]) => {
    const covered = new Map<string, Cand[]>(), cls: Record<string, number> = {};
    for (const c of cs.filter(x => x.account === 'general')) {
      if (!c.nameComplete || !c.nameNormalized) { inc(cls, 'name_unavailable'); continue; }
      const m = byNorm.get(normalizeKey(c.nameNormalized)) ?? [];
      if (m.length === 0) { inc(cls, 'no_exact_name_match'); continue; }
      inc(cls, m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous');
      for (const s of m) covered.set(s.id, [...(covered.get(s.id) ?? []), c]);
    }
    return { covered, cls, generalCandidates: cs.filter(x => x.account === 'general').length, distinctNames: new Set([...covered.keys()].map(i => secMap.get(i)!.norm)).size };
  };
  const B = evalSet(before), A = evalSet(after);
  const baselineReproduced = B.covered.size === baseline.exactCoveredMofRows && secs.length - B.covered.size === baseline.unmatchedMofRows && before.length === baseline.candidateRows;
  const newlyExact = secs.filter(s => A.covered.has(s.id) && !B.covered.has(s.id));
  const lost = secs.filter(s => B.covered.has(s.id) && !A.covered.has(s.id));
  const beforeIds = new Set(before.map(c => c.candidateId)), afterById = new Map(after.map(c => [c.candidateId, c]));
  const removed = before.filter(c => !afterById.has(c.candidateId)), renamed = before.filter(c => afterById.get(c.candidateId) && afterById.get(c.candidateId)!.nameNormalized !== c.nameNormalized);
  const pdfDiff = (cs: Cand[]) => { const m: Record<string, string[]> = {}; for (const c of cs) (m[c.localPath] ??= []).push(c.candidateId); return m; };
  const bp = pdfDiff(before), ap = pdfDiff(after);
  const changedPdfs = [...new Set([...Object.keys(bp), ...Object.keys(ap)])].filter(k => JSON.stringify((bp[k] ?? []).sort()) !== JSON.stringify((ap[k] ?? []).sort()));
  const dupIds = after.length - new Set(after.map(c => c.candidateId)).size;
  const levelsInCands = profileCands.reduce((m: Record<string, number>, c) => { inc(m, c.level); return m; }, {});
  const gates = {
    baseline_reproduced_661_of_784: baselineReproduced, profile_valid: profile.valid, profile_candidates_nonempty_names: excludedEmptyName === 0 && profileCands.length > 0, only_item_level_candidates: Object.keys(levelsInCands).every(k => k === 'item'),
    deltaX_within_item_cluster: profileCands.every(c => Math.abs(c.deltaX! - profile.item!.deltaX) <= profile.tolerance! + 1e-9), no_duplicate_candidate: dupIds === 0, coverage_increased: A.covered.size > B.covered.size,
    lost_exact_mof_rows_zero: lost.length === 0, existing_candidates_removed_zero: removed.length === 0, existing_candidate_names_unchanged: renamed.length === 0, unrelated_pdf_changed_zero: changedPdfs.every(k => k === PROFILE_PDF),
  };
  const go = Object.values(gates).every(Boolean);

  // 未一致 inventory（after）
  const unmatchedAfter = secs.filter(s => !A.covered.has(s.id));
  const byMinistry: Record<string, number> = {}; for (const s of unmatchedAfter) inc(byMinistry, s.ministry);
  // 文科省の未一致: _03.pdf の source に full name があるか（literal 単一 token / 隣接 token をつなぐと存在 / 不在）
  const mextUnmatched = unmatchedAfter.filter(s => s.ministry === '文部科学省');
  const itemsAmounts = new Map<string, { amountYen: number; previousAmountYen: number; items: number; columns: Set<string> }>();
  for (const j of readJsonl<{ accountType: string; sectionNaturalKey: string; amountYen: number | null; previousAmountYen: number | null; sourceAmountColumn: string }>(ITEMS)) if (j.accountType === 'general') { const e = itemsAmounts.get(j.sectionNaturalKey) ?? { amountYen: 0, previousAmountYen: 0, items: 0, columns: new Set() }; e.amountYen += j.amountYen ?? 0; e.previousAmountYen += j.previousAmountYen ?? 0; e.items++; e.columns.add(j.sourceAmountColumn); itemsAmounts.set(j.sectionNaturalKey, e); }
  const mdoc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(MEXT_PDF)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  const nf = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
  const literal = new Set<string>(), joinedOnly = new Set<string>();
  for (let n = 1; n <= mdoc.numPages; n++) {
    const pg = await mdoc.getPage(n); const c = await pg.getTextContent({ disableNormalization: false });
    const toks = (c.items.filter((i: unknown) => typeof i === 'object' && i !== null && 'str' in (i as object)) as { str: string }[]).map(i => i.str);
    const joined = nf(toks.join(''));
    for (const s of mextUnmatched) { const k = nf(s.name); if (toks.some(t => nf(t).includes(k))) literal.add(s.id); else if (joined.includes(k)) joinedOnly.add(s.id); }
    pg.cleanup();
  }
  const mextClass = new Map(mextUnmatched.map(s => [s.id, literal.has(s.id) ? 'LITERAL_IN_SINGLE_TOKEN' : joinedOnly.has(s.id) ? 'SPLIT_ACROSS_ADJACENT_TOKENS_FULL_NAME_PRESENT_AFTER_JOIN' : 'SOURCE_FULL_NAME_ABSENT']));
  await mdoc.destroy();
  const mextOut = mextUnmatched.map(s => { const a = itemsAmounts.get(s.naturalKey); return { mofSectionId: s.id, organization: s.organization, code: s.code, name: s.name, sourceClass: mextClass.get(s.id), mofAmountDiagnostic: a ? { amountYenSum: a.amountYen, previousAmountYenSum: a.previousAmountYen, items: a.items, sourceAmountColumns: [...a.columns].sort(), note: '診断列のみ。当初予算 0 と概算要求 PDF に項が無いことの因果は確定していない' } : null }; });
  const caoBefore = baseline.unmatchedByMinistry['内閣府'] ?? 0, caoAfter = byMinistry['内閣府'] ?? 0;
  const caoRemaining = unmatchedAfter.filter(s => s.ministry === '内閣府').map(s => ({ mofSectionId: s.id, organization: s.organization, code: s.code, name: s.name, sourceClass: 'unresolved_pdf_assignment (no item-level source evidence; not inferred from ministry name)' }));

  const newMatchLines = newlyExact.flatMap(s => A.covered.get(s.id)!.map(c => JSON.stringify(sortDeep({ mofSectionId: s.id, mofMinistry: s.ministry, mofOrganization: s.organization, mofCode: s.code, mofName: s.name, localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, pdfCode: c.code, pdfName: c.nameRaw, normalizedName: c.nameNormalized, ruleX: c.ruleX, codeX: c.codeX, deltaX: c.deltaX, origin: c.origin, codeMatchesMof: s.code === c.code }))));
  fs.mkdirSync(OUT, { recursive: true });
  const gzN = zlib.gzipSync(Buffer.from(newMatchLines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/new-exact-matches.jsonl.gz`, gzN);
  const gzC = zlib.gzipSync(Buffer.from(profileCands.map(c => JSON.stringify(sortDeep(c))).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/profile-candidates.jsonl.gz`, gzC);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-item-layout-anchor-after/v0',
    note: 'source-derived layout profile（内閣府 0.pdf）で項 anchor を拡張した after 評価。MOF は candidate 生成に使っていない。GO 判定は gates の全 true',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), scriptSha256: fileSha('scripts/pipeline-v2/run-budget-request-item-layout-anchor-evaluation.ts'), libSha256: fileSha('scripts/pipeline-v2/lib/budget-request-item-layout-profile.ts'),
    profile: { sourcePath: PROFILE_PDF, sourceSha256: profileDoc.sha256, derivation: 'markers + request rows + rule links (see protocol §4)', ...profile, markerCount: markers.length },
    profileCandidates: { rows: profileCands.length, excludedEmptyName, levelOfCandidateRows: levelsInCands, organizationRowsInPdf: profile.evidence.levelCounts.organization, eventRowsInPdf: profile.evidence.levelCounts.event, profileCandidatesGzSha256: sha(gzC), priorIndependentMeasurement: 65 },
    beforeAfter: { mofTotal: { before: 784, after: 784 }, exactCoveredMofRows: { before: B.covered.size, after: A.covered.size, delta: A.covered.size - B.covered.size }, unmatchedMofRows: { before: secs.length - B.covered.size, after: secs.length - A.covered.size, delta: -(A.covered.size - B.covered.size) }, distinctNormalizedNamesCovered: { before: B.distinctNames, after: A.distinctNames, delta: A.distinctNames - B.distinctNames }, candidateRowsAll: { before: before.length, after: after.length, delta: profileCands.length }, generalCandidateRows: { before: B.generalCandidates, after: A.generalCandidates }, candidateClassCounts: { before: B.cls, after: A.cls } },
    newlyExactMofRows: newlyExact.length, newExactMatchesGzSha256: sha(gzN), newlyExactMof: newlyExact.map(s => ({ mofSectionId: s.id, ministry: s.ministry, organization: s.organization, code: s.code, name: s.name })),
    regression: { lostExactMofRows: lost.length, lostExactMof: lost.map(s => s.id), existingCandidatesRemoved: removed.length, existingCandidateNamesChanged: renamed.length, changedPdfs, duplicateCandidateIds: dupIds },
    unmatchedAfter: { total: unmatchedAfter.length, byMinistry: Object.fromEntries(Object.entries(byMinistry).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))), cabinetOffice: { before: caoBefore, newlyExact: newlyExact.filter(s => s.ministry === '内閣府').length, after: caoAfter, remaining: caoRemaining }, mext: { count: mextOut.length, items: mextOut, unchangedThisPhase: true } },
    gates, go,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/after-evaluation.json`, text);
  console.log(JSON.stringify({ sha: sha(text), profile: { valid: profile.valid, reason: profile.invalidReason, ruleX: profile.ruleX, org: profile.organization?.deltaX, item: profile.item?.deltaX, event: profile.event?.deltaX, tol: profile.tolerance, levelCounts: profile.evidence.levelCounts }, profileCandidates: profileCands.length, beforeAfter: [B.covered.size, A.covered.size], newlyExact: newlyExact.length, lost: lost.length, changedPdfs, unmatchedByMinistry: byMinistry, gates, go }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
