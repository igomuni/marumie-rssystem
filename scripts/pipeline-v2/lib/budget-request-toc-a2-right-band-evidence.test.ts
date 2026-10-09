import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CLASSIFICATIONS, acceptedStarts, censusPage, classify, dominantWindow, type PageCensusContext } from './budget-request-toc-a2-right-band-evidence';

const L = (...texts: string[]) => texts.map((text, lineIndex) => ({ lineIndex, text }));
const SPLIT: PageCensusContext = { pageState: 'ASSEMBLED_SPLIT', pageAbstentionReason: null };
const UNSPLIT: PageCensusContext = { pageState: 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', pageAbstentionReason: null };
const ABST: PageCensusContext = { pageState: 'PAGE_ABSTAINED', pageAbstentionReason: 'RIGHT_EVIDENCE_INSUFFICIENT' };
const pad = (n: number, s: string) => ' '.repeat(n) + s;
const leftRight = (left: string, right: string) => `${left}${' '.repeat(Math.max(1, 40 - left.length))}12 ${right}`;

describe('A2 right-band evidence census（合成行）', () => {
  it('左列末尾の数字 + 空白 + request token は accepted（現行述語）', () => {
    const t = leftRight('01 10-01 サンプル 12', '34 10-02');
    const c = censusPage(L(t), UNSPLIT);
    expect(c.requestTokenCandidatesAll).toBe(2);
    expect(c.acceptedEvidenceCount).toBe(1);
    expect(acceptedStarts(t).size).toBe(1);
  });
  it('行頭 index 0 の token は line-start(idx0) で right-only に含めない', () => {
    const c = censusPage(L('12 10-01 事項'), UNSPLIT);
    expect(c.lineStart0Candidates).toBe(1);
    expect(c.rightOnlyCandidates).toBe(0);
    expect(c.acceptedEvidenceCount).toBe(0);
  });
  it('行頭空白の後ろの先頭 token は right-only candidate（開始 index を histogram に記録）', () => {
    const c = censusPage(L(pad(55, '12 10-01'), pad(55, '13 10-02'), pad(56, '14 10-03')), UNSPLIT);
    expect(c.rightOnlyCandidates).toBe(3);
    expect(c.rightOnlyStartHistogram).toEqual({ 55: 2, 56: 1 });
    expect(c.dominantRightOnlyWindow).toEqual({ start: 55, count: 3 });
    expect(c.a2Pattern).toBe(true);
    expect(c.classification).toBe('A2_LIKE_REJECTED_RIGHT_ONLY');
  });
  it('tolerance を超えて散った right-only は A2 pattern にならない', () => {
    const c = censusPage(L(pad(10, '12 10-01'), pad(30, '13 10-02'), pad(50, '14 10-03')), ABST);
    expect(c.rightOnlyCandidates).toBe(3);
    expect(c.a2Pattern).toBe(false);
    expect(c.classification).toBe('A1_LIKE_SPARSE');
  });
  it('right-only 1 件だけでは A2 pattern にならない', () => {
    expect(censusPage(L(pad(55, '12 10-01')), UNSPLIT).a2Pattern).toBe(false);
  });
  it('dominantWindow は幅 2 以内の最大件数', () => {
    expect(dominantWindow([])).toBeNull();
    expect(dominantWindow([5, 7, 8, 20])).toEqual({ start: 5, count: 2 });
  });
  it('全角を含む行は code point index で数える', () => {
    const t = `あい ${' '.repeat(3)}1 10-01 x 12 34 10-02`;
    const c = censusPage(L(t), UNSPLIT);
    const rightmost = c.tokens[c.tokens.length - 1];
    expect(rightmost.charIndex).toBe(Array.from(t.slice(0, t.lastIndexOf('34 10-02'))).length);
    expect(rightmost.accepted).toBe(true);
  });
  it('分類: accepted>=2 + pattern + SPLIT は CURRENTLY_RESOLVED', () => {
    expect(classify(2, true, SPLIT)).toBe('A2_PATTERN_BUT_CURRENTLY_RESOLVED');
    expect(classify(1, true, ABST)).toBe('A2_LIKE_REJECTED_RIGHT_ONLY');
    expect(classify(0, true, UNSPLIT)).toBe('A2_LIKE_REJECTED_RIGHT_ONLY');
    expect(classify(1, false, ABST)).toBe('A1_LIKE_SPARSE');
    expect(classify(0, false, UNSPLIT)).toBe('NO_A2_PATTERN');
    expect(classify(3, false, SPLIT)).toBe('NO_A2_PATTERN');
    expect(classify(3, false, { pageState: 'PAGE_ABSTAINED', pageAbstentionReason: 'MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS' })).toBe('MIXED_OR_UNRESOLVED');
    expect(classify(0, false, { pageState: 'PAGE_ABSTAINED', pageAbstentionReason: 'FROZEN_INPUT_MISMATCH' })).toBe('MIXED_OR_UNRESOLVED');
  });
  it('MARKER_ONLY は sub-breakdown markerOnly（A1_LIKE_SPARSE）', () => {
    const c = censusPage(L('abc'), { pageState: 'PAGE_ABSTAINED', pageAbstentionReason: 'MARKER_ONLY_RIGHT_BOUNDARY' });
    expect(c.classification).toBe('A1_LIKE_SPARSE');
    expect(c.subBreakdown).toBe('markerOnly');
  });
});

describe('census.json の integrity（commit 済み fixture のみ・data/work 不要）', () => {
  const doc = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-toc-a2-right-band-evidence-failure-isolation', '2024', 'census.json'), 'utf8'));
  it('82 page・partition 34/23/25・分類合計 82', () => {
    expect(doc.pages).toHaveLength(82);
    expect(doc.summary.byPartition).toEqual({ DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25 });
    expect(CLASSIFICATIONS.reduce((s, c) => s + doc.summary.classification[c].pages, 0)).toBe(82);
  });
  it('accepted evidence は full-corpus-status と全 82 page で一致', () => {
    const st = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json'), 'utf8')).pages;
    const m = new Map(st.map((p: { localPdfPath: string; physicalPage: number; rightBandEvidenceCount: number; pageState: string; partition: string }) => [`${p.localPdfPath}#${p.physicalPage}`, p]));
    for (const p of doc.pages) {
      const s = m.get(`${p.localPdfPath}#${p.physicalPage}`) as { rightBandEvidenceCount: number; pageState: string; partition: string };
      expect(p.acceptedEvidenceCount).toBe(s.rightBandEvidenceCount);
      expect(p.currentPageState).toBe(s.pageState);
      expect(p.partition).toBe(s.partition);
    }
  });
  it('絶対パスを含まず、anchor は #404 と一致', () => {
    expect(JSON.stringify(doc)).not.toContain('/Users/');
    expect(doc.input.rawTextRoot).toBe('data/work/budget-request-raw-text/2024');
    expect(doc.anchors.every((a: { matchesObservations404: boolean }) => a.matchesObservations404)).toBe(true);
    expect(doc.anchors.map((a: { classification: string }) => a.classification)).toEqual(['A1_LIKE_SPARSE', 'A2_LIKE_REJECTED_RIGHT_ONLY', 'A1_LIKE_SPARSE']);
  });
});
