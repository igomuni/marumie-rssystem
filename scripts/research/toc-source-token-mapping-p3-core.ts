export type CodePointSpan = {
  value: string;
  utf16Start: number;
  utf16End: number;
  codePointIndex: number;
};

export type SegmentSource = {
  mappingCandidateId: string;
  fragmentId: string;
  sourcePdf: string;
  physicalPage: number;
  sourceLineIndexPageLocal: number;
  sourceSpanUtf16: [number, number];
  exactSourceFragment: string;
  exactFullRawLine: string;
};

export type Segment = {
  segmentId: string;
  mappingCandidateId: string;
  fragmentId: string;
  sourcePdf: string;
  physicalPage: number;
  sourceLineIndexPageLocal: number;
  sourceSpanUtf16: [number, number];
  rawSegment: string;
  normalizedSegment: string;
  contextBefore: string;
  contextAfter: string;
};

export type Occurrence = { start: number; end: number };

const WHITE_SPACE = /^\p{White_Space}$/u;
const MULTI_WHITE_SPACE = /\p{White_Space}{2,}/gu;

export function codePointSpans(value: string): CodePointSpan[] {
  const output: CodePointSpan[] = [];
  let offset = 0;
  let index = 0;
  for (const point of value) {
    const end = offset + point.length;
    output.push({ value: point, utf16Start: offset, utf16End: end, codePointIndex: index });
    offset = end;
    index += 1;
  }
  return output;
}

export function isUnicodeWhitespace(value: string): boolean {
  return WHITE_SPACE.test(value);
}

export function normalize(value: string): string {
  let result = '';
  for (const point of value) {
    if (isUnicodeWhitespace(point)) continue;
    result += point === '\u2011' ? '-' : point;
  }
  return result;
}

export function occurrences(haystack: string, needle: string): Occurrence[] {
  const haystackPoints = Array.from(haystack);
  const needlePoints = Array.from(needle);
  if (needlePoints.length === 0) return [];
  const found: Occurrence[] = [];
  for (let start = 0; start <= haystackPoints.length - needlePoints.length; start += 1) {
    if (needlePoints.every((point, index) => haystackPoints[start + index] === point)) {
      found.push({ start, end: start + needlePoints.length });
    }
  }
  return found;
}

export function lineContext(line: string, startUtf16: number, endUtf16: number): { before: string; after: string } {
  const points = codePointSpans(line);
  const before = points.filter((point) => point.utf16End <= startUtf16 && !isUnicodeWhitespace(point.value)).slice(-12);
  const after = points.filter((point) => point.utf16Start >= endUtf16 && !isUnicodeWhitespace(point.value)).slice(0, 12);
  return {
    before: normalize(before.map((point) => point.value).join('')),
    after: normalize(after.map((point) => point.value).join('')),
  };
}

export function splitSegments(items: SegmentSource[]): Segment[] {
  const result: Segment[] = [];
  for (const item of items) {
    const fragment = item.exactSourceFragment;
    const base = item.sourceSpanUtf16[0];
    const boundaries = [...fragment.matchAll(MULTI_WHITE_SPACE)];
    let localStart = 0;
    let segmentNumber = 0;
    const candidates: Array<[number, number]> = [];
    for (const boundary of boundaries) {
      const start = localStart;
      const end = boundary.index ?? start;
      if (normalize(fragment.slice(start, end))) candidates.push([start, end]);
      localStart = end + boundary[0].length;
    }
    if (normalize(fragment.slice(localStart))) candidates.push([localStart, fragment.length]);
    for (const [localStartOffset, localEndOffset] of candidates) {
      const rawSegment = fragment.slice(localStartOffset, localEndOffset);
      const sourceStart = base + localStartOffset;
      const sourceEnd = base + localEndOffset;
      const contexts = lineContext(item.exactFullRawLine, sourceStart, sourceEnd);
      segmentNumber += 1;
      result.push({
        segmentId: `${item.fragmentId}-segment-${segmentNumber}`,
        mappingCandidateId: item.mappingCandidateId,
        fragmentId: item.fragmentId,
        sourcePdf: item.sourcePdf,
        physicalPage: item.physicalPage,
        sourceLineIndexPageLocal: item.sourceLineIndexPageLocal,
        sourceSpanUtf16: [sourceStart, sourceEnd],
        rawSegment,
        normalizedSegment: normalize(rawSegment),
        contextBefore: contexts.before,
        contextAfter: contexts.after,
      });
    }
  }
  return result;
}

export function matchesContextRange(
  stream: string,
  range: Occurrence,
  before: string,
  after: string,
): boolean {
  const streamPoints = Array.from(stream);
  const beforeMatches = !before || streamPoints.slice(0, range.start).join('').endsWith(before);
  const afterMatches = !after || streamPoints.slice(range.end, range.end + Array.from(after).length).join('') === after;
  return beforeMatches && afterMatches;
}

export function statusM0(matches: Occurrence[]): string {
  if (matches.length === 0) return 'NO_TEXT_OCCURRENCE';
  if (matches.length === 1) return 'UNIQUE_TEXT_OCCURRENCE';
  return 'MULTIPLE_TEXT_OCCURRENCES';
}

export function statusM1(matches: Occurrence[]): string {
  if (matches.length === 1) return 'UNIQUE_CONTEXT_OCCURRENCE';
  if (matches.length > 1) return 'MULTIPLE_CONTEXT_OCCURRENCES';
  return 'CONTEXT_NOT_MATCHED';
}
