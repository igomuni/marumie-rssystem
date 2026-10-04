/**
 * 概算要求PDFの layout / geometry inventory（純関数）。row-local な観測値（code token の x・lexical class・見出し由来の column layout・page サイズ）を page 単位で保存し、
 * 凍結した signature で contiguous range にまとめる。hierarchy・MOF・項の意味は使わない。診断 status は「項がある/ない」ではない。
 */

/** 事前登録で固定する定数 */
export const SIGNATURE_QUANTUM = 1.0; // column layout の x と page 幅を 1pt 単位に丸めて signature にする
export const DOMINANCE_TOLERANCE = 0.5; // request x が単峰とみなす幅（最頻値からの距離）
export const X_HISTOGRAM_RESOLUTION = 0.1;

export interface InvRecord {
  anchor: { page: number; logicalRowIndex: number };
  recordKind: string;
  rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null } };
}
export interface InvColumnLayout { basis: string; previousBudget: [number, number]; requestedBudget: [number, number]; difference: [number, number]; regions: { name: [number | null, number] } }
export interface PageGeometry { width: number; height: number; rotate: number }

export type CodeClass = 'plain3' | 'request_like' | 'hyphen_other' | 'other_numeric' | 'non_code';
/** code の lexical class。request_like は行頭の request 番号を観測した行（row-local。hierarchy 非依存）の NN-NN code */
export function codeClass(r: InvRecord): CodeClass {
  const raw = r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.value?.raw ?? null : null;
  if (raw === null) return 'non_code';
  if (r.recordKind === 'request' && /^\d{2}-\d{2,5}$/.test(raw)) return 'request_like';
  if (/^\d{3}$/.test(raw)) return 'plain3';
  if (raw.includes('-')) return 'hyphen_other';
  return /^\d+$/.test(raw) ? 'other_numeric' : 'non_code';
}

const q = (x: number, step: number) => Math.round(x / step) * step;
const r1 = (x: number) => Math.round(x * 10) / 10;
export const histogram = (xs: number[]): [number, number][] => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(r1(q(x, X_HISTOGRAM_RESOLUTION)), (m.get(r1(q(x, X_HISTOGRAM_RESOLUTION))) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
};

export type RequestEvidence = 'none' | 'dominant' | 'multimodal';
export interface PageSummary {
  page: number; width: number; height: number; rotate: number;
  header: { basis: string; previousBudgetX: number; requestedBudgetX: number; differenceX: number; nameRight: number } | null;
  /** 見出し由来の column layout の signature（無ければ null）。request x の signature（dominant: 1pt に丸めた x、multimodal: 'multi'、無ければ null）。signature = 両者の結合（両方 null なら null） */
  headerSignature: string | null;
  requestKey: string | null;
  signature: string | null;
  lexical: Record<CodeClass, number>;
  requestX: [number, number][];
  plain3X: [number, number][];
  requestEvidence: RequestEvidence;
  /** request x が dominant のときの代表値（最頻値。同数なら小さい x） */
  requestDominantX: number | null;
}

const modal = (h: [number, number][]) => h.reduce<[number, number] | null>((b, e) => (!b || e[1] > b[1] || (e[1] === b[1] && e[0] < b[0]) ? e : b), null);

/** 凍結 signature: 見出し由来の column layout がある page のみ。無ければ null（no_header_geometry） */
export function headerSignatureOf(layout: InvColumnLayout | null, geom: PageGeometry): string | null {
  if (!layout) return null;
  const s = (x: number) => q(x, SIGNATURE_QUANTUM).toFixed(0);
  return `w${s(geom.width)}|p${s(layout.previousBudget[0])}|r${s(layout.requestedBudget[0])}|d${s(layout.difference[0])}`;
}
export const requestKeyOf = (evidence: RequestEvidence, dominantX: number | null): string | null => (evidence === 'none' ? null : evidence === 'multimodal' ? 'multi' : q(dominantX as number, SIGNATURE_QUANTUM).toFixed(0));
export const combineSignature = (h: string | null, r: string | null): string | null => (h === null && r === null ? null : `H:${h ?? '-'}|R:${r ?? '-'}`);

export function summarizePage(page: number, records: InvRecord[], layout: InvColumnLayout | null, geom: PageGeometry): PageSummary {
  const lexical: Record<CodeClass, number> = { plain3: 0, request_like: 0, hyphen_other: 0, other_numeric: 0, non_code: 0 };
  const reqXs: number[] = [], p3Xs: number[] = [];
  for (const r of records) {
    const c = codeClass(r);
    lexical[c]++;
    const x = r.rowLocal.code.evidence?.bboxUnion.xMin;
    if (x === undefined) continue;
    if (c === 'request_like') reqXs.push(x);
    if (c === 'plain3') p3Xs.push(x);
  }
  const requestX = histogram(reqXs);
  const m = modal(requestX);
  const evidence: RequestEvidence = !m ? 'none' : requestX.every(([x]) => Math.abs(x - m[0]) <= DOMINANCE_TOLERANCE) ? 'dominant' : 'multimodal';
  const requestDominantX = evidence === 'dominant' ? m![0] : null;
  const headerSignature = headerSignatureOf(layout, geom);
  const requestKey = requestKeyOf(evidence, requestDominantX);
  return {
    page, width: geom.width, height: geom.height, rotate: geom.rotate,
    header: layout ? { basis: layout.basis, previousBudgetX: r1(layout.previousBudget[0]), requestedBudgetX: r1(layout.requestedBudget[0]), differenceX: r1(layout.difference[0]), nameRight: r1(layout.regions.name[1]) } : null,
    headerSignature, requestKey, signature: combineSignature(headerSignature, requestKey), lexical, requestX, plain3X: histogram(p3Xs), requestEvidence: evidence, requestDominantX,
  };
}

export interface LayoutRange { from: number; to: number; signature: string; assignedPages: number; gapPages: number[] }
export interface Transition { fromSignature: string; toSignature: string; lastPageBefore: number; firstPageAfter: number; unassignedPagesBetween: number[] }

/**
 * contiguous range。page は header 成分と request 成分を持ち、各成分は未設定（null）か値。range と page は、両方が設定されている成分がすべて等しいとき互換で、
 * 互換なら range に加え、range の未設定成分を埋める。signature が全く無い page は、前後が同じ range に属するなら gapPages として吸収し、range が変わる所では transition の間の未割当 page とする。
 */
export function buildRanges(pages: PageSummary[]): { ranges: LayoutRange[]; transitions: Transition[]; leadingUnassigned: number[]; trailingUnassigned: number[] } {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const cur: { from: number; to: number; h: string | null; r: string | null; assigned: number; gaps: number[] }[] = [];
  const transitionsRaw: { fromIdx: number; toIdx: number; lastBefore: number; firstAfter: number; between: number[] }[] = [];
  let pendingGap: number[] = [];
  const leading: number[] = [];
  for (const p of sorted) {
    if (p.headerSignature === null && p.requestKey === null) { pendingGap.push(p.page); continue; }
    const last = cur[cur.length - 1];
    const compat = last && (p.headerSignature === null || last.h === null || p.headerSignature === last.h) && (p.requestKey === null || last.r === null || p.requestKey === last.r);
    if (!last) { leading.push(...pendingGap); cur.push({ from: p.page, to: p.page, h: p.headerSignature, r: p.requestKey, assigned: 1, gaps: [] }); }
    else if (compat) { last.gaps.push(...pendingGap); last.to = p.page; last.assigned++; last.h ??= p.headerSignature; last.r ??= p.requestKey; }
    else { transitionsRaw.push({ fromIdx: cur.length - 1, toIdx: cur.length, lastBefore: last.to, firstAfter: p.page, between: [...pendingGap] }); cur.push({ from: p.page, to: p.page, h: p.headerSignature, r: p.requestKey, assigned: 1, gaps: [] }); }
    pendingGap = [];
  }
  const sig = (c: { h: string | null; r: string | null }) => combineSignature(c.h, c.r) as string;
  return {
    ranges: cur.map(c => ({ from: c.from, to: c.to, signature: sig(c), assignedPages: c.assigned, gapPages: c.gaps })),
    transitions: transitionsRaw.map(t => ({ fromSignature: sig(cur[t.fromIdx]), toSignature: sig(cur[t.toIdx]), lastPageBefore: t.lastBefore, firstPageAfter: t.firstAfter, unassignedPagesBetween: t.between })),
    leadingUnassigned: leading, trailingUnassigned: pendingGap,
  };
}

export type PdfLayoutStatus = 'single_layout_like' | 'mixed_layout_like' | 'insufficient_evidence';
export function pdfStatus(ranges: LayoutRange[]): PdfLayoutStatus {
  const distinct = new Set(ranges.map(r => r.signature)).size;
  return distinct === 0 ? 'insufficient_evidence' : distinct === 1 ? 'single_layout_like' : 'mixed_layout_like';
}

/** 既存の hierarchy 契約の page 範囲 [a, b] が layout range の境界と一致するか（a の page が range の先頭、b の page が range の末尾。range に属さない page は不一致） */
export function contractAlignment(ranges: LayoutRange[], totalPages: number, a: number, b: number): { startAligned: boolean; endAligned: boolean; rangesInside: number } {
  const idx = (page: number) => ranges.findIndex(r => page >= r.from && page <= r.to);
  const ia = idx(a), ib = idx(b);
  const startAligned = ia >= 0 && (a === 1 || idx(a - 1) !== ia);
  const endAligned = ib >= 0 && (b === totalPages || idx(b + 1) !== ib);
  const inside = new Set<number>();
  for (let p = a; p <= b; p++) { const i = idx(p); if (i >= 0) inside.add(i); }
  return { startAligned, endAligned, rangesInside: inside.size };
}

export type LayoutDecision = 'LAYOUT_VARIANTS_DETERMINISTIC' | 'LAYOUT_DETERMINISTIC_BUT_HIERARCHY_SOURCE_INCOMPLETE' | 'LAYOUT_VARIANTS_AMBIGUOUS' | 'INCONCLUSIVE';
export interface LayoutFacts { developmentOk: boolean; evaluablePdfs: number; unavailablePdfs: number; pagesRequestMultimodal: number; pagesRequestDominant: number; contractPdfs: number; contractAligned: number }

/** 事前登録の判定規則（上から順）。件数同士の比較のみ。結果を見た後に条件・閾値を足さない */
export function decideLayout(f: LayoutFacts): { decision: LayoutDecision; rule: number } {
  if (!f.developmentOk || f.unavailablePdfs >= f.evaluablePdfs) return { decision: 'INCONCLUSIVE', rule: 1 };
  if (f.pagesRequestMultimodal > f.pagesRequestDominant) return { decision: 'LAYOUT_VARIANTS_AMBIGUOUS', rule: 2 };
  if (f.contractAligned < f.contractPdfs) return { decision: 'LAYOUT_DETERMINISTIC_BUT_HIERARCHY_SOURCE_INCOMPLETE', rule: 3 };
  return { decision: 'LAYOUT_VARIANTS_DETERMINISTIC', rule: 4 };
}

/** header signature ごとに、その page 群の request x（dominant）が 0.5pt を超えて離れた 2 つ以上のクラスタに分かれるか。報告用（判定規則には使わない） */
export function headerSignatureRequestClusters(pages: PageSummary[]): Record<string, number> {
  const by = new Map<string, number[]>();
  for (const p of pages) if (p.headerSignature && p.requestDominantX !== null) { if (!by.has(p.headerSignature)) by.set(p.headerSignature, []); by.get(p.headerSignature)!.push(p.requestDominantX); }
  const out: Record<string, number> = {};
  for (const [h, xs] of by) { const s = [...xs].sort((a, b) => a - b); out[h] = 1 + s.filter((x, i) => i > 0 && x - s[i - 1] > DOMINANCE_TOLERANCE).length; }
  return out;
}
