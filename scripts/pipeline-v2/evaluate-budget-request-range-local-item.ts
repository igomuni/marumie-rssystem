/**
 * range-local 座標ベース item-shaped row candidate の frozen evaluation（事前登録 Range_Local_Item_Extraction_Preregistration）。
 * --phase=control : hierarchy 契約 8 PDF の hierarchy 区間で、既存 item（ON、baseline）との突き合わせ（実装 freeze 前の mechanism check）
 * --phase=full    : 82 PDF への適用・前回 detector との paired 比較・weak population（MOF は使わない）
 * --phase=mof     : 一般会計 candidate 名の MOF section 名との exact-only diagnostic（detector freeze 後）
 * --phase=decide  : control / full を再計算して artifact と一致を確認し（決定性）、判定規則を適用する
 * 入力は hierarchy=null の row-local 出力（baseline の null 区間 / 8 PDF の hierarchy 区間は OFF 出力）と凍結済み layout range。hierarchy・MOF（mof phase を除く）・金額は使わない。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readJsonl } from './lib/jsonl';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { countCandidates, type CandidateSourceRecord, type ItemCandidate } from './lib/budget-request-item-candidate';
import { evaluateRange, type RangeEvaluation, type RangeStatus } from './lib/budget-request-range-local-item';
import type { MofBudgetJikouRecord } from './types';

const OUT = path.join('tests', 'fixtures', 'budget-request-range-local-item-extraction', '2024');
const FX = 'tests/fixtures';
const P = {
  corpus: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`, extraction: `${FX}/budget-request-full-corpus-baseline/2024/extraction-baseline.json`, recon: `${FX}/budget-request-full-corpus-baseline/2024/reconciliation-result.json`,
  transition: `${FX}/budget-request-hierarchy-failure-isolation/2024/transition-evaluation.json`, off: `${FX}/budget-request-hierarchy-failure-isolation/2024/off-diagnostic.json`, pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  candLib: 'scripts/pipeline-v2/lib/budget-request-item-candidate.ts', cand: `${FX}/budget-request-pdf-item-candidate-count/2024/candidate-count.json`,
  layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, layoutPages: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-page-inventory.json`, matcher: 'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts',
  prereg: 'docs/tasks/20261005_0820_Budget_Request_Range_Local_Item_Extraction_Preregistration.md',
};
const FROZEN: Record<string, string> = {
  [P.corpus]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.extraction]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f', [P.recon]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [P.transition]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd', [P.off]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.candLib]: 'fd51578a12c3fbd72660ae054a539cd5dc25b6d17cd288cacf9bd2609b8dc892', [P.cand]: '35ffc096496ff9af7ab62ac5848b2ddef19ae0211f441193bf05598e7990d508',
  [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.layoutPages]: 'fb74ca44614e5170fb20508343551dd5491b37251f6774a45cb7a418b008441b', [P.matcher]: 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  [P.prereg]: 'fc3c82e6ee1cbec391b0b6fa945a1a42fe42edabd98647880171fd48cd350c7a',
};
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const json = (o: unknown) => `${JSON.stringify(sortDeep(o), null, 1)}\n`;
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface LRange { from: number; to: number; signature: string; assignedPages: number; gapPages: number[] }
interface LPdf { localPath: string; accountType: string; publisherAuthority: string; coverage: string; totalPages: number; ranges: LRange[]; hierarchyContract: { id: string; pages: [number, number] } | null }
interface BaseSeg { pages: [number, number]; mode: string; status: string; outputs: { records: { path: string; sha256: string } } | null }
type Src = CandidateSourceRecord & { recordKind: string };

function guard() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const rec = readJson<{ items: { conditional: { comparable: number; exactUnique: number }; generalAccount: number } }>(P.recon);
  const ext = readJson<{ items: { total: number } }>(P.extraction);
  const cand = readJson<{ totals: { rows: number }; byAccount: { general: { rows: number } } }>(P.cand);
  const lay = readJson<{ coverage: { inventory_evaluable: { pdfs: number; pages: number } } }>(P.layout);
  const known = { productionItems: ext.items.total, generalItems: rec.items.generalAccount, comparable: rec.items.conditional.comparable, exactUnique: rec.items.conditional.exactUnique, prevCandidates: cand.totals.rows, prevGeneralCandidates: cand.byAccount.general.rows, layoutEvaluablePdfs: lay.coverage.inventory_evaluable.pdfs, layoutEvaluablePages: lay.coverage.inventory_evaluable.pages };
  const expected = { productionItems: 97, generalItems: 81, comparable: 79, exactUnique: 77, prevCandidates: 929, prevGeneralCandidates: 641, layoutEvaluablePdfs: 73, layoutEvaluablePages: 8586 };
  for (const [k, v] of Object.entries(expected)) if ((known as Record<string, number>)[k] !== v) throw new Error(`既知値が再現しない（STOP）: ${k}=${(known as Record<string, number>)[k]} (期待 ${v})`);
  return known;
}

const layoutPdfs = () => readJson<{ perPdf: LPdf[] }>(P.layout).perPdf;
const offHash = () => new Map(readJson<{ documents: { localPath: string; recordsSha256: string }[] }>(P.off).documents.map(d => [d.localPath, d.recordsSha256]));

/** hierarchy=null の row-local records（null 区間は baseline、hierarchy 区間は OFF 出力）。hash を照合する */
function loadNullRecords(localPath: string): Src[] {
  const slug = slugOf(localPath);
  const res = readJson<{ segments: BaseSeg[] }>(path.join(BASE_WORK, slug, 'result.json'));
  const out: Src[] = [];
  for (const s of res.segments) {
    if (s.status !== 'success' || !s.outputs) throw new Error(`成功区間でない: ${localPath}`);
    let file = s.outputs.records.path;
    if (s.mode === 'hierarchy_enabled') {
      file = path.join(OFF_WORK, slug, `seg-${s.pages[0]}-${s.pages[1]}.records.jsonl.gz`);
      if (fileSha(file) !== offHash().get(localPath)) throw new Error(`OFF artifact の hash 不一致: ${file}`);
    } else if (fileSha(file) !== s.outputs.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${file}`);
    out.push(...readGz<Src>(file));
  }
  return out;
}

interface RangeOut { from: number; to: number; signature: string; status: RangeStatus; refX: number | null; requests: number; candidates: number; nameResolved: number; nameUnavailable: number }
interface PdfOut { localPath: string; accountType: string; publisherAuthority: string; pdfStatus: string; ranges: RangeOut[] }
const cKey = (lp: string, c: { anchor: { page: number; logicalRowIndex: number } }) => `${lp}|${c.anchor.page}:${c.anchor.logicalRowIndex}`;

// ------------------------------------------------------------------ control
interface OnRec { anchor: { page: number; logicalRowIndex: number }; recordKind: string }
export function computeControl() {
  const known = guard();
  const docs = readJson<{ documents: { localPath: string; class: string; hierarchySegment: [number, number]; baselineOnRecordsSha256: string; publisherAuthority: string }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable');
  const lay = new Map(layoutPdfs().map(p => [p.localPath, p]));
  const per: Record<string, unknown>[] = [];
  const tot = { existingItems: 0, recovered: 0, missed: 0, candidates: 0, candidatesNotItem: 0, knownOrganization: 0, onUnclassified: 0, onOther: 0, duplicates: 0, unjoinable: 0 };
  for (const d of docs) {
    const [a, b] = d.hierarchySegment;
    const onFile = path.join(BASE_WORK, slugOf(d.localPath), `seg-${a}-${b}.records.jsonl.gz`);
    if (fileSha(onFile) !== d.baselineOnRecordsSha256) throw new Error(`ON artifact の hash 不一致: ${onFile}`);
    const on = readGz<OnRec>(onFile);
    const onBy = new Map<string, string>();
    let dup = 0;
    for (const r of on) { const k = `${r.anchor.page}:${r.anchor.logicalRowIndex}`; if (onBy.has(k)) dup++; onBy.set(k, r.recordKind); }
    const recs = loadNullRecords(d.localPath);
    const ranges = lay.get(d.localPath)!.ranges;
    const evals: { r: LRange; e: RangeEvaluation }[] = ranges.map(r => ({ r, e: evaluateRange(r, recs) }));
    // control: hierarchy 区間の page の候補のみ
    const cands = evals.flatMap(x => x.e.candidates).filter(c => c.anchor.page >= a && c.anchor.page <= b);
    const keys = new Set(cands.map(c => `${c.anchor.page}:${c.anchor.logicalRowIndex}`));
    const items = on.filter(r => r.recordKind === 'item');
    const rec = items.filter(r => keys.has(`${r.anchor.page}:${r.anchor.logicalRowIndex}`)).length;
    let unj = 0, org = 0, uncl = 0, other = 0;
    for (const c of cands) { const k = onBy.get(`${c.anchor.page}:${c.anchor.logicalRowIndex}`); if (k === undefined) unj++; else if (k === 'item') continue; else if (k === 'organization') org++; else if (k === 'unclassified') uncl++; else other++; }
    const c = countCandidates(cands);
    tot.existingItems += items.length; tot.recovered += rec; tot.missed += items.length - rec; tot.candidates += cands.length; tot.candidatesNotItem += cands.length - rec; tot.knownOrganization += org; tot.onUnclassified += uncl; tot.onOther += other; tot.duplicates += dup + c.duplicateRows; tot.unjoinable += unj;
    per.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, hierarchySegment: d.hierarchySegment, contract: lay.get(d.localPath)!.hierarchyContract?.id ?? null, existingItems: items.length, recovered: rec, candidates: cands.length, knownOrganization: org, onUnclassified: uncl, onOther: other, unjoinable: unj, ranges: evals.filter(x => x.r.to >= a && x.r.from <= b).map(x => ({ from: x.r.from, to: x.r.to, signature: x.r.signature, status: x.e.status, refX: x.e.refX, requests: x.e.requests })) });
  }
  return json({ schema: 'budget-request-range-local-item-control/v0', scope: 'hierarchy 契約 8 PDF の hierarchy 区間。前回 offset の較正に使った population のため独立検証ではない（regression / mechanism check）', known, totals: tot, organizationShareOfCandidates: tot.candidates ? tot.knownOrganization / tot.candidates : null, perPdf: per });
}

// ------------------------------------------------------------------ full
export function computeFull() {
  const known = guard();
  const pdfs = layoutPdfs();
  const cand = readJson<{ candidates: { localPath: string; page: number; logicalRowIndex: number }[]; perPdf: { localPath: string; group: string; scan: string; referenceX: number | null; reference?: string; candidates: { rows: number } | null }[] }>(P.cand);
  const oldKeys = new Set(cand.candidates.map(c => `${c.localPath}|${c.page}:${c.logicalRowIndex}`));
  const oldInfo = new Map(cand.perPdf.map(p => [p.localPath, p]));
  const out: PdfOut[] = [];
  const rows: Record<string, unknown>[] = [];
  const allNew: { lp: string; account: string; c: ItemCandidate; sig: string }[] = [];
  for (const p of pdfs) {
    if (p.coverage !== 'inventory_evaluable') { out.push({ localPath: p.localPath, accountType: p.accountType, publisherAuthority: p.publisherAuthority, pdfStatus: p.coverage, ranges: [] }); continue; }
    const recs = loadNullRecords(p.localPath);
    const ranges: RangeOut[] = [];
    for (const r of p.ranges) {
      const e = evaluateRange(r, recs);
      const nameResolved = e.candidates.filter(c => c.nameStatus === 'resolved').length;
      ranges.push({ from: r.from, to: r.to, signature: r.signature, status: e.status, refX: e.refX, requests: e.requests, candidates: e.candidates.length, nameResolved, nameUnavailable: e.candidates.length - nameResolved });
      for (const c of e.candidates) allNew.push({ lp: p.localPath, account: p.accountType, c, sig: r.signature });
    }
    out.push({ localPath: p.localPath, accountType: p.accountType, publisherAuthority: p.publisherAuthority, pdfStatus: 'inventory_evaluable', ranges });
  }
  // coverage（range 単位 + PDF 単位）
  const spanPages = (r: RangeOut) => r.to - r.from + 1;
  const rangeCov: Record<string, { ranges: number; pages: number; pdfs: number }> = {};
  for (const p of out) { const seen = new Set<string>(); for (const r of p.ranges) { (rangeCov[r.status] ??= { ranges: 0, pages: 0, pdfs: 0 }); rangeCov[r.status].ranges++; rangeCov[r.status].pages += spanPages(r); if (!seen.has(r.status)) { seen.add(r.status); rangeCov[r.status].pdfs++; } } }
  const layoutByPdf = new Map(pdfs.map(p => [p.localPath, p]));
  const pdfCov: Record<string, { pdfs: number; pages: number }> = {};
  for (const p of out) { const k = p.pdfStatus !== 'inventory_evaluable' ? p.pdfStatus : p.ranges.some(r => r.status === 'evaluable_detail_range') ? 'has_evaluable_detail_range' : p.ranges.some(r => r.status === 'range_multimodal') ? 'only_multimodal_detail_ranges' : p.ranges.some(r => r.status === 'range_request_x_unavailable') ? 'only_request_x_unavailable_detail_ranges' : 'no_detail_range'; (pdfCov[k] ??= { pdfs: 0, pages: 0 }); pdfCov[k].pdfs++; pdfCov[k].pages += layoutByPdf.get(p.localPath)!.totalPages; }
  // 候補件数
  type Agg = { candidateRows: number; nameResolved: number; nameUnavailable: number; withinDocumentUnique: number; duplicateRows: number; pdfsWithCandidate: number; rangesWithCandidate: number };
  const agg = (pred: (p: PdfOut) => boolean): Agg => {
    const a: Agg = { candidateRows: 0, nameResolved: 0, nameUnavailable: 0, withinDocumentUnique: 0, duplicateRows: 0, pdfsWithCandidate: 0, rangesWithCandidate: 0 };
    for (const p of out) { if (!pred(p)) continue; const cs = allNew.filter(x => x.lp === p.localPath).map(x => x.c); if (cs.length) a.pdfsWithCandidate++; const c = countCandidates(cs); a.candidateRows += c.rows; a.nameResolved += c.withKey; a.nameUnavailable += c.ambiguous; a.withinDocumentUnique += c.withinDocumentUnique; a.duplicateRows += c.duplicateRows; a.rangesWithCandidate += p.ranges.filter(r => r.candidates > 0).length; }
    return a;
  };
  const contractSet = new Set(pdfs.filter(p => p.hierarchyContract).map(p => p.localPath));
  const counts = { general: agg(p => p.accountType === 'general'), special: agg(p => p.accountType === 'special'), total: agg(() => true), hierarchyContractPdfs: agg(p => contractSet.has(p.localPath)), hierarchyLessPdfs: agg(p => !contractSet.has(p.localPath)) };
  // fail-closed 検査: evaluable でない range に候補が無いこと
  const failClosed = out.every(p => p.ranges.every(r => r.status === 'evaluable_detail_range' || r.candidates === 0));
  // paired（old vs new）
  const oldEvaluable = (lp: string) => { const o = oldInfo.get(lp); return !!o && o.scan === 'scannable' && o.reference === 'available'; };
  const newKeys = new Set(allNew.map(x => cKey(x.lp, x.c)));
  const trans = { oldOnly: 0, both: 0, newOnly: 0, newOnlyInOldNotEvaluablePdfs: 0 };
  for (const x of allNew) { const k = cKey(x.lp, x.c); if (!oldEvaluable(x.lp)) trans.newOnlyInOldNotEvaluablePdfs++; else if (oldKeys.has(k)) trans.both++; else trans.newOnly++; }
  for (const k of oldKeys) if (!newKeys.has(k)) trans.oldOnly++;
  const oldNameResolved = cand.perPdf.reduce((n, p) => n + (p.candidates ? (p.candidates as unknown as { withKey: number }).withKey : 0), 0);
  const gen = (rs: typeof allNew) => rs.filter(x => x.account === 'general').length;
  const comparison = {
    old: { evaluablePdfs: cand.perPdf.filter(p => p.scan === 'scannable' && p.reference === 'available').length, candidateRows: oldKeys.size, generalCandidateRows: [...oldKeys].filter(k => layoutByPdf.get(k.split('|')[0])?.accountType === 'general').length, nameResolvedCandidates: oldNameResolved, candidateZeroPdfs: cand.perPdf.filter(p => p.scan === 'scannable' && p.reference === 'available' && (p.candidates?.rows ?? 0) === 0).length },
    new: { evaluablePdfs: pdfCov.has_evaluable_detail_range?.pdfs ?? 0, evaluableRanges: rangeCov.evaluable_detail_range?.ranges ?? 0, candidateRows: allNew.length, generalCandidateRows: gen(allNew), nameResolvedCandidates: counts.total.nameResolved, pdfsWithEvaluableRangeButNoCandidate: out.filter(p => p.ranges.some(r => r.status === 'evaluable_detail_range') && !allNew.some(x => x.lp === p.localPath)).length },
    transition: trans,
  };
  // weak populations
  const view = (lp: string) => { const p = out.find(x => x.localPath === lp)!; const o = oldInfo.get(lp); return { localPath: lp, publisherAuthority: p.publisherAuthority, accountType: p.accountType, pdfStatus: p.pdfStatus, oldCandidates: o?.candidates?.rows ?? null, oldReference: o?.reference ?? o?.scan ?? null, newCandidates: allNew.filter(x => x.lp === lp).length, ranges: p.ranges.map(r => [r.from, r.to, r.signature, r.status, r.refX, r.requests, r.candidates]) }; };
  const A = cand.perPdf.filter(p => p.group === 'hierarchy_less_pdf' && p.scan === 'scannable' && p.referenceX !== null && Math.abs(p.referenceX - 55.22) < 0.005).map(p => p.localPath).sort(cmp);
  const B = cand.perPdf.filter(p => p.scan === 'scannable' && p.reference === 'no_reference').map(p => p.localPath).sort(cmp);
  const C = pdfs.find(p => p.localPath.endsWith('001630395.pdf'))!.localPath;
  const aViews = A.map(view), bViews = B.map(view), cView = view(C);
  const weak = {
    requestX55_22: { pdfs: A.length, oldPdfsWithCandidate: aViews.filter(v => (v.oldCandidates ?? 0) > 0).length, newPdfsWithCandidate: aViews.filter(v => v.newCandidates > 0).length, newCandidateRows: aViews.reduce((n, v) => n + v.newCandidates, 0), pdfsWithEvaluableDetailRange: aViews.filter(v => v.ranges.some(r => r[3] === 'evaluable_detail_range')).length, perPdf: aViews },
    noReferenceX: { pdfs: B.length, newEvaluable: bViews.filter(v => v.ranges.some(r => r[3] === 'evaluable_detail_range')).length, newPdfsWithCandidate: bViews.filter(v => v.newCandidates > 0).length, newCandidateRows: bViews.reduce((n, v) => n + v.newCandidates, 0), stillUnavailable: bViews.filter(v => !v.ranges.some(r => r[3] === 'evaluable_detail_range')).length, perPdf: bViews },
    mlit001630395: cView,
  };
  const wk = cView.oldCandidates === 0 && cView.newCandidates >= 1 && weak.requestX55_22.newPdfsWithCandidate > weak.requestX55_22.oldPdfsWithCandidate;
  const candidates = allNew.map(x => ({ localPath: x.lp, accountType: x.account, rangeSignature: x.sig, page: x.c.anchor.page, logicalRowIndex: x.c.anchor.logicalRowIndex, code: x.c.code, nameStatus: x.c.nameStatus, nameRaw: x.c.nameRaw, key: x.c.key, status: x.c.nameStatus === 'resolved' ? 'candidate_name_resolved' : 'candidate_name_unavailable', inOldDetector: oldKeys.has(cKey(x.lp, x.c)) })).sort((a, b) => cmp(a.localPath, b.localPath) || a.page - b.page || a.logicalRowIndex - b.logicalRowIndex);
  return json({ schema: 'budget-request-range-local-item-full/v0', known, coverageByRange: rangeCov, coverageByPdf: pdfCov, counts, failClosed, comparison, weak, weakImproved: wk, perPdf: out, candidates });
}

// ------------------------------------------------------------------ mof
export function computeMof() {
  const full = readJson<{ candidates: { accountType: string; nameStatus: string; nameRaw: string | null }[] }>(path.join(OUT, 'full-evaluation.json'));
  const jikouSha = fileSha(path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl'));
  if (jikouSha !== readJson<{ output: { sha256: string } }>(path.join(FX, 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json')).output.sha256) throw new Error('budget-jikou.jsonl が #371 の記録と一致しない（STOP）');
  const sections = new Map<string, string>();
  for (const j of readJsonl<MofBudgetJikouRecord>(path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl'))) if (!sections.has(j.parentSectionId)) sections.set(j.parentSectionId, j.sectionName);
  const byName = new Map<string, Set<string>>();
  for (const [id, n] of sections) { const k = normalizeKey(n); if (!byName.has(k)) byName.set(k, new Set()); byName.get(k)!.add(id); }
  const gen = full.candidates.filter(c => c.accountType === 'general');
  const t: Record<string, number> = { exact_unique: 0, exact_ambiguous: 0, no_exact_match: 0, name_unavailable: 0 };
  for (const c of gen) { if (!c.nameRaw) { t.name_unavailable++; continue; } const m = byName.get(normalizeKey(c.nameRaw)); t[!m ? 'no_exact_match' : m.size === 1 ? 'exact_unique' : 'exact_ambiguous']++; }
  const resolved = t.exact_unique + t.exact_ambiguous + t.no_exact_match;
  return json({ schema: 'budget-request-range-local-item-mof-exact-diagnostic/v0', scope: 'diagnostic only（名称単独 exact。precision / recall ではない）', mofJikouSha256: jikouSha, fullEvaluationSha256: fileSha(path.join(OUT, 'full-evaluation.json')), mofSections: sections.size, generalCandidateRows: gen.length, byStatus: t, nameResolved: resolved, exactOverlapRate: resolved ? (t.exact_unique + t.exact_ambiguous) / resolved : null, reference: { formalReconciliation: { comparable: 79, exactUnique: 77 }, previousGlobalDetectorDiagnostic: { nameResolved: 618, exactUnique: 534, exactAmbiguous: 63, noExact: 21 } } });
}

// ------------------------------------------------------------------ decide
function decide() {
  const ctrlText = computeControl(), fullText = computeFull();
  const det = ctrlText === fs.readFileSync(path.join(OUT, 'control-evaluation.json'), 'utf8') && fullText === fs.readFileSync(path.join(OUT, 'full-evaluation.json'), 'utf8') && computeMof() === fs.readFileSync(path.join(OUT, 'mof-exact-diagnostic.json'), 'utf8');
  const ctrl = JSON.parse(ctrlText) as { totals: { existingItems: number; recovered: number; unjoinable: number; duplicates: number }; organizationShareOfCandidates: number };
  const full = JSON.parse(fullText) as { failClosed: boolean; weakImproved: boolean; coverageByRange: Record<string, { ranges: number }> };
  const mof = readJson<{ exactOverlapRate: number }>(path.join(OUT, 'mof-exact-diagnostic.json'));
  const f = { det, controlUnjoinableOrDuplicate: ctrl.totals.unjoinable + ctrl.totals.duplicates, evaluableDetailRanges: full.coverageByRange.evaluable_detail_range?.ranges ?? 0, rec: ctrl.totals.recovered, existing: ctrl.totals.existingItems, ov: mof.exactOverlapRate, con: ctrl.organizationShareOfCandidates, wk: full.weakImproved, fc: full.failClosed };
  let decision: string, rule: number;
  if (!f.det || f.controlUnjoinableOrDuplicate > 0 || f.evaluableDetailRanges === 0) { decision = 'INCONCLUSIVE'; rule = 1; }
  else if (!f.wk) { decision = 'RANGE_LOCALIZATION_INSUFFICIENT'; rule = 2; }
  else if (f.rec === 97 && f.ov >= 0.9 && f.con <= 0.05 && f.fc) { decision = 'RANGE_LOCAL_COORDINATE_ITEM_EXTRACTION_SUPPORTED'; rule = 3; }
  else if (f.rec === 97 && f.ov >= 0.9 && f.con > 0.05) { decision = 'COORDINATE_SIGNAL_STRONG_BUT_CLASSIFICATION_INCOMPLETE'; rule = 4; }
  else { decision = 'RANGE_LOCALIZATION_INSUFFICIENT'; rule = 5; }
  const text = json({ schema: 'budget-request-range-local-item-decision/v0', facts: f, decision, rule, artifacts: { control: sha(ctrlText), full: sha(fullText), mof: fileSha(path.join(OUT, 'mof-exact-diagnostic.json')) } });
  fs.writeFileSync(path.join(OUT, 'decision.json'), text);
  console.log(text);
}

function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  fs.mkdirSync(OUT, { recursive: true });
  if (phase === 'control') { const t = computeControl(); fs.writeFileSync(path.join(OUT, 'control-evaluation.json'), t); console.log(t.split('\n').slice(0, 40).join('\n')); console.log(`sha256 ${sha(t)}`); }
  else if (phase === 'full') { const t = computeFull(); fs.writeFileSync(path.join(OUT, 'full-evaluation.json'), t); const j = JSON.parse(t); console.log(JSON.stringify({ sha: sha(t), coverageByRange: j.coverageByRange, coverageByPdf: j.coverageByPdf, counts: j.counts, failClosed: j.failClosed, comparison: j.comparison, weakImproved: j.weakImproved, weakSummary: { a: { ...j.weak.requestX55_22, perPdf: undefined }, b: { ...j.weak.noReferenceX, perPdf: undefined }, c: j.weak.mlit001630395 } }, null, 1)); }
  else if (phase === 'mof') { const t = computeMof(); fs.writeFileSync(path.join(OUT, 'mof-exact-diagnostic.json'), t); console.log(t); }
  else if (phase === 'decide') decide();
  else throw new Error('--phase=control|full|mof|decide が必要');
}

main();
