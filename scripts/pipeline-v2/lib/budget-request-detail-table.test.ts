import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DETAIL_TABLE_CSV_COLUMNS,
  classifyCode,
  headerBoundary,
  isDetailTablePage,
  parseDetailSource,
  renderRowsCsv,
  renderUnresolvedCsv,
  signedValue,
  splitTail,
  type DetailRow,
} from './budget-request-detail-table';

const read = (dir: string, name: string) => fs.readFileSync(path.join(process.cwd(), dir, `${name}.txt`), 'utf8');
const fixture = (name: string) => read('tests/fixtures/budget-request-detail-table/2024', name);
const parseFixture = (name: string) => parseDetailSource(fixture(name), name);
const totalTableFixture = (name: string) => read('tests/fixtures/budget-request-total-table/2024', name);
const cellsOf = (r: DetailRow) => [r.cells.previous, r.cells.request, r.cells.difference];

describe('page detection and the left/備考 boundary', () => {
  it('detects detail-table pages, not total-table pages or a table-of-contents line', () => {
    expect(isDetailTablePage(fixture('context'))).toBe(true);
    expect(isDetailTablePage(totalTableFixture('mext-02'))).toBe(false);
    expect(isDetailTablePage('        2. 令和６年度歳出概算要求額明細表 ・・・・・・   3')).toBe(false);
  });

  it('takes the column where the 前年度 heading starts as the boundary and ends the header zone at the second heading line', () => {
    const lines = fixture('context').split('\f')[0].split('\n');
    const hb = headerBoundary(lines)!;
    expect(lines[hb.headerEnd]).toMatch(/番\s*号.*予\s*算\s*額.*比\s*較/u);
    expect(hb.boundary).toBe(lines.find(l => l.includes('事') && l.includes('備'))!.indexOf('前'));
  });

  it('refuses to guess on a page without a header boundary: every non-blank line is unresolved', () => {
    const r = parseFixture('no-boundary');
    expect(r.pagesWithoutBoundary).toEqual([1]);
    expect(r.rows).toEqual([]);
    expect(r.unresolved.length).toBe(r.nonBlankLinesInDetailPages);
    expect(new Set(r.unresolved.map(u => u.reason))).toEqual(new Set(['PAGE_WITHOUT_HEADER_BOUNDARY']));
  });
});

describe('rows', () => {
  it('keeps the context line, headings (blank amounts) and items as they are in the raw text', () => {
    const rows = parseFixture('context').rows;
    expect(rows.map(r => [r.row_type, r.matter_raw, cellsOf(r)])).toEqual([
      ['CONTEXT', '9101 東 日 本 大 震 災 復 興 特 別 会 計 （警察庁）', ['', '', '']],
      ['CODE2', '01    東 日 本 大 震 災 復 興', ['', '', '']],
      ['CODE2', '31    復         興   庁', ['', '', '']],
      ['CODE3', '010 復       興      庁', ['232,621', '316,018', '83,397']],
    ]);
  });

  it('joins name continuation lines with a newline and keeps the request number separate', () => {
    const row = parseFixture('edges').rows.find(r => r.request_no_raw === '101')!;
    expect(row.row_type).toBe('DETAIL');
    expect(row.matter_raw).toBe('12‑49 農業施設災害関連事業に\n必要な経費');
    expect(row.source_line_end - row.source_line_start).toBe(1);
    expect(parseFixture('continuation').rows[0].matter_raw).toBe('49053‑ 825‑00‑5190 河川等災害復旧\n事業費補助');
  });

  it('keeps cell text as it appears, including the spaces between △ and the digits', () => {
    expect(cellsOf(parseFixture('wide-triangle').rows[0])).toEqual(['2,653,302', '2,012,269', '△   641,033']);
    expect(cellsOf(parseFixture('edges').rows[0])).toEqual(['434,640', '0', '△    434,640']);
  });

  it('does not read 備考 text into the left part', () => {
    const r = parseFixture('arith');
    expect(r.rows.every(row => !/[(（]/u.test(row.matter_raw))).toBe(true);
    expect(r.lineClassCounts.RIGHT_REGION).toBe(4);
  });

  it('classifies the code by its form', () => {
    expect([
      classifyCode('95016‑2111‑05‑0710', false), classifyCode('95016‑   2‑08‑2010', false), classifyCode('02‑0100', false),
      classifyCode('01‑95', true), classifyCode('010', false), classifyCode('01', false), classifyCode('1', false),
    ]).toEqual(['CODE_5_4_2_4', 'CODE_5_4_2_4', 'CODE_NN_NNNN', 'DETAIL', 'CODE3', 'CODE2', 'CODE1']);
  });
});

describe('amounts', () => {
  it('splits the amount run from the name and handles △ glued to the previous amount', () => {
    const t = splitTail('在外住居手当                0△    32,160   △    32,160   １   プロパー減');
    expect(t.tokens.map(x => x.raw)).toEqual(['0', '△    32,160', '△    32,160']);
    expect(splitTail('職 員 旅 費           119      144          25 １     健康食品').tokens.map(x => x.raw)).toEqual(['119', '144', '25']);
    expect(splitTail('名称だけの見出し                    （要 求 要 旨）').tokens).toEqual([]);
    expect(signedValue('△   641,033')).toBe(BigInt(-641033));
  });

  it('leaves a blank cell blank and places two amounts by column position when the page has enough rows to calibrate', () => {
    const row = parseFixture('edges').rows.find(r => r.matter_raw.startsWith('49053‑ 825‑00‑5170'))!;
    expect(cellsOf(row)).toEqual(['', '136,000', '136,000']);
    expect(row.parse_status).toBe('AMOUNTS_PLACED_BY_PAGE_EDGES');
  });

  it('places two amounts by the arithmetic only when it decides, and records that', () => {
    const row = parseFixture('arith').rows[0];
    expect(cellsOf(row)).toEqual(['', '274', '274']);
    expect(row.parse_status).toBe('AMOUNTS_PLACED_BY_ARITHMETIC');
  });

  it('sends a two-amount row to unresolved when neither position nor arithmetic decides (0 0), never filling 0', () => {
    const r = parseFixture('undetermined');
    expect(r.unresolved.map(u => u.reason)).toEqual(['BLANK_CELL_COLUMN_UNDETERMINED', 'BLANK_CELL_COLUMN_UNDETERMINED']);
    expect(r.rows.every(row => row.row_type === 'CODE3')).toBe(true);
  });

  it('reports a three-amount row that fails 要求額−前年度＝増減 without rewriting its values', () => {
    const src = fixture('wide-triangle').replace('2,012,269', '2,012,270');
    const r = parseDetailSource(src, 'synthetic');
    expect(r.arithmeticMismatchRows.length).toBe(1);
    expect(cellsOf(r.arithmeticMismatchRows[0])).toEqual(['2,653,302', '2,012,270', '△   641,033']);
    expect(parseFixture('wide-triangle').arithmeticMismatchRows).toEqual([]);
  });
});

describe('left-region text that is not a name continuation', () => {
  it('attaches a fragment only when it is on the physical line right below the row and starts at the name column', () => {
    const r = parseFixture('not-aligned');
    expect(r.rows[0].matter_raw).toBe('100   外国人に対する日本語教\n育の推進');
    const reasons = r.unresolved.map(u => u.reason);
    expect(reasons.filter(x => x === 'LEFT_FRAGMENT_NOT_ADJACENT').length).toBeGreaterThan(20);
    expect(reasons).toContain('LEFT_FRAGMENT_NOT_ALIGNED');
  });

  it('does not attach a fragment that has no preceding row on the page', () => {
    const lines = fixture('continuation').split('\n');
    const headerEnd = lines.findIndex(l => /番\s*号.*予\s*算\s*額/u.test(l));
    const orphan = `${lines.slice(0, headerEnd + 1).join('\n')}\n                必要な経費\n\f`;
    expect(parseDetailSource(orphan, 'synthetic').unresolved.map(u => u.reason)).toEqual(['LEFT_FRAGMENT_WITHOUT_PRECEDING_ROW_ON_PAGE']);
  });
});

describe('accounting and CSV output', () => {
  const names = ['context', 'continuation', 'wide-triangle', 'edges', 'arith', 'undetermined', 'not-aligned', 'no-boundary'];

  it('classifies every non-blank physical line of a detail page exactly once', () => {
    for (const n of names) {
      const r = parseFixture(n);
      expect(Object.values(r.lineClassCounts).reduce((a, b) => a + b, 0), n).toBe(r.nonBlankLinesInDetailPages);
    }
  });

  it('uses the source table headings as column names, with provenance columns last', () => {
    expect([...DETAIL_TABLE_CSV_COLUMNS]).toEqual([
      '要求番号', '事項', '前年度予算額', '６年度概算要求額', '対前年度比較増△減',
      'source_page', 'source_line_start', 'source_line_end', 'row_index', 'row_type', 'parse_status',
    ]);
    expect(DETAIL_TABLE_CSV_COLUMNS).not.toContain('source_file');
    const csv = renderRowsCsv(parseFixture('edges').rows);
    expect(csv.split('\n')[0].split(',')).toEqual([...DETAIL_TABLE_CSV_COLUMNS]);
  });

  it('writes blank cells empty, raw cell text quoted, and multi-line cells quoted', () => {
    const lines = renderRowsCsv(parseFixture('edges').rows).split('\n');
    expect(lines.some(l => l.includes(',"△    434,640",'))).toBe(true);
    expect(lines.some(l => l.startsWith(',"49053‑ 825‑00‑5170 漁港施設災害復\n') || l.startsWith(',"49053‑ 825‑00‑5170 漁港施設災害復'))).toBe(true);
    expect(renderRowsCsv(parseFixture('edges').rows)).toContain(',,"136,000","136,000",');
  });

  it('is deterministic and keeps unresolved raw text', () => {
    expect(renderRowsCsv(parseFixture('edges').rows)).toBe(renderRowsCsv(parseFixture('edges').rows));
    expect(renderUnresolvedCsv(parseFixture('undetermined').unresolved)).toContain('13054‑2202‑08‑2010');
  });
});
