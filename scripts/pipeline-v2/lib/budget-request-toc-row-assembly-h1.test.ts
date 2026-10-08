import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { assembleTocPage, type TocPageInput } from './budget-request-toc-row-assembly';
import { assembleTocPageH1 } from './budget-request-toc-row-assembly-h1';
import { diffPages, triggerCensus } from './budget-request-toc-row-assembly-h1-differential';

const h1dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const syn = JSON.parse(fs.readFileSync(path.join(h1dir, 'development-synthetic.json'), 'utf8')) as { cases: { id: string; polarity: string; lines: string[]; expect: { triggerLineIndexes: number[]; rightKinds?: string[]; downstreamFragments?: number; pageState?: string } }[] };
const mk = (lines: string[]): TocPageInput => { const text = lines.join('\n'); return { localPdfPath: 'x/a.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: sha256Hex(text), classifierSource: 'DIRECT', text, nonEmptyLines: nonEmptyLinesOf(text) }; };

describe('H1 実装（#393 frozen source と分離した別 version。development-only）', () => {
  it('#393 の source は不変で、H1 source との差は H1-BEGIN〜H1-END の 1 ブロックと関数名・先頭 comment のみ', () => {
    const base = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts', 'utf8');
    expect(sha256Hex(base)).toBe('f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd');
    const h1 = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts', 'utf8');
    expect((h1.match(/\/\/ H1-BEGIN/g) ?? []).length).toBe(1);
    expect((h1.match(/\/\/ H1-END/g) ?? []).length).toBe(1);
    const strip = (s: string) => s.slice(s.indexOf('import { nonEmptyLinesOf')).replace('export function assembleTocPageH1(', 'export function assembleTocPage(').replace(/ {6}\/\/ H1-BEGIN[\s\S]*?\/\/ H1-END\n/, '');
    expect(strip(h1)).toBe(strip(base));
  });
  it('synthetic は required な positive / negative case を全て含む（15 case）', () => {
    expect(syn.cases).toHaveLength(15);
    expect(syn.cases.filter(c => c.polarity === 'positive')).toHaveLength(6);
    expect(syn.cases.filter(c => c.polarity === 'negative')).toHaveLength(9);
  });
  for (const c of syn.cases) {
    it(`synthetic ${c.id}: 機械 trigger = 期待、H1 の分割は trigger 行のみ、差分は許可差のみ`, () => {
      const page = mk(c.lines);
      const baseline = assembleTocPage(page); const h1 = assembleTocPageH1(page);
      if (c.expect.pageState) expect(baseline.pageState).toBe(c.expect.pageState);
      const census = triggerCensus(page, baseline);
      expect(census.triggerLines).toEqual(c.expect.triggerLineIndexes);
      const rep = diffPages(page, baseline, h1, census);
      expect(rep.undeclared).toEqual([]); expect(rep.triggerMismatches).toEqual([]); expect(rep.falseSplits).toEqual([]);
      expect(rep.pageStateChanges).toBe(0); expect(rep.provenanceMismatches).toBe(0);
      expect(rep.triggerLineChanges).toBe(c.expect.triggerLineIndexes.length);
      if (c.expect.rightKinds) expect(Object.keys(rep.rightKinds).sort()).toEqual([...new Set(c.expect.rightKinds)].sort());
      expect(rep.declaredDownstreamFragments).toBe(c.expect.downstreamFragments ?? 0);
      if (c.expect.triggerLineIndexes.length === 0) expect(JSON.stringify(h1)).toBe(JSON.stringify(baseline)); // non-trigger は #393 と完全一致
    });
  }
  it('trigger 行は LEFT TITLE（RESOLVED）+ RIGHT unit に分かれ、分割位置は E、LEFT は捨てない、新 row kind・新 reason なし', () => {
    const page = mk(syn.cases[0].lines);
    const h1 = assembleTocPageH1(page);
    const L = h1.rows.filter(r => r.provenance.lineIndex === 2);
    expect(L.map(r => [r.column, r.rowKind, r.state])).toEqual([['LEFT', 'TITLE_OR_HEADING', 'RESOLVED'], ['RIGHT', 'REQUEST_NUMBER_ROW', 'RESOLVED']]);
    expect(L[0].provenance.sourceRawSlice).toBe('総表 1');
    expect(L[1].provenance.charStart).toBe(60);
    for (const r of h1.rows) expect(['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'TITLE_OR_HEADING', 'OTHER_CODE', 'WRAPPED_FRAGMENT', 'UNKNOWN_ABSTAINED']).toContain(r.rowKind);
    expect(JSON.stringify(h1)).not.toMatch(/PLAIN_ROW/);
  });
  it('H1 source は publisher・PDF・page・特定 token・line index・GT 値を条件に持たず、GT / held-out artifact を参照しない', () => {
    const src = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts', 'utf8');
    const block = src.slice(src.indexOf('// H1-BEGIN'), src.indexOf('// H1-END'));
    expect(block).not.toMatch(/令和|\.pdf|publisher|230901|lineIndex ===|physicalPage|PLAIN_ROW/);
    expect(src).not.toMatch(/ground-truth|visual-gt-source|annotation-ledger|heldout-candidates|heldout-parser-output|evaluation-result/);
  });
  it('決定的（同一入力で同一出力）', () => {
    const page = mk(syn.cases[5].lines);
    expect(JSON.stringify(assembleTocPageH1(page))).toBe(JSON.stringify(assembleTocPageH1(page)));
  });
});
