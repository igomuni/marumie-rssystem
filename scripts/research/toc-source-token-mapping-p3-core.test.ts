import { describe, expect, it } from 'vitest';
import {
  lineContext,
  matchesContextRange,
  normalize,
  occurrences,
  splitSegments,
  statusM0,
  statusM1,
} from './toc-source-token-mapping-p3-core';

describe('P3 source-token mapping primitives', () => {
  it('uses only the frozen normalization', () => {
    expect(normalize('甲\u3000乙\u2011丙-丁')).toBe('甲乙-丙-丁');
    expect(normalize('A\uFEFFB')).toBe('A\uFEFFB');
  });

  it('keeps every overlapping occurrence in Unicode code-point offsets', () => {
    expect(occurrences('😀aaaa', 'aa')).toEqual([
      { start: 1, end: 3 },
      { start: 2, end: 4 },
      { start: 3, end: 5 },
    ]);
    expect(statusM0([])).toBe('NO_TEXT_OCCURRENCE');
    expect(statusM0([{ start: 0, end: 1 }])).toBe('UNIQUE_TEXT_OCCURRENCE');
    expect(statusM1([{ start: 0, end: 1 }, { start: 2, end: 3 }])).toBe('MULTIPLE_CONTEXT_OCCURRENCES');
  });

  it('splits only on runs of Unicode White_Space and retains source spans', () => {
    const line = '前 Alpha\u3000\u3000Beta 後';
    const fragment = 'Alpha\u3000\u3000Beta';
    const start = line.indexOf(fragment);
    const segments = splitSegments([{
      mappingCandidateId: 'candidate',
      fragmentId: 'fragment',
      sourcePdf: 'source.pdf',
      physicalPage: 1,
      sourceLineIndexPageLocal: 4,
      sourceSpanUtf16: [start, start + fragment.length],
      exactSourceFragment: fragment,
      exactFullRawLine: line,
    }]);

    expect(segments.map((segment) => segment.rawSegment)).toEqual(['Alpha', 'Beta']);
    expect(segments.map((segment) => segment.sourceSpanUtf16)).toEqual([[2, 7], [9, 13]]);
    expect(segments[0].contextBefore).toBe('前');
    expect(segments[1].contextAfter).toBe('後');
    expect(splitSegments([{
      mappingCandidateId: 'candidate', fragmentId: 'single', sourcePdf: 'source.pdf', physicalPage: 1,
      sourceLineIndexPageLocal: 0, sourceSpanUtf16: [0, 3], exactSourceFragment: 'A\uFEFFB', exactFullRawLine: 'A\uFEFFB',
    }])).toHaveLength(1);
  });

  it('uses the available same-line context without a geometry tie-break', () => {
    const context = lineContext('beforeTARGETafter', 6, 12);
    expect(context).toEqual({ before: 'before', after: 'after' });
    expect(matchesContextRange('beforeTARGETafter', { start: 6, end: 12 }, context.before, context.after)).toBe(true);
    expect(matchesContextRange('otherTARGETafter', { start: 5, end: 11 }, context.before, context.after)).toBe(false);
    expect(matchesContextRange('TARGET', { start: 0, end: 6 }, '', '')).toBe(true);
  });
});
