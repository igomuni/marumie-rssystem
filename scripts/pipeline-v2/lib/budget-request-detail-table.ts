/**
 * 令和6年度歳出概算要求額明細表 raw text → logical row parser (v0, deterministic, no LLM). 備考 is out of scope.
 *
 * Input is pdftotext plain text (pages separated by Form Feed). Only the left part of the table is read:
 * 要求番号, 事項, 前年度予算額, ６年度概算要求額, 対前年度比較増△減. Cell text is kept as it appears in the raw
 * text (inner whitespace, △ spacing); blank cells stay blank (no 0, no sign completion, no value from other rows/pages).
 * Where a blank cell is in a 2-amount row, the amounts are placed by column position (or, when that is not
 * available, by the arithmetic) and the way is recorded in parse_status; rows that cannot be placed go to unresolved.
 *
 * Grammar and its FY2024 corpus evidence: docs/budget-request-detail-table-csv.md.
 */
import { compact, splitPages } from './budget-request-total-table';

// ---------- page detection ----------

const DETAIL_HEADER_SIGNATURE = ['事項', '前年度', '比較増', '備考', '予算額', '概算要求額'] as const;
const TOTAL_TABLE_TOKENS = ['一般行政経費', 'その他の経費', '明細書'] as const;

/** Detail-table page: the whitespace-removed text has the detail header vocabulary and is not a total-table page. */
export function isDetailTablePage(pageText: string): boolean {
  const c = compact(pageText);
  return DETAIL_HEADER_SIGNATURE.every(t => c.includes(t)) && !TOTAL_TABLE_TOKENS.every(t => c.includes(t));
}

const HEADER_2 = /番\s*号.*予\s*算\s*額.*比\s*較/u;

/**
 * Column where the 前年度予算額 heading starts on the first header line. Everything that starts at or right of it
 * belongs to the amount columns or to 備考; names of the left part end before it.
 */
export function headerBoundary(lines: string[]): { boundary: number; headerEnd: number } | null {
  const first = lines.findIndex(l => {
    const c = compact(l);
    if (!(c.includes('事項') && c.includes('前年度') && c.includes('備考'))) return false;
    const q = l.indexOf('前');
    return q > 0 && q < l.indexOf('備');
  });
  if (first < 0) return null;
  const end = lines.findIndex((l, i) => i >= first && HEADER_2.test(l));
  if (end < 0) return null;
  return { boundary: lines[first].indexOf('前'), headerEnd: end };
}

// ---------- amounts ----------

/** ASCII digits only: full-width digits belong to names and 備考. △ may be separated from the number by spaces. */
const NUM = '(?:△\\s*)?[0-9][0-9,]*';
export interface AmountToken { raw: string; start: number; end: number }
export interface TailSplit { nameEnd: number; tokens: AmountToken[] }

/**
 * Splits text after the code into the name and the amount tokens. The amount run starts after 2+ spaces (or right
 * before a △); the name ends there. Returns nameEnd = index (in `rest`) where the name ends.
 */
export function splitTail(rest: string): TailSplit {
  const runAt = (from: number): AmountToken[] | null => {
    const m = new RegExp(`^(?:${NUM})(?:\\s*(?:${NUM}))*(?=\\s|$)`, 'u').exec(rest.slice(from));
    if (!m) return null;
    const out: AmountToken[] = [];
    for (const t of m[0].matchAll(new RegExp(NUM, 'gu'))) {
      out.push({ raw: t[0], start: from + t.index!, end: from + t.index! + t[0].length });
    }
    return out;
  };
  for (const g of rest.matchAll(/\s{2,}|(?<=\S)\s(?=△)/gu)) {
    const from = g.index! + g[0].length;
    const tokens = runAt(from);
    if (tokens) return { nameEnd: g.index!, tokens };
  }
  // Amounts glued to the name by a single space (at least two amounts).
  const glued = /\s((?:△\s*)?[0-9][0-9,]*(?:\s*(?:△\s*)?[0-9][0-9,]*)+)(?=\s|$)/u.exec(rest);
  if (glued) {
    const tokens = runAt(glued.index + 1);
    if (tokens && tokens.length >= 2) return { nameEnd: glued.index, tokens };
  }
  return { nameEnd: rest.trimEnd().length, tokens: [] };
}

export const signedValue = (raw: string): bigint => {
  const v = BigInt(raw.replace(/[△\s,]/gu, ''));
  return raw.includes('△') ? -v : v;
};

// ---------- row head ----------

const HY = '[\\u2011-]';
const CODE = `(?:[0-9]{5}${HY}\\s*[0-9]{1,4}${HY}[0-9]{2}${HY}[0-9]{4}|[0-9]{2}${HY}[0-9]{4}|[0-9]{2}${HY}[0-9]{2}|[0-9]{1,3})`;
/** [indent] [要求番号 (only when followed by an NN‑NN code)] code name… */
const HEAD = new RegExp(`^(\\s*)(?:([0-9]{1,3})\\s+(?=[0-9]{2}${HY}[0-9]{2}\\s))?(${CODE})\\s+(\\S.*)$`, 'du');

export type RowType = 'CONTEXT' | 'DETAIL' | 'CODE_5_4_2_4' | 'CODE_NN_NNNN' | 'CODE_NN_NN' | 'CODE3' | 'CODE2' | 'CODE1';

export function classifyCode(code: string, hasRequestNo: boolean): Exclude<RowType, 'CONTEXT'> {
  const c = code.replace(/\s/gu, '');
  if (hasRequestNo) return 'DETAIL';
  if (new RegExp(`^[0-9]{5}${HY}`, 'u').test(c)) return 'CODE_5_4_2_4';
  if (new RegExp(`^[0-9]{2}${HY}[0-9]{4}$`, 'u').test(c)) return 'CODE_NN_NNNN';
  if (new RegExp(`^[0-9]{2}${HY}[0-9]{2}$`, 'u').test(c)) return 'CODE_NN_NN';
  return c.length === 3 ? 'CODE3' : c.length === 2 ? 'CODE2' : 'CODE1';
}

// ---------- line classes ----------

const HEADER_VOCABULARY = /^(?:要求|番号|事項|前年度|６年度|予算額|概算要求額|対前年度|比較増△減|比較増△|比較増|比較|備考)+$/u;
const UNIT_LINE = /単位/u;
const CONTEXT_LINE = /^\s*[0-9]{1,4}\s+\S/u;
const FOOTER_TIMESTAMP = /^\s*[0-9]{4}\/[0-9]{2}\/[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}\s*$/u;

export type LineClass =
  | 'PAGE_LABEL' | 'TABLE_TITLE' | 'CONTEXT' | 'UNIT' | 'TABLE_HEADER' | 'FOOTER_TIMESTAMP'
  | 'ROW' | 'CONTINUATION' | 'RIGHT_REGION' | 'UNRESOLVED';

export type UnresolvedReason =
  | 'PAGE_WITHOUT_HEADER_BOUNDARY'
  | 'UNKNOWN_HEADER_ZONE_LINE'
  | 'UNEXPECTED_AMOUNT_COUNT'
  | 'BLANK_CELL_COLUMN_UNDETERMINED'
  | 'BLANK_CELL_PLACEMENT_CONFLICT'
  | 'LEFT_TEXT_CROSSES_BOUNDARY'
  | 'LEFT_FRAGMENT_NOT_ADJACENT'
  | 'LEFT_FRAGMENT_NOT_ALIGNED'
  | 'LEFT_FRAGMENT_WITHOUT_PRECEDING_ROW_ON_PAGE';

// ---------- records ----------

export type AmountColumn = 'previous' | 'request' | 'difference';
export const AMOUNT_COLUMNS: readonly AmountColumn[] = ['previous', 'request', 'difference'];

export interface DetailRow {
  source_file: string;
  source_page: number;
  source_line_start: number;
  source_line_end: number;
  row_index: number;
  row_type: RowType;
  request_no_raw: string;
  /** Code + name as in the raw text (inner whitespace kept); continuation segments are joined with "\n". */
  matter_raw: string;
  /** Cell text as in the raw text; '' = the cell is blank in the raw text. */
  cells: Record<AmountColumn, string>;
  parse_status: 'PARSED' | 'AMOUNTS_PLACED_BY_PAGE_EDGES' | 'AMOUNTS_PLACED_BY_ARITHMETIC';
  continuationLines: number;
}

export interface UnresolvedLine {
  source_file: string;
  source_page: number;
  source_line_start: number;
  source_line_end: number;
  raw_text: string;
  reason: UnresolvedReason;
}

export interface SourceResult {
  source_file: string;
  pageCount: number;
  detailPages: number[];
  pagesWithoutBoundary: number[];
  rows: DetailRow[];
  unresolved: UnresolvedLine[];
  lineClassCounts: Record<string, number>;
  nonBlankLinesInDetailPages: number;
  /** Rows whose three amounts are all present but 要求額−前年度≠増減 (values are never rewritten). */
  arithmeticMismatchRows: DetailRow[];
}

const EDGE_TOLERANCE = 3;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface ParsedLine {
  index: number;
  line: string;
  head: RegExpExecArray;
  tokens: AmountToken[];
  /** index in `line` where the name ends (before the amount run) */
  nameEnd: number;
  /** absolute index in `line` of each amount token end */
  ends: number[];
}

function parseHeadLine(index: number, line: string): ParsedLine | null {
  const head = HEAD.exec(line);
  if (!head) return null;
  const restStart = head.indices![4][0];
  const { nameEnd, tokens } = splitTail(line.slice(restStart));
  return { index, line, head, tokens, nameEnd: restStart + nameEnd, ends: tokens.map(t => restStart + t.end) };
}

/** Parse one source text. `sourceFile` is a stable identifier (archive entry path). */
export function parseDetailSource(text: string, sourceFile: string): SourceResult {
  const { pages } = splitPages(text);
  // 1-based file line number of each page's first line (FF is not a newline).
  const pageFirstLine: number[] = [];
  let lineNo = 1;
  for (const page of pages) {
    pageFirstLine.push(lineNo);
    lineNo += page.match(/\n/gu)?.length ?? 0;
  }

  const result: SourceResult = {
    source_file: sourceFile, pageCount: pages.length, detailPages: [], pagesWithoutBoundary: [],
    rows: [], unresolved: [], lineClassCounts: {}, nonBlankLinesInDetailPages: 0, arithmeticMismatchRows: [],
  };
  const tally = (cls: LineClass) => { result.lineClassCounts[cls] = (result.lineClassCounts[cls] ?? 0) + 1; };
  let rowIndex = 0;

  pages.forEach((pageText, pi) => {
    if (!isDetailTablePage(pageText)) return;
    const pageNo = pi + 1;
    result.detailPages.push(pageNo);
    const lines = pageText.split('\n').map(l => l.replace(/\f/gu, ''));
    const firstLineNo = pageFirstLine[pi];
    result.nonBlankLinesInDetailPages += lines.filter(l => l.trim() !== '').length;
    const unresolved = (i: number, reason: UnresolvedReason) => {
      result.unresolved.push({ source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i, raw_text: lines[i], reason });
      tally('UNRESOLVED');
    };

    const hb = headerBoundary(lines);
    if (!hb) {
      result.pagesWithoutBoundary.push(pageNo);
      lines.forEach((l, i) => { if (l.trim() !== '') unresolved(i, 'PAGE_WITHOUT_HEADER_BOUNDARY'); });
      return;
    }
    const { boundary: q, headerEnd } = hb;

    // Column right edges of this page, from rows whose three amounts are all present and satisfy the arithmetic.
    const edgeSamples: number[][] = [[], [], []];
    lines.forEach((l, i) => {
      if (i <= headerEnd || l.trim() === '' || l.length - l.trimStart().length >= q) return;
      const p = parseHeadLine(i, l);
      if (p && p.tokens.length === 3 && signedValue(p.tokens[2].raw) === signedValue(p.tokens[1].raw) - signedValue(p.tokens[0].raw)) {
        p.ends.forEach((e, k) => edgeSamples[k].push(e));
      }
    });
    const edges = edgeSamples[0].length >= 3 ? edgeSamples.map(median) : null;

    const firstNonBlank = lines.findIndex(l => l.trim() !== '');
    let open: { row: DetailRow; nameStart: number; lastLine: number } | null = null;

    lines.forEach((l, i) => {
      if (l.trim() === '') return;
      const c = compact(l);
      const indent = l.length - l.trimStart().length;

      if (i <= headerEnd) {
        if (HEADER_VOCABULARY.test(c)) tally('TABLE_HEADER');
        else if (c.includes('概算要求額明細表')) tally('TABLE_TITLE');
        else if (UNIT_LINE.test(c)) tally('UNIT');
        else if ((c.includes('所管') || c.includes('会計')) && CONTEXT_LINE.test(l)) {
          result.rows.push({
            source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i,
            row_index: ++rowIndex, row_type: 'CONTEXT', request_no_raw: '', matter_raw: l.trim(),
            cells: { previous: '', request: '', difference: '' }, parse_status: 'PARSED', continuationLines: 0,
          });
          tally('ROW');
          open = null;
        } else if (i === firstNonBlank) tally('PAGE_LABEL');
        else unresolved(i, 'UNKNOWN_HEADER_ZONE_LINE');
        return;
      }
      if (FOOTER_TIMESTAMP.test(l)) { tally('FOOTER_TIMESTAMP'); return; }
      if (indent >= q) { tally('RIGHT_REGION'); return; }

      const crosses = l.length > q && l[q - 1].trim() !== '' && l[q].trim() !== '';
      const p = parseHeadLine(i, l);

      if (!p) {
        // Left-region text without a code: a continuation of the name of the row on the physical line right above
        // (or of that row's previous continuation), starting at the same column as the name. 備考 tables can also
        // start in the left region, so anything that is not directly adjacent and aligned stays unresolved.
        if (crosses) { unresolved(i, 'LEFT_TEXT_CROSSES_BOUNDARY'); return; }
        if (!open) { unresolved(i, 'LEFT_FRAGMENT_WITHOUT_PRECEDING_ROW_ON_PAGE'); return; }
        if (open.lastLine !== i - 1) { unresolved(i, 'LEFT_FRAGMENT_NOT_ADJACENT'); return; }
        if (Math.abs(indent - open.nameStart) > 1) { unresolved(i, 'LEFT_FRAGMENT_NOT_ALIGNED'); return; }
        open.row.matter_raw += `\n${l.slice(0, q).trim()}`;
        open.row.source_line_end = firstLineNo + i;
        open.row.continuationLines++;
        open.lastLine = i;
        tally('CONTINUATION');
        return;
      }

      const requestNo = p.head[2] ?? '';
      const codeStart = p.head.indices![3][0];
      const n = p.tokens.length;
      let cells: Record<AmountColumn, string> = { previous: '', request: '', difference: '' };
      let status: DetailRow['parse_status'] = 'PARSED';
      let matterEnd: number;

      if (n === 0) {
        // Heading: only the part left of the boundary is the 事項 cell (the rest of the line is 備考).
        if (crosses) { unresolved(i, 'LEFT_TEXT_CROSSES_BOUNDARY'); open = null; return; }
        matterEnd = q;
      } else {
        matterEnd = p.nameEnd;
        if (n === 3) {
          cells = { previous: p.tokens[0].raw, request: p.tokens[1].raw, difference: p.tokens[2].raw };
        } else if (n === 2) {
          const [x, y] = p.tokens.map(t => signedValue(t.raw));
          // By position: each token's right edge must be within ±3 characters of exactly one column of this page.
          let byEdges: AmountColumn[] | null = null;
          if (edges) {
            const cols = p.ends.map(e => {
              const near = [0, 1, 2].filter(k => Math.abs(e - edges[k]) <= EDGE_TOLERANCE);
              return near.length === 1 ? near[0] : -1;
            });
            if (cols[0] >= 0 && cols[1] >= 0 && cols[0] !== cols[1]) byEdges = cols.map(k => AMOUNT_COLUMNS[k]);
          }
          // By arithmetic: x==y → 前年度 blank (tokens are 要求額, 増減); x==−y → 要求額 blank (tokens are 前年度, 増減).
          let byArithmetic: AmountColumn[] | null = null;
          if (x === y && x !== BigInt(0)) byArithmetic = ['request', 'difference'];
          else if (x === -y && x !== BigInt(0)) byArithmetic = ['previous', 'difference'];
          if (byEdges && byArithmetic && byEdges.join() !== byArithmetic.join()) { unresolved(i, 'BLANK_CELL_PLACEMENT_CONFLICT'); open = null; return; }
          const placed = byEdges ?? byArithmetic;
          if (!placed) { unresolved(i, 'BLANK_CELL_COLUMN_UNDETERMINED'); open = null; return; }
          placed.forEach((col, k) => { cells[col] = p.tokens[k].raw; });
          status = byEdges ? 'AMOUNTS_PLACED_BY_PAGE_EDGES' : 'AMOUNTS_PLACED_BY_ARITHMETIC';
        } else {
          unresolved(i, 'UNEXPECTED_AMOUNT_COUNT');
          open = null;
          return;
        }
      }

      const row: DetailRow = {
        source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i,
        row_index: ++rowIndex, row_type: classifyCode(p.head[3], requestNo !== ''), request_no_raw: requestNo,
        matter_raw: l.slice(codeStart, matterEnd).trimEnd(), cells, parse_status: status, continuationLines: 0,
      };
      result.rows.push(row);
      tally('ROW');
      open = { row, nameStart: p.head.indices![4][0], lastLine: i };
      if (n === 3 && signedValue(cells.request) - signedValue(cells.previous) !== signedValue(cells.difference)) result.arithmeticMismatchRows.push(row);
    });
  });
  return result;
}

// ---------- CSV rendering ----------

/**
 * 明細表の見出し（表頭の原文。文字間の空白は除く）を列名にし、行の出所をたどる列を末尾に置く。
 * source_file 列は持たない（ソース別 CSV のファイル名 `<slug>.csv` で判別する）。
 */
export const DETAIL_TABLE_CSV_COLUMNS = [
  '要求番号', '事項', '前年度予算額', '６年度概算要求額', '対前年度比較増△減',
  'source_page', 'source_line_start', 'source_line_end', 'row_index', 'row_type', 'parse_status',
] as const;

export const UNRESOLVED_CSV_COLUMNS = ['source_file', 'source_page', 'source_line_start', 'source_line_end', 'raw_text', 'reason'] as const;

export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (values: unknown[]) => values.map(csvCell).join(',');

export function renderRowsCsv(rows: DetailRow[]): string {
  const body = rows.map(r => csvLine([
    r.request_no_raw, r.matter_raw, r.cells.previous, r.cells.request, r.cells.difference,
    r.source_page, r.source_line_start, r.source_line_end, r.row_index, r.row_type, r.parse_status,
  ]));
  return [DETAIL_TABLE_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}

export function renderUnresolvedCsv(lines: UnresolvedLine[]): string {
  const body = lines.map(u => csvLine([u.source_file, u.source_page, u.source_line_start, u.source_line_end, u.raw_text, u.reason]));
  return [UNRESOLVED_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}
