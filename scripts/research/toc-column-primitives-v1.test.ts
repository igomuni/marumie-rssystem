import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGEX_SOURCE, segmentPage, type Primitive, type SourceLine } from './toc-column-primitives-v1';

const root = path.join('tests', 'fixtures', 'budget-request-toc-column-primitives', '2024');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected-results.json'), 'utf8'));
const byId = (items: any[], id: string) => items.find(x => x.caseId === id);
const asLine = (x: any): SourceLine => ({ lineIndex: x.rawLineIndex, lineStartUtf16: x.lineStartUtf16, rawText: x.rawText });
const flat = (lines: ReturnType<typeof segmentPage>): Primitive[] => lines.flatMap(l => l.primitive ? [l.primitive] : l.segments.flatMap(s => s.primitive ? [s.primitive] : []));
const runSingle = (id: string) => {
  const input = byId(fixture.cases, id); const want = byId(expected.results, id);
  const headerLines = input.headerLines?.length ? input.headerLines : (input.headerLine ? [input.headerLine] : []);
  const result = segmentPage([asLine(input)], headerLines)[0];
  return { input, want, result };
};

describe('frozen TOC column segmentation and primitive extraction contract', () => {
  it('uses the exact frozen regex source strings', () => {
    expect(REGEX_SOURCE).toEqual(expected.regexContract);
  });
  it('D1, D2, D6, D7: no local header leaves primitive side unknown while recognizing simple whole-line candidates', () => {
    for (const id of ['D1', 'D2', 'D6', 'D7']) {
      const { want, result } = runSingle(id);
      expect(result.lineStatus).toBe(want.lineStatus);
      expect(result.primitive).toMatchObject(want.primitive);
      expect(result.segments).toEqual([]);
    }
  });
  it('D3 and D12: preserves the original source and exact independent left/right slices', () => {
    for (const id of ['D3', 'D12']) {
      const { input, want, result } = runSingle(id);
      expect(result.lineStatus).toBe('SPLIT_AT_HEADER_BOUNDARY');
      expect(result.boundaryUtf16Column).toBe(want.boundaryUtf16Column);
      expect(result.sourceLine.rawText).toBe(input.rawText);
      expect(result.segments.map(s => ({ side: s.side, sourceRangeUtf16: s.sourceRangeUtf16, rawText: s.rawText, primitive: s.primitive && { kind: s.primitive.kind, titleText: s.primitive.titleText, pageRef: s.primitive.pageRef, rawText: s.primitive.rawText } }))).toEqual(want.segments);
    }
  });
  it('D12-N: the original one-space separators do not satisfy the frozen title/page regex', () => {
    const { input, want, result } = runSingle('D12-N');
    expect(result.lineStatus).toBe(want.lineStatus);
    expect(result.boundaryUtf16Column).toBe(want.boundaryUtf16Column);
    expect(result.sourceLine.rawText).toBe(input.rawText);
    expect(result.segments.map(s => ({ side: s.side, sourceRangeUtf16: s.sourceRangeUtf16, rawText: s.rawText, primitive: s.primitive && { kind: s.primitive.kind, titleText: s.primitive.titleText, pageRef: s.primitive.pageRef, rawText: s.primitive.rawText } }))).toEqual(want.segments);
    expect(result.segments.every(s => s.primitive?.kind !== 'title_page')).toBe(true);
  });
  it('D4: CFA p3 lines 19 and 21 retain separate 88/143 and 88/145 primitives without side leakage', () => {
    const input = byId(fixture.cases, 'D4'); const want = byId(expected.results, 'D4');
    const lines = input.source.rawLines.map((x: any) => ({ lineIndex: x.rawLineIndex, lineStartUtf16: x.lineStartUtf16, rawText: x.rawText }));
    const result = flat(segmentPage(lines, [input.source.headerLine]));
    expect(result.map(p => ({ kind: p.kind, side: p.side, titleText: p.titleText, pageRef: p.pageRef, rawText: p.rawText, sourceLineIndex: p.sourceLineIndex, sourceLineStartUtf16: p.sourceLineStartUtf16 }))).toEqual(want.primitives);
    expect(result.find(p => p.side === 'left')?.rawText).not.toContain('143');
    expect(result.find(p => p.side === 'right')?.rawText).not.toContain('88');
  });
  it('D5: physical page 3 printed 94 stays distinct from the next line, with both prescribed slices', () => {
    const input = byId(fixture.cases, 'D5'); const want = byId(expected.results, 'D5');
    const lines = input.source.sourceLines.map((x: any) => ({ lineIndex: x.rawLineIndex, lineStartUtf16: x.lineStartUtf16, rawText: x.rawText }));
    const header = byId(fixture.cases, 'D4').source.headerLine;
    const result = segmentPage(lines, [header]);
    expect(flat(result).map(p => ({ kind: p.kind, side: p.side, pageRef: p.pageRef, rawText: p.rawText, sourceLineIndex: p.sourceLineIndex, sourceLineStartUtf16: p.sourceLineStartUtf16 }))).toEqual(want.primitives);
    expect(result.map(x => x.segments.map(s => ({ side: s.side, sourceRangeUtf16: s.sourceRangeUtf16, rawText: s.rawText })))).toEqual(want.sourceLineSlicesUtf16.map((x: any) => x.slices.map((s: any) => ({ side: s.side, sourceRangeUtf16: s.sourceRangeUtf16, rawText: s.rawText }))));
    expect(flat(result).find(p => p.sourceLineIndex === 29)?.kind).toBe('title_only_candidate');
    expect(flat(result).some(p => p.sourceLineIndex === 29 && p.pageRef === '94')).toBe(false);
  });
  it('D8: METI examples retain every expected segment and exact page spelling', () => {
    const input = byId(fixture.cases, 'D8'); const want = byId(expected.results, 'D8');
    const all: Primitive[] = [];
    for (const ex of input.source.examples) {
      const r = segmentPage([{ lineIndex: ex.rawLineIndex, lineStartUtf16: ex.lineStartUtf16, rawText: ex.rawText }], [ex.headerLine]);
      all.push(...flat(r));
    }
    expect(all.map(p => ({ kind: p.kind, side: p.side, pageRef: p.pageRef, rawText: p.rawText, sourceLineIndex: p.sourceLineIndex, sourceLineStartUtf16: p.sourceLineStartUtf16 }))).toEqual(want.primitives);
  });
  it('D9: 国 1 and 国(国)13 preserve distinct source spellings on unknown sides', () => {
    const input = byId(fixture.cases, 'D9'); const want = byId(expected.results, 'D9');
    const all: Primitive[] = [];
    for (const ex of input.source.examples) all.push(...flat(segmentPage([{ lineIndex: ex.rawLineIndex, lineStartUtf16: ex.lineStartUtf16, rawText: ex.rawText }], [])));
    expect(all.map(p => ({ kind: p.kind, side: p.side, pageRef: p.pageRef, rawText: p.rawText, sourceLineIndex: p.sourceLineIndex, sourceLineStartUtf16: p.sourceLineStartUtf16 }))).toEqual(want.primitives);
  });
  it('D10 and D11: unsafe cuts remain unknown-side unresolved and mixed no-boundary lines remain unparsed', () => {
    const unsafe = runSingle('D10');
    expect(unsafe.result.lineStatus).toBe(unsafe.want.lineStatus);
    expect(unsafe.result.sourceLine.rawText).toBe(unsafe.want.preservedRawLine);
    expect(unsafe.result.segments).toEqual([]);
    expect(unsafe.result.primitive).toMatchObject({ kind: 'unresolved', side: 'unknown', rawText: unsafe.want.preservedRawLine });
    const missing = runSingle('D11');
    expect(missing.result.lineStatus).toBe(missing.want.lineStatus);
    expect(missing.result.boundaryUtf16Column).toBeNull();
    expect(missing.result.sourceLine.rawText).toBe(missing.want.preservedRawLine);
    expect(missing.result.segments).toEqual([]);
    expect(missing.result.primitive).toBeNull();
  });
  it('D5 continuation line 29 is independently observed and never joined to line 28', () => {
    const input = byId(fixture.cases, 'D5');
    const lines = input.source.sourceLines.map((x: any) => ({ lineIndex: x.rawLineIndex, lineStartUtf16: x.lineStartUtf16, rawText: x.rawText }));
    const header = byId(fixture.cases, 'D4').source.headerLine;
    const result = segmentPage(lines, [header]);
    const continuation = flat(result).find(p => p.sourceLineIndex === 29)!;
    expect(continuation).toMatchObject({ kind: 'title_only_candidate', side: 'left', titleText: '必要な経費', pageRef: null, sourceLineIndex: 29 });
    expect(continuation.rawText).toBe('           必要な経費');
  });
});
