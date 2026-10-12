/**
 * 令和6年度歳出概算要求額総表 raw text → logical row parser (v0, deterministic, no LLM).
 *
 * Input is pdftotext plain text (pages separated by Form Feed). The parser only extracts values
 * that appear in the raw text: no sign completion, no blank→0, no cross-row/page inference.
 *
 * Pipeline: page split → total-table page classifier → table block builder →
 * physical line classifier → numeric-tail parser → row-head parser → continuation assembler.
 * Grammar and its FY2024 corpus evidence: docs/budget-request-total-table-csv.md.
 */

// ---------- page / block detection ----------

/** Every token must appear in the whitespace-removed page text. Title alone is NOT used (it also appears on cover/TOC pages). */
export const TOTAL_TABLE_HEADER_SIGNATURE = [
  '前年度予算額', '６年度概算要求額', '一般行政経費', 'その他の経費', '対前年度', '比較', '増△減', '明細書', '頁数',
] as const;

export const TOTAL_TABLE_TITLE = /令\s*和\s*[６6]\s*年\s*度\s*歳\s*出\s*概\s*算\s*要\s*求\s*額\s*総\s*表/u;

export const compact = (s: string): string => s.replace(/[\s　]+/gu, '');

export function isTotalTablePage(pageText: string): boolean {
  const c = compact(pageText);
  return TOTAL_TABLE_HEADER_SIGNATURE.every(token => c.includes(token));
}

/** Split on Form Feed. pdftotext ends every page with FF, so the trailing empty chunk is not a page. */
export function splitPages(text: string): { pages: string[]; endsWithFormFeed: boolean } {
  const parts = text.split('\f');
  const endsWithFormFeed = text.endsWith('\f');
  if (endsWithFormFeed) parts.pop();
  return { pages: parts, endsWithFormFeed };
}

/** Consecutive candidate pages form one block; a non-candidate page always closes the block. Pages are 1-based. */
export function buildBlocks(candidatePages: number[]): number[][] {
  const blocks: number[][] = [];
  for (const page of [...candidatePages].sort((a, b) => a - b)) {
    const last = blocks[blocks.length - 1];
    if (last && last[last.length - 1] === page - 1) last.push(page);
    else blocks.push([page]);
  }
  return blocks;
}

// ---------- numeric tail ----------

const AMOUNT = '[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+';
const SIGNED_AMOUNT = `(△)?\\s*(${AMOUNT})`;
/** 明細書頁数: plain digits, or a one-character prefix + digits (observed: エ / 電 / 原). Kept as a raw string. */
const DETAIL_PAGE = '[^\\s0-9,△]\\s*[0-9]+|[0-9]+';

/**
 * Exactly 7 signed amount cells, optionally followed by the detail page, anchored at line end.
 * Every cell may carry its own △ (observed outside the difference column, e.g. 定員合理化に伴う経費).
 */
export const NUMERIC_TAIL = new RegExp(
  `(?:^|\\s)${SIGNED_AMOUNT}${`\\s+${SIGNED_AMOUNT}`.repeat(6)}(?:\\s+(${DETAIL_PAGE}))?\\s*$`,
  'u',
);

/** Any standalone ASCII number token (used to refuse treating partial numeric lines as text). */
const STANDALONE_NUMBER = /(?:^|\s)△?\s*[0-9][0-9,]*(?=\s|$)/u;

export const AMOUNT_FIELDS = [
  'previous_general', 'previous_other', 'previous_total',
  'request_general', 'request_other', 'request_total',
  'difference',
] as const;
export type AmountField = typeof AMOUNT_FIELDS[number];
export interface AmountCell { sign_raw: '' | '△'; amount_raw: string }

export interface NumericTail {
  head: string;
  cells: Record<AmountField, AmountCell>;
  detail_page_raw: string;
}

export function parseNumericTail(line: string): NumericTail | null {
  const m = NUMERIC_TAIL.exec(line);
  if (!m) return null;
  const cells = {} as Record<AmountField, AmountCell>;
  AMOUNT_FIELDS.forEach((field, i) => {
    cells[field] = { sign_raw: (m[1 + i * 2] ?? '') as '' | '△', amount_raw: m[2 + i * 2] };
  });
  // m.index points at the separating whitespace (or 0); the head is everything before the tail.
  return { head: line.slice(0, m.index), cells, detail_page_raw: m[15] ?? '' };
}

// ---------- row head ----------

/** Hyphen variants accepted between NN and NN; code_raw keeps the original character (corpus: U+2011 only). */
const HYPHEN = '[‐‑‒–—―−－-]';
const DETAIL_HEAD = new RegExp(`^(\\s*([0-9]+)\\s+([0-9]{2}${HYPHEN}[0-9]{2})\\s+)(\\S.*?)\\s*$`, 'u');
const CODE3_HEAD = /^(\s*([0-9]{3})\s+)(\S.*?)\s*$/u;
const HIER_HEAD = /^(\s*([0-9]{1,2})\s+)(\S.*?)\s*$/u;
export const TOTAL_LABELS = ['組織計', '所管計', '会計計'] as const;

export type RowType = 'DETAIL' | 'CODE3' | 'HIER' | 'TOTAL';
export interface RowHead {
  row_type: RowType;
  request_no_raw: string;
  code_raw: string;
  name_raw: string;
  /** Column where the name starts; continuation lines must start at exactly this column. */
  nameColumn: number;
}

/** Order matters: TOTAL → DETAIL → CODE3 → HIER (a 3-digit request number must not become CODE3). */
export function parseRowHead(head: string): RowHead | null {
  const c = compact(head);
  if ((TOTAL_LABELS as readonly string[]).includes(c)) {
    const name = head.trim();
    return { row_type: 'TOTAL', request_no_raw: '', code_raw: '', name_raw: name, nameColumn: head.indexOf(name) };
  }
  let m = DETAIL_HEAD.exec(head);
  if (m) return { row_type: 'DETAIL', request_no_raw: m[2], code_raw: m[3], name_raw: m[4], nameColumn: m[1].length };
  m = CODE3_HEAD.exec(head);
  if (m) return { row_type: 'CODE3', request_no_raw: '', code_raw: m[2], name_raw: m[3], nameColumn: m[1].length };
  m = HIER_HEAD.exec(head);
  if (m) return { row_type: 'HIER', request_no_raw: '', code_raw: m[2], name_raw: m[3], nameColumn: m[1].length };
  return null;
}

/** Row types observed to wrap their name onto following lines (FY2024: DETAIL 532 lines, CODE3 204 lines). */
const CONTINUABLE: ReadonlySet<RowType> = new Set(['DETAIL', 'CODE3']);

// ---------- header-zone line classes ----------

const HEADER_VOCABULARY = /^(?:要求|番号|区分|前年度予算額|６年度概算要求額|一般行政経費|その他の経費|計|対前年度|比較|明細書|増△減|（Ｂ−Ａ）|頁数|\(A\)|\(B\))+$/u;
const UNIT_LINE = /^[（(]単位[:：]千円[)）]$/u;
/** Jurisdiction / account context line, e.g. "24 文部科学省所管", "9101 東日本大震災復興特別会計（…）". */
const CONTEXT_LINE = /^\s*[0-9]{2,4}\s+\S/u;
/** Running page label, e.g. "文 1", "2 文", "復興特 1", "10 環", "6". Only accepted as the first non-blank line of a page. */
const PAGE_LABEL = /^[0-9]*[^\s0-9]{0,3}[0-9]*$/u;

export type LineClass =
  | 'PAGE_LABEL' | 'TABLE_TITLE' | 'CONTEXT' | 'UNIT' | 'TABLE_HEADER'
  | 'ROW' | 'CONTINUATION' | 'UNRESOLVED';

export type UnresolvedReason =
  | 'UNMATCHED_NUMERIC_HEAD'
  | 'NUMERIC_TAIL_AMBIGUOUS_HEAD_ENDS_WITH_NUMBER'
  | 'MALFORMED_NUMERIC_TAIL'
  | 'UNKNOWN_HEADER_ZONE_LINE'
  | 'UNKNOWN_NON_NUMERIC_ROW'
  | 'AMBIGUOUS_CONTINUATION';

// ---------- records ----------

export interface LogicalRow {
  source_file: string;
  source_page: number;
  source_line_start: number;
  source_line_end: number;
  table_block_id: string;
  row_index: number;
  row_type: RowType;
  request_no_raw: string;
  code_raw: string;
  /** Head name and continuation segments joined by "\n" (each segment trimmed); see name_compact for the normalized form. */
  name_raw: string;
  name_compact: string;
  cells: Record<AmountField, AmountCell>;
  detail_page_raw: string;
  parse_status: 'PARSED' | 'PARSED_UNEXPECTED_DETAIL_PAGE_PRESENCE';
  continuationLines: number;
}

export interface UnresolvedLine {
  source_file: string;
  source_page: number;
  source_line_start: number;
  source_line_end: number;
  table_block_id: string;
  raw_text: string;
  reason: UnresolvedReason;
}

export interface LineAudit {
  source_file: string;
  source_page: number;
  source_line: number;
  table_block_id: string;
  line_class: LineClass;
  detail: string;
}

export interface BlockSummary {
  table_block_id: string;
  pages: number[];
  titlePages: number[];
  contextLines: string[];
  rows: number;
}

export interface SourceResult {
  source_file: string;
  pageCount: number;
  endsWithFormFeed: boolean;
  candidatePages: number[];
  titleOnlyPages: number[];
  blocks: BlockSummary[];
  rows: LogicalRow[];
  unresolved: UnresolvedLine[];
  audit: LineAudit[];
  blankLinesInCandidatePages: number;
}

/** name_compact: concatenate segments after removing all whitespace (half-width, full-width, layout spacing). */
export const nameCompact = (segments: string[]): string => segments.map(compact).join('');

/**
 * Parse one source text. `sourceFile` is a stable identifier (archive entry path) and
 * `blockPrefix` is used to build table_block_id ("<blockPrefix>#b<n>").
 */
export function parseSource(text: string, sourceFile: string, blockPrefix: string): SourceResult {
  const { pages, endsWithFormFeed } = splitPages(text);
  // 1-based file line number of each page's first line (FF is not a newline).
  const pageFirstLine: number[] = [];
  let line = 1;
  for (const page of pages) {
    pageFirstLine.push(line);
    line += (page.match(/\n/gu)?.length ?? 0);
  }

  const candidatePages = pages.map((p, i) => (isTotalTablePage(p) ? i + 1 : 0)).filter(Boolean);
  const titleOnlyPages = pages.map((p, i) => (!isTotalTablePage(p) && TOTAL_TABLE_TITLE.test(p) ? i + 1 : 0)).filter(Boolean);
  const result: SourceResult = {
    source_file: sourceFile, pageCount: pages.length, endsWithFormFeed, candidatePages, titleOnlyPages,
    blocks: [], rows: [], unresolved: [], audit: [], blankLinesInCandidatePages: 0,
  };

  buildBlocks(candidatePages).forEach((blockPages, bi) => {
    const blockId = `${blockPrefix}#b${bi + 1}`;
    const block: BlockSummary = { table_block_id: blockId, pages: blockPages, titlePages: [], contextLines: [], rows: 0 };
    result.blocks.push(block);
    let rowIndex = 0;

    for (const pageNo of blockPages) {
      const lines = pages[pageNo - 1].split('\n');
      const firstLineNo = pageFirstLine[pageNo - 1];
      // Header zone = up to the last TABLE_HEADER line before the first numeric-tail line (the "(A)/(B)" line in FY2024).
      // Bounded by the first numeric row so that a wrapped name such as "計" in the body is never taken as header.
      const firstTail = lines.findIndex(l => NUMERIC_TAIL.test(l));
      let headerEnd = -1;
      lines.forEach((l, i) => { if ((firstTail < 0 || i < firstTail) && l.trim() && HEADER_VOCABULARY.test(compact(l))) headerEnd = i; });
      const firstNonBlank = lines.findIndex(l => l.trim() !== '');
      // Continuation is only possible onto the row on the immediately preceding physical line (or its continuation).
      let open: { row: LogicalRow; nameColumn: number; lastLine: number } | null = null;

      const audit = (i: number, cls: LineClass, detail = '') =>
        result.audit.push({ source_file: sourceFile, source_page: pageNo, source_line: firstLineNo + i, table_block_id: blockId, line_class: cls, detail });
      const unresolved = (i: number, raw: string, reason: UnresolvedReason) => {
        result.unresolved.push({ source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i, table_block_id: blockId, raw_text: raw, reason });
        audit(i, 'UNRESOLVED', reason);
      };

      lines.forEach((rawLine, i) => {
        const l = rawLine.replace(/\f/gu, '');
        if (l.trim() === '') { result.blankLinesInCandidatePages++; open = null; return; }
        const c = compact(l);

        if (i <= headerEnd) {
          if (i === firstNonBlank && PAGE_LABEL.test(c)) audit(i, 'PAGE_LABEL');
          else if (TOTAL_TABLE_TITLE.test(l)) { audit(i, 'TABLE_TITLE'); if (!block.titlePages.includes(pageNo)) block.titlePages.push(pageNo); }
          else if (UNIT_LINE.test(c)) audit(i, 'UNIT');
          else if (HEADER_VOCABULARY.test(c)) audit(i, 'TABLE_HEADER');
          else if (CONTEXT_LINE.test(l)) { audit(i, 'CONTEXT'); block.contextLines.push(l.trim()); }
          else unresolved(i, rawLine, 'UNKNOWN_HEADER_ZONE_LINE');
          return;
        }

        const tail = parseNumericTail(l);
        if (tail) {
          open = null;
          if (/[0-9]$/u.test(tail.head.trimEnd())) { unresolved(i, rawLine, 'NUMERIC_TAIL_AMBIGUOUS_HEAD_ENDS_WITH_NUMBER'); return; }
          const head = parseRowHead(tail.head);
          if (!head) { unresolved(i, rawLine, 'UNMATCHED_NUMERIC_HEAD'); return; }
          const pagePresent = tail.detail_page_raw !== '';
          const expectedPresent = head.row_type !== 'TOTAL';
          const row: LogicalRow = {
            source_file: sourceFile, source_page: pageNo, source_line_start: firstLineNo + i, source_line_end: firstLineNo + i,
            table_block_id: blockId, row_index: ++rowIndex, row_type: head.row_type,
            request_no_raw: head.request_no_raw, code_raw: head.code_raw,
            name_raw: head.name_raw, name_compact: nameCompact([head.name_raw]),
            cells: tail.cells, detail_page_raw: tail.detail_page_raw,
            parse_status: pagePresent === expectedPresent ? 'PARSED' : 'PARSED_UNEXPECTED_DETAIL_PAGE_PRESENCE',
            continuationLines: 0,
          };
          result.rows.push(row);
          block.rows++;
          audit(i, 'ROW', head.row_type);
          if (CONTINUABLE.has(head.row_type)) open = { row, nameColumn: head.nameColumn, lastLine: i };
          return;
        }

        if (STANDALONE_NUMBER.test(l)) { open = null; unresolved(i, rawLine, 'MALFORMED_NUMERIC_TAIL'); return; }

        const indent = l.length - l.trimStart().length;
        if (open && open.lastLine === i - 1) {
          if (indent === open.nameColumn) {
            const seg = l.trim();
            open.row.name_raw += `\n${seg}`;
            open.row.name_compact += compact(seg);
            open.row.source_line_end = firstLineNo + i;
            open.row.continuationLines++;
            open.lastLine = i;
            audit(i, 'CONTINUATION', open.row.row_type);
            return;
          }
          open = null;
          unresolved(i, rawLine, 'AMBIGUOUS_CONTINUATION');
          return;
        }
        open = null;
        unresolved(i, rawLine, 'UNKNOWN_NON_NUMERIC_ROW');
      });
    }
  });
  return result;
}

// ---------- CSV rendering ----------

/** 総表の見出しの語（表頭の原文。文字間の空白は除く）。2段の見出しは「上段_下段」。 */
const AMOUNT_HEADERS: Record<AmountField, string> = {
  previous_general: '前年度予算額_一般行政経費',
  previous_other: '前年度予算額_その他の経費',
  previous_total: '前年度予算額_計',
  request_general: '６年度概算要求額_一般行政経費',
  request_other: '６年度概算要求額_その他の経費',
  request_total: '６年度概算要求額_計',
  difference: '増△減',
};

/**
 * 総表の列（原本の見出し）を先頭に、行の出所をたどる列を末尾に置く。
 * source_file 列は持たない（ソース別 CSV のファイル名 `<slug>.csv` で判別する）。
 */
export const TOTAL_TABLE_CSV_COLUMNS = [
  '要求番号', '区分', ...AMOUNT_FIELDS.map(f => AMOUNT_HEADERS[f]), '明細書頁数',
  'source_page', 'source_line_start', 'source_line_end', 'table_block_id', 'row_index', 'row_type', 'parse_status',
] as const;

export const UNRESOLVED_CSV_COLUMNS = ['source_file', 'source_page', 'source_line_start', 'source_line_end', 'table_block_id', 'raw_text', 'reason'] as const;

export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (values: unknown[]) => values.map(csvCell).join(',');

export function renderRowsCsv(rows: LogicalRow[]): string {
  const body = rows.map(r => csvLine([
    r.request_no_raw,
    // 区分 = コード + 名称（名称は文字間の空白を除いたもの）。TOTAL は名称だけ。
    [r.code_raw, r.name_compact].filter(Boolean).join(' '),
    // 金額は原文のまま。△は金額の前に付ける。
    ...AMOUNT_FIELDS.map(f => `${r.cells[f].sign_raw}${r.cells[f].amount_raw}`),
    r.detail_page_raw,
    r.source_page, r.source_line_start, r.source_line_end, r.table_block_id, r.row_index, r.row_type, r.parse_status,
  ]));
  return [TOTAL_TABLE_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}

/** raw_text is the physical line verbatim except a leading Form Feed. */
export function renderUnresolvedCsv(lines: UnresolvedLine[]): string {
  const body = lines.map(u => csvLine([u.source_file, u.source_page, u.source_line_start, u.source_line_end, u.table_block_id, u.raw_text.replace(/\f/gu, ''), u.reason]));
  return [UNRESOLVED_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}

export function renderAuditCsv(lines: LineAudit[]): string {
  const body = lines.map(a => csvLine([a.source_file, a.source_page, a.source_line, a.table_block_id, a.line_class, a.detail]));
  return ['source_file,source_page,source_line,table_block_id,line_class,detail', ...body].join('\n') + '\n';
}

// ---------- calculation-only validation (never rewrites extracted values) ----------

/** Validation-only interpretation: △ = negative. */
export const signedValue = (cell: AmountCell): bigint => {
  const v = BigInt(cell.amount_raw.replace(/,/gu, ''));
  return cell.sign_raw === '△' ? -v : v;
};

export type CheckName = 'previous_general+previous_other=previous_total' | 'request_general+request_other=request_total' | 'request_total-previous_total=difference';
export function arithmeticMismatches(row: LogicalRow): { check: CheckName; expected: string; actual: string }[] {
  const v = (f: AmountField) => signedValue(row.cells[f]);
  const checks: [CheckName, bigint, bigint][] = [
    ['previous_general+previous_other=previous_total', v('previous_general') + v('previous_other'), v('previous_total')],
    ['request_general+request_other=request_total', v('request_general') + v('request_other'), v('request_total')],
    ['request_total-previous_total=difference', v('request_total') - v('previous_total'), v('difference')],
  ];
  return checks.filter(([, e, a]) => e !== a).map(([check, e, a]) => ({ check, expected: e.toString(), actual: a.toString() }));
}
