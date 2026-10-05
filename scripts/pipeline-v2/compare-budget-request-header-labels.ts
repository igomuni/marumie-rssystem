/**
 * Phase B: frozen な header label projection と、layout range・manual activation range・既存 hierarchy root / item-shaped row・x=38 行との構造比較（事前登録 Page_Header_Label_Segment_Protocol）。
 * projection は変更しない。label の意味は解釈しない。existing ON kind・manual contract は GT ではない。MOF は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/compare-budget-request-header-labels.ts
 * 出力: tests/fixtures/budget-request-header-label/2024/header-label-structural-comparison.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import type { Segment } from './lib/budget-request-header-label';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-header-label', '2024');
const P = {
  projection: `${OUT}/header-label-projection.json`, summary: `${OUT}/header-label-summary.json`, layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`,
  paired: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, population: `${FX}/budget-request-semantic-boundary/2024/population-887.json`,
  orgEvidence: `${FX}/budget-request-organization-root-evidence/2024/organization-root-evidence.json`, protocol: 'docs/tasks/20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md',
};
const FROZEN: Record<string, string> = {
  [P.projection]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5', [P.summary]: '599acde04daf80cda23404834cd895f12efe83f2188a7e72ef229527208b78f9',
  [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.paired]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.population]: '24f4803bb3fefd756ccb85f313404879529588792d7ae88352b30beab34c1aee', [P.protocol]: 'fed6229169503ce7b1e167bba09a0dab35d67d72b1960cdc703386a1c55a5493',
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

interface Proj { p: number; s: string; br: string | null; raw: string | null; n: string | null; sh: (number | null)[] | null }
interface PdfProj { localPath: string; publisherAuthority: string; accountType: string; group: string; pages: number; segments: Segment[]; projection: Proj[] }
interface LRange { from: number; to: number; signature: string }
interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null }; name: { value: { raw: string } | null } } }
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const proj = readJson<{ pdfs: PdfProj[] }>(P.projection).pdfs;
  const summary = readJson<{ coverage: { pdfs: number; pages: number; evaluablePages: number; byStatus: Record<string, number> } }>(P.summary);
  const layout = new Map(readJson<{ perPdf: { localPath: string; ranges: LRange[]; transitions: unknown[] }[] }>(P.layout).perPdf.map(p => [p.localPath, p]));
  const paired = readJson<{ documents: { localPath: string; canonicalUrl: string; class: string; hierarchySegment: [number, number] }[] }>(P.paired).documents.filter(d => d.class === 'paired_evaluable');
  const contract = new Map(paired.map(d => [d.localPath, hierarchyContractFor(d.canonicalUrl)!.pages as [number, number]]));
  const pop = readJson<{ rows: { key: string; localPath: string; onKind: string; page: number; logicalRowIndex: number; codeX: number }[] }>(P.population).rows;
  const populationOk = summary.coverage.pdfs === 82 && summary.coverage.pages === 9899 && pop.length === 887;

  const byPath = new Map(proj.map(p => [p.localPath, p]));
  const segOf = (pdf: PdfProj, page: number) => pdf.segments.find(s => page >= s.from && page <= s.to) ?? null;
  const stateAt = (pdf: PdfProj, page: number) => { const pr = pdf.projection.find(x => x.p === page); return pr ? (pr.s === 'observed_nonblank' ? `label:${pr.n}` : pr.s) : 'out_of_range'; };
  /** label segment の開始 page（前の page が存在し、別の segment）。page 1 の開始は境界に数えない */
  const labelStarts = (pdf: PdfProj) => pdf.segments.filter(s => s.kind === 'label' && s.from > 1);

  // ---- layout relation ----
  const layoutRel: Record<string, number> = {}, layoutRelReverse: Record<string, number> = {};
  const layoutBoundaryPages = (lp: string) => { const l = layout.get(lp); return l ? new Set(l.ranges.slice(1).map(r => r.from)) : null; };
  const inSameRange = (lp: string, a: number, b: number) => { const l = layout.get(lp); if (!l) return null; const ra = l.ranges.findIndex(r => a >= r.from && a <= r.to), rb = l.ranges.findIndex(r => b >= r.from && b <= r.to); return ra >= 0 && rb >= 0 ? ra === rb : null; };
  for (const pdf of proj) {
    const lb = layoutBoundaryPages(pdf.localPath);
    for (const s of labelStarts(pdf)) {
      const prevState = stateAt(pdf, s.from - 1);
      const viaBlank = prevState !== 'out_of_range' && !prevState.startsWith('label:');
      const rel = lb === null ? 'layout_unavailable' : lb.has(s.from) ? 'layout_boundary' : inSameRange(pdf.localPath, s.from - 1, s.from) === true ? 'inside_layout_range' : 'layout_unavailable';
      inc(layoutRel, `${rel}${viaBlank ? '|after_blank_or_unavailable' : '|direct'}`);
    }
    const l = layout.get(pdf.localPath);
    if (l) for (const r of l.ranges.slice(1)) {
      const a = stateAt(pdf, r.from - 1), b = stateAt(pdf, r.from);
      const rel = a.startsWith('label:') && b.startsWith('label:') ? (a === b ? 'same_label' : 'label_transition') : a === 'out_of_range' || b === 'out_of_range' ? 'undetermined' : 'blank_or_unavailable';
      inc(layoutRelReverse, rel);
    }
  }

  // ---- manual contract relation（discovery 8 PDF）----
  const manual: Record<string, unknown>[] = [];
  const g3: { key: string; ok: boolean }[] = [];
  const otherTransitions: Record<string, number> = {};
  for (const [lp, [a, b]] of contract) {
    const pdf = byPath.get(lp)!;
    const total = pdf.pages;
    const lbStart = layoutBoundaryPages(lp);
    const lay = layout.get(lp)!;
    const layoutEnds = new Set(lay.ranges.map(r => r.to));
    const startSeg = segOf(pdf, a), endSeg = segOf(pdf, b);
    const startIsSegStart = !!startSeg && startSeg.kind === 'label' && startSeg.from === a && a > 1;
    const endIsSegEnd = !!endSeg && endSeg.kind === 'label' && endSeg.to === b && b < total;
    const startLayout = !!lbStart && lbStart.has(a), endLayout = layoutEnds.has(b) && b < total;
    const mk = (page: number) => stateAt(pdf, page);
    const startDocEdge = a === 1, endDocEdge = b === total;
    // manual 境界以外の label transition（label segment の開始。page 1 は除く。manual 開始の segment と manual 終了の直後の segment を除く）
    const others = labelStarts(pdf).filter(s => s.from !== a && s.from !== b + 1);
    inc(otherTransitions, path.basename(lp), others.length);
    const interior = labelStarts(pdf).filter(s => s.from > a && s.from <= b);
    manual.push({
      localPath: lp, manual: [a, b], totalPages: total,
      start: { before: mk(a - 1), at: mk(a), after: mk(a + 1), isLabelSegmentStart: startIsSegStart, exactLabelTransition: mk(a - 1).startsWith('label:') && mk(a).startsWith('label:') && mk(a - 1) !== mk(a), blankAdjacent: !mk(a - 1).startsWith('label:') || !mk(a).startsWith('label:'), layoutBoundary: startLayout, documentEdge: startDocEdge },
      end: { before: mk(b - 1), at: mk(b), after: mk(b + 1), isLabelSegmentEnd: endIsSegEnd, exactLabelTransition: mk(b).startsWith('label:') && mk(b + 1).startsWith('label:') && mk(b) !== mk(b + 1), blankAdjacent: !mk(b).startsWith('label:') || !mk(b + 1).startsWith('label:'), layoutBoundary: endLayout, documentEdge: endDocEdge },
      interiorLabelTransitions: interior.length, interiorTransitionPages: interior.slice(0, 40).map(s => s.from), otherLabelTransitionsInPdf: others.length,
      labelSegmentsInPdf: pdf.segments.filter(s => s.kind === 'label').length,
    });
    if (/_03\.pdf$/.test(lp)) g3.push({ key: 'mext_start', ok: startIsSegStart && !startLayout });
    if (/05-1b-01\.pdf$/.test(lp)) { g3.push({ key: 'mhlw_start', ok: startIsSegStart && !startLayout }); g3.push({ key: 'mhlw_end', ok: endIsSegEnd && !endLayout }); }
  }

  // ---- mext / mhlw segments ----
  const focus = ['_03.pdf', '05-1b-01.pdf'].map(sfx => [...contract.keys()].find(k => k.endsWith(sfx))!).map(lp => {
    const pdf = byPath.get(lp)!; const [a, b] = contract.get(lp)!;
    const labelSegs = pdf.segments.filter(s => s.kind === 'label');
    const lens = labelSegs.map(s => s.pages);
    const manualStartSeg = segOf(pdf, a), manualEndSeg = segOf(pdf, b);
    const around = pdf.segments.filter(s => s.to >= a - 12 && s.from <= a + 12).concat(pdf.segments.filter(s => s.to >= b - 12 && s.from <= b + 12)).filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
    return { localPath: lp, manual: [a, b], segments: pdf.segments.length, labelSegments: labelSegs.length, longLabelSegmentsGE10: labelSegs.filter(s => s.pages >= 10).length, blankSegments: pdf.segments.filter(s => s.kind === 'blank').length, labelSegmentLengthMedian: lens.sort((x, y) => x - y)[lens.length >> 1] ?? null, manualStartSegment: manualStartSeg, manualEndSegment: manualEndSeg, segmentsNearManualBoundaries: around.map(s => [s.id, s.kind, s.state, s.from, s.to]), longLabelSegments: labelSegs.filter(s => s.pages >= 10).map(s => [s.state, s.from, s.to]).slice(0, 60) };
  });

  // ---- existing hierarchy root / item-shaped row relation（population-887）----
  const recsCache = new Map<string, Rec[]>();
  const records = (lp: string) => { if (!recsCache.has(lp)) { const res = readJson<{ segments: { outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slugOf(lp), 'result.json')); recsCache.set(lp, res.segments.flatMap(s => readGz<Rec>(s.outputs.records.path)).sort((x, y) => x.anchor.page - y.anchor.page || x.anchor.logicalRowIndex - y.anchor.logicalRowIndex)); } return recsCache.get(lp)!; };
  const plain3 = (r: Rec) => !!r.rowLocal.code.value && /^\d{3}$/.test(r.rowLocal.code.value.raw) && codeX(r) !== null;
  const relation: Record<string, Record<string, Record<string, number>>> = {};
  const rel = (kind: string, feat: string, v: string) => { ((relation[kind] ??= {})[feat] ??= {})[v] = (relation[kind][feat][v] ?? 0) + 1; };
  const segStats = new Map<string, { firstPlain3: string; minX: number; rootShaped: number }>();
  const statsOf = (pdf: PdfProj, s: Segment) => { const k = `${pdf.localPath}#${s.id}`; if (!segStats.has(k)) { const rs = records(pdf.localPath).filter(r => r.anchor.page >= s.from && r.anchor.page <= s.to && plain3(r)); const minX = rs.length ? Math.min(...rs.map(r => codeX(r) as number)) : Infinity; const first = rs[0]; segStats.set(k, { firstPlain3: first ? `${first.anchor.page}:${first.anchor.logicalRowIndex}` : '', minX, rootShaped: rs.filter(r => (codeX(r) as number) <= minX + 0.5).length }); } return segStats.get(k)!; };
  for (const r of pop) {
    const pdf = byPath.get(r.localPath)!; const s = segOf(pdf, r.page);
    if (!s || s.kind !== 'label') { rel(r.onKind, 'segment', s ? `non_label:${s.kind}` : 'none'); continue; }
    const st = statsOf(pdf, s);
    const dist = r.page - s.from;
    rel(r.onKind, 'pageDistanceFromSegmentStart', dist === 0 ? '0' : dist === 1 ? '1' : dist <= 5 ? '2-5' : '6+');
    rel(r.onKind, 'isFirstPlain3InSegment', String(st.firstPlain3 === `${r.page}:${r.logicalRowIndex}`));
    rel(r.onKind, 'isShallowestXInSegment', String(r.codeX <= st.minX + 0.5));
    rel(r.onKind, 'segmentHasMultipleRootShaped', String(st.rootShaped > 1));
    rel(r.onKind, 'segmentLengthPages', s.pages >= 10 ? '10+' : String(s.pages));
  }

  // ---- x=38 rows（manual range 外、mext / mhlw）----
  const x38: Record<string, unknown> = {};
  for (const lp of [...contract.keys()].filter(k => /_03\.pdf$|05-1b-01\.pdf$/.test(k))) {
    const pdf = byPath.get(lp)!; const [a, b] = contract.get(lp)!;
    const rows = records(lp).filter(r => plain3(r) && Math.abs((codeX(r) as number) - 38) <= 0.5 && r.rowLocal.name.value === null);
    const cnt = { total: rows.length, inManual: 0, outsideManual: 0, onBlankTitlePage: 0, onLabelPage: 0, atSegmentStartPage: 0 };
    const bySeg: Record<string, number> = {}; const dist: Record<string, number> = {};
    for (const r of rows) {
      const inM = r.anchor.page >= a && r.anchor.page <= b; inM ? cnt.inManual++ : cnt.outsideManual++;
      const st = stateAt(pdf, r.anchor.page); st.startsWith('label:') ? cnt.onLabelPage++ : cnt.onBlankTitlePage++;
      const s = segOf(pdf, r.anchor.page); if (s) { inc(bySeg, `${s.kind}:${s.state}:${s.from}-${s.to}`); if (s.from === r.anchor.page) cnt.atSegmentStartPage++; inc(dist, r.anchor.page - s.from === 0 ? '0' : r.anchor.page - s.from <= 5 ? '1-5' : '6+'); }
    }
    x38[path.basename(lp)] = { ...cnt, segmentDistribution: Object.entries(bySeg).sort((x, y) => y[1] - x[1]).slice(0, 12), pageDistanceFromSegmentStart: dist };
  }

  // ---- discovery vs non-discovery / gates ----
  const grp = (g: string) => proj.filter(p => p.group === g);
  const covOf = (ps: PdfProj[]) => { let nb = 0, ev = 0, par = 0; for (const p of ps) for (const x of p.projection) { if (x.s === 'observed_nonblank' || x.s === 'observed_blank') ev++; if (x.s === 'observed_nonblank') { nb++; if (x.sh && x.sh[1] === 1) par++; } } return { pdfs: ps.length, evaluablePages: ev, observedNonblankPages: nb, parenthesizedPages: par, nonblankRatio: ev ? nb / ev : null, parenthesizedRatioOfNonblank: nb ? par / nb : null }; };
  const disc = covOf(grp('discovery')), non = covOf(grp('non_discovery')), all = covOf(proj);
  const nonPdfShare = (() => { const ps = grp('non_discovery').filter(p => p.projection.some(x => x.s === 'observed_nonblank')); const ok = ps.filter(p => { const c = covOf([p]); return (c.parenthesizedRatioOfNonblank ?? 0) >= 0.5; }); return { pdfsWithNonblank: ps.length, pdfsParenthesizedMajority: ok.length, ratio: ps.length ? ok.length / ps.length : null }; })();
  const G1 = (all.nonblankRatio ?? 0) >= 0.5 && (non.nonblankRatio ?? 0) >= 0.5;
  const G3 = g3.length === 3 && g3.every(x => x.ok);
  const mextOther = otherTransitions['20230914-mxt_kaikesou01-000031817_03.pdf'] ?? 0, mhlwOther = otherTransitions['05-1b-01.pdf'] ?? 0;
  const G4 = mextOther <= 2 && mhlwOther <= 2;
  const G5 = (nonPdfShare.ratio ?? 0) >= 0.5;
  const evaluableShare = summary.coverage.evaluablePages / summary.coverage.pages;
  let decision: string, rule: number;
  if (!populationOk || evaluableShare < 0.5) { decision = 'INCONCLUSIVE'; rule = 1; }
  else if (!G1) { decision = 'HEADER_LABEL_SOURCE_UNSTABLE'; rule = 2; }
  else if (G3 && G4 && G5) { decision = 'HEADER_LABEL_STRUCTURAL_SEGMENT_SUPPORTED'; rule = 3; }
  else if (G3 && G4 && !G5) { decision = 'HEADER_LABEL_LOCAL_ONLY'; rule = 4; }
  else { decision = 'HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC'; rule = 5; }

  const out = sortDeep({
    schema: 'budget-request-header-label-structural-comparison/v0', note: '構造相関のみ。label の意味は解釈しない。manual contract・existing ON kind は GT ではない。MOF は未使用',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) },
    layoutRelation: { labelSegmentStartsByLayoutRelation: layoutRel, layoutBoundariesByLabelRelation: layoutRelReverse },
    manualContractRelation: manual, mextMhlw: focus, hierarchyRelation: relation, x38Rows: x38,
    groups: { discovery: disc, nonDiscovery: non, all, nonDiscoveryParenthesizedMajorityPdfs: nonPdfShare },
    gates: { G1: { pass: G1, allNonblankRatio: all.nonblankRatio, nonDiscoveryNonblankRatio: non.nonblankRatio, threshold: '>= 0.5 (both)' }, G3: { pass: G3, boundaries: g3, threshold: 'mext start・mhlw start・mhlw end がすべて label segment の開始/終了 page かつ layout 境界でない' }, G4: { pass: G4, mextOtherTransitions: mextOther, mhlwOtherTransitions: mhlwOther, threshold: '<= 2 each' }, G5: { pass: G5, ...nonPdfShare, threshold: '>= 0.5' } },
    decision, rule,
  });
  const text = `${JSON.stringify(out, null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'header-label-structural-comparison.json'), text);
  console.log(JSON.stringify({ sha: sha(text), gates: (out as { gates: unknown }).gates, decision, layoutRel, layoutRelReverse, disc, non }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
