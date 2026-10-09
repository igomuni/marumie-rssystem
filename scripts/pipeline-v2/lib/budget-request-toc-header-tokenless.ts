/**
 * TOC A 層 header zone の「row-start token なしの E 以右 text」census 用 analysis helper（analysis-only・production path から呼ばない）。
 * 現行 H1 の出力と h1TriggerCensus を使って機械的に数えるだけで、parser の意味は変えない。
 * candidate は raw line の機械的ラベルであり、continuation・title・column heading・右 column 帰属のいずれも意味しない。
 *
 * ---- census の定義（census 実行前に固定。corpus の結果を見た後で調整しない）----
 * header zone        = 最初の rowStartsLine（行頭が request / marker / OTHER_CODE）行の直前まで（無ければ全行）。位置は nonEmptyLines の配列 index
 * E                  = H1 出力の rightBandEdge（ASSEMBLED_SPLIT のみ確定）。E 未確定ページ（UNSPLIT / ABSTAINED）は E_UNDEFINED とし candidate 集計の外に置く
 * candidate          = ASSEMBLED_SPLIT ページで、header zone 内かつ E 以右の trim が非空かつ startsRowToken(E 以右) が偽の行（h1TriggerCensus.negativeControlLines と同一集合）
 * trigger            = h1TriggerCensus.triggerLines
 * AFTER_TRIGGER      = candidate の lineIndex > ページの最初の trigger の lineIndex（trigger なしなら不成立）
 * WITHOUT_TRIGGER_CONTEXT = candidate で AFTER_TRIGGER でないもの（trigger なしページ、または最初の trigger 以前の行）
 * KNOWN_FLAG_MATCH   = 既存 KNOWN_TOKENLESS_FRAGMENT_RELEVANT 条件（triggers > 0 && neg.some(l > min(trigger))）をページが満たし、かつ当該行が l > min(trigger)
 * PAGE_REF_TOKENLESS = E 以右 trim text が parser の FRAGMENT_WITH_PAGE_REF 判定と同じ末尾 page ref（\s+PAGEREF\s*$）を持つ
 * OTHER_HEADER_TOKENLESS = AFTER_TRIGGER でも WITHOUT_TRIGGER_CONTEXT でも PAGE_REF_TOKENLESS でもない candidate（定義上 0 になるはずの residual）
 * 位置特徴 = headerEnd までの行距離 / 直前・直後の trigger までの行距離（nonEmptyLines の配列 index 差）/ 左側（E 未満）が空白のみか / E と右 text 開始位置の差
 */
import { sha256Hex } from './budget-request-raw-text';
import { MARKER_TOKEN_SOURCE, OTHER_CODE_SOURCE, PAGEREF_SOURCE, REQUEST_TOKEN_SOURCE, type PageOut } from './budget-request-toc-row-assembly-h1';
import { h1TriggerCensus } from './budget-request-toc-h1-formal-evaluation';

const STARTS_REQUEST = new RegExp(`^(${REQUEST_TOKEN_SOURCE})`, 'u');
const STARTS_MARKER = new RegExp(`^(${MARKER_TOKEN_SOURCE})`, 'u');
const OTHER_CODE = new RegExp(OTHER_CODE_SOURCE.replace('PAGEREF', PAGEREF_SOURCE), 'u');
const TRAILING_PAGEREF = new RegExp(`\\s+(${PAGEREF_SOURCE})\\s*$`, 'u');
const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);

/** parser の rowStartsLine と同じ述語（parser 側は非 export。同等性は test で H1 出力と照合する） */
export function rowStartsLine(text: string): boolean {
  const t = text.replace(/^\s+/u, '');
  return STARTS_REQUEST.test(t) || STARTS_MARKER.test(t) || OTHER_CODE.test(text);
}
/** parser の TRAILING_PAGEREF と同じ述語（trimmed segment に適用） */
export const hasTrailingPageRef = (trimmed: string): boolean => TRAILING_PAGEREF.test(trimmed);

export const CANDIDATE_PRIMARY = ['HEADER_TOKENLESS_AFTER_TRIGGER', 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT'] as const;
export type CandidatePrimary = (typeof CANDIDATE_PRIMARY)[number];

export interface CandidateLine {
  lineIndex: number; position: number;
  charStart: number; offsetFromE: number; rightTextChars: number; rightTextSha256: string;
  leftBlank: boolean; distanceToHeaderEnd: number;
  precedingTriggerDistance: number | null; followingTriggerDistance: number | null;
  wholeLineTitleInOutput: boolean;
  primary: CandidatePrimary; knownFlagMatch: boolean; pageRefTokenless: boolean; otherHeaderTokenless: boolean;
}
export interface HeaderPage {
  edge: number | null; eDefined: boolean;
  headerZoneLineCount: number; headerZoneLineCountFromOutput: number | null;
  triggerCount: number; negativeControlCount: number;
  knownFlag: boolean; candidates: CandidateLine[];
  currentFragmentsAttached: number;
  diagnostic: { hasCandidate: boolean; knownFlag: boolean; hasTrigger: boolean; hasPageRefCandidate: boolean; hasCurrentFragmentAttachment: boolean; key: string };
}

export function headerEndPosition(lines: { text: string }[]): number {
  const first = lines.findIndex(l => rowStartsLine(l.text));
  return first < 0 ? lines.length : first;
}

export function analyzeHeaderPage(lines: { lineIndex: number; text: string }[], h1: PageOut): HeaderPage {
  const headerEnd = headerEndPosition(lines);
  const fromOutput = h1.pageState === 'PAGE_ABSTAINED' ? null : new Set(h1.rows.filter(r => r.rowKind === 'TITLE_OR_HEADING' && (r.column === 'UNSPLIT' || r.column === 'LEFT')).map(r => r.provenance.lineIndex)).size;
  const census = h1TriggerCensus(lines, h1);
  const E = h1.pageState === 'ASSEMBLED_SPLIT' ? h1.rightBandEdge : null;
  const attached = h1.rows.reduce((a, r) => a + r.fragments.length, 0);
  const trig = census.triggerLines;
  const firstTrigger = trig.length ? Math.min(...trig) : null;
  const knownFlag = trig.length > 0 && census.negativeControlLines.some(l => l > Math.min(...trig));
  const posOf = new Map(lines.map((l, i) => [l.lineIndex, i]));
  const trigPos = trig.map(t => posOf.get(t) as number).sort((a, b) => a - b);
  const wholeLineTitle = new Set(h1.rows.filter(r => r.column === 'UNSPLIT' && r.rowKind === 'TITLE_OR_HEADING').map(r => r.provenance.lineIndex));
  const candidates: CandidateLine[] = [];
  if (E !== null) {
    for (const li of census.negativeControlLines) {
      const position = posOf.get(li) as number;
      const chars = cps(lines[position].text);
      const rightChars = chars.slice(E);
      const lead = rightChars.findIndex(c => !isWs(c));
      const trimmed = rightChars.join('').trim();
      const after = firstTrigger !== null && li > firstTrigger;
      const pageRef = hasTrailingPageRef(trimmed);
      const primary: CandidatePrimary = after ? 'HEADER_TOKENLESS_AFTER_TRIGGER' : 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT';
      const prec = trigPos.filter(p => p < position);
      const foll = trigPos.filter(p => p > position);
      candidates.push({
        lineIndex: li, position, charStart: E + lead, offsetFromE: lead, rightTextChars: cps(trimmed).length, rightTextSha256: sha256Hex(trimmed),
        leftBlank: !chars.slice(0, E).some(c => !isWs(c)), distanceToHeaderEnd: headerEnd - position,
        precedingTriggerDistance: prec.length ? position - Math.max(...prec) : null, followingTriggerDistance: foll.length ? Math.min(...foll) - position : null,
        wholeLineTitleInOutput: wholeLineTitle.has(li),
        primary, knownFlagMatch: knownFlag && after, pageRefTokenless: pageRef, otherHeaderTokenless: false,
      });
    }
  }
  for (const c of candidates) c.otherHeaderTokenless = !(c.primary === 'HEADER_TOKENLESS_AFTER_TRIGGER' || c.primary === 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT' || c.pageRefTokenless);
  const hasCandidate = candidates.length > 0; const hasTrigger = trig.length > 0; const hasPageRefCandidate = candidates.some(c => c.pageRefTokenless); const hasAtt = attached > 0;
  const key = [hasCandidate ? 'CAND' : 'NOCAND', knownFlag ? 'FLAG' : 'NOFLAG', hasTrigger ? 'TRIG' : 'NOTRIG', hasPageRefCandidate ? 'PREF' : 'NOPREF', hasAtt ? 'ATT' : 'NOATT'].join('|');
  return {
    edge: E, eDefined: E !== null, headerZoneLineCount: headerEnd, headerZoneLineCountFromOutput: fromOutput,
    triggerCount: trig.length, negativeControlCount: census.negativeControlLines.length, knownFlag, candidates, currentFragmentsAttached: attached,
    diagnostic: { hasCandidate, knownFlag, hasTrigger, hasPageRefCandidate, hasCurrentFragmentAttachment: hasAtt, key },
  };
}
