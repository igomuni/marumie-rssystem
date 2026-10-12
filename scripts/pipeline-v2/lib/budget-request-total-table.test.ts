import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  TOTAL_TABLE_CSV_COLUMNS,
  arithmeticMismatches,
  buildBlocks,
  isTotalTablePage,
  parseNumericTail,
  parseRowHead,
  parseSource,
  renderRowsCsv,
  renderUnresolvedCsv,
  type LogicalRow,
} from './budget-request-total-table';

const fixtureDir = path.join(process.cwd(), 'tests/fixtures/budget-request-total-table/2024');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, `${name}.txt`), 'utf8');
const parseFixture = (name: string) => parseSource(fixture(name), name, name);
const amounts = (row: LogicalRow) =>
  Object.values(row.cells).map(c => `${c.sign_raw}${c.amount_raw}`);

// Header zone of a real total-table page (mext p1, lines 0-11) reused for synthetic cases.
const HEADER = fixture('mext-02').split('\f')[0].split('\n').slice(0, 12).join('\n');
const TAIL = '         0        4,383,885         4,383,885                 0          4,915,977        4,915,977             532,092    131';
const DETAIL_ROW = `6     50‑15 客観的根拠に基づく教育政策立案の推進に必                             ${TAIL}`;
const NAME_COL = DETAIL_ROW.indexOf('客');
const page = (...body: string[]) => `${HEADER}\n${body.join('\n')}\n\f`;

describe('total-table page / block detection', () => {
  it('requires the full header signature; a title-only (TOC) page is not a candidate', () => {
    expect(isTotalTablePage(HEADER)).toBe(true);
    expect(isTotalTablePage('        1. 令和６年度歳出概算要求額総表 ・・・・・・   1')).toBe(false);
  });

  it('groups consecutive candidate pages and splits at a non-candidate page', () => {
    expect(buildBlocks([2, 3, 4, 5, 7, 9, 11])).toEqual([[2, 3, 4, 5], [7], [9], [11]]);
    const result = parseSource(`${page(DETAIL_ROW)}cover page\f${page(DETAIL_ROW)}`, 'synthetic', 's');
    expect(result.blocks.map(b => [b.table_block_id, b.pages])).toEqual([['s#b1', [1]], ['s#b2', [3]]]);
  });
});

describe('numeric tail', () => {
  it('captures 7 independently signed cells, including △ outside the difference column', () => {
    const rows = parseFixture('env-000157010').rows;
    const row = rows.find(r => r.name_compact === '定員合理化に伴う経費' && r.code_raw === '003');
    expect(row).toBeDefined();
    expect(amounts(row!)).toEqual(['△22,529', '0', '△22,529', '△5,645', '0', '△5,645', '16,884']);
    expect(row!.cells.previous_general).toEqual({ sign_raw: '△', amount_raw: '22,529' });
    expect(row!.cells.difference).toEqual({ sign_raw: '', amount_raw: '16,884' });
  });

  it('keeps the detail page as a raw string (digits, エ/電/原 prefix) and blank on TOTAL rows', () => {
    const pages = [...parseFixture('env-000157012').rows, ...parseFixture('env-000157013').rows, ...parseFixture('meti-enegen').rows, ...parseFixture('mext-02').rows];
    const pageOf = (pred: (r: LogicalRow) => boolean) => pages.find(pred)?.detail_page_raw;
    expect(pageOf(r => r.detail_page_raw === 'エ 9')).toBe('エ 9');
    expect(pageOf(r => r.detail_page_raw === '電 19')).toBe('電 19');
    expect(pageOf(r => r.detail_page_raw === '原 1')).toBe('原 1');
    expect(pageOf(r => r.request_no_raw === '1' && r.code_raw === '01‑95')).toBe('11');
    const totals = pages.filter(r => r.row_type === 'TOTAL');
    expect(totals.map(r => r.name_compact).sort()).toEqual(['会計計', '会計計', '所管計', '組織計']);
    expect(totals.every(r => r.detail_page_raw === '' && r.parse_status === 'PARSED')).toBe(true);
  });

  it('does not parse 6 amounts as a row', () => {
    expect(parseNumericTail('  010 項目   0   1   2   3   4   5')).toBeNull();
  });
});

describe('row head grammar', () => {
  it('classifies DETAIL before CODE3 so 3-digit request numbers stay DETAIL, and keeps the raw hyphen', () => {
    const rows = parseFixture('mext-02').rows;
    const r99 = rows.find(r => r.request_no_raw === '99');
    expect(r99).toMatchObject({ row_type: 'DETAIL', code_raw: '01‑95' });
    expect(r99!.code_raw.charCodeAt(2)).toBe(0x2011);
    expect(rows.find(r => r.request_no_raw === '100')?.row_type).toBe('DETAIL');
    expect(parseRowHead('100    01‑95 独立行政法人国立文化財機構施設整備に必要')?.row_type).toBe('DETAIL');
  });

  it('keeps CODE3 / HIER as physical grammar only', () => {
    expect(parseRowHead('     030 教      育       政   策       推       進       費    ')).toMatchObject({ row_type: 'CODE3', code_raw: '030' });
    const hier = parseFixture('env-000157013').rows.filter(r => r.row_type === 'HIER');
    expect(hier.map(r => [r.code_raw, r.name_compact])).toEqual([['05', 'エネルギー対策'], ['2', '電源開発促進勘定']]);
  });
});

describe('continuation assembly (representative fixture: mext 総表)', () => {
  const result = parseFixture('mext-02');

  it('merges DETAIL and CODE3 continuations with traceable line ranges', () => {
    const detail = result.rows.find(r => r.request_no_raw === '6')!;
    expect(detail).toMatchObject({ row_type: 'DETAIL', source_line_start: 22, source_line_end: 23 });
    expect(detail.name_raw).toBe('客観的根拠に基づく教育政策立案の推進に必\n要な経費');
    expect(detail.name_compact).toBe('客観的根拠に基づく教育政策立案の推進に必要な経費');
    const code3 = result.rows.find(r => r.row_type === 'CODE3' && r.code_raw === '110')!;
    expect(code3).toMatchObject({ source_page: 2, continuationLines: 1, name_compact: '独立行政法人国立特別支援教育総合研究所運営費' });
  });

  it('treats repeated headers and page labels on continuation pages as known skip classes', () => {
    expect(result.blocks.map(b => b.pages)).toEqual([[1, 2, 3, 4]]);
    expect(result.blocks[0].titlePages).toEqual([1]);
    for (const p of [1, 2, 3, 4]) {
      expect(result.audit.filter(a => a.source_page === p && a.line_class === 'TABLE_HEADER').length).toBe(6);
      expect(result.audit.filter(a => a.source_page === p && a.line_class === 'PAGE_LABEL').length).toBe(1);
    }
    expect(result.unresolved).toEqual([]);
    expect(result.rows.filter(r => r.row_type === 'TOTAL').map(r => r.name_compact)).toEqual(['組織計', '所管計']);
  });

  it('accounts for every non-blank line of candidate pages exactly once (no silent drop)', () => {
    const nonBlank = fixture('mext-02').split('\f').flatMap(p => p.split('\n')).filter(l => l.trim() !== '').length;
    expect(result.audit.length).toBe(nonBlank);
    expect(new Set(result.audit.map(a => a.source_line)).size).toBe(result.audit.length);
    const rows = result.audit.filter(a => a.line_class === 'ROW').length;
    const conts = result.audit.filter(a => a.line_class === 'CONTINUATION').length;
    expect([rows, conts]).toEqual([result.rows.length, result.rows.reduce((n, r) => n + r.continuationLines, 0)]);
  });
});

describe('unresolved rules (synthetic, built on a real header zone)', () => {
  const reasons = (text: string) => parseSource(text, 'synthetic', 's').unresolved.map(u => u.reason);

  it('accepts a continuation only directly below, at the exact name column', () => {
    expect(reasons(page(DETAIL_ROW, `${' '.repeat(NAME_COL)}要な経費`))).toEqual([]);
    expect(reasons(page(DETAIL_ROW, `${' '.repeat(NAME_COL + 2)}要な経費`))).toEqual(['AMBIGUOUS_CONTINUATION']);
    expect(reasons(page(DETAIL_ROW, '', `${' '.repeat(NAME_COL)}要な経費`))).toEqual(['UNKNOWN_NON_NUMERIC_ROW']);
  });

  it('does not append text to HIER/TOTAL rows or across a page boundary', () => {
    const hier = `     2      電       源       開       発   促           進       勘       定    ${TAIL}`;
    expect(reasons(page(hier, `${' '.repeat(hier.indexOf('電'))}続き`))).toEqual(['UNKNOWN_NON_NUMERIC_ROW']);
    const nextPage = page(`${' '.repeat(NAME_COL)}要な経費`);
    expect(reasons(page(DETAIL_ROW) + nextPage)).toEqual(['UNKNOWN_NON_NUMERIC_ROW']);
  });

  it('keeps malformed tails, unknown heads and ambiguous heads out of the main CSV', () => {
    const partial = `6     50‑15 名称                0        4,383,885         4,383,885                 0`;
    const unknownHead = `ABC 予算 ${TAIL}`;
    // 9 trailing numbers: one more than 7 cells + page, so the head would end with a number.
    const headEndsWithNumber = `     010 名称   5   0   1   1   0   2   2   1   9`;
    const result = parseSource(page(partial, unknownHead, headEndsWithNumber), 'synthetic', 's');
    expect(result.rows).toEqual([]);
    expect(result.unresolved.map(u => u.reason)).toEqual(['MALFORMED_NUMERIC_TAIL', 'UNMATCHED_NUMERIC_HEAD', 'NUMERIC_TAIL_AMBIGUOUS_HEAD_ENDS_WITH_NUMBER']);
    expect(renderUnresolvedCsv(result.unresolved).split('\n')[1]).toContain('MALFORMED_NUMERIC_TAIL');
  });

  it('reads 8 trailing numbers as 7 cells + detail page (a name ending in an ASCII number is not distinguishable)', () => {
    // Documented residual ambiguity: FY2024 names contain no ASCII digits and arithmetic diagnostics show no column shift.
    const row = parseSource(page(`     010 第 5     0   1   1   0   2   2   1`), 'synthetic', 's').rows[0];
    expect([row.name_compact, row.cells.previous_general.amount_raw, row.detail_page_raw]).toEqual(['第', '5', '1']);
  });

  it('flags an unknown line inside the header zone', () => {
    const lines = HEADER.split('\n');
    lines.splice(5, 0, '  注記：これは表頭ではない行');
    expect(reasons(`${lines.join('\n')}\n${DETAIL_ROW}\n\f`)).toEqual(['UNKNOWN_HEADER_ZONE_LINE']);
  });
});

describe('CSV output', () => {
  const rowsOf = (csv: string) => csv.trimEnd().split('\n').slice(1);

  it('uses the source table headings as column names, with provenance columns last', () => {
    const csv = renderRowsCsv(parseFixture('mext-02').rows);
    expect(csv.split('\n')[0].split(',')).toEqual([...TOTAL_TABLE_CSV_COLUMNS]);
    expect([...TOTAL_TABLE_CSV_COLUMNS].slice(0, 10)).toEqual([
      '要求番号', '区分',
      '前年度予算額_一般行政経費', '前年度予算額_その他の経費', '前年度予算額_計',
      '６年度概算要求額_一般行政経費', '６年度概算要求額_その他の経費', '６年度概算要求額_計',
      '増△減', '明細書頁数',
    ]);
    expect([...TOTAL_TABLE_CSV_COLUMNS].slice(10)).toEqual(['source_file', 'source_page', 'source_line_start', 'source_line_end', 'table_block_id', 'row_index', 'row_type', 'parse_status']);
  });

  it('writes 区分 as code + name without letter spacing, and amounts as the source text', () => {
    const csv = renderRowsCsv(parseFixture('mext-02').rows);
    expect(csv).toContain('客観的根拠に基づく教育政策立案の推進に必要な経費');
    expect(csv).not.toContain('\n要な経費');
    expect(csv).toContain(',"95,208,241",');
    const row = parseFixture('mext-02').rows.find(r => r.cells.difference.sign_raw === '△')!;
    expect(rowsOf(renderRowsCsv([row]))[0]).toContain(`,"△${row.cells.difference.amount_raw}",`);
  });

  it('keeps 区分 as the name only for TOTAL rows and leaves absent values empty', () => {
    const rows = parseFixture('mext-02').rows;
    const total = rows.find(r => r.row_type === 'TOTAL')!;
    expect(rowsOf(renderRowsCsv([total]))[0].split(',')[1]).toBe(total.name_compact);
    expect(total.request_no_raw).toBe('');
    expect(rowsOf(renderRowsCsv([total]))[0].startsWith(',')).toBe(true);
  });

  it('is deterministic', () => {
    expect(renderRowsCsv(parseFixture('env-000157012').rows)).toBe(renderRowsCsv(parseFixture('env-000157012').rows));
  });
});

describe('calculation-only validation', () => {
  it('reports mismatches without rewriting extracted values', () => {
    const rows = ['mext-02', 'env-000157010', 'env-000157012', 'env-000157013', 'meti-enegen'].flatMap(n => parseFixture(n).rows);
    expect(rows.flatMap(arithmeticMismatches)).toEqual([]);
    const row = structuredClone(rows[0]);
    row.cells.difference = { sign_raw: '', amount_raw: '1' };
    expect(arithmeticMismatches(row).map(m => m.check)).toEqual(['request_total-previous_total=difference']);
    expect(row.cells.difference.amount_raw).toBe('1');
  });
});
