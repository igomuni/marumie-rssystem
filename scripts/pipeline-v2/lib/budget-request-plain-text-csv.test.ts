import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { coverTables, offsetCoverProvenance, renderCoverCsv, renderCoverEntriesCsv, renderTocCsv, tocPage } from './budget-request-plain-text-csv';
import { deterministicPdfSlug } from './budget-request-plain-text';

const fixtureDir = path.join(process.cwd(), 'tests/fixtures/budget-request-plain-text-csv/2024');
const header = '要求                    区                    分     ページ 要求                      区                     分      ページ';
const tocText = (pdf: string, page: number) => {
  const slug = deterministicPdfSlug(pdf);
  return fs.readFileSync(path.join(process.cwd(), `data/work/budget-request-plain-text/2024/${slug}.txt`), 'utf8').split('\f')[page - 1];
};
const page = (pdf: string, physicalPage: number) => tocText(pdf, physicalPage);

describe('plain text CSV v0', () => {
  it('offsets Cover provenance to the integrated CSV data-row sequence', () => {
    const traces = [
      { sourcePdf: 'a.pdf', page: 10, rawLineIndex: 0, csvRecordIndex: 0, scope: 'cover' as const, role: 'header-fields', recordType: 'cover' as const },
      { sourcePdf: 'a.pdf', page: 10, rawLineIndex: 1, csvRecordIndex: 0, scope: 'cover' as const, role: 'entry', recordType: 'cover_entry' as const },
      { sourcePdf: 'a.pdf', page: 10, rawLineIndex: 2, csvRecordIndex: 1, scope: 'cover' as const, role: 'entry', recordType: 'cover_entry' as const },
    ];
    expect(offsetCoverProvenance(traces, 5, 15).map(trace => trace.csvRecordIndex + 1)).toEqual([6, 16, 17]);
  });

  it('parses one continuous artificial TXT against independently maintained expected CSV', () => {
    const input = fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.txt'), 'utf8');
    const result = tocPage(input, 'fixture.pdf', 1);
    expect(renderTocCsv(result.records)).toBe(fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.expected.csv'), 'utf8'));
    expect(result.audit.some(a => a.rawLine === 'orphan string survives audit')).toBe(true);
    expect(result.audit.every(a => Number.isInteger(a.rawLineIndex) && a.rawLineIndex >= 0)).toBe(true);
    expect(result.audit.some(a => a.rawLine.includes('no printed page'))).toBe(true);
    expect(result.provenance.some(p => p.csvRecordIndex === 0 && p.side === 'left')).toBe(true);
  });

  it('keeps all 16 R/I/C/E side-state combinations and emits each page left column before right column', () => {
    const input = fs.readFileSync(path.join(fixtureDir, 'continuous-artificial.txt'), 'utf8');
    const states = ['R', 'I', 'C', 'E'] as const;
    const pairs = states.flatMap(left => states.map(right => [left, right] as const));
    const pages = input.split('\f').map(value => value.split(/\r?\n/u));
    const result = tocPage(input, 'fixture.pdf', 1);
    for (const [index, [left, right]] of pairs.entries()) {
      const sourceLines = pages[Math.floor(index / 8)];
      const pairStart = sourceLines.findIndex(line => line.startsWith(`${String(91 + index).padStart(2, '0')} 05‐13 parentL`));
      expect(pairStart).toBeGreaterThanOrEqual(0);
      const pairLine = sourceLines[pairStart + 2] ?? '';
      const rightLine = (sourceLines[pairStart + 3] ?? '').trimStart();
      const observedLeft = /^\d{1,2} 05‐13 R\d+/u.test(pairLine) ? 'R' : /^（項）/u.test(pairLine) ? 'I' : /^continuationL/u.test(pairLine) ? 'C' : 'E';
      const observedRight = /^\d{1,2} 05‐95 R\d+/u.test(rightLine) ? 'R' : /^（項）/u.test(rightLine) ? 'I' : /^continuationR/u.test(rightLine) ? 'C' : 'E';
      expect([observedLeft, observedRight], `pair ${index + 1}`).toEqual([left, right]);
    }
    for (const physicalPage of [1, 2]) {
      const sides = result.provenance.filter(p => p.page === physicalPage && p.role === 'item').map(p => p.side);
      const firstRight = sides.indexOf('right');
      expect(firstRight).toBe(-1 === sides.lastIndexOf('left') ? -1 : sides.lastIndexOf('left') + 1);
      expect(sides.slice(firstRight < 0 ? sides.length : firstRight).every(side => side === 'right')).toBe(true);
    }
  });

  it('keeps two same-line new starts as separate left and right rows', () => {
    const left = '01 01‐13 left entry 7';
    const right = '02 05‐95 right entry 8';
    const result = tocPage(`${header}\n${left.padEnd(66, ' ')}${right}\n`, 'synthetic.pdf', 1);
    expect(result.records).toEqual([
      { 要求番号: '01', 区分: '01‐13 left entry', ページ: '7' },
      { 要求番号: '02', 区分: '05‐95 right entry', ページ: '8' },
    ]);
    expect(result.provenance.map(p => p.side)).toEqual(['left', 'right']);
  });

  it('emits marker, table-reference, and three-digit standalone entries independently', () => {
    const result = tocPage([
      header,
      '令和６年度歳出概算要求額総表 1',
      '（所管）23 財務省 7',
      '（組織）010 財務本省 7',
      '001 既定定員に伴う経費 3',
    ].join('\n'), 'synthetic.pdf', 1);
    expect(result.records).toEqual([
      { 要求番号: '', 区分: '令和６年度歳出概算要求額総表', ページ: '1' },
      { 要求番号: '', 区分: '（所管）23 財務省', ページ: '7' },
      { 要求番号: '', 区分: '（組織）010 財務本省', ページ: '7' },
      { 要求番号: '', 区分: '001 既定定員に伴う経費', ページ: '3' },
    ]);
  });

  it('attaches a same-line right continuation after an independent left start', () => {
    const rightParent = '02 05‐95 right parent 8';
    const leftNew = '01 01‐13 left new 7';
    const result = tocPage(`${header}\n${' '.repeat(66)}${rightParent}\n${leftNew}${' '.repeat(40)}right continuation\n`, 'synthetic.pdf', 1);
    expect(result.records).toContainEqual({ 要求番号: '02', 区分: '05‐95 right parentright continuation', ページ: '8' });
    expect(result.records).toContainEqual({ 要求番号: '01', 区分: '01‐13 left new', ページ: '7' });
  });

  it('keeps only the specified R1 separators and full-width item marker', () => {
    for (const hyphen of ['‐', '‑', '-']) {
      const result = tocPage(`${header}\n01 05${hyphen}13 exact 8\n`, 'source.pdf', 6);
      expect(result.records[0]).toEqual({ 要求番号: '01', 区分: `05${hyphen}13 exact`, ページ: '8' });
    }
    for (const hyphen of ['‒', '–', '—', '－']) expect(tocPage(`${header}\n01 05${hyphen}13 invalid 8\n`, 'source.pdf', 6).records).toHaveLength(0);
    expect(tocPage(`${header}\n（項） 612 名称 10\n`, 'source.pdf', 6).records[0]).toEqual({ 要求番号: '', 区分: '（項） 612 名称', ページ: '10' });
  });

  it('keeps reconstruction office/organization entries separate from request rows (F1)', () => {
    const pdf = 'data/download/reconstruction.go.jp/files/user/topics/2023_fukkochougaisansaisyutsu.pdf';
    const result = tocPage(page(pdf, 3), pdf, 3);
    const office = result.records.find(r => r.区分.includes('（所管） 23   財務省'));
    const request = result.records.find(r => r.要求番号 === '1');
    expect(office).toEqual({ 要求番号: '', 区分: '（所管） 23   財務省', ページ: '7' });
    expect(request?.区分).not.toContain('（所管）');
    expect(request?.区分).not.toContain('（組織）');
  });

  it('preserves both environment ministry sides and the right wrapped suffix (F2)', () => {
    const pdf = 'data/download/env.go.jp/content/000157010.pdf';
    const result = tocPage(page(pdf, 3), pdf, 3);
    expect(result.records.find(r => r.要求番号 === '7')?.区分).toContain('石油石炭税財源');
    expect(result.records.find(r => r.要求番号 === '24')?.区分).toContain('必要な経費');
    expect(result.records.find(r => r.要求番号 === '24')?.区分).toContain('交付金に必要な経費');
    expect(result.audit.some(a => a.rawLine.includes('経費') && a.reason.includes('unresolved'))).toBe(false);
  });

  it('keeps three-digit standalone Personnel Authority items (F3)', () => {
    const pdf = 'data/download/jinji.go.jp/content/900024096.pdf';
    const result = tocPage(page(pdf, 3), pdf, 3);
    expect(result.records).toContainEqual({ 要求番号: '', 区分: '001 既定定員に伴う経費', ページ: '3' });
  });

  it('keeps MHLW marker and request records separate and retains page 7 continuations (F4)', () => {
    const pdf = 'data/download/mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf';
    const result = tocPage(page(pdf, 7), pdf, 7);
    expect(result.records.some(r => r.区分.startsWith('（組織） 050 '))).toBe(true);
    expect(result.records.find(r => r.要求番号 === '176')?.区分).not.toContain('（組織）');
    expect(result.records.every(r => r.要求番号 !== '176' || r.区分.includes('国立光明寮'))).toBe(true);
  });

  it('keeps H5 item rows, wrapped text, and left-then-right ordering (F5)', () => {
    const pdf = 'data/download/mlit.go.jp/page/content/001630995.pdf';
    const result = tocPage(page(pdf, 6), pdf, 6);
    expect(result.records).toHaveLength(71);
    expect(result.records).toContainEqual({ 要求番号: '', 区分: '（項） 612 国立研究開発法人海上・港湾・航空技術研究所施設整備費', ページ: '434' });
    expect(result.records.find(r => r.要求番号 === '147')?.区分).toContain('繰入れに必要な経費');
    const sides = result.provenance.filter(p => p.role === 'item').map(p => p.side);
    expect(sides.indexOf('right')).toBe(sides.lastIndexOf('left') + 1);
  });

  it('builds six-column Cover and distinct Cover entry rows, including the eleven-cover CAO PDF', () => {
    const pdf = 'data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf';
    const txt = fs.readFileSync(`data/work/budget-request-plain-text/2024/${deterministicPdfSlug(pdf)}.txt`, 'utf8');
    const covers = [1, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24].map(n => coverTables(txt.split('\f')[n - 1], pdf, n));
    expect(renderCoverCsv(covers.map(c => c.cover).map(row => row))).toContain('source_pdf,physical_page,header_code,header_name,year_raw,document_title_raw');
    expect(covers).toHaveLength(11);
    expect(new Set(covers.map(c => `${c.cover.source_pdf}|${c.cover.physical_page}`)).size).toBe(11);
    const tenth = covers.find(c => c.cover.physical_page === 10)!;
    expect(tenth.cover.document_title_raw).toContain('歳');
    expect(tenth.entries[0].区分).toBe('1. 令和６年度歳出概算要求額総表');
    expect(tenth.entries.some(e => e.区分.includes('科学技術・イノベーション推進事務局'))).toBe(true);
    expect(renderCoverEntriesCsv(tenth.entries)).toContain('source_pdf,physical_page,entry_order,区分,ページ');
  });

  it('processes all 69 inventory Cover pages, including the required other-office forms', () => {
    const inventory = JSON.parse(fs.readFileSync('tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json', 'utf8'));
    const pages = inventory.pages.filter((p: any) => p.classifierPageType === 'COVER');
    const outputs: Array<{ inventory: any; cover: ReturnType<typeof coverTables>['cover']; entries: ReturnType<typeof coverTables>['entries'] }> = pages.map((p: any) => {
      const txtPath = `data/work/budget-request-plain-text/2024/${deterministicPdfSlug(p.localPdfPath)}.txt`;
      const pageText = fs.readFileSync(txtPath, 'utf8').split('\f')[p.physicalPage - 1];
      return { inventory: p, ...coverTables(pageText, p.localPdfPath, p.physicalPage) };
    });
    expect(outputs).toHaveLength(69);
    expect(new Set(outputs.map(o => `${o.cover.source_pdf}|${o.cover.physical_page}`)).size).toBe(69);
    expect(outputs.every(o => o.cover.header_code && o.cover.header_name && o.cover.year_raw && o.cover.document_title_raw)).toBe(true);
    for (const domain of ['mhlw.go.jp', 'mext.go.jp', 'env.go.jp', 'meti.go.jp', 'reconstruction.go.jp', 'cas.go.jp']) {
      expect(outputs.some(o => o.inventory.publisherDomain === domain)).toBe(true);
    }
    const multilineMhlw = outputs.find(o => o.inventory.publisherDomain === 'mhlw.go.jp' && o.inventory.physicalPage === 1)!;
    expect(multilineMhlw.entries.some(e => e.区分.includes('国立障害者リハビリテーションセンター'))).toBe(true);
    expect(outputs.filter(o => o.inventory.accountType === 'special').every(o => o.cover.header_code.length === 4)).toBe(true);
    expect(outputs.filter(o => o.inventory.accountType === 'general').every(o => o.cover.header_code.length === 2)).toBe(true);
  });

  it('accepts two- and four-digit Cover codes without fixed office names or inferred accounting type', () => {
    const title = '令 和 ６ 年 度 歳 出 概 算 要 求 書';
    const general = coverTables(`12 Example office\n${title}\n1. 令和６年度歳出概算要求額総表 1\n`, 'general.pdf', 1);
    const special = coverTables(`9101 Example special account （勘定）\n${title}\n1. 令和６年度歳出概算要求額総表 1\n`, 'special.pdf', 1);
    expect([general.cover.header_code, special.cover.header_code]).toEqual(['12', '9101']);
    expect(general.cover.header_name).toBe('Example office');
    expect(special.cover.header_name).toContain('（勘定）');
    expect(general.cover).not.toHaveProperty('account_type');
    expect(general.entries).toHaveLength(1);
  });
});
