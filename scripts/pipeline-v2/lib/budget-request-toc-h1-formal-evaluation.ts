/**
 * H1 formal evaluation 用の補助（#398 の positive trigger を H1 出力と raw line から集計する、最終 judgment の合成）。
 * 評価規則そのもの（matching / severe / applicability）は #395 を機械化した budget-request-toc-row-assembly-evaluator.ts をそのまま使う。
 * trigger の集計は formal output 生成後にのみ行い、#393 を新 held-out に実行しない（E・page state・header zone は H1 出力から得る。H1 は trigger 行以外でこれらを変えない）。
 */
import { BAND_TOLERANCE_CHARS, MARKER_TOKEN_SOURCE, OTHER_CODE_SOURCE, PAGEREF_SOURCE, REQUEST_TOKEN_SOURCE, type PageOut } from './budget-request-toc-row-assembly';
import type { FinalJudgment } from './budget-request-toc-row-assembly-evaluator';

const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const cpIndex = (s: string, utf16: number) => Array.from(s.slice(0, utf16)).length;
const STARTS_REQUEST = new RegExp(`^(${REQUEST_TOKEN_SOURCE})`, 'u');
const STARTS_MARKER = new RegExp(`^(${MARKER_TOKEN_SOURCE})`, 'u');
const OTHER_CODE = new RegExp(OTHER_CODE_SOURCE.replace('PAGEREF', PAGEREF_SOURCE), 'u');
const ANY_REQUEST = new RegExp(REQUEST_TOKEN_SOURCE, 'gu');
const startsRowToken = (seg: string) => { const t = seg.replace(/^\s+/u, ''); return STARTS_REQUEST.test(t) || STARTS_MARKER.test(t) || OTHER_CODE.test(seg); };

export interface H1TriggerCensus { triggerLines: number[]; negativeControlLines: number[]; splitLines: number[]; tokenTypes: { REQUEST: number; MARKER: number; OTHER_CODE: number } }

/** page の raw line（nonEmptyLines）と H1 出力から、#398 の trigger（T1〜T4）を機械判定する */
export function h1TriggerCensus(lines: { lineIndex: number; text: string }[], h1: PageOut): H1TriggerCensus {
  const out: H1TriggerCensus = { triggerLines: [], negativeControlLines: [], splitLines: [], tokenTypes: { REQUEST: 0, MARKER: 0, OTHER_CODE: 0 } };
  if (h1.pageState !== 'ASSEMBLED_SPLIT' || h1.rightBandEdge === null) return out; // T1
  const E = h1.rightBandEdge;
  const headerLines = new Set(h1.rows.filter(r => r.rowKind === 'TITLE_OR_HEADING' && (r.column === 'UNSPLIT' || r.column === 'LEFT')).map(r => r.provenance.lineIndex)); // T2（frozen header zone。H1 は header zone の範囲を変えない）
  const byLine = new Map<number, PageOut['rows']>();
  for (const r of h1.rows) byLine.set(r.provenance.lineIndex, [...(byLine.get(r.provenance.lineIndex) ?? []), r]);
  for (const l of lines) {
    if (!headerLines.has(l.lineIndex)) continue;
    const us = byLine.get(l.lineIndex) ?? [];
    if (us.some(u => u.column === 'LEFT' && u.rowKind === 'TITLE_OR_HEADING') && us.some(u => u.column === 'RIGHT')) out.splitLines.push(l.lineIndex);
    const chars = cps(l.text);
    const right = chars.slice(E).join('');
    if (!right.trim()) continue;
    const first = chars.findIndex(c => !isWs(c));
    const toks = [...l.text.matchAll(ANY_REQUEST)].map(m => cpIndex(l.text, m.index as number)).filter(ix => ix > first);
    const conflict = toks.some(ix => (ix >= E - BAND_TOLERANCE_CHARS && ix <= E - 1) || ix >= E + BAND_TOLERANCE_CHARS + 1);
    const crossing = chars.length > E && !isWs(chars[E - 1]) && !isWs(chars[E]);
    if (startsRowToken(right)) {
      if (conflict || crossing) continue;
      out.triggerLines.push(l.lineIndex);
      const t = right.replace(/^\s+/u, '');
      if (STARTS_REQUEST.test(t)) out.tokenTypes.REQUEST++; else if (STARTS_MARKER.test(t)) out.tokenTypes.MARKER++; else out.tokenTypes.OTHER_CODE++;
    } else out.negativeControlLines.push(l.lineIndex);
  }
  return out;
}

export type H1Judgment = FinalJudgment | 'H1_UNVALIDATED';
/** 優先順位: STOP_PROTOCOL > STOP_SAFETY > H1_UNVALIDATED（positive trigger = 0） > REVIEW_REQUIRED（blocking unresolved） > SAFETY_PASS_COVERAGE_REPORTED */
export function h1FinalJudgment(protocolCompliant: boolean, totalSevere: number, positiveTriggerLines: number, blockingUnresolved: number): H1Judgment {
  if (!protocolCompliant) return 'STOP_PROTOCOL';
  if (totalSevere >= 1) return 'STOP_SAFETY';
  if (positiveTriggerLines === 0) return 'H1_UNVALIDATED';
  if (blockingUnresolved > 0) return 'REVIEW_REQUIRED';
  return 'SAFETY_PASS_COVERAGE_REPORTED';
}
