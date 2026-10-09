/**
 * FY2024 TOC 82 page の POST_HOC full-corpus status assessment 用の純粋な集計 helper。
 * parser / H1 / GT / 評価 contract は一切変更せず、frozen H1 の出力と frozen evaluator の結果から機械的な観測だけを作る。原因の推測・priority 付けはしない。
 */
import { BAND_TOLERANCE_CHARS, REQUEST_TOKEN_SOURCE, type PageOut } from './budget-request-toc-row-assembly';
import type { PageResult } from './budget-request-toc-row-assembly-evaluator';
import type { H1TriggerCensus } from './budget-request-toc-h1-formal-evaluation';

export const CANDIDATE_REASONS = ['PAGE_ABSTAINED', 'UNSPLIT_WITH_GT_RIGHT_ROWS', 'SEVERE_DETECTED_POSTHOC', 'INCORRECT_ROW', 'OMITTED_SILENTLY', 'ORDER_INVERSION', 'OTHER_CODE_PRESENT', 'UNRESOLVED_PRESENT', 'FRAGMENT_UNRESOLVED_OR_WRONG', 'H1_TRIGGER_PRESENT', 'H1_NEGATIVE_CONTROL_PRESENT', 'KNOWN_TOKENLESS_FRAGMENT_RELEVANT'] as const;
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];
export const PARTITIONS = ['DEVELOPMENT_EXPLORED', 'FIRST_HELDOUT_POSTHOC', 'NEW_HELDOUT_POSTHOC'] as const;
export type Partition = (typeof PARTITIONS)[number];

const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const RIGHT_EVIDENCE = new RegExp(`\\d{1,4}(\\s+)(${REQUEST_TOKEN_SOURCE})`, 'gu');

/** #393 の right-band evidence（先頭 token でない request token）の件数。観測用の再計算で、parser の判定には使わない */
export function rightBandEvidenceCount(lines: { text: string }[]): number {
  let n = 0;
  for (const l of lines) {
    const first = cps(l.text).findIndex(c => !isWs(c));
    for (const m of l.text.matchAll(RIGHT_EVIDENCE)) { const start = cps(l.text.slice(0, (m.index as number) + m[0].length - m[2].length)).length; if (start > first) n++; }
  }
  return n;
}

export interface PageObservation {
  localPdfPath: string; physicalPage: number; publisherDomain: string | null; partition: Partition; classifierSource: string; pdfSha256: string; textSha256: string;
  pageState: PageOut['pageState']; rightBandEdge: number | null; rightBandEvidenceCount: number; pageAbstentionReason: string | null;
  units: { total: number; LEFT: number; RIGHT: number; UNSPLIT: number }; rowKinds: Record<string, number>; abstainedUnits: number; abstentionByReason: Record<string, number>; fragmentsAttached: number;
  h1: { triggerLines: number[]; negativeControlLines: number[]; splitLines: number[]; tokenTypes: H1TriggerCensus['tokenTypes'] };
}

export function observePage(meta: { localPdfPath: string; physicalPage: number; publisherDomain: string | null; partition: Partition; classifierSource: string; pdfSha256: string; textSha256: string }, h1: PageOut, census: H1TriggerCensus, lines: { text: string }[]): PageObservation {
  const rowKinds: Record<string, number> = {}; const abstentionByReason: Record<string, number> = {};
  const units = { total: h1.rows.length, LEFT: 0, RIGHT: 0, UNSPLIT: 0 };
  let abstainedUnits = 0;
  for (const r of h1.rows) {
    units[r.column]++; rowKinds[r.rowKind] = (rowKinds[r.rowKind] ?? 0) + 1;
    if (r.state === 'ABSTAINED') { abstainedUnits++; abstentionByReason[r.abstentionReason ?? 'NONE'] = (abstentionByReason[r.abstentionReason ?? 'NONE'] ?? 0) + 1; }
  }
  return { ...meta, pageState: h1.pageState, rightBandEdge: h1.rightBandEdge, rightBandEvidenceCount: rightBandEvidenceCount(lines), pageAbstentionReason: h1.pageAbstentionReason, units, rowKinds, abstainedUnits, abstentionByReason, fragmentsAttached: h1.rows.reduce((a, r) => a + r.fragments.length, 0), h1: { triggerLines: census.triggerLines, negativeControlLines: census.negativeControlLines, splitLines: census.splitLines, tokenTypes: census.tokenTypes } };
}

/** 機械的な candidate reason（failure diagnosis ではない。priority は付けない） */
export function candidateReasons(o: PageObservation, ev: PageResult | null): CandidateReason[] {
  const r = new Set<CandidateReason>();
  if (o.pageState === 'PAGE_ABSTAINED') r.add('PAGE_ABSTAINED');
  if (o.h1.triggerLines.length > 0) r.add('H1_TRIGGER_PRESENT');
  if (o.h1.negativeControlLines.length > 0) r.add('H1_NEGATIVE_CONTROL_PRESENT');
  if ((o.rowKinds.OTHER_CODE ?? 0) > 0) r.add('OTHER_CODE_PRESENT');
  // 機械定義: header zone で最初の trigger 行より後ろにあり、E 以右に text を持つが row-start token を持たない行（既知の tokenless fragment 事象の形に一致）
  if (o.h1.triggerLines.length > 0 && o.h1.negativeControlLines.some(l => l > Math.min(...o.h1.triggerLines))) r.add('KNOWN_TOKENLESS_FRAGMENT_RELEVANT');
  if (ev) {
    if (ev.pageOutcome.reason === 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT') r.add('UNSPLIT_WITH_GT_RIGHT_ROWS');
    if (ev.instances.some(i => ['FALSE_POSITIVE_ROW_ASSEMBLY', 'WRONG_COLUMN_ASSIGNMENT', 'WRONG_FRAGMENT_ATTACHMENT', 'PROVENANCE_MISMATCH'].includes(i.family))) r.add('SEVERE_DETECTED_POSTHOC');
    if (ev.rowStates.INCORRECT > 0) r.add('INCORRECT_ROW');
    if (ev.omittedSilently > 0) r.add('OMITTED_SILENTLY');
    if (ev.orderInversions > 0) r.add('ORDER_INVERSION');
    if (ev.rowStates.UNRESOLVED > 0) r.add('UNRESOLVED_PRESENT');
    if (ev.fragments.unresolved > 0 || ev.fragments.incorrect > 0 || ev.fragments.wrongAttachment > 0) r.add('FRAGMENT_UNRESOLVED_OR_WRONG');
  }
  return CANDIDATE_REASONS.filter(x => r.has(x));
}

export function summarize(obs: PageObservation[]) {
  const sum = (f: (o: PageObservation) => number) => obs.reduce((a, o) => a + f(o), 0);
  const kinds = (k: string) => sum(o => o.rowKinds[k] ?? 0);
  const reasons: Record<string, number> = {}; for (const o of obs) for (const [k, v] of Object.entries(o.abstentionByReason)) reasons[k] = (reasons[k] ?? 0) + v;
  const pageReasons: Record<string, number> = {}; for (const o of obs) if (o.pageAbstentionReason) pageReasons[o.pageAbstentionReason] = (pageReasons[o.pageAbstentionReason] ?? 0) + 1;
  return {
    pages: obs.length,
    pageState: { SPLIT: obs.filter(o => o.pageState === 'ASSEMBLED_SPLIT').length, UNSPLIT: obs.filter(o => o.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE').length, ABSTAINED: obs.filter(o => o.pageState === 'PAGE_ABSTAINED').length },
    rightBand: { resolved: obs.filter(o => o.rightBandEdge !== null).length, unresolvedOrNoEvidence: obs.filter(o => o.rightBandEdge === null).length },
    pageAbstentionByReason: pageReasons,
    units: { total: sum(o => o.units.total), LEFT: sum(o => o.units.LEFT), RIGHT: sum(o => o.units.RIGHT), UNSPLIT: sum(o => o.units.UNSPLIT) },
    rowKinds: { REQUEST_NUMBER_ROW: kinds('REQUEST_NUMBER_ROW'), MARKER_ROW: kinds('MARKER_ROW'), TITLE_OR_HEADING: kinds('TITLE_OR_HEADING'), OTHER_CODE: kinds('OTHER_CODE'), WRAPPED_FRAGMENT: kinds('WRAPPED_FRAGMENT'), UNKNOWN_ABSTAINED: kinds('UNKNOWN_ABSTAINED') },
    fragmentsAttached: sum(o => o.fragmentsAttached), abstainedUnits: sum(o => o.abstainedUnits), unitAbstentionByReason: reasons,
    h1: { triggerLines: sum(o => o.h1.triggerLines.length), triggerPages: obs.filter(o => o.h1.triggerLines.length > 0).length, negativeControlLines: sum(o => o.h1.negativeControlLines.length), splitLines: sum(o => o.h1.splitLines.length), tokenTypes: { REQUEST: sum(o => o.h1.tokenTypes.REQUEST), MARKER: sum(o => o.h1.tokenTypes.MARKER), OTHER_CODE: sum(o => o.h1.tokenTypes.OTHER_CODE) } },
  };
}

export const BAND_TOLERANCE = BAND_TOLERANCE_CHARS;
