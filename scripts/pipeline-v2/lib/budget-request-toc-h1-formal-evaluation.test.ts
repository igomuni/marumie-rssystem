import { describe, expect, it } from 'vitest';
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { assembleTocPageH1 } from './budget-request-toc-row-assembly-h1';
import { h1FinalJudgment, h1TriggerCensus } from './budget-request-toc-h1-formal-evaluation';

// synthetic のみ（新 held-out の値は使わない）
const E = 60;
const ln = (left: string, right = '', e = E) => (left + ' ').padEnd(e) + right;
const mk = (lines: string[]) => { const text = lines.join('\n'); return { localPdfPath: 'x/a.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: sha256Hex(text), classifierSource: 'DIRECT' as const, text, nonEmptyLines: nonEmptyLinesOf(text) }; };
const BODY = [ln('1 01-95 左 3', '2 01-95 右 5'), ln('   （項） 010 左 4', '   （項） 020 右 6'), ln('3 01-95 左 7', '4 01-95 右 9')];

describe('H1 formal evaluation 補助（synthetic）', () => {
  it('positive trigger は H1 出力と raw line から集計され、H1 の分割行と 1:1、negative control は数えない', () => {
    const page = mk(['令和6年度目次', '要求 区分 ページ', ln('総表 1', '5 01-95 右の事業 11'), ln('明細表 3', '   （項） 030 右の項 12'), ln('見出し', '右側の見出し文字'), ...BODY]);
    const h1 = assembleTocPageH1(page);
    const c = h1TriggerCensus(page.nonEmptyLines, h1);
    expect(c.triggerLines).toEqual([2, 3]);
    expect(c.splitLines).toEqual([2, 3]);
    expect(c.tokenTypes).toEqual({ REQUEST: 1, MARKER: 1, OTHER_CODE: 0 });
    expect(c.negativeControlLines).toContain(4);
  });
  it('UNSPLIT page・trigger なしの page は 0', () => {
    const page = mk(['令和6年度目次', '1 01-95 左 3', '   （項） 010 左 4']);
    const c = h1TriggerCensus(page.nonEmptyLines, assembleTocPageH1(page));
    expect(c.triggerLines).toEqual([]); expect(c.splitLines).toEqual([]);
  });
  it('final judgment の優先順位（STOP_PROTOCOL > STOP_SAFETY > H1_UNVALIDATED > REVIEW_REQUIRED > SAFETY_PASS）', () => {
    expect(h1FinalJudgment(false, 5, 0, 1)).toBe('STOP_PROTOCOL');
    expect(h1FinalJudgment(true, 1, 0, 0)).toBe('STOP_SAFETY');
    expect(h1FinalJudgment(true, 0, 0, 1)).toBe('H1_UNVALIDATED');
    expect(h1FinalJudgment(true, 0, 3, 1)).toBe('REVIEW_REQUIRED');
    expect(h1FinalJudgment(true, 0, 3, 0)).toBe('SAFETY_PASS_COVERAGE_REPORTED');
  });
});
