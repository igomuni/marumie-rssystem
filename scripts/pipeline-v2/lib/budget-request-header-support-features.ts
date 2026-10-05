/**
 * header-position support provenance isolation の Phase A（source-only）の純関数。規則は
 * docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md（feature の全件列挙・比較の前に固定）。
 * このファイルと Phase A runner は、基準 frame・基準範囲・外部照合・downstream outcome を参照しない（source scan test で確認）。
 */
import { pageRuns } from './budget-request-cluster-provenance';

export type FeatureKind = 'categorical' | 'binned' | 'descriptive';
export interface FeatureRec { name: string; family: string; circular: boolean; kind: FeatureKind; raw: string | number | boolean | null; label: string | null; missing: string | null }

// 事前登録した bin（protocol §6）
export const COUNT_EDGES = [0, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, Infinity];
export const DIST_EDGES = [-Infinity, -100, -50, -20, -5, 0, 5, 20, 50, 100, Infinity];
export const DENSITY_EDGES = [0, 1, 1.5, 2, 3, 5, 10, Infinity];
const fmt = (x: number) => (x === Infinity ? '∞' : x === -Infinity ? '-∞' : String(x));
const edgeLabel = (x: number, edges: number[]): string => {
  for (let i = 0; i < edges.length - 1; i++) if (x >= edges[i] && x < edges[i + 1]) return `[${fmt(edges[i])},${fmt(edges[i + 1])})`;
  return `out_of_range`;
};
export const binCount = (x: number) => edgeLabel(x, COUNT_EDGES);
export const binDist = (x: number) => edgeLabel(x, DIST_EDGES);
export const binDensity = (x: number) => edgeLabel(x, DENSITY_EDGES);
export const binRatio = (x: number) => `r${Math.min(9, Math.max(0, Math.floor(x * 10)))}`;

export function charClassSignature(text: string): string {
  const cls = (c: string) => (/\d/.test(c) ? 'd' : /[ぁ-ゟァ-ヿ]/.test(c) ? 'k' : /[一-鿿]/.test(c) ? 'h' : /[A-Za-zＡ-Ｚａ-ｚ]/.test(c) ? 'l' : /[\p{P}\p{S}]/u.test(c) ? 'p' : 'o');
  let out = '';
  for (const c of text.replace(/\s+/g, '')) { const k = cls(c); if (out[out.length - 1] !== k) out += k; }
  return out;
}

export type XRel = 'shallower' | 'same' | 'deeper';
export const xRelOf = (from: number, to: number, gap: number): XRel => (to - from > gap ? 'deeper' : from - to > gap ? 'shallower' : 'same');

export interface NodeLite { id: string; page: number; logicalRowIndex: number; x: number; rowShape: string; code: string; clusterIndex: number | null; textParts: string[]; rowTokenCount: number; rowTexts: string[] }
export interface RelationLite { frameAvailable: boolean; frameBBox: { top: number; bottom: number; left: number; right: number } | null; bbox: { xMin: number; xMax: number; yMin: number; yMax: number } | null; relation: string }
export interface LayoutLite { id: string; signature: string | null; detail: boolean; from: number | null; to: number | null }
export interface FeatureContext {
  node: NodeLite; indexInSequence: number; sequence: NodeLite[]; range: [number, number]; gap: number; relation: RelationLite | null;
  layoutOf: (page: number) => LayoutLite; pageNodeOrdinal: number; pageNodeCount: number;
}

const rec = (name: string, family: string, circular: boolean, kind: FeatureKind, raw: FeatureRec['raw'], label: string | null, missing: string | null = null): FeatureRec => ({ name, family, circular, kind, raw, label, missing });
const cat = (name: string, family: string, v: string | number | boolean | null, circular = false, missing: string | null = null) => rec(name, family, circular, 'categorical', v, v === null ? null : String(v), v === null ? missing ?? 'unavailable' : null);
const cnt = (name: string, family: string, v: number | null, circular = false, missing: string | null = null) => rec(name, family, circular, 'binned', v, v === null ? null : binCount(v), v === null ? missing ?? 'unavailable' : null);
const dist = (name: string, family: string, v: number | null, circular = false, missing: string | null = null) => rec(name, family, circular, 'binned', v, v === null ? null : binDist(v), v === null ? missing ?? 'unavailable' : null);
const ratio = (name: string, family: string, v: number | null) => rec(name, family, false, 'binned', v, v === null ? null : binRatio(v), v === null ? 'unavailable' : null);
const desc = (name: string, family: string, v: FeatureRec['raw'], circular = false) => rec(name, family, circular, 'descriptive', v, null);

export function clusterMorphology(nodes: NodeLite[], range: [number, number], layoutOf: (p: number) => LayoutLite) {
  const pages = nodes.map(n => n.page), uniq = [...new Set(pages)].sort((a, b) => a - b);
  const runs = pageRuns(pages);
  const maxGap = runs.length < 2 ? 0 : Math.max(...runs.slice(1).map((r, i) => r.start - runs[i].end - 1));
  const span = uniq.length === 0 ? 0 : uniq[uniq.length - 1] - uniq[0] + 1;
  const norm = (p: number) => (range[1] === range[0] ? 0 : (p - range[0]) / (range[1] - range[0]));
  const requestShaped = nodes.filter(n => n.rowShape === 'request_no_then_code').length;
  return { count: nodes.length, pageCount: uniq.length, span, runs, runCount: runs.length, maxGap, density: uniq.length === 0 ? null : nodes.length / uniq.length, extent: uniq.length === 0 ? 'unclassifiable' : uniq.length === 1 ? 'single_page' : runs.length === 1 ? 'multi_page_single_run' : 'multi_run', firstNorm: uniq.length ? norm(uniq[0]) : null, lastNorm: uniq.length ? norm(uniq[uniq.length - 1]) : null, layoutRanges: new Set(uniq.map(p => layoutOf(p).id)).size, requestShaped, nonRequest: nodes.length - requestShaped };
}

/** F1〜F6（と circular block）。clusterNodes はその node の T2 cluster の support node 全件 */
export function computeFeatures(c: FeatureContext, clusterNodes: NodeLite[]): FeatureRec[] {
  const n = c.node, f: FeatureRec[] = [];
  const norm = (p: number) => (c.range[1] === c.range[0] ? 0 : (p - c.range[0]) / (c.range[1] - c.range[0]));
  const m = clusterMorphology(clusterNodes, c.range, c.layoutOf);
  // circular block（descriptive。separator 判定には使わない）
  f.push(desc('keyTokenXMin', 'circular', n.x, true), desc('t2ClusterIndex', 'circular', n.clusterIndex, true));
  // F1 page / run
  const run = m.runs.findIndex(r => n.page >= r.start && n.page <= r.end);
  f.push(desc('page', 'F1', n.page), ratio('normalizedPagePosition', 'F1', norm(n.page)), cnt('clusterRunId', 'F1', run < 0 ? null : run), cnt('clusterRunPageLength', 'F1', run < 0 ? null : m.runs[run].end - m.runs[run].start + 1),
    cnt('clusterSupportPageCount', 'F1', m.pageCount), cnt('clusterSupportPageSpan', 'F1', m.span), cnt('clusterRunCount', 'F1', m.runCount), cat('clusterSupportContiguous', 'F1', m.runCount === 1),
    cnt('pageNodeOrdinal', 'F1', c.pageNodeOrdinal), cnt('pageHierarchyNodeCount', 'F1', c.pageNodeCount));
  // F2 layout
  const lay = c.layoutOf(n.page);
  f.push(cat('layoutRangeId', 'F2', lay.id), cat('layoutSignature', 'F2', lay.signature, false, 'no_layout_range'), cat('layoutDetailRange', 'F2', lay.signature === null ? null : lay.detail, false, 'no_layout_range'),
    ratio('layoutRangePagePosition', 'F2', lay.from === null || lay.to === null ? null : lay.to === lay.from ? 0 : (n.page - lay.from) / (lay.to - lay.from)), cnt('layoutRangeLength', 'F2', lay.from === null || lay.to === null ? null : lay.to - lay.from + 1, false, 'no_layout_range'),
    cnt('clusterLayoutRangeCount', 'F2', m.layoutRanges), cat('clusterLayoutSingleRange', 'F2', m.layoutRanges === 1));
  // F3 table-frame geometry（既存 tolerance・frozen relation の入力 geometry）
  const r = c.relation, fr = r?.frameBBox ?? null, bb = r?.bbox ?? null;
  const miss = r === null ? 'relation_artifact_missing' : null;
  f.push(cat('frameAvailable', 'F3', r === null ? null : r.frameAvailable, false, miss), cat('frozenRelation', 'F3', r === null ? null : r.relation, false, miss),
    desc('rowTop', 'F3', bb ? bb.yMin : null), desc('rowBottom', 'F3', bb ? bb.yMax : null), desc('rowLeft', 'F3', bb ? bb.xMin : null, true), desc('rowRight', 'F3', bb ? bb.xMax : null, true),
    dist('rowTopMinusFrameTop', 'F3', bb && fr ? bb.yMin - fr.top : null, false, miss ?? 'frame_unavailable'), dist('rowBottomMinusFrameTop', 'F3', bb && fr ? bb.yMax - fr.top : null, false, miss ?? 'frame_unavailable'),
    dist('rowBottomMinusFrameBottom', 'F3', bb && fr ? bb.yMax - fr.bottom : null, false, miss ?? 'frame_unavailable'),
    dist('rowLeftMinusFrameLeft', 'F3', bb && fr ? bb.xMin - fr.left : null, true, miss ?? 'frame_unavailable'), dist('rowRightMinusFrameRight', 'F3', bb && fr ? bb.xMax - fr.right : null, true, miss ?? 'frame_unavailable'));
  // F4 lexical shape（意味なし）
  const textAll = n.rowTexts.join('');
  f.push(cnt('rowTokenCount', 'F4', n.rowTokenCount), cat('firstTokenClass', 'F4', n.rowShape), cat('plain3Code', 'F4', /^\d{3}$/.test(n.code)), cat('requestShaped', 'F4', n.rowShape === 'request_no_then_code'),
    cat('codeShaped', 'F4', /^\d{3}$/.test(n.code) || /^\d{2}-\d{2,5}$/.test(n.code)), cat('numericOnlyCode', 'F4', /^\d+$/.test(n.code)), cnt('codeTokenLength', 'F4', n.code.length), cat('followingTokenExists', 'F4', n.textParts.length > 0),
    cnt('rowCharCount', 'F4', textAll.length), cnt('rowNormalizedCharCount', 'F4', textAll.normalize('NFKC').replace(/\s+/g, '').length), cat('charClassSignature', 'F4', charClassSignature(n.textParts.join(''))));
  // F5 sequence（前 3 / 後 3 の hierarchy node。parent / stack / level は使わない）
  const seq = c.sequence, i = c.indexInSequence;
  for (const dir of ['prev', 'next'] as const) for (let k = 1; k <= 3; k++) {
    const nb = seq[dir === 'prev' ? i - k : i + k];
    const key = `${dir}${k}`;
    if (!nb) { f.push(cat(`${key}XRelation`, 'F5', 'no_neighbor'), cat(`${key}RowShape`, 'F5', 'no_neighbor'), cat(`${key}PageBreak`, 'F5', 'no_neighbor'), cnt(`${key}RowDistance`, 'F5', null, false, 'no_neighbor')); continue; }
    f.push(cat(`${key}XRelation`, 'F5', dir === 'prev' ? xRelOf(nb.x, n.x, c.gap) : xRelOf(n.x, nb.x, c.gap)), cat(`${key}RowShape`, 'F5', nb.rowShape), cat(`${key}PageBreak`, 'F5', nb.page !== n.page),
      cnt(`${key}RowDistance`, 'F5', nb.page === n.page ? Math.abs(nb.logicalRowIndex - n.logicalRowIndex) : null, false, 'neighbor_on_other_page'));
  }
  let a = i, b = i;
  while (a > 0 && xRelOf(seq[a - 1].x, seq[a].x, c.gap) === 'same') a--;
  while (b < seq.length - 1 && xRelOf(seq[b].x, seq[b + 1].x, c.gap) === 'same') b++;
  f.push(cnt('sameXRunLength', 'F5', b - a + 1), cat('sameXRunPosition', 'F5', b === a ? 'only' : i === a ? 'first' : i === b ? 'last' : 'middle'));
  // F6 cluster morphology
  f.push(cnt('clusterNodeCount', 'F6', m.count), cnt('clusterPageCount', 'F6', m.pageCount), cnt('clusterPdfCount', 'F6', 1), rec('clusterSupportDensity', 'F6', false, 'binned', m.density, m.density === null ? null : binDensity(m.density), m.density === null ? 'unavailable' : null),
    cat('clusterExtent', 'F6', m.extent), ratio('clusterFirstSupportPosition', 'F6', m.firstNorm), ratio('clusterLastSupportPosition', 'F6', m.lastNorm), cnt('clusterGapCount', 'F6', Math.max(0, m.runCount - 1)), cnt('clusterMaxGap', 'F6', m.maxGap),
    cnt('clusterLayoutRangeCountF6', 'F6', m.layoutRanges), cnt('clusterRequestShapedSupport', 'F6', m.requestShaped), cnt('clusterNonRequestSupport', 'F6', m.nonRequest));
  return f;
}

// ---- 比較（protocol §7） ----
export interface Sample { pdf: string; label: string | null }
const dist1 = (xs: Sample[]) => { const m = new Map<string, number>(); let n = 0; for (const x of xs) if (x.label !== null) { m.set(x.label, (m.get(x.label) ?? 0) + 1); n++; } return { m, n }; };
export function tvd(a: Sample[], b: Sample[]): number | null {
  const da = dist1(a), db = dist1(b);
  if (da.n === 0 || db.n === 0) return null;
  let s = 0;
  for (const k of new Set([...da.m.keys(), ...db.m.keys()])) s += Math.abs((da.m.get(k) ?? 0) / da.n - (db.m.get(k) ?? 0) / db.n);
  return Math.round((s / 2) * 1e6) / 1e6;
}
const modal = (xs: Sample[]) => { const d = dist1(xs); let best: string | null = null; for (const [k, v] of [...d.m.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) { best = k; void v; break; } return { label: best, freq: best === null ? 0 : (d.m.get(best) ?? 0) / d.n }; };
const freqOf = (xs: Sample[], label: string | null) => { const d = dist1(xs); return label === null || d.n === 0 ? 0 : (d.m.get(label) ?? 0) / d.n; };
const valueSet = (xs: Sample[]) => new Set(xs.filter(x => x.label !== null).map(x => x.label as string));
const disjoint = (a: Set<string>, b: Set<string>) => ![...a].some(x => b.has(x));
const availability = (xs: Sample[]) => (xs.length === 0 ? 0 : xs.filter(x => x.label !== null).length / xs.length);

export interface FeatureComparison {
  name: string; family: string; circular: boolean; kind: FeatureKind; eligibleForSeparator: boolean; ineligibleReason: string | null;
  availabilityP1: number; availabilityP2: number; distinct: number; valueSetP1: string[]; valueSetP2: string[]; disjointCombined: boolean; tvd: number | null;
  pdfLevel: Record<string, { tvd: number | null; disjoint: boolean; modal: string | null }>; p2PerPdf: Record<string, Record<string, number>>; leaveOneP2PdfOutTvd: Record<string, number | null>;
  complete: boolean; strongPartial: boolean;
}
/** circular / descriptive / 高 cardinality（P1 ∪ P2 で distinct > 20）は separator 判定の対象外 */
export function compareFeature(rec0: { name: string; family: string; circular: boolean; kind: FeatureKind }, p1: Sample[], p2: Sample[]): FeatureComparison {
  const v1 = valueSet(p1), v2 = valueSet(p2), union = new Set([...v1, ...v2]);
  const reason = rec0.circular ? 'circular' : rec0.kind === 'descriptive' ? 'descriptive_only' : union.size > 20 ? 'high_cardinality' : null;
  const p1Pdfs = [...new Set(p1.map(x => x.pdf))].sort(), p2Pdfs = [...new Set(p2.map(x => x.pdf))].sort();
  const pdfLevel: FeatureComparison['pdfLevel'] = {};
  for (const q of p1Pdfs) { const s = p1.filter(x => x.pdf === q); pdfLevel[q] = { tvd: tvd(s, p2), disjoint: disjoint(valueSet(s), v2), modal: modal(s).label }; }
  const p2PerPdf: FeatureComparison['p2PerPdf'] = {};
  for (const q of p2Pdfs) { const d = dist1(p2.filter(x => x.pdf === q)); p2PerPdf[q] = Object.fromEntries([...d.m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))); }
  const loo: FeatureComparison['leaveOneP2PdfOutTvd'] = {};
  for (const q of p2Pdfs) loo[q] = tvd(p1, p2.filter(x => x.pdf !== q));
  const comb = tvd(p1, p2), a1 = availability(p1), a2 = availability(p2), mod1 = modal(p1);
  const complete = reason === null && disjoint(v1, v2) && a1 >= 0.95 && a2 >= 0.95 && p1Pdfs.length >= 2 && p1Pdfs.every(q => pdfLevel[q].disjoint) && v1.size > 0 && v2.size > 0;
  const partial = reason === null && !complete && comb !== null && comb >= 0.8 && a1 >= 0.9 && a2 >= 0.9 && p1Pdfs.length >= 2
    && p1Pdfs.every(q => pdfLevel[q].modal === mod1.label && freqOf(p2, mod1.label) < freqOf(p1.filter(x => x.pdf === q), mod1.label))
    && p2Pdfs.length >= 2 && p2Pdfs.every(q => (loo[q] ?? 0) >= 0.8);
  return { name: rec0.name, family: rec0.family, circular: rec0.circular, kind: rec0.kind, eligibleForSeparator: reason === null, ineligibleReason: reason, availabilityP1: Math.round(a1 * 1e6) / 1e6, availabilityP2: Math.round(a2 * 1e6) / 1e6, distinct: union.size, valueSetP1: [...v1].sort(), valueSetP2: [...v2].sort(), disjointCombined: disjoint(v1, v2), tvd: comb, pdfLevel, p2PerPdf, leaveOneP2PdfOutTvd: loo, complete, strongPartial: partial };
}

export type HeaderSupportDecision = 'HEADER_SUPPORT_PROVENANCE_STRUCTURALLY_DISTINCT' | 'HEADER_SUPPORT_PROVENANCE_PARTIALLY_LOCALIZED' | 'HEADER_SUPPORT_NOT_DISTINGUISHABLE_WITH_CURRENT_SOURCE_EVIDENCE' | 'SOURCE_FEATURE_COVERAGE_INSUFFICIENT' | 'INVALID' | 'INVALID_DECISION_RULE_GAP';
/** 事前登録の順序: D0 → D4 → D1 → D2 → D3 */
export function decideHeaderSupport(f: { gatesPass: boolean; p1Size: number; p2Size: number; p1Unconstructible: number; p2Unconstructible: number; completeSeparators: number; strongPartialSeparators: number }): { decision: HeaderSupportDecision; rule: string } {
  if (!f.gatesPass) return { decision: 'INVALID', rule: 'D0' };
  if (f.p1Size === 0 || f.p2Size === 0) return { decision: 'INVALID_DECISION_RULE_GAP', rule: 'gap_empty_population' };
  if (f.p1Unconstructible * 10 > f.p1Size || f.p2Unconstructible * 10 > f.p2Size) return { decision: 'SOURCE_FEATURE_COVERAGE_INSUFFICIENT', rule: 'D4' };
  if (f.completeSeparators > 0) return { decision: 'HEADER_SUPPORT_PROVENANCE_STRUCTURALLY_DISTINCT', rule: 'D1' };
  if (f.strongPartialSeparators > 0) return { decision: 'HEADER_SUPPORT_PROVENANCE_PARTIALLY_LOCALIZED', rule: 'D2' };
  return { decision: 'HEADER_SUPPORT_NOT_DISTINGUISHABLE_WITH_CURRENT_SOURCE_EVIDENCE', rule: 'D3' };
}
