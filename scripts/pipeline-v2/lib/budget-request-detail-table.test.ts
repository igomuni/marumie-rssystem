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

  it('reads a page whose heading is three lines (要求/前年度 · 番号/事項/備考 · 予算額/概算要求額/比較): context and rows are kept', () => {
    const r = parseFixture('no-boundary'); // 取り込んだ実ページは 3 行の表頭（以前は境界なしとして全行が落ちていた）
    expect(r.pagesWithoutBoundary).toEqual([]);
    expect(r.rows[0].row_type).toBe('CONTEXT');
    expect(r.rows.length).toBeGreaterThan(1);
    expect(r.unresolved.every(u => u.reason !== 'PAGE_WITHOUT_HEADER_BOUNDARY')).toBe(true);
  });

  it('refuses to guess on a page without a header boundary: every non-blank line is unresolved', () => {
    // 2 行目の `番号` を消して、境界が取れないページにする（ページ自体は明細表のページとして検出される）
    const broken = fixture('no-boundary').replace('番号', '');
    const r = parseDetailSource(broken, 'no-boundary-broken');
    expect(r.pagesWithoutBoundary).toEqual([1]);
    expect(r.rows).toEqual([]);
    expect(r.unresolved.length).toBe(r.nonBlankLinesInDetailPages);
    expect(new Set(r.unresolved.map(u => u.reason))).toEqual(new Set(['PAGE_WITHOUT_HEADER_BOUNDARY']));
  });
});

describe('rows', () => {
  it('keeps the context line, headings (blank amounts) and items; the name loses its letter spacing', () => {
    const rows = parseFixture('context').rows;
    expect(rows.map(r => [r.row_type, r.matter, cellsOf(r)])).toEqual([
      ['CONTEXT', '9101 東日本大震災復興特別会計（警察庁）', ['', '', '']],
      ['CODE2', '01 東日本大震災復興', ['', '', '']],
      ['CODE2', '31 復興庁', ['', '', '']],
      ['CODE3', '010 復興庁', ['232,621', '316,018', '83,397']],
    ]);
  });

  it('joins name continuation lines without a separator and keeps the request number separate', () => {
    const row = parseFixture('edges').rows.find(r => r.request_no_raw === '101')!;
    expect(row.row_type).toBe('DETAIL');
    expect(row.matter).toBe('12‑49 農業施設災害関連事業に必要な経費');
    expect(row.source_line_end - row.source_line_start).toBe(1);
    // the code is kept as in the raw text: the middle group is shortened and preceded by spaces (an extraction defect)
    expect(parseFixture('continuation').rows[0].matter).toBe('49053‑ 825‑00‑5190 河川等災害復旧事業費補助');
  });

  it('removes the spaces between △ and the digits and keeps the amount text otherwise', () => {
    expect(cellsOf(parseFixture('wide-triangle').rows[0])).toEqual(['2,653,302', '2,012,269', '△641,033']);
    expect(cellsOf(parseFixture('edges').rows[0])).toEqual(['434,640', '0', '△434,640']);
  });

  it('does not read 備考 text into the left part', () => {
    const r = parseFixture('arith');
    expect(r.rows.every(row => !/[(（]/u.test(row.matter))).toBe(true);
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
    const row = parseFixture('edges').rows.find(r => r.matter.startsWith('49053‑ 825‑00‑5170'))!;
    expect(cellsOf(row)).toEqual(['', '136,000', '136,000']);
    expect(row.parse_status).toBe('AMOUNTS_PLACED_BY_PAGE_EDGES');
  });

  it('never uses the arithmetic to decide which column holds a value: a two-amount row without a position match is unresolved', () => {
    const r = parseFixture('arith');
    expect(r.rows).toEqual([]);
    expect(r.unresolved.map(u => u.reason)).toEqual(['BLANK_CELL_COLUMN_UNDETERMINED']);
    expect(r.unresolved[0].raw_text).toContain('95016‑2122‑08‑2010');
  });

  it('sends a two-amount row to unresolved when the position does not decide (e.g. 0 0), never filling 0', () => {
    const r = parseFixture('undetermined');
    expect(r.unresolved.map(u => u.reason)).toEqual(['BLANK_CELL_COLUMN_UNDETERMINED', 'BLANK_CELL_COLUMN_UNDETERMINED']);
    expect(r.rows.every(row => row.row_type === 'CODE3')).toBe(true);
  });

  it('reports a three-amount row that fails 要求額−前年度＝増減 without rewriting its values', () => {
    const src = fixture('wide-triangle').replace('2,012,269', '2,012,270');
    const r = parseDetailSource(src, 'synthetic');
    expect(r.arithmeticMismatchRows.length).toBe(1);
    expect(cellsOf(r.arithmeticMismatchRows[0])).toEqual(['2,653,302', '2,012,270', '△641,033']);
    expect(parseFixture('wide-triangle').arithmeticMismatchRows).toEqual([]);
  });
});

describe('left-region text that is not a name continuation', () => {
  it('attaches a fragment only when it is on the physical line right below the row and starts at the name column', () => {
    const r = parseFixture('not-aligned');
    expect(r.rows[0].matter).toBe('100 外国人に対する日本語教育の推進');
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

describe('備考 on the same physical line is not read', () => {
  // A real header (the 'edges' page): the three amount columns end in these windows (from the header words only).
  const zone = fixture('edges').split('\n');
  const hb = headerBoundary(zone)!;
  const header = zone.slice(0, hb.headerEnd + 1).join('\n');
  const E = hb.windows.map(([lo, hi]) => Math.round((lo + hi) / 2)); // exclusive right end of each amount column
  const FAR = hb.windows[2][1] + 4; // 備考 text well right of the 比較 window
  const NEAR = E[2] + 2; // 備考 text starting right after the 比較 column
  const line = (head: string, cells: (string | null)[], remark = '', remarkCol = FAR) => {
    const arr: string[] = Array(Math.max(remarkCol + remark.length, E[2]) + 1).fill(' ');
    [...head].forEach((ch, i) => { arr[8 + i] = ch; });
    cells.forEach((c, k) => { if (c !== null) [...c].forEach((ch, i) => { arr[E[k] - c.length + i] = ch; }); });
    [...remark].forEach((ch, i) => { arr[remarkCol + i] = ch; });
    return arr.join('').trimEnd();
  };
  const normal = (n: number) => [
    line('95016‑2111‑05‑0710 手当', ['574', '574', '0']),
    line('95016‑2122‑08‑2010 旅費', ['1,979', '1,988', '9']),
    line('95016‑2123‑09‑1010 庁費', ['58,861', '64,193', '5,332']),
  ].slice(0, n);
  const page = (genuine: number, ...body: string[]) => `${header}\n${[...normal(genuine), ...body].join('\n')}\n\f`;
  const parse = (text: string) => parseDetailSource(text, 'synthetic');
  const named = (r: ReturnType<typeof parse>, prefix: string) => r.rows.filter(x => x.matter.startsWith(prefix));
  const hasAmounts = (r: DetailRow) => cellsOf(r).some(c => c !== '');

  it('reads the synthetic page as designed: the three amounts end in their header windows', () => {
    const r = parse(page(3));
    expect(r.rows.map(x => cellsOf(x))).toEqual([['574', '574', '0'], ['1,979', '1,988', '9'], ['58,861', '64,193', '5,332']]);
    expect(r.unresolved).toEqual([]);
  });

  it('does not read numbers in 備考 as amounts when the left part is a heading', () => {
    for (const col of [FAR, NEAR]) {
      const r = parse(page(3, line('011 経常事務費', [], '1 2 1', col)));
      expect(named(r, '011').some(hasAmounts), `remark at ${col}`).toBe(false);
    }
  });

  it('does not let 備考 numbers that satisfy the arithmetic shape the calibration or become amounts (page with too few genuine rows)', () => {
    for (const genuine of [0, 1]) {
      for (const col of [FAR, NEAR]) {
        // fewer than three genuine three-amount rows (not enough to measure the page), three headings whose 備考 has
        // "100 150 50" (it satisfies the arithmetic), and a genuine two-amount row whose blank cell can only be
        // placed if the page was measured
        const r = parse(page(genuine,
          line('011 経常事務費', [], '100 150 50', col),
          line('012 一般事務費', [], '100 150 50', col),
          line('013 特別事務費', [], '100 150 50', col),
          line('95016‑2129‑06‑0110 諸謝金', ['136', null, '136'])));
        const at = `${genuine} genuine rows, remark at ${col}`;
        expect(['011', '012', '013'].flatMap(p => named(r, p)).some(hasAmounts), at).toBe(false);
        expect(r.rows.some(x => x.parse_status === 'AMOUNTS_PLACED_BY_PAGE_EDGES'), at).toBe(false);
        // the page cannot be measured, so the genuine row is not placed by page edges; the header windows alone place it
        const genuineRow = r.rows.find(x => x.matter.startsWith('95016‑2129‑06‑0110'))!;
        expect(cellsOf(genuineRow), at).toEqual(['136', '', '136']);
        expect(genuineRow.parse_status, at).toBe('AMOUNTS_PLACED_BY_HEADER_WINDOWS');
        expect(r.arithmeticMismatchRows, at).toEqual([]);
      }
    }
  });

  it('does not mix 備考 numbers into the cells of a row that has one or two amounts', () => {
    const one = parse(page(3, line('95016‑2129‑17‑1010 交際費', ['8,262', null, null], '5 5 0')));
    expect(named(one, '95016‑2129‑17‑1010')).toEqual([]);
    expect(one.unresolved.map(u => u.reason)).toEqual(['UNEXPECTED_AMOUNT_COUNT']);
    const two = parse(page(3, line('95016‑2129‑06‑0110 諸謝金', [null, '136', '136'], '7 8 9')));
    expect(cellsOf(named(two, '95016‑2129‑06‑0110')[0])).toEqual(['', '136', '136']);
  });

  it('keeps the three amounts of a row and does not read a 備考 number or text after them', () => {
    for (const remark of ['100 150 50', '1 既定分', '内国旅費']) {
      for (const col of [FAR, NEAR]) {
        const r = parse(page(3, line('006 事務処理費', ['69,676', '75,017', '5,341'], remark, col)));
        expect(cellsOf(named(r, '006')[0]), `${remark} at ${col}`).toEqual(['69,676', '75,017', '5,341']);
        expect(r.arithmeticMismatchRows).toEqual([]);
      }
    }
  });

  it('takes the amount windows from the header words only', () => {
    expect(hb.windows.every(([lo, hi], k) => lo < hi && (k === 0 || lo > hb.windows[k - 1][0]))).toBe(true);
    expect(hb.windows[2][1]).toBeLessThan(hb.remarksStart);
  });
});

describe('printed page label (頁)', () => {
  const labels = (name: string) => [...new Set(parseFixture(name).rows.map(r => r.page_label))];

  it('takes the first non-blank line of the page, without whitespace, whichever side the number is on', () => {
    expect(labels('context')).toEqual(['復興特3']);
    expect(labels('continuation')).toEqual(['6復興特']);
    expect(labels('wide-triangle')).toEqual(['1058国（保）']);
    expect(labels('undetermined')).toEqual(['国（総）523']);
    expect(labels('not-aligned')).toEqual(['1136文（文）']);
  });

  it('keeps a bare number as the label, and gives the CONTEXT row of the page the same label', () => {
    expect(labels('edges')).toEqual(['97']);
    const rows = parseFixture('context').rows;
    expect(rows[0].row_type).toBe('CONTEXT');
    expect(rows.every(r => r.page_label === '復興特3')).toBe(true);
  });

  it('leaves the label empty when the page has no label line, and writes it as the 頁 column', () => {
    const lines = fixture('continuation').split('\n');
    const withoutLabel = lines.filter((l, i) => !(i === lines.findIndex(x => x.trim() !== ''))).join('\n');
    expect(parseDetailSource(withoutLabel, 'synthetic').rows.map(r => r.page_label)).toEqual(['']);
    const csv = renderRowsCsv(parseFixture('edges').rows).split('\n');
    expect(csv[0].split(',')[5]).toBe('頁');
    expect(csv[1]).toContain(',97,');
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
      '要求番号', '事項', '前年度予算額', '６年度概算要求額', '対前年度比較増△減', '頁',
      'source_page', 'source_line_start', 'source_line_end', 'row_index', 'row_type', 'parse_status',
    ]);
    expect(DETAIL_TABLE_CSV_COLUMNS).not.toContain('source_file');
    const csv = renderRowsCsv(parseFixture('edges').rows);
    expect(csv.split('\n')[0].split(',')).toEqual([...DETAIL_TABLE_CSV_COLUMNS]);
  });

  it('writes blank cells empty and amounts without spaces, quoting only cells that contain a comma', () => {
    const lines = renderRowsCsv(parseFixture('edges').rows).split('\n');
    expect(lines.some(l => l.includes(',"△434,640",'))).toBe(true);
    expect(lines.some(l => l.startsWith(',49053‑ 825‑00‑5170 漁港施設災害復旧事業費補助,'))).toBe(true);
    expect(renderRowsCsv(parseFixture('edges').rows)).toContain(',,"136,000","136,000",');
    expect(renderRowsCsv(parseFixture('edges').rows)).not.toContain('\n"');
  });

  it('is deterministic and keeps unresolved raw text', () => {
    expect(renderRowsCsv(parseFixture('edges').rows)).toBe(renderRowsCsv(parseFixture('edges').rows));
    expect(renderUnresolvedCsv(parseFixture('undetermined').unresolved)).toContain('13054‑2202‑08‑2010');
  });
});
