import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { coverPage, renderTocCsv, tocPage } from './budget-request-plain-text-csv';

const fixtureDir = path.join(process.cwd(), 'tests/fixtures/budget-request-plain-text-csv/2024');
const states = ['R', 'I', 'C', 'E'] as const;
const pairs = states.flatMap(left => states.map(right => [left, right] as const));

describe('plain text CSV v0', () => {
  it('parses one continuous artificial page against the independent expected CSV', () => {
    const input = fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.txt'), 'utf8');
    const result = tocPage(input, 'fixture.pdf', 1);
    expect(renderTocCsv(result.records)).toBe(fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.expected.csv'), 'utf8'));
    expect(result.audit.some(a => a.rawLine === 'orphan string survives audit')).toBe(true);
    expect(result.audit.every(a => Number.isInteger(a.rawLineIndex) && a.rawLineIndex >= 0)).toBe(true);
    expect(result.audit.some(a => a.rawLine.includes('no printed page'))).toBe(true);
  });

  it('covers all 16 ordered side-state pairs through the same page-level stateful call', () => {
    const input = fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.txt'), 'utf8');
    const pages = input.split('\f').map(page => page.split(/\r?\n/u));
    const result = tocPage(input, 'fixture.pdf', 1);
    for (const [index, [left, right]] of pairs.entries()) {
      const pageLines = pages[Math.floor(index / 8)];
      const pairStart = pageLines.findIndex(line => line.startsWith(`${String(90 + index + 1).padStart(2, '0')} 05‐13 parentL`));
      const pairLine = pageLines[pairStart + 2];
      const rightLine = pageLines[pairStart + 3].trimStart();
      const expected = (state: typeof left) => state === 'R' ? 'R' : state === 'I' ? 'I' : state === 'C' ? 'C' : 'E';
      const leftObserved = /^\d{1,2} 05‐13 R\d+/u.test(pairLine) ? 'R' : /^（項）/u.test(pairLine) ? 'I' : /^continuationL/u.test(pairLine) ? 'C' : 'E';
      const rightObserved = /^\d{1,2} 05‐95 parentR/u.test(rightLine) ? 'R' : /^\d{1,2} 05‐95 R\d+/u.test(rightLine) ? 'R' : /^（項）/u.test(rightLine) ? 'I' : /^continuationR/u.test(rightLine) ? 'C' : 'E';
      expect([leftObserved, rightObserved], `pair ${index + 1}`).toEqual([expected(left), expected(right)]);
      if (left === 'C') expect(result.records.find(r => r.要求番号 === String(90 + index + 1).padStart(2, '0'))?.区分).toContain(`continuationL${index + 1}`);
      if (right === 'C') expect(result.records.find(r => r.要求番号 === String(90 + index + 1).padStart(2, '0') && r.区分.startsWith('05‐95'))?.区分).toContain(`continuationR${index + 1}`);
      if (left === 'C' && right !== 'C') expect(result.records.find(r => r.要求番号 === String(90 + index + 1).padStart(2, '0') && r.区分.startsWith('05‐95'))?.区分).not.toContain(`continuationL${index + 1}`);
      if (right === 'C' && left !== 'C') expect(result.records.find(r => r.要求番号 === String(90 + index + 1).padStart(2, '0'))?.区分).not.toContain(`continuationR${index + 1}`);
    }
  });

  it('extracts R, I, and continuation text from actual line shapes without inferring identifiers', () => {
    const r = tocPage('孤立した継続\n07 01‐13 label digits 123 9\n  （項） 612 項の名称 10\n要求番号 区分 ページ\n\n12\n', 'source.pdf', 6);
    expect(r.records).toEqual([
      { 要求番号: '07', 区分: '01‐13 label digits 123', ページ: '9' },
      { 要求番号: '', 区分: '（項） 612 項の名称', ページ: '10' },
    ]);
    expect(r.audit.map(a => a.rawLine)).toContain('孤立した継続');
    expect(r.audit.map(a => a.rawLine)).toContain('12');
    expect(r.audit.find(a => a.rawLine === '孤立した継続')?.rawLineIndex).toBe(0);
  });

  it('keeps long left-side labels intact and accepts blank pages in a continuous TXT input', () => {
    const label = '非常に長い左側の要求事項名称'.repeat(12);
    const parsed = tocPage(`01 05‐13 ${label} 22\n\f\f`, 'source.pdf', 6);
    expect(parsed.records).toEqual([{ 要求番号: '01', 区分: `05‐13 ${label}`, ページ: '22' }]);
    expect(parsed.audit).toHaveLength(0);
  });

  it('accepts only the three Pattern Catalog R1 separators and rejects lookalikes', () => {
    for (const hyphen of ['‐', '‑', '-']) {
      const result = tocPage(`01 05${hyphen}13 exact 8\n`, 'source.pdf', 6);
      expect(result.records[0]).toEqual({ 要求番号: '01', 区分: `05${hyphen}13 exact`, ページ: '8' });
    }
    for (const hyphen of ['‒', '–', '—', '－']) {
      expect(tocPage(`01 05${hyphen}13 invalid 8\n`, 'source.pdf', 6).records).toHaveLength(0);
    }
  });

  it('keeps the source code/name separator blanks in R1 CSV text', () => {
    expect(tocPage('01 05‐13   source spacing 8\n', 'source.pdf', 6).records[0]?.区分).toBe('05‐13   source spacing');
  });

  it('accepts only full-width I1 token and preserves it exactly', () => {
    expect(tocPage('（項） 612 名称 10\n', 'source.pdf', 6).records[0]).toEqual({ 要求番号: '', 区分: '（項） 612 名称', ページ: '10' });
    for (const token of ['(項) 612 名称 10', '（項) 612 名称 10', '(項） 612 名称 10']) {
      expect(tocPage(`${token}\n`, 'source.pdf', 6).records).toHaveLength(0);
    }
  });

  it('accounts for prefix text before a later start token as same-side continuation', () => {
    const result = tocPage('01 05‐13 parent 8\ncontinuationPrefix 02 06-14 child 9\n', 'source.pdf', 6);
    expect(result.records).toEqual([
      { 要求番号: '01', 区分: '05‐13 parentcontinuationPrefix', ページ: '8' },
      { 要求番号: '02', 区分: '06-14 child', ページ: '9' },
    ]);
    expect(result.audit).toHaveLength(0);
  });

  it('audits starts on the ambiguous development boundary instead of assigning a side', () => {
    const r = tocPage(`${' '.repeat(30)}01 05‐13 ambiguous 8\n`, 'source.pdf', 6);
    expect(r.records).toHaveLength(0);
    expect(r.audit[0].reason).toContain('ambiguous development boundary');
  });

  it('reads the Cover fields from page text and preserves source spacing and Unicode', () => {
    const cover = '19 内 閣 府 所 管\n   令   和    ６       年      度      歳      出       概       算       要         求   書\n';
    const result = coverPage(cover, 'cover.pdf', 1);
    expect(result.csv).toBe('年度,所管,会計,資料名\n"令   和    ６       年      度","19 内 閣 府 所 管","","歳      出       概       算       要         求   書"\n');
    expect(result.audit).toHaveLength(0);
    const audited = coverPage(`表紙上の未使用行\n${cover}`, 'cover.pdf', 1);
    expect(audited.audit).toEqual([expect.objectContaining({ rawLineIndex: 0, rawLine: '表紙上の未使用行' })]);
    expect(() => coverPage('no matching content')).toThrow(/fixed four-column schema/u);
  });
});
