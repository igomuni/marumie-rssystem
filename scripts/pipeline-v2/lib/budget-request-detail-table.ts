/**
 * 令和6年度歳出概算要求額明細表 raw text → logical row parser (v0, deterministic, no LLM). 備考 is out of scope.
 *
 * Input is pdftotext plain text (pages separated by Form Feed). Only the left part of the table is read:
 * 要求番号, 事項, 前年度予算額, ６年度概算要求額, 対前年度比較増△減. Names and amounts have their whitespace removed (the
 * letter spacing of a name and the spaces between △ and the digits carry no information), like the total table. The
 * code is kept exactly as in the raw text: a shortened middle group with spaces (e.g. `95016‑ 815‑16‑7878`) is an
 * extraction defect that must stay visible, not be "repaired". Blank cells stay blank (no 0, no sign completion, no
 * value from other rows/pages).
 * Where a blank cell is in a 2-amount row, the amounts are placed by column position only (recorded in parse_status);
 * rows whose columns cannot be determined from the position go to unresolved. The arithmetic is used only as a check
 * after extraction, never to decide which column holds a value.
 *
 * 備考 on the same physical line is not read: a number is an amount only if it ends in the window of an amount column
 * (from the header words, or the page's measured edges once enough consistent rows that pass the header windows exist).
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

/** [lo, hi] columns (inclusive) where the right end of an amount in a column may lie. */
export type Window = [number, number];

/**
 * Where the right edge of each amount column lies relative to the right end of its heading word on the second heading
 * line (FY2024, 4,376 pages measured from their rows): 前年度 −2…+3 (予算額), 要求額 0…+14 (概算要求額),
 * 比較 +2…+14 (比較増△減); a margin of 2 is added. This is header geometry only; it does not read any body row, so a
 * 備考 number can never influence it.
 */
const HEADER_WORD_WINDOWS: readonly [RegExp, Window][] = [
  [/予\s*算\s*額/u, [-4, 5]],
  [/概算要求額/u, [-2, 16]],
  [/比\s*較\s*(?:増\s*△?\s*減?)?/u, [0, 16]],
];

/**
 * Geometry taken from the two heading lines. `boundary` = column where the 前年度予算額 heading starts (everything that
 * starts at or right of it belongs to the amount columns or to 備考; names of the left part end before it).
 * `remarksStart` = column where the 備考 heading starts. `windows` = the columns where the three amounts may end.
 * A page whose second heading line lacks one of the three heading words has no boundary.
 */
export function headerBoundary(lines: string[]): { boundary: number; remarksStart: number; windows: Window[]; headerEnd: number } | null {
  const first = lines.findIndex(l => {
    const c = compact(l);
    if (!(c.includes('事項') && c.includes('前年度') && c.includes('備考'))) return false;
    const q = l.indexOf('前');
    return q > 0 && q < l.indexOf('備');
  });
  if (first < 0) return null;
  const end = lines.findIndex((l, i) => i >= first && HEADER_2.test(l));
  if (end < 0) return null;
  const windows: Window[] = [];
  for (const [re, [lo, hi]] of HEADER_WORD_WINDOWS) {
    const m = re.exec(lines[end]);
    if (!m) return null;
    const wordEnd = m.index + m[0].length;
    windows.push([wordEnd + lo, wordEnd + hi]);
  }
  return { boundary: lines[first].indexOf('前'), remarksStart: lines[first].indexOf('備'), windows, headerEnd: end };
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
  /**
   * Code as in the raw text (inner whitespace kept) + one space + the name without whitespace. Continuation lines are
   * appended to the name without a separator (the lines are in source_line_start..source_line_end).
   */
  matter: string;
  /**
   * The printed page label of the page the row is on (the first non-blank line of the page: a page number with a
   * section mark, e.g. `厚（本）13`, `14厚（本）`, `1058国（保）`, `97`), without whitespace; '' = the page has no label.
   * The total table's 明細書頁数 refers to these page numbers.
   */
  page_label: string;
  /** Amount text without whitespace (△ kept in front of the digits); '' = the cell is blank in the raw text. */
  cells: Record<AmountColumn, string>;
  parse_status: 'PARSED' | 'AMOUNTS_PLACED_BY_PAGE_EDGES';
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
/** Whitespace-free text (amounts, names). */
const squeeze = (s: string): string => s.replace(/[\s　]+/gu, '');
/** `code name`: the code is kept as in the raw text, the name loses its letter spacing. */
const joinMatter = (code: string, name: string): string => (compact(name) === '' ? code : `${code} ${compact(name)}`);
/**
 * 備考 on the same physical line must not be read as amounts. Its heading starts far right of where 備考 text starts
 * (FY2024: 99.9% of the 備考 text on a row line starts left of it), so the 備考 heading cannot be the cut. A number is
 * an amount only if its right end lies in the window of an amount column (the measured right edge ±3 when the page has
 * enough consistent rows, else the header-geometry window), taking the columns in order. The measured edges are
 * calibrated only from rows that pass this same header-window test, so 備考 numbers cannot shape the calibration.
 */
const EDGE_SPREAD_MAX = 5;
/** A measured edge accepts an amount whose right end is within the observed spread of it (placement of a blank cell is stricter: ±EDGE_TOLERANCE). */
const EDGE_ACCEPT = EDGE_SPREAD_MAX + 1;
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

/**
 * Keeps the amounts of a run: tokens are assigned in order to distinct amount columns, each token's right end having to
 * lie in the window of its column; the first token that fits no remaining column (and everything after it) is 備考.
 * A run of 備考 numbers cannot pass: its first number would have to end in the 前年度 window (or the next ones in the
 * following windows), which lie far left of where 備考 starts.
 */
export function acceptAmounts(tokens: AmountToken[], offset: number, windows: Window[]): AmountToken[] {
  const out: AmountToken[] = [];
  let col = -1;
  for (const t of tokens) {
    const end = offset + t.end;
    let next = -1;
    for (let k = col + 1; k < windows.length; k++) {
      if (end >= windows[k][0] && end <= windows[k][1]) { next = k; break; }
    }
    if (next < 0) break;
    out.push(t);
    col = next;
  }
  return out;
}

/**
 * `windows`: the columns where the amounts of this page may end. The line is tokenized as a whole and then filtered;
 * cutting the string would create an artificial line end and change how a number right at the cut is tokenized.
 */
function parseHeadLine(index: number, line: string, windows: Window[]): ParsedLine | null {
  const head = HEAD.exec(line);
  if (!head) return null;
  const restStart = head.indices![4][0];
  const split = splitTail(line.slice(restStart));
  const tokens = acceptAmounts(split.tokens, restStart, windows);
  return { index, line, head, tokens, nameEnd: restStart + split.nameEnd, ends: tokens.map(t => restStart + t.end) };
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
    const { boundary: q, remarksStart, windows: headerWindows, headerEnd } = hb;

    // Column right edges of this page, measured from rows whose three amounts pass the header-window test and the
    // arithmetic. Only if there are at least three such rows and their edges agree (spread ≤ 5) is the page measured;
    // the measured edges (±3) then replace the header windows. The windows never reach right of the 備考 heading.
    const clamp = (w: Window): Window => [Math.min(w[0], remarksStart), Math.min(w[1], remarksStart)];
    const guard = headerWindows.map(clamp);
    const edgeSamples: number[][] = [[], [], []];
    lines.forEach((l, i) => {
      if (i <= headerEnd || l.trim() === '' || l.length - l.trimStart().length >= q) return;
      const p = parseHeadLine(i, l, guard);
      if (p && p.tokens.length === 3 && signedValue(p.tokens[2].raw) === signedValue(p.tokens[1].raw) - signedValue(p.tokens[0].raw)) {
        p.ends.forEach((e, k) => edgeSamples[k].push(e));
      }
    });
    const measurable = edgeSamples[0].length >= 3 && edgeSamples.every(xs => Math.max(...xs) - Math.min(...xs) <= EDGE_SPREAD_MAX);
    const edges = measurable ? edgeSamples.map(median) : null;
    const pageWindows: Window[] = edges ? edges.map(e => clamp([e - EDGE_ACCEPT, e + EDGE_ACCEPT])) : guard;

    const firstNonBlank = lines.findIndex(l => l.trim() !== '');
    let pageLabel = '';
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
            row_index: ++rowIndex, row_type: 'CONTEXT', request_no_raw: '', page_label: pageLabel, matter: joinMatter(l.trim().match(/^[0-9]{1,4}/u)![0], l.trim().replace(/^[0-9]{1,4}\s+/u, '')),
            cells: { previous: '', request: '', difference: '' }, parse_status: 'PARSED', continuationLines: 0,
          });
          tally('ROW');
          open = null;
        } else if (i === firstNonBlank) { pageLabel = squeeze(l); tally('PAGE_LABEL'); }
        else unresolved(i, 'UNKNOWN_HEADER_ZONE_LINE');
        return;
      }
      if (FOOTER_TIMESTAMP.test(l)) { tally('FOOTER_TIMESTAMP'); return; }
      if (indent >= q) { tally('RIGHT_REGION'); return; }

      const crosses = l.length > q && l[q - 1].trim() !== '' && l[q].trim() !== '';
      const p = parseHeadLine(i, l, pageWindows);

      if (!p) {
        // Left-region text without a code: a continuation of the name of the row on the physical line right above
        // (or of that row's previous continuation), starting at the same column as the name. 備考 tables can also
        // start in the left region, so anything that is not directly adjacent and aligned stays unresolved.
        if (crosses) { unresolved(i, 'LEFT_TEXT_CROSSES_BOUNDARY'); return; }
        if (!open) { unresolved(i, 'LEFT_FRAGMENT_WITHOUT_PRECEDING_ROW_ON_PAGE'); return; }
        if (open.lastLine !== i - 1) { unresolved(i, 'LEFT_FRAGMENT_NOT_ADJACENT'); return; }
        if (Math.abs(indent - open.nameStart) > 1) { unresolved(i, 'LEFT_FRAGMENT_NOT_ALIGNED'); return; }
        open.row.matter += compact(l.slice(0, q));
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
          cells = { previous: squeeze(p.tokens[0].raw), request: squeeze(p.tokens[1].raw), difference: squeeze(p.tokens[2].raw) };
        } else if (n === 2) {
          // A blank cell is placed only by what the raw text shows: each token's right edge must be within ±3
          // characters of exactly one amount column of this page. The arithmetic is never used to decide which
          // column holds a value (it is only a check after extraction).
          let placed: AmountColumn[] | null = null;
          if (edges) {
            const cols = p.ends.map(e => {
              const near = [0, 1, 2].filter(k => Math.abs(e - edges[k]) <= EDGE_TOLERANCE);
              return near.length === 1 ? near[0] : -1;
            });
            if (cols[0] >= 0 && cols[1] >= 0 && cols[0] !== cols[1]) placed = cols.map(k => AMOUNT_COLUMNS[k]);
          }
          if (!placed) { unresolved(i, 'BLANK_CELL_COLUMN_UNDETERMINED'); open = null; return; }
          placed.forEach((col, k) => { cells[col] = squeeze(p.tokens[k].raw); });
          status = 'AMOUNTS_PLACED_BY_PAGE_EDGES';
        } else {
          unresolved(i, 'UNEXPECTED_AMOUNT_COUNT');
          open = null;
          return;
        }
      }

      const row: DetailRow = {
        source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i,
        row_index: ++rowIndex, row_type: classifyCode(p.head[3], requestNo !== ''), request_no_raw: requestNo, page_label: pageLabel,
        matter: joinMatter(p.head[3], l.slice(p.head.indices![4][0], matterEnd)), cells, parse_status: status, continuationLines: 0,
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
  '要求番号', '事項', '前年度予算額', '６年度概算要求額', '対前年度比較増△減', '頁',
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
    r.request_no_raw, r.matter, r.cells.previous, r.cells.request, r.cells.difference, r.page_label,
    r.source_page, r.source_line_start, r.source_line_end, r.row_index, r.row_type, r.parse_status,
  ]));
  return [DETAIL_TABLE_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}

export function renderUnresolvedCsv(lines: UnresolvedLine[]): string {
  const body = lines.map(u => csvLine([u.source_file, u.source_page, u.source_line_start, u.source_line_end, u.raw_text, u.reason]));
  return [UNRESOLVED_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}
