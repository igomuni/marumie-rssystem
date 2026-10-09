/**
 * TOC A 層 right-band evidence の「rejected request token」census 用 analysis helper（analysis-only・production path から呼ばない）。
 * 現行 H1 / #393 の evidence 述語（RIGHT_BAND_EVIDENCE・start > firstNonWs）を再現して accepted / rejected を数えるだけで、parser の意味は変えない。
 * 「right-only-line candidate」は raw line の先頭 token が行頭空白の後ろ（index > 0）にあることを示す機械的ラベルで、visual に right column であることを意味しない。
 *
 * ---- diagnostic classification の定義（census 実行前に固定。corpus の結果を見た後で調整しない）----
 * a  = accepted request evidence count（現行述語どおり）
 * ro = right-only-line candidate = rejected かつ firstTokenOnLine かつ token 開始 index > 0
 * （index 0 の firstTokenOnLine は left 列頭 / 全幅行と区別できないため lineStart0 として別カウントし ro に含めない）
 * A2 pattern = ro が 2 件以上あり、開始 index が BAND_TOLERANCE_CHARS 以内の 1 window に 2 件以上含まれる
 * resolved = 現行 pageState が ASSEMBLED_SPLIT
 * - A2_LIKE_REJECTED_RIGHT_ONLY      : a < 2 かつ A2 pattern
 * - A2_PATTERN_BUT_CURRENTLY_RESOLVED: a >= 2 かつ A2 pattern かつ resolved
 * - MIXED_OR_UNRESOLVED              : 上記に当たらず、a >= 2 だが resolved でない / FROZEN_INPUT_MISMATCH 等 a に由来しない abstain
 * - A1_LIKE_SPARSE                   : a < 2 かつ A2 pattern なし かつ pageState が PAGE_ABSTAINED（RIGHT_EVIDENCE_INSUFFICIENT / MARKER_ONLY_RIGHT_BOUNDARY）
 * - NO_A2_PATTERN                    : 上記以外の A2 pattern なし（SPLIT、または a == 0 の ASSEMBLED_UNSPLIT）
 * 各分類内の sub-breakdown（accepted==0 / accepted==1 / accepted>=2 / MARKER_ONLY）を併記し、レビュー側で再分類できるようにする。
 */
import { BAND_MIN_EVIDENCE, BAND_TOLERANCE_CHARS, REQUEST_TOKEN_SOURCE } from './budget-request-toc-row-assembly-h1';

const RIGHT_BAND_EVIDENCE = new RegExp(`\\d{1,4}(\\s+)(${REQUEST_TOKEN_SOURCE})`, 'gu');
const ANY_REQUEST_TOKEN = new RegExp(REQUEST_TOKEN_SOURCE, 'gu');

export const CLASSIFICATIONS = ['A1_LIKE_SPARSE', 'A2_LIKE_REJECTED_RIGHT_ONLY', 'A2_PATTERN_BUT_CURRENTLY_RESOLVED', 'NO_A2_PATTERN', 'MIXED_OR_UNRESOLVED'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const SUB_BREAKDOWNS = ['accepted0', 'accepted1', 'accepted2plus', 'markerOnly'] as const;
export type SubBreakdown = (typeof SUB_BREAKDOWNS)[number];
export type PageStateName = 'ASSEMBLED_SPLIT' | 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE' | 'PAGE_ABSTAINED';

export type RejectReason = 'FIRST_TOKEN_ON_LINE_INDEX0' | 'FIRST_TOKEN_ON_LINE_RIGHT_ONLY' | 'NOT_FIRST_NOT_PRECEDED_BY_DIGITS_WS';
export interface TokenTrace { lineIndex: number; charIndex: number; token: string; accepted: boolean; rejectReason: RejectReason | null }
export interface PageCensusContext { pageState: PageStateName; pageAbstentionReason: string | null }
export interface PageCensus {
  acceptedEvidenceCount: number;
  acceptedNotInAnyToken: number;
  requestTokenCandidatesAll: number;
  rejectedCount: number;
  rejectedByReason: Record<RejectReason, number>;
  lineStart0Candidates: number;
  rightOnlyCandidates: number;
  rightOnlyStartHistogram: Record<string, number>;
  dominantRightOnlyWindow: { start: number; count: number } | null;
  a2Pattern: boolean;
  classification: Classification;
  subBreakdown: SubBreakdown;
  tokens: TokenTrace[];
}

const cps = (s: string) => Array.from(s);
const cpIndex = (s: string, utf16: number) => Array.from(s.slice(0, utf16)).length;
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);

/** 現行述語（budget-request-toc-row-assembly-h1.ts の bandEvidenceOf）と同じ accepted 開始 index 集合 */
export function acceptedStarts(text: string): Set<number> {
  const first = cps(text).findIndex(c => !isWs(c));
  const out = new Set<number>();
  for (const m of text.matchAll(RIGHT_BAND_EVIDENCE)) {
    const tokenUtf16 = (m.index as number) + m[0].length - m[2].length;
    const start = cpIndex(text, tokenUtf16);
    if (start > first) out.add(start);
  }
  return out;
}

/** 開始 index の multiset から、幅 BAND_TOLERANCE_CHARS 以内の window に最も多く入る件数（同数は小さい start を採る） */
export function dominantWindow(starts: number[]): { start: number; count: number } | null {
  if (!starts.length) return null;
  let best: { start: number; count: number } | null = null;
  for (const v of [...new Set(starts)].sort((a, b) => a - b)) {
    const count = starts.filter(s => s >= v && s <= v + BAND_TOLERANCE_CHARS).length;
    if (!best || count > best.count) best = { start: v, count };
  }
  return best;
}

export function classify(a: number, a2Pattern: boolean, ctx: PageCensusContext): Classification {
  if (a < BAND_MIN_EVIDENCE && a2Pattern) return 'A2_LIKE_REJECTED_RIGHT_ONLY';
  if (a >= BAND_MIN_EVIDENCE && a2Pattern && ctx.pageState === 'ASSEMBLED_SPLIT') return 'A2_PATTERN_BUT_CURRENTLY_RESOLVED';
  if (ctx.pageAbstentionReason === 'FROZEN_INPUT_MISMATCH' || (a >= BAND_MIN_EVIDENCE && ctx.pageState !== 'ASSEMBLED_SPLIT')) return 'MIXED_OR_UNRESOLVED';
  if (a < BAND_MIN_EVIDENCE && ctx.pageState === 'PAGE_ABSTAINED') return 'A1_LIKE_SPARSE';
  return 'NO_A2_PATTERN';
}

export function subBreakdownOf(a: number, ctx: PageCensusContext): SubBreakdown {
  if (ctx.pageAbstentionReason === 'MARKER_ONLY_RIGHT_BOUNDARY') return 'markerOnly';
  return a === 0 ? 'accepted0' : a === 1 ? 'accepted1' : 'accepted2plus';
}

export function censusPage(lines: { lineIndex: number; text: string }[], ctx: PageCensusContext): PageCensus {
  const tokens: TokenTrace[] = [];
  let accepted = 0; let acceptedNotInAny = 0;
  for (const l of lines) {
    const acc = acceptedStarts(l.text);
    const first = cps(l.text).findIndex(c => !isWs(c));
    const anyStarts = new Set<number>();
    for (const m of l.text.matchAll(ANY_REQUEST_TOKEN)) {
      const start = cpIndex(l.text, m.index as number);
      anyStarts.add(start);
      const ok = acc.has(start);
      const before = l.text.slice(0, m.index as number);
      let rejectReason: RejectReason | null = null;
      if (!ok) {
        if (start <= first) rejectReason = start > 0 ? 'FIRST_TOKEN_ON_LINE_RIGHT_ONLY' : 'FIRST_TOKEN_ON_LINE_INDEX0';
        else rejectReason = /\d{1,4}\s+$/u.test(before) ? null : 'NOT_FIRST_NOT_PRECEDED_BY_DIGITS_WS';
      }
      tokens.push({ lineIndex: l.lineIndex, charIndex: start, token: m[0], accepted: ok, rejectReason });
    }
    accepted += acc.size;
    for (const s of acc) if (!anyStarts.has(s)) acceptedNotInAny++;
  }
  const rejected = tokens.filter(t => !t.accepted);
  const byReason: Record<RejectReason, number> = { FIRST_TOKEN_ON_LINE_INDEX0: 0, FIRST_TOKEN_ON_LINE_RIGHT_ONLY: 0, NOT_FIRST_NOT_PRECEDED_BY_DIGITS_WS: 0 };
  for (const t of rejected) if (t.rejectReason) byReason[t.rejectReason]++;
  const ro = rejected.filter(t => t.rejectReason === 'FIRST_TOKEN_ON_LINE_RIGHT_ONLY');
  const hist: Record<string, number> = {};
  for (const t of ro) hist[t.charIndex] = (hist[t.charIndex] ?? 0) + 1;
  const dom = dominantWindow(ro.map(t => t.charIndex));
  const a2Pattern = ro.length >= 2 && !!dom && dom.count >= 2;
  return {
    acceptedEvidenceCount: accepted, acceptedNotInAnyToken: acceptedNotInAny, requestTokenCandidatesAll: tokens.length, rejectedCount: rejected.length,
    rejectedByReason: byReason, lineStart0Candidates: byReason.FIRST_TOKEN_ON_LINE_INDEX0, rightOnlyCandidates: ro.length,
    rightOnlyStartHistogram: hist, dominantRightOnlyWindow: dom, a2Pattern,
    classification: classify(accepted, a2Pattern, ctx), subBreakdown: subBreakdownOf(accepted, ctx), tokens,
  };
}
