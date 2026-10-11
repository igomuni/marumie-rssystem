/** Standalone development PoC: header-based column segmentation and segment-local primitives. */
export const REGEX_SOURCE = {
  HEADER_REGEX: '^要求[ \\t]+区[ \\t]+分[ \\t]+(?<page>ページ)[ \\t]+(?<secondRequest>要求)',
  PAGE_REF_REGEX: '^(?:[0-9]{1,4}|エ[ \\t]+[0-9]{1,4}|電[ \\t]+[0-9]{1,4}|原[ \\t]+[0-9]{1,4}|国[ \\t]+[0-9]{1,4}|国\\(国\\)[ \\t]?[0-9]{1,4})$',
  PAGE_ONLY_REGEX: '^[ \\t]*(?:[0-9]{1,4}|エ[ \\t]+[0-9]{1,4}|電[ \\t]+[0-9]{1,4}|原[ \\t]+[0-9]{1,4}|国[ \\t]+[0-9]{1,4}|国\\(国\\)[ \\t]?[0-9]{1,4})[ \\t]*$',
  TITLE_PAGE_REGEX: '^(.*?)(?:[ \\t]{2,}|[.・…･·。]{2,})([0-9]{1,4}|エ[ \\t]+[0-9]{1,4}|電[ \\t]+[0-9]{1,4}|原[ \\t]+[0-9]{1,4}|国[ \\t]+[0-9]{1,4}|国\\(国\\)[ \\t]?[0-9]{1,4})$',
  UNKNOWN_PAGE_TAIL_REGEX: '^(.*?)(?:[ \\t]{2,}|[.・…･·。]{2,})([^ \\t]*[0-9]{5,}|[^ \\t]+[ \\t]+[0-9]+)$',
  KNOWN_PAGE_REF_SPAN_REGEX: '(?<![^ \\t])(?:[0-9]{1,4}|エ[ \\t]+[0-9]{1,4}|電[ \\t]+[0-9]{1,4}|原[ \\t]+[0-9]{1,4}|国[ \\t]+[0-9]{1,4}|国\\(国\\)[ \\t]?[0-9]{1,4})(?![^ \\t])',
  NONBLANK_BOUNDARY_CUT_REGEX: '(?<=\\S)(?=\\S)',
  TITLE_PAGE_SEPARATOR_REGEX: '(?:[ \\t]{2,}|[.・…･·。]{2,})',
  TITLE_EDGE_WS_REGEX: '^[ \\t]+|[ \\t]+$',
} as const;
const headerRe = new RegExp(REGEX_SOURCE.HEADER_REGEX, 'u');
const pageOnlyRe = new RegExp(REGEX_SOURCE.PAGE_ONLY_REGEX, 'u');
const titlePageRe = new RegExp(REGEX_SOURCE.TITLE_PAGE_REGEX, 'u');
const unknownTailRe = new RegExp(REGEX_SOURCE.UNKNOWN_PAGE_TAIL_REGEX, 'u');
const knownSpanRe = new RegExp(REGEX_SOURCE.KNOWN_PAGE_REF_SPAN_REGEX, 'gu');
const nonblankCutRe = new RegExp(REGEX_SOURCE.NONBLANK_BOUNDARY_CUT_REGEX, 'u');
const edgeWsRe = new RegExp(REGEX_SOURCE.TITLE_EDGE_WS_REGEX, 'gu');

export type Side = 'left' | 'right' | 'unknown';
export type PrimitiveKind = 'page_only' | 'title_page' | 'title_only_candidate' | 'unresolved';
export type LineStatus = 'SPLIT_AT_HEADER_BOUNDARY' | 'NO_PAGE_LOCAL_BOUNDARY' | 'UNRESOLVED_BOUNDARY_CUT';
export interface SourceLine { lineIndex: number; lineStartUtf16: number; rawText: string }
export interface Segment { side: Side; sourceRangeUtf16: [number, number]; rawText: string; primitive: Primitive | null }
export interface Primitive { kind: PrimitiveKind; side: Side; pageRef: string | null; titleText?: string; rawText: string; sourceLineIndex: number; sourceLineStartUtf16: number; sourceRangeUtf16: [number, number]; reason?: 'UNSUPPORTED_TERMINAL_PAGE_FORM' }
export interface SegmentedLine { lineStatus: LineStatus; boundaryUtf16Column: number | null; sourceLine: SourceLine; segments: Segment[]; primitive: Primitive | null }

/** Find a unique page-local boundary from qualifying raw header lines. */
export function boundaryOfHeaderLines(lines: string[]): number | null {
  const candidates: number[] = [];
  for (const line of lines) {
    const m = headerRe.exec(line);
    if (!m?.groups) continue;
    const pageStart = m.index + m[0].indexOf(m.groups.page);
    const pageEnd = pageStart + m.groups.page.length;
    const requestStart = m.index + m[0].lastIndexOf(m.groups.secondRequest);
    candidates.push(Math.floor((pageEnd + requestStart) / 2));
  }
  return candidates.length && candidates.every(x => x === candidates[0]) ? candidates[0] : null;
}

/** Recognition only; always operates on a single original source slice. */
export function extractPrimitive(rawText: string, side: Side, sourceLine: SourceLine, range: [number, number]): Primitive | null {
  if (!rawText.length || /^[ \\t]*$/u.test(rawText)) return null;
  const base = { side, rawText, sourceLineIndex: sourceLine.lineIndex, sourceLineStartUtf16: sourceLine.lineStartUtf16, sourceRangeUtf16: range };
  if (pageOnlyRe.test(rawText)) return { ...base, kind: 'page_only', pageRef: rawText.replace(/^[ \\t]+|[ \\t]+$/gu, '') };
  const tp = titlePageRe.exec(rawText);
  if (tp) return { ...base, kind: 'title_page', titleText: tp[1].replace(edgeWsRe, ''), pageRef: tp[2] };
  const unknown = unknownTailRe.exec(rawText);
  if (unknown) return { ...base, kind: 'unresolved', titleText: unknown[1].replace(edgeWsRe, ''), pageRef: null, reason: 'UNSUPPORTED_TERMINAL_PAGE_FORM' };
  return { ...base, kind: 'title_only_candidate', titleText: rawText.replace(edgeWsRe, ''), pageRef: null };
}

/** Segmentation is page-local and does not carry state across calls or lines. */
export function segmentPage(lines: SourceLine[], headerLines: string[]): SegmentedLine[] {
  const boundary = boundaryOfHeaderLines(headerLines);
  return lines.map(sourceLine => {
    const text = sourceLine.rawText;
    if (boundary === null) {
      const wholeLine = extractPrimitive(text, 'unknown', sourceLine, [0, text.length]);
      // A known page-reference token followed by more text can be a mixed-column
      // line. Without a page-local boundary, preserve it without parsing the
      // whole line as one title or item.
      const knownRefs = [...text.matchAll(knownSpanRe)];
      knownSpanRe.lastIndex = 0;
      const hasNonterminalPageRef = knownRefs.some(match => {
        const end = (match.index as number) + match[0].length;
        return !!text.slice(end).trim();
      });
      const hasClearTerminalPagePrimitive = wholeLine?.kind === 'title_page' || wholeLine?.kind === 'page_only';
      return {
        lineStatus: 'NO_PAGE_LOCAL_BOUNDARY',
        boundaryUtf16Column: null,
        sourceLine,
        segments: [],
        primitive: hasNonterminalPageRef && !hasClearTerminalPagePrimitive ? null : wholeLine,
      };
    }
    const cut = Math.min(boundary, text.length);
    const known = [...text.matchAll(knownSpanRe)];
    knownSpanRe.lastIndex = 0;
    const insideKnown = known.some(m => (m.index as number) < cut && cut < (m.index as number) + m[0].length);
    const cutsNonblank = cut > 0 && cut < text.length && nonblankCutRe.test(text.slice(cut - 1, cut + 1));
    if (cutsNonblank || insideKnown) return { lineStatus: 'UNRESOLVED_BOUNDARY_CUT', boundaryUtf16Column: boundary, sourceLine, segments: [], primitive: { kind: 'unresolved', side: 'unknown', pageRef: null, rawText: text, sourceLineIndex: sourceLine.lineIndex, sourceLineStartUtf16: sourceLine.lineStartUtf16, sourceRangeUtf16: [0, text.length] } };
    const segments: Segment[] = [];
    for (const [side, start, end] of [['left', 0, cut], ['right', cut, text.length]] as const) {
      const rawText = text.slice(start, end);
      segments.push({ side, sourceRangeUtf16: [start, end], rawText, primitive: extractPrimitive(rawText, side, sourceLine, [start, end]) });
    }
    return { lineStatus: 'SPLIT_AT_HEADER_BOUNDARY', boundaryUtf16Column: boundary, sourceLine, segments, primitive: null };
  });
}
