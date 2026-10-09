/**
 * B 層 scope continuity の mechanical census 用 analysis-only helper。
 * 「context 候補がどの境界まで observable か」を数えるだけで、parent resolver ではない。
 * A 層 committed parser 出力（PageOut）のみを読み、意味を推測して埋めない。production path からは呼ばれない。
 *
 * ---- 定義（census 実行前に固定。結果を見て調整しない）----
 * 用語: ITEM = （項）MARKER_ROW。REQUEST = REQUEST_NUMBER_ROW。
 *   ACTIVE_ITEM_CONTEXT_CANDIDATE = 当該 REQUEST より同一 stream 内の物理順（lineIndex 昇順）で前にある最も近い ITEM。
 *   真の parent を意味しない。「parent」という語は使わない。
 *   interruption 候補 = 組織/会計/勘定/所管 marker、TITLE_OR_HEADING、OTHER_CODE、UNKNOWN_ABSTAINED（scope を切ると決めない）。
 *   semantic row = REQUEST_NUMBER_ROW または MARKER_ROW。
 * stream（順序が確立できる単位。lineIndex 昇順）:
 *   SPLIT page   : LEFT / RIGHT（column 内は lineIndex で確立）、HEADER（UNSPLIT 行。item 分析の対象外）
 *   UNSPLIT page : PAGE（page-local の単一 stream。column 情報なし）
 *   PAGE_ABSTAINED: stream なし（units 0）
 *   LEFT↔RIGHT の順序は ORDER_NOT_ESTABLISHED。配列順・sourceOrder 順・LEFT→RIGHT を semantic 順にしない。
 *   stream をまたぐ context 候補（cross-column / cross-page）は census では「存在し得るか」の記述のみで、carry しない。
 * Q1: REQUEST ごとに同一 stream 内の nearest preceding ITEM、その間の marker 列・interruption 候補（gap）を記録。
 * Q2: SPLIT の RIGHT stream で ITEM より前に REQUEST があるケース（先頭 semantic row が REQUEST か、left 末尾の記述、heading 有無）。
 * Q3: stream 内で最初の REQUEST より前に ITEM が無いケース。UNSPLIT は PAGE stream。SPLIT は LEFT 先頭・RIGHT 先頭を別々に数え、
 *     どちらがページ先頭かを主張しない。前ページから補完しない。
 * Q4: ITEM → 続く連続 REQUEST 列 → 終端（最初の非 REQUEST 行の kind / STREAM_END）。reset とは決めない。
 * Q5: ITEM と REQUEST の間（gap）に入る interruption 種別の分類。
 * Population（重複可・exclusive でない）:
 *   P1 = SPLIT page で、同一 column stream 内に先行 ITEM を持つ REQUEST が 1 件以上
 *   P2 = SPLIT page の RIGHT stream に、RIGHT 内で先行 ITEM の無い REQUEST が 1 件以上（ITEM が RIGHT 内に無い場合を含む）
 *   P3 = ITEM に先行されない REQUEST が stream 内の最初の REQUEST である stream を持つ page
 *        （UNSPLIT: PAGE stream。SPLIT: LEFT 先頭 = P3_LEFT / RIGHT 先頭 = P3_RIGHT。どちらかで page 該当）
 *   P4 = SPLIT page で、ある column に先行 ITEM の無い REQUEST があり、かつ他方 column に ITEM がある
 *        （page 内に explicit ITEM は存在するが、column をまたぐ順序が ORDER_NOT_ESTABLISHED のため context 候補が曖昧）
 *   P5 = 非 abstain page で explicit ITEM 数 0
 *   P6 = A 層 evidence 不足。P6_PAGE_ABSTAINED（NO_A_LAYER_SEMANTIC_EVIDENCE）／ P6_UNSPLIT_COLUMN（column 依存の問いは COLUMN_CONTEXT_NOT_AVAILABLE。
 *        right blank を仮定しない）
 * failure family の機械的ラベル（semantic rule ではない・重複可）:
 *   SAME_COLUMN_CONTEXT_AVAILABLE = P1 / COLUMN_BOUNDARY_CONTEXT_MISSING = P2 / PAGE_BOUNDARY_CONTEXT_MISSING = P3 /
 *   ITEM_FREE_PAGE = P5 / ORDER_AMBIGUOUS = P4 / A_LAYER_UNAVAILABLE = P6_PAGE_ABSTAINED
 */
import type { PageOut, RowOut } from './budget-request-toc-row-assembly';

export type StreamName = 'LEFT' | 'RIGHT' | 'PAGE' | 'HEADER';
export const MARKER_KINDS: Record<string, string> = { '（項）': 'ITEM', '（組織）': 'ORG', '（会計）': 'KAIKEI', '（勘定）': 'KANJO', '（所管）': 'SHOKAN' };
export const ORDER_NOT_ESTABLISHED = 'ORDER_NOT_ESTABLISHED';
export const POPULATIONS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;

export interface PageMeta { localPdfPath: string; physicalPage: number; partition: string; classifierSource: string }
export interface Tag { kind: string; code: string | null }
export interface ItemSeq { code: string | null; lineIndex: number; contiguousRequests: number; requestsBeforeNextItemOrEnd: number; terminator: string }
export interface GapRecord { request: string; item: string | null; gap: string[] }
export interface StreamCensus {
  stream: StreamName; rows: number; requests: number; items: number;
  strictlyIncreasing: boolean; sourceOrderIsIndex: boolean;
  requestsBeforeFirstItem: number; requestsWithPriorItem: number;
  firstSemantic: Tag | null; firstExplicitMarker: Tag | null; lastSemanticTail: Tag[];
  firstRowsKinds: string[]; interruptionBeforeFirstItem: string[];
  preItemRequestsAmongFirstSemantic: boolean;
  itemSequences: ItemSeq[]; gapSignatures: Record<string, number>; gapRecords: GapRecord[];
}
export interface PageCensus {
  localPdfPath: string; pdfSha256: string; physicalPage: number; partition: string; pageState: string; classifierSource: string;
  priorPageInCorpus: { present: boolean; pageState: string | null };
  ordering: { status: string; crossColumn: string; arrayOrderDiffersFromLineIndex: boolean; leftRightRangesOverlap: boolean | null; headerRowsInterleavedWithBody: number | null };
  counts: { rows: number; items: number; requests: number; markerKinds: Record<string, number>; duplicateItemCodes: number };
  sameColumnRequestWithPriorItem: number | null; pageLocalRequestWithPriorItem: number | null;
  columnStartRequestWithoutPriorItem: { LEFT: number | null; RIGHT: number | null };
  pageStartRequestBeforeFirstItem: { PAGE: number | null; LEFT: number | null; RIGHT: number | null };
  streams: StreamCensus[];
  q2: null | { rightStartsWithRequest: boolean; rightRequestsBeforeFirstItem: number; rightHasItem: boolean; leftTail: Tag[]; leftHasItem: boolean; headingInterruptionInRightPrefix: boolean; rightRequestsToFirstExplicitItem: number | null };
  interruptionKinds: string[];
  reasons: string[];
  flags: { P1: boolean; P2: boolean; P3: boolean; P3_PAGE: boolean; P3_LEFT: boolean; P3_RIGHT: boolean; P4: boolean; P5: boolean; P6: boolean; P6_PAGE_ABSTAINED: boolean; P6_UNSPLIT_COLUMN: boolean };
  families: string[];
}

const kindOf = (r: RowOut): string => (r.rowKind === 'MARKER_ROW' ? (MARKER_KINDS[r.rowStartTokenRaw ?? ''] ?? 'MARKER_OTHER') : r.rowKind === 'REQUEST_NUMBER_ROW' ? 'REQUEST' : r.rowKind);
export const tagOf = (r: RowOut): Tag => ({ kind: kindOf(r), code: r.rowKind === 'REQUEST_NUMBER_ROW' ? reqNo(r) : r.rowKind === 'MARKER_ROW' ? r.codeRaw : null });
const reqNo = (r: RowOut) => (/^\s*(\d+)/.exec(r.rowStartTokenRaw ?? '')?.[1] ?? r.rowStartTokenRaw ?? '?');
const isSemantic = (r: RowOut) => r.rowKind === 'REQUEST_NUMBER_ROW' || r.rowKind === 'MARKER_ROW';
const isItem = (r: RowOut) => kindOf(r) === 'ITEM';
const isReq = (r: RowOut) => r.rowKind === 'REQUEST_NUMBER_ROW';
const tagStr = (t: Tag) => (t.code ? `${t.kind}:${t.code}` : t.kind);
const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
const sortKeys = (m: Record<string, number>) => Object.fromEntries(Object.keys(m).sort().map(k => [k, m[k]]));

export function censusStream(name: StreamName, rows: RowOut[]): StreamCensus {
  const s = [...rows].sort((a, b) => a.provenance.lineIndex - b.provenance.lineIndex);
  const strictlyIncreasing = rows.every((r, i) => i === 0 || r.provenance.lineIndex > rows[i - 1].provenance.lineIndex) && s.every((r, i) => r === rows[i]);
  const sourceOrderIsIndex = s.every((r, i) => r.sourceOrder === i);
  let lastItem = -1;
  let before = 0, withPrior = 0;
  const gapSignatures: Record<string, number> = {}, gapRecords: GapRecord[] = [];
  for (let i = 0; i < s.length; i++) {
    if (isItem(s[i])) lastItem = i;
    if (!isReq(s[i])) continue;
    if (lastItem < 0) { before++; continue; }
    withPrior++;
    const gap = s.slice(lastItem + 1, i).filter(r => !isReq(r)).map(r => tagStr(tagOf(r)));
    bump(gapSignatures, gap.length ? s.slice(lastItem + 1, i).filter(r => !isReq(r)).map(kindOf).join('>') : '-');
    if (gap.length) gapRecords.push({ request: reqNo(s[i]), item: s[lastItem].codeRaw, gap });
  }
  const itemSequences: ItemSeq[] = [];
  s.forEach((r, i) => {
    if (!isItem(r)) return;
    let j = i + 1, contiguous = 0;
    while (j < s.length && isReq(s[j])) { contiguous++; j++; }
    let k = i + 1, total = 0;
    while (k < s.length && !isItem(s[k])) { if (isReq(s[k])) total++; k++; }
    itemSequences.push({ code: r.codeRaw, lineIndex: r.provenance.lineIndex, contiguousRequests: contiguous, requestsBeforeNextItemOrEnd: total, terminator: j >= s.length ? 'STREAM_END' : kindOf(s[j]) });
  });
  const firstItemIdx = s.findIndex(isItem);
  const prefix = firstItemIdx < 0 ? s : s.slice(0, firstItemIdx);
  const sem = s.filter(isSemantic);
  const firstMarker = s.find(r => r.rowKind === 'MARKER_ROW');
  return {
    stream: name, rows: s.length, requests: s.filter(isReq).length, items: s.filter(isItem).length, strictlyIncreasing, sourceOrderIsIndex,
    requestsBeforeFirstItem: before, requestsWithPriorItem: withPrior,
    firstSemantic: sem[0] ? tagOf(sem[0]) : null, firstExplicitMarker: firstMarker ? tagOf(firstMarker) : null, lastSemanticTail: sem.slice(-4).map(tagOf),
    firstRowsKinds: s.slice(0, 6).map(r => tagStr(tagOf(r))),
    interruptionBeforeFirstItem: prefix.filter(r => !isReq(r)).map(r => tagStr(tagOf(r))),
    preItemRequestsAmongFirstSemantic: sem[0] ? isReq(sem[0]) : false,
    itemSequences, gapSignatures: sortKeys(gapSignatures), gapRecords,
  };
}

export function censusPage(meta: PageMeta, p: PageOut, prior: { present: boolean; pageState: string | null }): PageCensus {
  const rows = p.rows;
  const by = (c: string) => rows.filter(r => r.column === c);
  const markerKinds: Record<string, number> = {};
  rows.filter(r => r.rowKind === 'MARKER_ROW').forEach(r => bump(markerKinds, kindOf(r)));
  const itemCodes = rows.filter(isItem).map(r => r.codeRaw);
  const duplicateItemCodes = itemCodes.length - new Set(itemCodes).size;
  const counts = { rows: rows.length, items: itemCodes.length, requests: rows.filter(isReq).length, markerKinds: sortKeys(markerKinds), duplicateItemCodes };
  const base = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, partition: meta.partition, pageState: p.pageState, classifierSource: p.classifierSource, priorPageInCorpus: prior, counts };
  const reasons: string[] = [];
  const zero = { P1: false, P2: false, P3: false, P3_PAGE: false, P3_LEFT: false, P3_RIGHT: false, P4: false, P5: false, P6: false, P6_PAGE_ABSTAINED: false, P6_UNSPLIT_COLUMN: false };

  if (p.pageState === 'PAGE_ABSTAINED' || rows.length === 0) {
    reasons.push('NO_A_LAYER_SEMANTIC_EVIDENCE');
    return { ...base, ordering: { status: 'NO_A_LAYER_SEMANTIC_EVIDENCE', crossColumn: 'NOT_APPLICABLE', arrayOrderDiffersFromLineIndex: false, leftRightRangesOverlap: null, headerRowsInterleavedWithBody: null }, sameColumnRequestWithPriorItem: null, pageLocalRequestWithPriorItem: null, columnStartRequestWithoutPriorItem: { LEFT: null, RIGHT: null }, pageStartRequestBeforeFirstItem: { PAGE: null, LEFT: null, RIGHT: null }, streams: [], q2: null, interruptionKinds: [], reasons, flags: { ...zero, P6: true, P6_PAGE_ABSTAINED: true }, families: ['A_LAYER_UNAVAILABLE'] };
  }

  const interruption = new Set<string>();
  const addInterruptions = (st: StreamCensus) => {
    Object.keys(st.gapSignatures).forEach(k => k.split('>').forEach(x => { if (x !== '-') interruption.add(x); }));
  };
  const arrayDiff = (() => { const s = [...rows].sort((a, b) => a.provenance.lineIndex - b.provenance.lineIndex || (a.column === b.column ? 0 : a.column === 'LEFT' ? -1 : 1)); return s.some((r, i) => r !== rows[i]); })();

  if (p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE') {
    const st = censusStream('PAGE', rows);
    addInterruptions(st);
    reasons.push('COLUMN_CONTEXT_NOT_AVAILABLE');
    const p3 = st.requests > 0 && st.requestsBeforeFirstItem > 0;
    const p5 = st.items === 0;
    const flags = { ...zero, P3: p3, P3_PAGE: p3, P5: p5, P6: true, P6_UNSPLIT_COLUMN: true };
    const families = [...(p3 ? ['PAGE_BOUNDARY_CONTEXT_MISSING'] : []), ...(p5 ? ['ITEM_FREE_PAGE'] : [])];
    return { ...base, ordering: { status: 'PAGE_LOCAL_LINEINDEX_ORDER', crossColumn: 'NOT_APPLICABLE', arrayOrderDiffersFromLineIndex: arrayDiff, leftRightRangesOverlap: null, headerRowsInterleavedWithBody: null }, sameColumnRequestWithPriorItem: null, pageLocalRequestWithPriorItem: st.requestsWithPriorItem, columnStartRequestWithoutPriorItem: { LEFT: null, RIGHT: null }, pageStartRequestBeforeFirstItem: { PAGE: st.requestsBeforeFirstItem, LEFT: null, RIGHT: null }, streams: [st], q2: null, interruptionKinds: [...interruption].sort(), reasons, flags, families };
  }

  const L = censusStream('LEFT', by('LEFT')), R = censusStream('RIGHT', by('RIGHT')), H = censusStream('HEADER', by('UNSPLIT'));
  [L, R].forEach(addInterruptions);
  const lr = rows.filter(r => r.column !== 'UNSPLIT');
  const lMin = Math.min(...by('LEFT').map(r => r.provenance.lineIndex)), lMax = Math.max(...by('LEFT').map(r => r.provenance.lineIndex));
  const rMin = Math.min(...by('RIGHT').map(r => r.provenance.lineIndex)), rMax = Math.max(...by('RIGHT').map(r => r.provenance.lineIndex));
  const bodyMin = Math.min(...lr.map(r => r.provenance.lineIndex)), bodyMax = Math.max(...lr.map(r => r.provenance.lineIndex));
  const interleaved = by('UNSPLIT').filter(r => r.provenance.lineIndex > bodyMin && r.provenance.lineIndex < bodyMax).length;
  if (H.rows > 0 && H.items + H.requests > 0) reasons.push('HEADER_ZONE_HAS_SEMANTIC_ROW');
  const overlap = L.rows > 0 && R.rows > 0 ? lMax >= rMin && rMax >= lMin : null;
  const p1 = L.requestsWithPriorItem + R.requestsWithPriorItem > 0;
  const p2 = R.requestsBeforeFirstItem > 0;
  const p3L = L.requestsBeforeFirstItem > 0, p3R = R.requestsBeforeFirstItem > 0;
  const p4 = (p3L && R.items > 0) || (p3R && L.items > 0);
  const p5 = L.items + R.items === 0;
  if (p4) reasons.push('CROSS_COLUMN_ORDER_NOT_ESTABLISHED_WITH_ITEM_IN_OTHER_COLUMN');
  const rFirstItemIdx = [...by('RIGHT')].sort((a, b) => a.provenance.lineIndex - b.provenance.lineIndex).findIndex(isItem);
  const q2 = p2 ? { rightStartsWithRequest: R.preItemRequestsAmongFirstSemantic, rightRequestsBeforeFirstItem: R.requestsBeforeFirstItem, rightHasItem: R.items > 0, leftTail: L.lastSemanticTail, leftHasItem: L.items > 0, headingInterruptionInRightPrefix: R.interruptionBeforeFirstItem.some(x => x.startsWith('TITLE_OR_HEADING') || x.startsWith('OTHER_CODE') || x.startsWith('UNKNOWN_ABSTAINED')), rightRequestsToFirstExplicitItem: rFirstItemIdx < 0 ? null : R.requestsBeforeFirstItem } : null;
  const flags = { ...zero, P1: p1, P2: p2, P3: p3L || p3R, P3_PAGE: false, P3_LEFT: p3L, P3_RIGHT: p3R, P4: p4, P5: p5 };
  const families = [...(p1 ? ['SAME_COLUMN_CONTEXT_AVAILABLE'] : []), ...(p2 ? ['COLUMN_BOUNDARY_CONTEXT_MISSING'] : []), ...(p3L || p3R ? ['PAGE_BOUNDARY_CONTEXT_MISSING'] : []), ...(p5 ? ['ITEM_FREE_PAGE'] : []), ...(p4 ? ['ORDER_AMBIGUOUS'] : [])];
  return { ...base, ordering: { status: 'WITHIN_COLUMN_LINEINDEX_ORDER', crossColumn: ORDER_NOT_ESTABLISHED, arrayOrderDiffersFromLineIndex: arrayDiff, leftRightRangesOverlap: overlap, headerRowsInterleavedWithBody: interleaved }, sameColumnRequestWithPriorItem: L.requestsWithPriorItem + R.requestsWithPriorItem, pageLocalRequestWithPriorItem: null, columnStartRequestWithoutPriorItem: { LEFT: L.requestsBeforeFirstItem, RIGHT: R.requestsBeforeFirstItem }, pageStartRequestBeforeFirstItem: { PAGE: null, LEFT: L.requestsBeforeFirstItem, RIGHT: R.requestsBeforeFirstItem }, streams: [L, R, H], q2, interruptionKinds: [...interruption].sort(), reasons, flags, families };
}

export interface Tally { pages: number; P1: number; P2: number; P3: number; P3_PAGE: number; P3_LEFT: number; P3_RIGHT: number; P4: number; P5: number; P6: number; P6_PAGE_ABSTAINED: number; P6_UNSPLIT_COLUMN: number; none: number; overlapMatrix: Record<string, number>; families: Record<string, number> }
export function tally(pages: PageCensus[]): Tally {
  const keys = ['P1', 'P2', 'P3', 'P3_LEFT', 'P3_RIGHT', 'P4', 'P5', 'P6', 'P6_PAGE_ABSTAINED', 'P6_UNSPLIT_COLUMN'] as const;
  const t: any = { pages: pages.length, P3_PAGE: pages.filter(p => p.flags.P3_PAGE).length, none: 0, overlapMatrix: {}, families: {} };
  keys.forEach(k => { t[k] = pages.filter(p => p.flags[k]).length; });
  const om: Record<string, number> = {}, fam: Record<string, number> = {};
  pages.forEach(p => {
    const c = POPULATIONS.filter(k => p.flags[k]).join('+') || 'NONE';
    bump(om, c);
    p.families.forEach(f => bump(fam, f));
  });
  t.none = om.NONE ?? 0;
  t.overlapMatrix = sortKeys(om); t.families = sortKeys(fam);
  return t as Tally;
}

/** ordering evidence の再確認（stream 単位の strict monotonic・sourceOrder = index・配列順差・LEFT/RIGHT 範囲重なり）。 */
export function orderingAccounting(pages: PageCensus[]) {
  const groups = pages.flatMap(p => p.streams);
  const split = pages.filter(p => p.pageState === 'ASSEMBLED_SPLIT'), unsplit = pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE');
  return {
    pageColumnGroups: groups.length,
    byStream: sortKeys(groups.reduce((a: Record<string, number>, g) => (bump(a, g.stream), a), {})),
    strictlyIncreasing: groups.filter(g => g.strictlyIncreasing).length,
    sourceOrderIsIndex: groups.filter(g => g.sourceOrderIsIndex).length,
    splitPages: split.length, splitArrayOrderDiffers: split.filter(p => p.ordering.arrayOrderDiffersFromLineIndex).length,
    splitLeftRightRangesOverlap: split.filter(p => p.ordering.leftRightRangesOverlap).length,
    unsplitPages: unsplit.length, unsplitArrayOrderDiffers: unsplit.filter(p => p.ordering.arrayOrderDiffersFromLineIndex).length,
    headerRowsInterleavedWithBody: split.reduce((a, p) => a + (p.ordering.headerRowsInterleavedWithBody ?? 0), 0),
    headerRowsInterleavedPages: split.filter(p => (p.ordering.headerRowsInterleavedWithBody ?? 0) > 0).length,
  };
}

/** Q1〜Q5 の corpus 集計。 */
export function questionTotals(pages: PageCensus[]) {
  const split = pages.filter(p => p.pageState === 'ASSEMBLED_SPLIT');
  const col = split.flatMap(p => p.streams.filter(s => s.stream !== 'HEADER'));
  const gap: Record<string, number> = {}, term: Record<string, number> = {}, gapKindRequests: Record<string, number> = {};
  const allBody = pages.flatMap(p => p.streams.filter(s => s.stream !== 'HEADER'));
  allBody.forEach(s => {
    Object.entries(s.gapSignatures).forEach(([k, n]) => { bump(gap, k, n); if (k !== '-') new Set(k.split('>')).forEach(x => bump(gapKindRequests, x, n)); });
    s.itemSequences.forEach(i => bump(term, i.terminator));
  });
  const q2p = split.filter(p => p.q2);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return {
    q1_splitSameColumn: { requestsWithPriorItem: sum(col.map(s => s.requestsWithPriorItem)), pagesWithPriorItem: split.filter(p => (p.sameColumnRequestWithPriorItem ?? 0) > 0).length, requestsWithoutPriorItem: sum(col.map(s => s.requestsBeforeFirstItem)), splitRequests: sum(col.map(s => s.requests)) },
    q1_unsplitPageLocal: { requestsWithPriorItem: sum(pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE').map(p => p.pageLocalRequestWithPriorItem ?? 0)), requestsWithoutPriorItem: sum(pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE').map(p => p.pageStartRequestBeforeFirstItem.PAGE ?? 0)) },
    q2_rightRequestBeforeRightItem: { pages: q2p.length, requests: sum(q2p.map(p => p.q2!.rightRequestsBeforeFirstItem)), rightStartsWithRequestPages: q2p.filter(p => p.q2!.rightStartsWithRequest).length, rightStartsWithRequestRequests: sum(q2p.filter(p => p.q2!.rightStartsWithRequest).map(p => p.q2!.rightRequestsBeforeFirstItem)), leftHasItemPages: q2p.filter(p => p.q2!.leftHasItem).length, rightHasNoItemPages: q2p.filter(p => !p.q2!.rightHasItem).length, headingInterruptionPages: q2p.filter(p => p.q2!.headingInterruptionInRightPrefix).length },
    q3_pageStart: { unsplitPagesRequestBeforeFirstItem: pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE' && p.flags.P3).length, unsplitRequests: sum(pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE').map(p => p.pageStartRequestBeforeFirstItem.PAGE ?? 0)), splitLeftStartPages: split.filter(p => p.flags.P3_LEFT).length, splitLeftStartRequests: sum(split.map(p => p.pageStartRequestBeforeFirstItem.LEFT ?? 0)), splitRightStartPages: split.filter(p => p.flags.P3_RIGHT).length, splitRightStartRequests: sum(split.map(p => p.pageStartRequestBeforeFirstItem.RIGHT ?? 0)), splitEitherPages: split.filter(p => p.flags.P3).length, splitBothPages: split.filter(p => p.flags.P3_LEFT && p.flags.P3_RIGHT).length, byClassifierSource: sortKeys(pages.filter(p => p.flags.P3).reduce((a: Record<string, number>, p) => (bump(a, `${p.pageState}/${p.classifierSource}`), a), {})) },
    q4_terminatorAfterItemRequestSequence: sortKeys(term),
    q5_gapSignatureRequests: sortKeys(gap), q5_requestsWithGapContainingKind: sortKeys(gapKindRequests),
  };
}
