/**
 * page-header label の structural gate（G1・G3・G4・G5）と segment 比較の移植（research-only 純関数）。
 * 定義は frozen の protocol（Page_Header_Label_Segment_Protocol §3）と frozen script（evaluate-budget-request-alt-title-projection.ts の segments phase）から取り、式・threshold を変更しない。
 * alternative projection に適用して frozen の segment-structural-evaluation.json と同じ値になることを equivalence test で固定する。
 */
import { segmentize, type PageProjection, type PageTitle, type Segment } from './budget-request-header-label';

export interface GatePage { p: number; s: string; n: string | null; sh: (number | null)[] | null }
export interface GatePdf { localPath: string; group: string; pages: GatePage[] }
export interface LayoutRange { from: number; to: number }

const toTitle = (s: string, n: string | null): PageTitle => ({ status: s as PageTitle['status'], blankReason: null, firstTitleRaw: n, firstTitleNormalized: n, shape: null, sourceRefs: null });
export const segmentsOf = (pdf: GatePdf): Segment[] => segmentize(pdf.pages.map(x => ({ page: x.p, title: toTitle(x.s, x.n) }) as PageProjection));

export interface SegmentStat { labelSegments: number; allSegments: number; directLabelTransitions: number; sameLabelNonContiguousRecurrence: number; blankMediatedSameLabel: number; blankMediatedDifferentLabel: number }
export function segmentStat(segsBy: Map<string, Segment[]>): SegmentStat {
  let labelSegments = 0, all = 0, direct = 0, reappear = 0, sameViaBlank = 0, diffViaBlank = 0;
  for (const segs of segsBy.values()) {
    all += segs.length; const seen = new Set<string>();
    for (const s of segs) if (s.kind === 'label') { labelSegments++; if (seen.has(s.state)) reappear++; seen.add(s.state); }
    for (let k = 1; k < segs.length; k++) if (segs[k - 1].kind === 'label' && segs[k].kind === 'label' && segs[k - 1].state !== segs[k].state) direct++;
    for (let k = 1; k + 1 < segs.length; k++) if (segs[k].kind !== 'label' && segs[k - 1].kind === 'label' && segs[k + 1].kind === 'label') (segs[k - 1].state === segs[k + 1].state ? sameViaBlank++ : diffViaBlank++);
  }
  return { labelSegments, allSegments: all, directLabelTransitions: direct, sameLabelNonContiguousRecurrence: reappear, blankMediatedSameLabel: sameViaBlank, blankMediatedDifferentLabel: diffViaBlank };
}

export const labelStarts = (segs: Segment[]): Segment[] => segs.filter(s => s.kind === 'label' && s.from > 1);
export interface Coverage { pdfs: number; evaluablePages: number; observedNonblankPages: number; parenthesizedPages: number; nonblankRatio: number | null }
export function coverageOf(ps: GatePdf[]): Coverage {
  let nb = 0, ev = 0, par = 0;
  for (const p of ps) for (const x of p.pages) { if (x.s === 'observed_nonblank' || x.s === 'observed_blank') ev++; if (x.s === 'observed_nonblank') { nb++; if (x.sh && x.sh[1] === 1) par++; } }
  return { pdfs: ps.length, evaluablePages: ev, observedNonblankPages: nb, parenthesizedPages: par, nonblankRatio: ev ? nb / ev : null };
}

export interface BoundaryResult { key: string; ok: boolean; isLabelSegmentBoundary: boolean; layoutBoundary: boolean }
export interface ManualRow { localPath: string; manual: [number, number]; startIsLabelSegmentStart: boolean; endIsLabelSegmentEnd: boolean; startLayoutBoundary: boolean; endLayoutBoundary: boolean; otherLabelTransitionsInPdf: number; interiorLabelTransitions: number }
export interface Gates {
  G1: { pass: boolean; allNonblankRatio: number | null; nonDiscoveryNonblankRatio: number | null; discoveryNonblankRatio: number | null; numerators: { all: number; nonDiscovery: number }; denominators: { all: number; nonDiscovery: number }; threshold: string };
  G3: { pass: boolean; boundaries: BoundaryResult[]; threshold: string };
  G4: { pass: boolean; mextOtherTransitions: number; mhlwOtherTransitions: number; threshold: string };
  G5: { pass: boolean; pdfsWithNonblank: number; pdfsParenthesizedMajority: number; ratio: number | null; threshold: string };
  manual: ManualRow[];
}
export function evaluateGates(pdfs: GatePdf[], segsBy: Map<string, Segment[]>, layout: Map<string, LayoutRange[]>, contract: Map<string, [number, number]>): Gates {
  const all = coverageOf(pdfs), non = coverageOf(pdfs.filter(p => p.group === 'non_discovery')), disc = coverageOf(pdfs.filter(p => p.group === 'discovery'));
  const nonPdfs = pdfs.filter(p => p.group === 'non_discovery' && p.pages.some(x => x.s === 'observed_nonblank'));
  const ok5 = nonPdfs.filter(p => { const c = coverageOf([p]); return c.observedNonblankPages ? c.parenthesizedPages / c.observedNonblankPages >= 0.5 : false; });
  const ratio5 = nonPdfs.length ? ok5.length / nonPdfs.length : null;
  const boundaries: BoundaryResult[] = [];
  const manual: ManualRow[] = [];
  const other: Record<string, number> = {};
  for (const [lp, [a, b]] of contract) {
    const segs = segsBy.get(lp)!; const total = pdfs.find(p => p.localPath === lp)!.pages.length;
    const segAt = (p: number) => segs.find(s => p >= s.from && p <= s.to) ?? null;
    const ranges = layout.get(lp)!; const lbStart = new Set(ranges.slice(1).map(r => r.from)); const lEnds = new Set(ranges.map(r => r.to));
    const sa = segAt(a), sb = segAt(b);
    const startIsSegStart = !!sa && sa.kind === 'label' && sa.from === a && a > 1, endIsSegEnd = !!sb && sb.kind === 'label' && sb.to === b && b < total;
    const startLayout = lbStart.has(a), endLayout = lEnds.has(b) && b < total;
    const others = labelStarts(segs).filter(s => s.from !== a && s.from !== b + 1);
    other[lp.split('/').pop()!] = others.length;
    manual.push({ localPath: lp, manual: [a, b], startIsLabelSegmentStart: startIsSegStart, endIsLabelSegmentEnd: endIsSegEnd, startLayoutBoundary: startLayout, endLayoutBoundary: endLayout, otherLabelTransitionsInPdf: others.length, interiorLabelTransitions: labelStarts(segs).filter(s => s.from > a && s.from <= b).length });
    if (/mxt_kaikesou01-000031817_03\.pdf$/.test(lp)) boundaries.push({ key: 'mext_start', ok: startIsSegStart && !startLayout, isLabelSegmentBoundary: startIsSegStart, layoutBoundary: startLayout });
    if (/05-1b-01\.pdf$/.test(lp)) { boundaries.push({ key: 'mhlw_start', ok: startIsSegStart && !startLayout, isLabelSegmentBoundary: startIsSegStart, layoutBoundary: startLayout }); boundaries.push({ key: 'mhlw_end', ok: endIsSegEnd && !endLayout, isLabelSegmentBoundary: endIsSegEnd, layoutBoundary: endLayout }); }
  }
  const mext = other['20230914-mxt_kaikesou01-000031817_03.pdf'] ?? 0, mhlw = other['05-1b-01.pdf'] ?? 0;
  return {
    G1: { pass: (all.nonblankRatio ?? 0) >= 0.5 && (non.nonblankRatio ?? 0) >= 0.5, allNonblankRatio: all.nonblankRatio, nonDiscoveryNonblankRatio: non.nonblankRatio, discoveryNonblankRatio: disc.nonblankRatio, numerators: { all: all.observedNonblankPages, nonDiscovery: non.observedNonblankPages }, denominators: { all: all.evaluablePages, nonDiscovery: non.evaluablePages }, threshold: '>= 0.5（corpus 全体と non-discovery の両方）' },
    G3: { pass: boundaries.length === 3 && boundaries.every(x => x.ok), boundaries, threshold: 'mext 開始・mhlw 開始・mhlw 終了のすべてが label segment の境界かつ layout 境界でない' },
    G4: { pass: mext <= 2 && mhlw <= 2, mextOtherTransitions: mext, mhlwOtherTransitions: mhlw, threshold: '<= 2 each' },
    G5: { pass: (ratio5 ?? 0) >= 0.5, pdfsWithNonblank: nonPdfs.length, pdfsParenthesizedMajority: ok5.length, ratio: ratio5, threshold: '>= 0.5' },
    manual,
  };
}

export type RefinedDecision = 'REFINED_HEADER_BOUNDARY_SUPPORTED' | 'HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC' | 'REFINEMENT_STRUCTURAL_REGRESSION_OR_INCONCLUSIVE';
/** 事前登録の判定（D1 / D2 / D3）。integrityOk は dependency・population・provenance・equivalence の整合 */
export function decideRefined(g: { G1: boolean; G3: boolean; G4: boolean; G5: boolean }, integrityOk: boolean): { decision: RefinedDecision; rule: number } {
  if (!integrityOk || !g.G1 || !g.G3 || !g.G5) return { decision: 'REFINEMENT_STRUCTURAL_REGRESSION_OR_INCONCLUSIVE', rule: 3 };
  return g.G4 ? { decision: 'REFINED_HEADER_BOUNDARY_SUPPORTED', rule: 1 } : { decision: 'HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC', rule: 2 };
}
