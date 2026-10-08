import { describe, expect, it } from 'vitest';
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { assembleTocPageH1 } from './budget-request-toc-row-assembly-h1';
import { h1TriggerCensus } from './budget-request-toc-h1-formal-evaluation';
import { CANDIDATE_REASONS, candidateReasons, observePage, rightBandEvidenceCount, summarize } from './budget-request-toc-full-corpus-status';

// synthetic のみ
const E = 60;
const ln = (left: string, right = '', e = E) => (left + ' ').padEnd(e) + right;
const mk = (lines: string[]) => { const text = lines.join('\n'); return { localPdfPath: 'x/a.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: sha256Hex(text), classifierSource: 'DIRECT' as const, text, nonEmptyLines: nonEmptyLinesOf(text) }; };
const BODY = [ln('1 01-95 左 3', '2 01-95 右 5'), ln('   （項） 010 左 4', '   （項） 020 右 6'), ln('3 01-95 左 7', '4 01-95 右 9')];
const meta = (p: ReturnType<typeof mk>) => ({ localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, publisherDomain: 'x', partition: 'DEVELOPMENT_EXPLORED' as const, classifierSource: p.classifierSource, pdfSha256: p.pdfSha256, textSha256: p.textSha256 });

describe('full-corpus status helper（synthetic）', () => {
  it('right-band evidence 件数は先頭 token でない request token のみを数え、E の定義と整合する', () => {
    expect(rightBandEvidenceCount(nonEmptyLinesOf(BODY.join("\n")))).toBe(2);
    const p = mk(['令和6年度', ...BODY]);
    expect(assembleTocPageH1(p).rightBandEdge).toBe(60);
  });
  it('page 観測と candidate reason: trigger・negative control・tokenless 形は reason になり、enum 外の reason は出ない', () => {
    const p = mk(['令和6年度目次', ln('総表 1', '5 01-95 右の事業 11'), ln('見出し', '右側の継続らしい文字'), ...BODY]);
    const h1 = assembleTocPageH1(p); const c = h1TriggerCensus(p.nonEmptyLines, h1);
    const o = observePage(meta(p), h1, c, p.nonEmptyLines);
    expect(o.pageState).toBe('ASSEMBLED_SPLIT'); expect(o.h1.triggerLines).toEqual([1]);
    const r = candidateReasons(o, null);
    expect(r).toEqual(expect.arrayContaining(['H1_TRIGGER_PRESENT', 'H1_NEGATIVE_CONTROL_PRESENT', 'KNOWN_TOKENLESS_FRAGMENT_RELEVANT']));
    for (const x of r) expect(CANDIDATE_REASONS).toContain(x);
  });
  it('page abstain は PAGE_ABSTAINED、UNSPLIT page は理由なし（GT なし）。summarize は件数を保存する', () => {
    const a = mk(['令和6年度', ln('1 01-95 a 3', '2 01-95 b 5')]);
    const h = assembleTocPageH1(a);
    const oa = observePage(meta(a), h, h1TriggerCensus(a.nonEmptyLines, h), a.nonEmptyLines);
    expect(oa.pageState).toBe('PAGE_ABSTAINED'); expect(candidateReasons(oa, null)).toEqual(['PAGE_ABSTAINED']);
    const u = mk(['令和6年度', '1 01-95 左 3', '   （項） 010 左 4']);
    const hu = assembleTocPageH1(u); const ou = observePage(meta(u), hu, h1TriggerCensus(u.nonEmptyLines, hu), u.nonEmptyLines);
    expect(candidateReasons(ou, null)).toEqual([]);
    const s = summarize([oa, ou]);
    expect(s.pages).toBe(2); expect(s.pageState).toEqual({ SPLIT: 0, UNSPLIT: 1, ABSTAINED: 1 });
    expect(s.rowKinds.REQUEST_NUMBER_ROW).toBe(1); expect(s.rowKinds.MARKER_ROW).toBe(1);
  });
});
