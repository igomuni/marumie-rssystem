import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { assembleTocPageH1, type TocPageInput } from './budget-request-toc-row-assembly-h1';
import { analyzeHeaderPage, hasTrailingPageRef, headerEndPosition, rowStartsLine } from './budget-request-toc-header-tokenless';

const pageOf = (lines: string[]): TocPageInput => {
  const text = lines.join('\n');
  return { localPdfPath: 'synthetic.pdf', pdfSha256: 'x', physicalPage: 1, textSha256: sha256Hex(text), classifierSource: 'DIRECT', text, nonEmptyLines: nonEmptyLinesOf(text) };
};
/** E=40 の右 column 行: 左 text + 40 桁目までの padding（末尾に page 番号 + 空白）+ 右 text */
const row = (left: string, right: string) => `${left.padEnd(38, ' ')}9 ${right}`.replace(/^(.{38})9 /u, '$19 ');
const body = [row('01 10-01 左A', '12 10-02 右A'), row('02 10-03 左B', '13 10-04 右B'), row('03 10-05 左C', '14 10-06 右C')];
const analyze = (lines: string[]) => { const p = pageOf(lines); const h1 = assembleTocPageH1(p); return { h1, a: analyzeHeaderPage(p.nonEmptyLines, h1) }; };
const tokenless = (t: string) => `${' '.repeat(40)}${t}`;

describe('header zone tokenless census（合成行）', () => {
  it('E 以右に row-start token なしの header 行は candidate（whole-line TITLE のまま・右 text は sha のみ）', () => {
    const { h1, a } = analyze(['見出し', tokenless('見出し右'), ...body]);
    expect(h1.pageState).toBe('ASSEMBLED_SPLIT');
    expect(a.edge).toBe(40);
    expect(a.candidates.map(c => c.lineIndex)).toEqual([1]);
    const c = a.candidates[0];
    expect(c.wholeLineTitleInOutput).toBe(true);
    expect(c.rightTextSha256).toBe(sha256Hex('見出し右'));
    expect(c.rightTextChars).toBe(4);
    expect(c.leftBlank).toBe(true);
    expect(c.charStart).toBe(40);
    expect(c.distanceToHeaderEnd).toBe(1);
    expect(Object.keys(c)).not.toContain('text');
  });
  it('trigger なしページの candidate は WITHOUT_TRIGGER_CONTEXT（既存 flag は不成立）', () => {
    const { a } = analyze(['見出し', tokenless('見出し右'), ...body]);
    expect(a.triggerCount).toBe(0);
    expect(a.knownFlag).toBe(false);
    expect(a.candidates[0].primary).toBe('HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT');
    expect(a.candidates[0].precedingTriggerDistance).toBeNull();
  });
  it('最初の trigger より後ろの candidate は AFTER_TRIGGER かつ既存 flag と一致、前の candidate は WITHOUT_TRIGGER_CONTEXT', () => {
    const { a } = analyze([tokenless('前'), row('見出し', '05 10-05 右見出し'), tokenless('後'), ...body]);
    expect(a.triggerCount).toBe(1);
    expect(a.knownFlag).toBe(true);
    const [before, after] = a.candidates;
    expect(before.primary).toBe('HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT');
    expect(before.knownFlagMatch).toBe(false);
    expect(before.followingTriggerDistance).toBe(1);
    expect(after.primary).toBe('HEADER_TOKENLESS_AFTER_TRIGGER');
    expect(after.knownFlagMatch).toBe(true);
    expect(after.precedingTriggerDistance).toBe(1);
    expect(a.currentFragmentsAttached).toBe(0);
  });
  it('末尾 page ref を持つ candidate は PAGE_REF_TOKENLESS', () => {
    const { a } = analyze([tokenless('右見出し 12'), ...body]);
    expect(a.candidates[0].pageRefTokenless).toBe(true);
    expect(a.diagnostic.key).toContain('PREF');
  });
  it('page ref 述語は parser の FRAGMENT_WITH_PAGE_REF 判定と同じ', () => {
    for (const [seg, expected] of [['に必要な経費', false], ['に必要な経費 12', true], ['に必要な経費 P3', false], ['経費 あ3', true]] as const) {
      expect(hasTrailingPageRef(seg)).toBe(expected);
      const out = assembleTocPageH1(pageOf(['01 10-01 名称 3', seg]));
      const abstained = out.rows.some(r => r.abstentionReason === 'FRAGMENT_WITH_PAGE_REF');
      const attached = out.rows.reduce((n, r) => n + r.fragments.length, 0);
      expect(abstained).toBe(expected && !/^\d/u.test(seg));
      expect(attached).toBe(abstained ? 0 : 1);
    }
  });
  it('rowStartsLine / headerEnd は H1 出力の header zone（TITLE 行）と一致', () => {
    const lines = ['見出し', tokenless('右'), ...body];
    const p = pageOf(lines);
    expect(rowStartsLine(lines[0])).toBe(false);
    expect(rowStartsLine(lines[2])).toBe(true);
    expect(headerEndPosition(p.nonEmptyLines)).toBe(2);
    const { a } = analyze(lines);
    expect(a.headerZoneLineCount).toBe(2);
    expect(a.headerZoneLineCountFromOutput).toBe(2);
    expect(headerEndPosition(pageOf(['見出し', '見出し2']).nonEmptyLines)).toBe(2);
  });
  it('E 未確定ページ（UNSPLIT）は candidate 集計の外（E_UNDEFINED）で header zone 行数のみ記録', () => {
    const { h1, a } = analyze(['見出し', tokenless('右'), '01 10-01 名称 3', '02 10-02 名称 4']);
    expect(h1.pageState).toBe('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE');
    expect(a.eDefined).toBe(false);
    expect(a.candidates).toEqual([]);
    expect(a.headerZoneLineCount).toBe(2);
  });
  it('分類は candidate の有無・flag・trigger・page ref・fragment attachment の組み合わせ（意味づけなし）', () => {
    const { a } = analyze([tokenless('右'), ...body]);
    expect(a.diagnostic).toEqual({ hasCandidate: true, knownFlag: false, hasTrigger: false, hasPageRefCandidate: false, hasCurrentFragmentAttachment: false, key: 'CAND|NOFLAG|NOTRIG|NOPREF|NOATT' });
  });
});

describe('committed census fixture integrity（data/work 不要）', () => {
  const FX = (...p: string[]) => path.join(process.cwd(), 'tests', 'fixtures', ...p);
  const census = JSON.parse(fs.readFileSync(FX('budget-request-toc-header-tokenless-failure-isolation', '2024', 'census.json'), 'utf8'));
  const status = JSON.parse(fs.readFileSync(FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json'), 'utf8')).pages;
  const queue = JSON.parse(fs.readFileSync(FX('budget-request-toc-full-corpus-status', '2024', 'human-review-queue.json'), 'utf8')).pages;
  it('82 page・partition 34/23/25 が full-corpus-status と一致', () => {
    expect(census.pages).toHaveLength(82);
    const count = (k: string) => census.pages.filter((p: { partition: string }) => p.partition === k).length;
    expect([count('DEVELOPMENT_EXPLORED'), count('FIRST_HELDOUT_POSTHOC'), count('NEW_HELDOUT_POSTHOC')]).toEqual([34, 23, 25]);
    for (const p of census.pages) {
      const s = status.find((x: { localPdfPath: string; physicalPage: number }) => x.localPdfPath === p.localPdfPath && x.physicalPage === p.physicalPage);
      expect(s.partition).toBe(p.partition);
      expect(p.candidates.map((c: { lineIndex: number }) => c.lineIndex)).toEqual(s.pageState === 'ASSEMBLED_SPLIT' ? s.h1.negativeControlLines : []);
      expect(p.triggerCount).toBe(s.h1.triggerLines.length);
      expect(p.currentFragmentsAttached).toBe(s.fragmentsAttached);
    }
  });
  it('分類別合計が candidate 行数に一致し、既存 flag ページが human-review-queue と一致', () => {
    const s = census.summary;
    expect(s.primary.AFTER_TRIGGER.lines + s.primary.WITHOUT_TRIGGER_CONTEXT.lines).toBe(s.candidates.lines);
    expect(s.flags.OTHER_HEADER_TOKENLESS.lines).toBe(0);
    const known = queue.filter((q: { candidateReasons: string[] }) => q.candidateReasons.includes('KNOWN_TOKENLESS_FRAGMENT_RELEVANT')).map((q: { localPdfPath: string; physicalPage: number }) => `${q.localPdfPath}#${q.physicalPage}`).sort();
    const mine = census.pages.filter((p: { knownFlag: boolean }) => p.knownFlag).map((p: { localPdfPath: string; physicalPage: number }) => `${p.localPdfPath}#${p.physicalPage}`).sort();
    expect(mine).toEqual(known);
    expect(Object.values(s.diagnosticKeys).reduce((a: number, b) => a + (b as number), 0)).toBe(82);
    expect(JSON.stringify(census)).not.toMatch(/\/Users\//u);
  });
});
