/**
 * organization / root 境界の source evidence inventory（research-only。事前登録 Organization_Root_Source_Evidence_Protocol）。
 * 既存 hierarchy 契約 8 PDF の手書き page 範囲の境界周辺（range 外を含む）と、organization 7 / item 97 の source evidence を観測する。
 * MOF・手書き range 値の特徴量化・organization 名辞書は使わない。existing ON kind は GT ではない。production code は変更しない。
 * 使い方: npx tsx scripts/pipeline-v2/inventory-budget-request-organization-root-evidence.ts
 * 出力: tests/fixtures/budget-request-organization-root-evidence/2024/organization-root-evidence.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { codeClass } from './lib/budget-request-layout-inventory';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-organization-root-evidence', '2024');
const P = {
  population: `${FX}/budget-request-semantic-boundary/2024/population-887.json`, semEval: `${FX}/budget-request-semantic-boundary/2024/semantic-boundary-evaluation.json`,
  layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  protocol: 'docs/tasks/20261005_0913_Budget_Request_Organization_Root_Source_Evidence_Protocol.md',
};
const FROZEN: Record<string, string> = {
  [P.population]: '24f4803bb3fefd756ccb85f313404879529588792d7ae88352b30beab34c1aee', [P.semEval]: '0a619469852c1953556b179bfa4b529c4778a83f425798241bef5bc3cd54c2f4',
  [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.protocol]: 'ec3a51dbad2fbf083d6576f7dca159566c83f8a0b5b86751384c7616c877fd71',
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
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null }; name: { status: string; value: { raw: string } | null } } }
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
interface PopRow { key: string; localPath: string; onKind: string; page: number; logicalRowIndex: number; rawCode: string; codeDigits: number; nameStatus: string; nameReason: string | null; nameRaw: string | null; layoutVariant: string; offsetFromRangeRequestRef: number | null; offsetFromAnchor: string; codeX: number; neighbors: { prev1: { kind: string } | null; next1: { kind: string } | null }; rowsSinceHeadingKind: number | null; rowsSinceRequest: number | null; onKindBasis: string }
interface LRange { from: number; to: number; signature: string }

type RowClass = 'request' | 'plain3' | 'plain3_only' | 'hyphen' | 'other';
const REQ_CODE = /^\d{2}[-‐-―−]\d{2}/;
function classOf(texts: string[]): RowClass {
  if (texts.length >= 2 && /^\d{1,3}$/.test(texts[0]) && REQ_CODE.test(texts[1])) return 'request';
  if (/^\d{3}$/.test(texts[0] ?? '')) return texts.length >= 2 ? 'plain3' : 'plain3_only';
  if (/^\d{2,3}[-‐-―−]\d/.test(texts[0] ?? '')) return 'hyphen';
  return 'other';
}
interface PageRows { rows: { idx: number; cls: RowClass; x: number; text: string }[]; titleText: string; titleSig: string; titleFirst: string }
const pageCache = new Map<string, PageRows>();
async function pageRows(file: string, n: number): Promise<PageRows> {
  const k = `${file}#${n}`;
  if (pageCache.has(k)) return pageCache.get(k)!;
  const ex = await extractPageTokens(file, n);
  const geom = buildTableGeometry(ex.tokens, ex.page);
  const lr = resolveLogicalRows(ex.tokens, ex.page, geom);
  const rows = lr.logicalRowCandidates.map(r => {
    const toks = r.visualTokenIndexes.map(i => ex.tokens[i]).filter(t => t.rawText.trim() !== '');
    const texts = toks.map(t => t.rawText.trim());
    return { idx: r.logicalRowIndex, cls: classOf(texts), x: Math.round((toks[0]?.bbox.xMin ?? 0) * 10) / 10, text: short(texts.join(' ')) };
  });
  const firstCode = rows.findIndex(r => r.cls !== 'other');
  const title = rows.slice(0, firstCode < 0 ? rows.length : firstCode).map(r => r.text.length ? r.text : '').filter(Boolean);
  const titleText = title.join(' | ');
  const out = { rows, titleText, titleSig: normalizeKey(titleText).replace(/\d/g, ''), titleFirst: title[0] ?? '' };
  pageCache.set(k, out);
  return out;
}

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const pop = readJson<{ rows: PopRow[]; counts: { total: number; byKind: Record<string, number> }; reproduced: boolean }>(P.population);
  const populationOk = pop.reproduced && pop.counts.total === 887 && pop.counts.byKind.item === 97 && pop.counts.byKind.organization === 7;
  const layout = readJson<{ perPdf: { localPath: string; ranges: (LRange & { assignedPages: number })[]; totalPages: number; hierarchyContract: { id: string; startAligned: boolean; endAligned: boolean } | null }[] }>(P.layout).perPdf;
  const paired = readJson<{ documents: { localPath: string; canonicalUrl: string; class: string; hierarchySegment: [number, number]; publisherAuthority: string }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable');
  const pdfs = paired.map(d => ({ ...d, contract: hierarchyContractFor(d.canonicalUrl)!, lay: layout.find(l => l.localPath === d.localPath)! }));
  const recs = new Map<string, Rec[]>();
  for (const d of pdfs) {
    const res = readJson<{ segments: { mode: string; outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slugOf(d.localPath), 'result.json'));
    recs.set(d.localPath, res.segments.flatMap(s => readGz<Rec>(s.outputs.records.path)).sort((a, b) => a.anchor.page - b.anchor.page || a.anchor.logicalRowIndex - b.anchor.logicalRowIndex));
  }
  const WINDOW = (lp: string) => (/_03\.pdf$|05-1b-01\.pdf$/.test(lp) ? 10 : 1); // mext / mhlw のみ ±10 page（protocol で固定）

  // ---------------- Axis A: activation boundary ----------------
  const activation: Record<string, unknown>[] = [];
  const ar = { AR1: 0, AR2: 0, mismatch: [] as string[] };
  for (const d of pdfs) {
    const [a, b] = d.contract.pages;
    const rs = recs.get(d.localPath)!;
    const total = d.lay.totalPages;
    const range = d.lay.ranges.find(r => a >= r.from && a <= r.to) ?? null;
    const rangeEnd = d.lay.ranges.find(r => b >= r.from && b <= r.to) ?? null;
    const ar1 = range && rangeEnd && range === rangeEnd ? [range.from, range.to] : null;
    const reqPages = [...new Set(rs.filter(r => r.recordKind === 'request').map(r => r.anchor.page))].sort((x, y) => x - y);
    const inRange = ar1 ? reqPages.filter(p => p >= ar1[0] && p <= ar1[1]) : [];
    const ar2 = inRange.length ? [inRange[0], inRange[inRange.length - 1]] : null;
    const m1 = !!ar1 && ar1[0] === a && ar1[1] === b, m2 = !!ar2 && ar2[0] === a && ar2[1] === b;
    if (m1) ar.AR1++; if (m2) ar.AR2++; if (!m1) ar.mismatch.push(path.basename(d.localPath));
    const w = WINDOW(d.localPath);
    const pages = new Set<number>();
    for (const c of [a, b]) for (let p = c - w; p <= c + w; p++) if (p >= 1 && p <= total) pages.add(p);
    const sig = new Map<number, PageRows>();
    for (const p of [...pages].sort((x, y) => x - y)) sig.set(p, await pageRows(d.localPath, p));
    const ts = (p: number) => sig.get(p)?.titleSig ?? null;
    const changes = (lo: number, hi: number) => { let n = 0, c = 0; for (let p = lo; p < hi; p++) if (sig.has(p) && sig.has(p + 1)) { n++; if (ts(p) !== ts(p + 1)) c++; } return { pairs: n, changed: c }; };
    const startWin = changes(Math.max(1, a - w), a + w), endWin = changes(Math.max(1, b - w), Math.min(total, b + w));
    const pageObs = (p: number) => { const prs = rs.filter(r => r.anchor.page === p); const p3 = prs.filter(r => r.rowLocal.code.value && /^\d{3}$/.test(r.rowLocal.code.value.raw)); return { page: p, insideContract: p >= a && p <= b, titleSig: short(ts(p) ?? 'n/a', 40), titleFirstRow: sig.get(p)?.titleFirst ?? null, titleText: short(sig.get(p)?.titleText ?? 'n/a', 90), requestRows: prs.filter(r => r.recordKind === 'request').length, plain3Rows: p3.length, minPlain3X: p3.length ? Math.round(Math.min(...p3.map(r => codeX(r) ?? 1e9)) * 10) / 10 : null, layoutRange: d.lay.ranges.find(r => p >= r.from && p <= r.to)?.signature ?? null }; };
    // ±20 logical rows の文脈（start: page a の先頭 logical row、end: page b の末尾 logical row。窓内の page をつないだ列）
    const stream = (lo: number, hi: number) => { const out: { page: number; idx: number; cls: RowClass; x: number; text: string }[] = []; for (let p = lo; p <= hi; p++) { const pr = sig.get(p); if (pr) for (const r of pr.rows) out.push({ page: p, ...r }); } return out; };
    const sStream = stream(Math.max(1, a - 1), a + 1), eStream = stream(Math.max(1, b - 1), Math.min(total, b + 1));
    const sPos = sStream.findIndex(r => r.page === a), ePos = eStream.map(r => r.page).lastIndexOf(b);
    const ctx = (st: typeof sStream, pos: number) => (pos < 0 ? [] : st.slice(Math.max(0, pos - 20), pos + 21).map((r, i) => ({ rel: Math.max(0, pos - 20) + i - pos, page: r.page, cls: r.cls, x: r.x, text: r.text })));
    // range 外の shallower row
    const inside = rs.filter(r => r.anchor.page >= a && r.anchor.page <= b && r.rowLocal.code.value && /^\d{3}$/.test(r.rowLocal.code.value.raw) && codeX(r) !== null);
    const minIn = inside.length ? Math.min(...inside.map(r => codeX(r) as number)) : null;
    const outside = minIn === null ? [] : rs.filter(r => (r.anchor.page < a || r.anchor.page > b) && r.rowLocal.code.value && /^\d{3}$/.test(r.rowLocal.code.value.raw) && (codeX(r) as number) < minIn - 0.5);
    const labelOf = (t: string | undefined) => (t ? /[^\s\d（）]+（[^）]*）/.exec(t)?.[0] ?? null : null);
    const first = (p: number) => (sig.has(p) ? labelOf(sig.get(p)!.titleFirst) : null);
    const labelChanges = (lo: number, hi: number) => { let n = 0, c = 0; for (let p = lo; p < hi; p++) if (sig.has(p) && sig.has(p + 1) && first(p) !== null && first(p + 1) !== null) { n++; if (first(p) !== first(p + 1)) c++; } return { pairs: n, changed: c }; };
    activation.push({
      postHocTitleLabel: { note: 'post-hoc exploratory（protocol の軸の外）。page の最初の title 行にある「文字（文字）」形の label（正規表現 [^\\s\\d（）]+（[^）]*））。意味（組織略称か）の解釈はしない。candidate_for_next_preregistration', atStart: first(a - 1) !== null && first(a) !== null ? first(a - 1) !== first(a) : null, atEnd: first(b) !== null && first(b + 1) !== null ? first(b) !== first(b + 1) : null, startWindow: labelChanges(Math.max(1, a - w), a + w), endWindow: labelChanges(Math.max(1, b - w), Math.min(total, b + w)), labelsAtStart: [a - 1, a, a + 1].map(p => [p, first(p)]), labelsAtEnd: [b - 1, b, b + 1].map(p => [p, first(p)]) },
      localPath: d.localPath, publisherAuthority: d.publisherAuthority, contractId: d.contract.id, manual: [a, b], totalPages: total, layoutRangeContainingStart: range, layoutRangeContainingEnd: rangeEnd, AR1: ar1, AR1Matches: m1, AR2: ar2, AR2Matches: m2,
      layoutAlignment: { startAligned: d.lay.hierarchyContract?.startAligned, endAligned: d.lay.hierarchyContract?.endAligned },
      titleChange: { window: w, atStart: ts(a - 1) !== null && ts(a) !== null ? ts(a - 1) !== ts(a) : null, atEnd: ts(b + 1) !== null && ts(b) !== null ? ts(b) !== ts(b + 1) : null, startWindowPairs: startWin, endWindowPairs: endWin },
      pagesAroundStart: [...pages].filter(p => p >= a - w && p <= a + w).sort((x, y) => x - y).map(pageObs), pagesAroundEnd: [...pages].filter(p => p >= b - w && p <= b + w).sort((x, y) => x - y).map(pageObs),
      rowContextStart: ctx(sStream, sPos), rowContextEnd: ctx(eStream, ePos),
      shallowerOutsideRange: { shallowestXInsideContract: minIn === null ? null : Math.round(minIn * 10) / 10, outsideRowsShallowerBy0_5: outside.length, samples: outside.slice(0, 5).map(r => ({ page: r.anchor.page, row: r.anchor.logicalRowIndex, x: Math.round((codeX(r) as number) * 10) / 10, code: r.rowLocal.code.value!.raw, name: short(r.rowLocal.name.value?.raw ?? '', 30) })) },
    });
  }

  // ---------------- Axis B: root semantics（organization 7 vs item 97） ----------------
  const target = pop.rows.filter(r => r.onKind === 'organization' || r.onKind === 'item');
  const rowsOf = new Map(pdfs.map(d => [d.localPath, recs.get(d.localPath)!]));
  const feat = async (r: PopRow) => {
    const rs = rowsOf.get(r.localPath)!;
    const idx = rs.findIndex(x => x.anchor.page === r.page && x.anchor.logicalRowIndex === r.logicalRowIndex);
    const self = rs[idx];
    const code = (x: Rec | undefined) => (x ? codeClass(x as never) : 'none');
    const pageRowsRecs = rs.filter(x => x.anchor.page === r.page);
    const prev = rs[idx - 1], next = rs[idx + 1];
    const nameKey = r.nameRaw ? normalizeKey(r.nameRaw) : '';
    const pr = await pageRows(r.localPath, r.page);
    const nameInTitle = nameKey !== '' && normalizeKey(pr.titleText).includes(nameKey);
    const sameName = nameKey === '' ? 0 : rs.filter((x, i) => i !== idx && x.rowLocal.code.value && /^\d{3}$/.test(x.rowLocal.code.value.raw) && x.rowLocal.name.value && normalizeKey(x.rowLocal.name.value.raw) === nameKey).length;
    let toRequest: number | null = null;
    for (let d = 1; idx + d < rs.length; d++) if (rs[idx + d].recordKind === 'request') { toRequest = d; break; }
    let prevP3: Rec | undefined;
    for (let d = 1; idx - d >= 0; d--) { const x = rs[idx - d]; if (x && x.rowLocal.code.value && /^\d{3}$/.test(x.rowLocal.code.value.raw)) { prevP3 = x; break; } if (d > 400) break; }
    const myX = codeX(self) as number;
    const step = !prevP3 ? 'none' : Math.abs((codeX(prevP3) as number) - myX) <= 0.5 ? 'same' : (codeX(prevP3) as number) < myX ? 'prev_shallower' : 'prev_deeper';
    const shallowerBefore = rs.slice(0, idx).some(x => x.rowLocal.code.value && /^\d{3}$/.test(x.rowLocal.code.value.raw) && (codeX(x) as number) < myX - 0.5);
    const bucket = (n: number | null) => (n === null ? 'none' : n === 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : '6+');
    return {
      codeDigits: String(r.codeDigits), nameResolved: String(r.nameStatus === 'resolved'), nameStatusReason: `${r.nameStatus}/${r.nameReason}`, layoutVariant: r.layoutVariant,
      requestRelativeBand: String(r.offsetFromRangeRequestRef !== null && r.offsetFromRangeRequestRef >= -7.9 && r.offsetFromRangeRequestRef <= -5.9), nameInPageTitle: String(nameInTitle), sameNameOtherRows: sameName === 0 ? '0' : sameName === 1 ? '1' : '2+',
      firstCodeRowOnPage: String(pageRowsRecs[0] === self), prevCodeRowClass: code(prev), nextCodeRowClass: code(next), codeRowsToNextRequest: bucket(toRequest), xStepFromPrevPlain3: step, shallowerPlain3BeforeInPdf: String(shallowerBefore),
      _circular: { prevOnKind: r.neighbors.prev1?.kind ?? 'none', nextOnKind: r.neighbors.next1?.kind ?? 'none', rowsSinceHeadingKind: r.rowsSinceHeadingKind === null ? 'none' : bucket(r.rowsSinceHeadingKind) },
      _titleText: short(pr.titleText, 90), _sameNameCount: sameName,
    };
  };
  const rowFeatures: { key: string; onKind: string; f: Awaited<ReturnType<typeof feat>> }[] = [];
  for (const r of target.sort((a, b) => cmp(a.key, b.key))) rowFeatures.push({ key: r.key, onKind: r.onKind, f: await feat(r) });
  const nonCircularNames = ['codeDigits', 'nameResolved', 'nameStatusReason', 'layoutVariant', 'requestRelativeBand', 'nameInPageTitle', 'sameNameOtherRows', 'firstCodeRowOnPage', 'prevCodeRowClass', 'nextCodeRowClass', 'codeRowsToNextRequest', 'xStepFromPrevPlain3', 'shallowerPlain3BeforeInPdf'];
  const orgs = rowFeatures.filter(r => r.onKind === 'organization'), items = rowFeatures.filter(r => r.onKind === 'item');
  const matrix: Record<string, unknown>[] = [];
  const disjointNonCircular: string[] = [];
  const tally = (rs: typeof rowFeatures, name: string) => { const m: Record<string, number> = {}; for (const r of rs) inc(m, (r.f as unknown as Record<string, string>)[name]); return m; };
  for (const name of nonCircularNames) {
    const o = tally(orgs, name), i = tally(items, name);
    const disjoint = Object.keys(o).every(v => !(v in i));
    const orgSubset = Object.keys(o).every(v => v in i);
    if (disjoint) disjointNonCircular.push(name);
    matrix.push({ evidence: name, source: 'row-local / records / extracted page title', organization: o, item: i, deterministic: true, contractIndependent: true, status: disjoint ? 'promising_candidate' : orgSubset ? 'shared_with_item' : 'insufficient_evidence' });
  }
  const circular = ['prevOnKind', 'nextOnKind', 'rowsSinceHeadingKind'];
  const circularDisjoint: string[] = [];
  for (const name of circular) { const m = (rs: typeof rowFeatures) => { const t: Record<string, number> = {}; for (const r of rs) inc(t, (r.f._circular as Record<string, string>)[name]); return t; }; const o = m(orgs), i = m(items); const disjoint = Object.keys(o).every(v => !(v in i)); if (disjoint) circularDisjoint.push(name); matrix.push({ evidence: name, source: 'existing ON kind（circular）', organization: o, item: i, deterministic: true, contractIndependent: false, status: disjoint ? 'contract_derived' : 'shared_with_item' }); }
  matrix.push({ evidence: 'root basis（hierarchy root: no parent candidate）', source: 'FieldResolver recordKindBasis（既存 stack の親候補なし）', organization: { root: orgs.length }, item: { child_of_root: items.length }, deterministic: true, contractIndependent: false, status: 'contract_derived' });
  const orgPdfs = [...new Set(orgs.map(r => r.key.split('|')[0]))];
  const orgShallowerOutside = (activation as { localPath: string; shallowerOutsideRange: { outsideRowsShallowerBy0_5: number } }[]).filter(a => orgPdfs.includes(a.localPath)).map(a => ({ localPath: a.localPath, outsideRowsShallowerBy0_5: a.shallowerOutsideRange.outsideRowsShallowerBy0_5 }));
  const anyShallowerOutside = orgShallowerOutside.some(x => x.outsideRowsShallowerBy0_5 > 0);

  const axisA = ar.AR1 === 8 || ar.AR2 === 8 ? 'SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED' : ar.AR1 >= 6 ? 'LAYOUT_BOUNDARY_ONLY' : 'MANUAL_CONTRACT_STILL_REQUIRED';
  const axisB = disjointNonCircular.length > 0 ? 'SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED' : anyShallowerOutside ? 'ROOT_EQUALS_RANGE_ROOT_ONLY' : circularDisjoint.length > 0 ? 'SEQUENCE_STATE_ONLY' : 'INSUFFICIENT_EVIDENCE';
  let overall: string, rule: number;
  if (!populationOk) { overall = 'INCONCLUSIVE'; rule = 1; }
  else if (axisA === 'SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED' && axisB === 'SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED') { overall = 'READY_FOR_ORGANIZATION_ROOT_BOUNDARY_PREREGISTRATION'; rule = 2; }
  else if (axisB === 'SOURCE_SEMANTIC_CANDIDATE_IDENTIFIED') { overall = 'ACTIVATION_BOUNDARY_UNRESOLVED'; rule = 3; }
  else if (axisA === 'SOURCE_BOUNDARY_CANDIDATE_IDENTIFIED' && axisB === 'INSUFFICIENT_EVIDENCE') { overall = 'ROOT_SEMANTICS_UNRESOLVED'; rule = 4; }
  else { overall = 'CONTRACT_DEPENDENCY_REMAINS'; rule = 5; }

  const cfaOrgs = orgs.map(o => { const p = target.find(t => t.key === o.key)!; return { key: o.key, code: p.rawCode, nameRaw: p.nameRaw, codeX: p.codeX, anchorOffset: p.offsetFromAnchor, requestRelativeOffset: p.offsetFromRangeRequestRef, features: o.f }; });
  const out = sortDeep({
    schema: 'budget-request-organization-root-evidence/v0', status: 'candidate_for_next_preregistration は development 観測であり検証済みではない。existing ON kind は GT ではない。MOF は使っていない',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) }, population: { total: pop.counts.total, byKind: pop.counts.byKind, reproduced: populationOk },
    contextWidths: { rows: 20, pagesDefault: 1, pagesMextMhlw: 10 },
    activation, activationSummary: { AR1Matches: ar.AR1, AR2Matches: ar.AR2, of: pdfs.length, AR1Mismatch: ar.mismatch },
    rootSemantics: { organizationRows: orgs.length, itemRows: items.length, nonCircularDisjointFeatures: disjointNonCircular, circularDisjointFeatures: circularDisjoint, organizationPdfs: orgPdfs, shallowerOutsideRangeInOrganizationPdfs: orgShallowerOutside, cfaOrganizationRows: cfaOrgs },
    evidenceMatrix: matrix,
    itemRows: items.map(i => ({ key: i.key, features: i.f })),
    axisA, axisB, decision: overall, rule,
  });
  const text = `${JSON.stringify(out, null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'organization-root-evidence.json'), text);
  console.log(JSON.stringify({ sha: sha(text), axisA, axisB, overall, ar1: ar.AR1, ar2: ar.AR2, mismatch: ar.mismatch, disjointNonCircular, circularDisjoint, orgShallowerOutside }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
