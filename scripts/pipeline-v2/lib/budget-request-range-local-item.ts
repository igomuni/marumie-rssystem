/**
 * range-local 座標ベースの item-shaped row candidate detector（research。production の recordKind=item には接続しない）。
 * 前回 detector（budget-request-item-candidate.ts。変更しない）の候補条件をそのまま使い、request x の基準を PDF 全体ではなく、凍結済み layout range（明細表 range）内の request 行から決める。
 * hierarchy・MOF・金額は使わない。基準が決められない range は fail-closed（候補を数えない）。
 */
import { MIN_REFERENCE_REQUESTS, detectCandidates, referenceX, type CandidateSourceRecord, type ItemCandidate } from './budget-request-item-candidate';
import { DOMINANCE_TOLERANCE, histogram } from './budget-request-layout-inventory';

export type RangeStatus = 'evaluable_detail_range' | 'range_request_x_unavailable' | 'range_multimodal' | 'outside_detail_range';

/** 明細表 range の mapping（事前登録）: layout range の signature の header 成分が設定されている（`H:-` でない）range */
export const isDetailRangeSignature = (signature: string): boolean => signature.startsWith('H:') && !signature.startsWith('H:-|');

export interface RangeLike { from: number; to: number; signature: string }
export interface RangeEvaluation { status: RangeStatus; refX: number | null; requests: number; candidates: ItemCandidate[] }

/**
 * range 内の records（page が [from, to] のもの）から候補を検出する。
 * request 行が MIN_REFERENCE_REQUESTS 未満 → range_request_x_unavailable、request x（0.1pt histogram）が最頻値から DOMINANCE_TOLERANCE 以内に収まらない → range_multimodal。
 */
export function evaluateRange(range: RangeLike, records: CandidateSourceRecord[]): RangeEvaluation {
  if (!isDetailRangeSignature(range.signature)) return { status: 'outside_detail_range', refX: null, requests: 0, candidates: [] };
  const inRange = records.filter(r => r.anchor.page >= range.from && r.anchor.page <= range.to);
  const { refX, requests } = referenceX(inRange);
  if (refX === null) return { status: 'range_request_x_unavailable', refX: null, requests, candidates: [] };
  const xs = inRange.filter(r => r.recordKind === 'request' && r.rowLocal.code.status === 'resolved' && r.rowLocal.code.evidence).map(r => r.rowLocal.code.evidence!.bboxUnion.xMin);
  const h = histogram(xs);
  const mode = h.reduce((b, e) => (e[1] > b[1] || (e[1] === b[1] && e[0] < b[0]) ? e : b));
  if (!h.every(([x]) => Math.abs(x - mode[0]) <= DOMINANCE_TOLERANCE)) return { status: 'range_multimodal', refX: null, requests, candidates: [] };
  return { status: 'evaluable_detail_range', refX, requests, candidates: detectCandidates(inRange, refX) };
}

export { MIN_REFERENCE_REQUESTS };
