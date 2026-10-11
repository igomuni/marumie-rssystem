/**
 * P0 failure isolation: read-only survey of hierarchy evidence in v0 total-table rows.
 *
 * Observation only. Nothing here assigns semantic roles (所管/会計/組織/項/…) or a confirmed parent.
 * Parent "candidates" come from two explicitly named naive rules so that their disagreements can be
 * listed as ambiguity; neither rule is adopted. Uses the frozen v0 parser output as input and never
 * changes it. Columns are raw UTF-16 string indexes on the Form-Feed-stripped physical line (corpus has no tabs).
 */
import {
  AMOUNT_FIELDS,
  NUMERIC_TAIL,
  compact,
  signedValue,
  type LineAudit,
  type LogicalRow,
  type RowType,
  type SourceResult,
} from './budget-request-total-table';

// ---------- raw line geometry ----------

export interface RowGeometry {
  line_leading_column: number;
  /** DETAIL only: column of the request number (= leading column). */
  request_no_start_column: number | '';
  /** DETAIL: NN-NN code; CODE3/HIER: the leading code; TOTAL: blank. */
  code_start_column: number | '';
  name_start_column: number;
  numeric_tail_start_column: number;
}

const leading = (l: string) => l.length - l.trimStart().length;

export function measureRow(line: string, row: Pick<LogicalRow, 'row_type' | 'request_no_raw' | 'code_raw'>): RowGeometry {
  const lead = leading(line);
  const m = NUMERIC_TAIL.exec(line);
  if (!m) throw new Error(`row line has no numeric tail: ${line}`);
  const tailStart = m.index + leading(line.slice(m.index));
  if (row.row_type === 'TOTAL') {
    return { line_leading_column: lead, request_no_start_column: '', code_start_column: '', name_start_column: lead, numeric_tail_start_column: tailStart };
  }
  let pos = lead;
  let requestCol: number | '' = '';
  if (row.row_type === 'DETAIL') {
    requestCol = lead;
    pos = lead + row.request_no_raw.length;
    pos += leading(line.slice(pos));
  }
  const codeCol = pos;
  if (line.slice(codeCol, codeCol + row.code_raw.length) !== row.code_raw) throw new Error(`code_raw not at expected column: ${line}`);
  const after = codeCol + row.code_raw.length;
  const nameCol = after + leading(line.slice(after));
  return { line_leading_column: lead, request_no_start_column: requestCol, code_start_column: codeCol, name_start_column: nameCol, numeric_tail_start_column: tailStart };
}

/** Column used for indentation comparisons: code start (TOTAL: leading column). */
export const indentColumn = (g: RowGeometry): number => (g.code_start_column === '' ? g.line_leading_column : g.code_start_column);

// ---------- context lines ----------

export type ContextClass =
  | 'CONTEXT_CODE2' | 'CONTEXT_CODE4' | 'CONTEXT_OTHER_CODE'
  | 'PAGE_LABEL_TEXT' | 'PAGE_LABEL_NUMBER_ONLY';

export interface ContextSurvey {
  context_id: string;
  source_file: string;
  table_block_id: string;
  source_page: number;
  source_line: number;
  line_class: 'CONTEXT' | 'PAGE_LABEL';
  syntactic_class: ContextClass;
  code_raw: string;
  text_compact: string;
  has_parenthetical: boolean;
  /** Literal suffix/infix markers only; not a semantic label. */
  marker_shozokan: boolean;
  marker_tokubetsu_kaikei: boolean;
  marker_kanjou: boolean;
  rows_before_in_block: number;
}

export function classifyContext(line: string, lineClass: 'CONTEXT' | 'PAGE_LABEL'): { syntactic_class: ContextClass; code_raw: string; text_compact: string } {
  const c = compact(line);
  if (lineClass === 'PAGE_LABEL') {
    return { syntactic_class: /[^0-9]/u.test(c) ? 'PAGE_LABEL_TEXT' : 'PAGE_LABEL_NUMBER_ONLY', code_raw: '', text_compact: c };
  }
  const m = /^\s*([0-9]+)\s+(.*)$/u.exec(line)!;
  const code = m[1];
  return {
    syntactic_class: code.length === 2 ? 'CONTEXT_CODE2' : code.length === 4 ? 'CONTEXT_CODE4' : 'CONTEXT_OTHER_CODE',
    code_raw: code,
    text_compact: compact(m[2]),
  };
}

// ---------- arithmetic observations (validation-style; never modify values, never assign roles) ----------

const ZERO = BigInt(0);
const cellValues = (r: LogicalRow): bigint[] => AMOUNT_FIELDS.map(f => signedValue(r.cells[f]));
const sameCells = (a: bigint[], b: bigint[]) => a.every((v, k) => v === b[k]);
const addCells = (a: bigint[], b: bigint[]) => a.map((v, k) => v + b[k]);

/** Contiguous DETAIL rows directly after row i, and whether their sum equals row i. */
export function followingDetailRun(rows: LogicalRow[], i: number): { count: number; sumEquals: boolean | '' } {
  let j = i + 1;
  let sum = AMOUNT_FIELDS.map(() => ZERO);
  while (j < rows.length && rows[j].row_type === 'DETAIL') { sum = addCells(sum, cellValues(rows[j])); j++; }
  const count = j - i - 1;
  return { count, sumEquals: count === 0 ? '' : sameCells(sum, cellValues(rows[i])) };
}

/**
 * Smallest k > i (before the next TOTAL) such that the rows in (i, k] having the same row_type as row i+1
 * sum to row i. Returns the row_index of k, or ''. A pure arithmetic coincidence check: all-zero rows match trivially.
 */
export function nextTypePrefixSumEnd(rows: LogicalRow[], i: number): number | '' {
  if (i + 1 >= rows.length || rows[i + 1].row_type === 'TOTAL') return '';
  const type = rows[i + 1].row_type;
  const self = cellValues(rows[i]);
  let sum = AMOUNT_FIELDS.map(() => ZERO);
  for (let k = i + 1; k < rows.length && rows[k].row_type !== 'TOTAL'; k++) {
    if (rows[k].row_type !== type) continue;
    sum = addCells(sum, cellValues(rows[k]));
    if (sameCells(sum, self)) return rows[k].row_index;
  }
  return '';
}

// ---------- row survey ----------

export type HierCodeForm = 'CODE2_ZERO_PADDED' | 'CODE2_UNPADDED' | 'CODE1' | '';
export const hierCodeForm = (r: Pick<LogicalRow, 'row_type' | 'code_raw'>): HierCodeForm =>
  r.row_type !== 'HIER' ? '' : r.code_raw.length === 1 ? 'CODE1' : r.code_raw.startsWith('0') ? 'CODE2_ZERO_PADDED' : 'CODE2_UNPADDED';

export interface RowSurvey extends RowGeometry {
  source_file: string;
  table_block_id: string;
  row_index: number;
  row_type: RowType;
  request_no_raw: string;
  code_raw: string;
  name_compact: string;
  hier_code_form: HierCodeForm;
  source_page: number;
  source_line_start: number;
  source_line_end: number;
  detail_page_raw: string;
  /** 1 = shallowest distinct CODE3 code_start_column on the same page. */
  code3_page_level: number | '';
  code3_page_level_count: number;
  previous_row_type: RowType | '';
  previous_row_index: number | '';
  next_row_type: RowType | '';
  next_row_index: number | '';
  nearest_prev_hier_row_index: number | '';
  nearest_prev_code3_row_index: number | '';
  nearest_prev_detail_row_index: number | '';
  /** Nearest preceding CODE3 on the same page whose code starts at a strictly smaller column. */
  nearest_prev_code3_shallower_same_page_row_index: number | '';
  preceding_context_id: string;
  preceding_total_type: string;
  preceding_total_row_index: number | '';
  page_boundary_before: boolean;
  first_row_on_page: boolean;
  last_row_on_page: boolean;
  /** Hypothesis candidate, Rule A (code width): nearest preceding row of a wider class (HIER > CODE3 > DETAIL). */
  candidate_parent_rule_a_row_index: number | '';
  /** Hypothesis candidate, Rule B (raw indent): nearest preceding non-TOTAL row on the same page with a strictly smaller indent column. */
  candidate_parent_rule_b_row_index: number | '';
  candidate_parent_status: 'AGREE' | 'DISAGREE' | 'ONLY_A' | 'ONLY_B' | 'NONE' | 'NOT_APPLICABLE';
  all_zero: boolean;
  following_detail_run_count: number;
  following_detail_run_sum_equals: boolean | '';
  next_type_prefix_sum_end_row_index: number | '';
  /** First later TOTAL in the block with identical 7 cells (non-TOTAL rows). */
  equals_later_total_row_index: number | '';
  equals_later_total_name: string;
  /** TOTAL rows: nearest earlier non-TOTAL row with identical 7 cells. */
  equals_earlier_row_index: number | '';
  equals_earlier_row_type: RowType | '';
  /** TOTAL rows: the sum of all earlier TOTAL rows in the block equals this row ('' when there is no earlier TOTAL). */
  equals_sum_of_earlier_totals: boolean | '';
  rows_after_in_block: number;
}

export interface SurveyResult {
  rows: RowSurvey[];
  contexts: ContextSurvey[];
}

const RANK_A: Record<RowType, number> = { HIER: 3, CODE3: 2, DETAIL: 1, TOTAL: 0 };

/** `text` must be the exact source text that produced `v0`. */
export function surveySource(text: string, v0: SourceResult): SurveyResult {
  const lines = text.split('\n').map(l => l.replace(/\f/gu, ''));
  const out: SurveyResult = { rows: [], contexts: [] };

  for (const block of v0.blocks) {
    const rows = v0.rows.filter(r => r.table_block_id === block.table_block_id);
    const audits = v0.audit.filter(a => a.table_block_id === block.table_block_id);
    const geo = rows.map(r => measureRow(lines[r.source_line_start - 1], r));
    const indent = geo.map(indentColumn);
    const values = rows.map(cellValues);

    const ctx: ContextSurvey[] = audits
      .filter((a): a is LineAudit & { line_class: 'CONTEXT' | 'PAGE_LABEL' } => a.line_class === 'CONTEXT' || a.line_class === 'PAGE_LABEL')
      .map((a, k) => {
        const cls = classifyContext(lines[a.source_line - 1], a.line_class);
        return {
          context_id: `${block.table_block_id}#c${k + 1}`,
          source_file: v0.source_file, table_block_id: block.table_block_id, source_page: a.source_page, source_line: a.source_line,
          line_class: a.line_class, ...cls,
          has_parenthetical: /[（(]/u.test(cls.text_compact),
          marker_shozokan: cls.text_compact.includes('所管'),
          marker_tokubetsu_kaikei: cls.text_compact.includes('特別会計'),
          marker_kanjou: cls.text_compact.includes('勘定'),
          rows_before_in_block: rows.filter(r => r.source_line_start < a.source_line).length,
        };
      });
    out.contexts.push(...ctx);
    const contextOnly = ctx.filter(c => c.line_class === 'CONTEXT');

    rows.forEach((r, i) => {
      const samePage = (j: number) => rows[j].source_page === r.source_page;
      const findPrev = (pred: (j: number) => boolean, stopAtPageStart = false): number | '' => {
        for (let j = i - 1; j >= 0; j--) {
          if (stopAtPageStart && !samePage(j)) return '';
          if (pred(j)) return rows[j].row_index;
        }
        return '';
      };
      const pageCode3Cols = [...new Set(rows.flatMap((x, j) => (x.row_type === 'CODE3' && samePage(j) ? [indent[j]] : [])))].sort((a, b) => a - b);
      const prevTotal = findPrev(j => rows[j].row_type === 'TOTAL');
      const a = r.row_type === 'TOTAL' ? '' : findPrev(j => RANK_A[rows[j].row_type] > RANK_A[r.row_type]);
      const b = r.row_type === 'TOTAL' ? '' : findPrev(j => rows[j].row_type !== 'TOTAL' && indent[j] < indent[i], true);
      const run = followingDetailRun(rows, i);
      const laterTotal = r.row_type === 'TOTAL' ? -1 : rows.findIndex((x, k) => k > i && x.row_type === 'TOTAL' && sameCells(values[k], values[i]));
      let earlier = -1;
      if (r.row_type === 'TOTAL') for (let k = i - 1; k >= 0 && earlier < 0; k--) if (rows[k].row_type !== 'TOTAL' && sameCells(values[k], values[i])) earlier = k;
      out.rows.push({
        source_file: v0.source_file, table_block_id: block.table_block_id, row_index: r.row_index, row_type: r.row_type,
        request_no_raw: r.request_no_raw, code_raw: r.code_raw, name_compact: r.name_compact, hier_code_form: hierCodeForm(r),
        source_page: r.source_page, source_line_start: r.source_line_start, source_line_end: r.source_line_end,
        detail_page_raw: r.detail_page_raw,
        ...geo[i],
        code3_page_level: r.row_type === 'CODE3' ? pageCode3Cols.indexOf(indent[i]) + 1 : '',
        code3_page_level_count: pageCode3Cols.length,
        previous_row_type: i > 0 ? rows[i - 1].row_type : '', previous_row_index: i > 0 ? rows[i - 1].row_index : '',
        next_row_type: i + 1 < rows.length ? rows[i + 1].row_type : '', next_row_index: i + 1 < rows.length ? rows[i + 1].row_index : '',
        nearest_prev_hier_row_index: findPrev(j => rows[j].row_type === 'HIER'),
        nearest_prev_code3_row_index: findPrev(j => rows[j].row_type === 'CODE3'),
        nearest_prev_detail_row_index: findPrev(j => rows[j].row_type === 'DETAIL'),
        nearest_prev_code3_shallower_same_page_row_index: findPrev(j => samePage(j) && rows[j].row_type === 'CODE3' && indent[j] < indent[i]),
        preceding_context_id: [...contextOnly].reverse().find(c => c.source_line < r.source_line_start)?.context_id ?? '',
        preceding_total_type: prevTotal === '' ? '' : rows[prevTotal - 1].name_compact,
        preceding_total_row_index: prevTotal,
        page_boundary_before: i > 0 && !samePage(i - 1),
        first_row_on_page: i === 0 || !samePage(i - 1),
        last_row_on_page: i + 1 === rows.length || rows[i + 1].source_page !== r.source_page,
        candidate_parent_rule_a_row_index: a,
        candidate_parent_rule_b_row_index: b,
        candidate_parent_status: r.row_type === 'TOTAL' ? 'NOT_APPLICABLE'
          : a === '' && b === '' ? 'NONE' : b === '' ? 'ONLY_A' : a === '' ? 'ONLY_B' : a === b ? 'AGREE' : 'DISAGREE',
        all_zero: values[i].every(v => v === ZERO),
        following_detail_run_count: run.count,
        following_detail_run_sum_equals: run.sumEquals,
        next_type_prefix_sum_end_row_index: r.row_type === 'TOTAL' ? '' : nextTypePrefixSumEnd(rows, i),
        equals_later_total_row_index: laterTotal < 0 ? '' : rows[laterTotal].row_index,
        equals_later_total_name: laterTotal < 0 ? '' : rows[laterTotal].name_compact,
        equals_earlier_row_index: earlier < 0 ? '' : rows[earlier].row_index,
        equals_earlier_row_type: earlier < 0 ? '' : rows[earlier].row_type,
        equals_sum_of_earlier_totals: (() => {
          if (r.row_type !== 'TOTAL') return '';
          const prior = rows.slice(0, i).map((x, k) => (x.row_type === 'TOTAL' ? values[k] : null)).filter((v): v is bigint[] => v !== null);
          return prior.length === 0 ? '' : sameCells(prior.reduce(addCells), values[i]);
        })(),
        rows_after_in_block: rows.length - i - 1,
      });
    });
  }
  return out;
}

// ---------- block survey ----------

export interface BlockSurvey {
  source_file: string;
  table_block_id: string;
  page_start: number;
  page_end: number;
  page_boundary_count: number;
  context_id: string;
  context_syntactic_class: string;
  context_code_raw: string;
  context_text_compact: string;
  row_count: number;
  DETAIL_count: number;
  CODE3_count: number;
  HIER_count: number;
  TOTAL_count: number;
  CODE3_indent_levels: number;
  /** Longest Rule-B candidate chain (hypothesis candidate, not a semantic depth). */
  max_rule_b_chain_depth_candidate: number;
  first_row_type: string;
  last_row_type: string;
  total_sequence: string;
  code3_equal_to_later_total_count: number;
  detail_followed_by_code3_breakdown_count: number;
}

const chainDepth = (byIndex: Map<number, RowSurvey>, r: RowSurvey): number => {
  let d = 1;
  let p = r.candidate_parent_rule_b_row_index;
  while (p !== '') { d++; p = byIndex.get(p)!.candidate_parent_rule_b_row_index; }
  return d;
};

/** DETAIL whose next row is CODE3 and whose amounts equal a prefix sum of the following CODE3 rows. */
export const isDetailWithCode3Breakdown = (r: RowSurvey) =>
  r.row_type === 'DETAIL' && r.next_row_type === 'CODE3' && r.next_type_prefix_sum_end_row_index !== '' && !r.all_zero;

export function surveyBlocks(v0: SourceResult[], rows: RowSurvey[], contexts: ContextSurvey[]): BlockSurvey[] {
  return v0.flatMap(src => src.blocks.map(block => {
    const rs = rows.filter(r => r.table_block_id === block.table_block_id);
    const byIndex = new Map(rs.map(r => [r.row_index, r]));
    const ctx = contexts.find(c => c.table_block_id === block.table_block_id && c.line_class === 'CONTEXT');
    const n = (t: RowType) => rs.filter(r => r.row_type === t).length;
    return {
      source_file: src.source_file,
      table_block_id: block.table_block_id,
      page_start: block.pages[0],
      page_end: block.pages[block.pages.length - 1],
      page_boundary_count: block.pages.length - 1,
      context_id: ctx?.context_id ?? '',
      context_syntactic_class: ctx?.syntactic_class ?? '',
      context_code_raw: ctx?.code_raw ?? '',
      context_text_compact: ctx?.text_compact ?? '',
      row_count: rs.length,
      DETAIL_count: n('DETAIL'), CODE3_count: n('CODE3'), HIER_count: n('HIER'), TOTAL_count: n('TOTAL'),
      CODE3_indent_levels: Math.max(0, ...rs.map(r => r.code3_page_level_count)),
      max_rule_b_chain_depth_candidate: Math.max(0, ...rs.filter(r => r.row_type !== 'TOTAL').map(r => chainDepth(byIndex, r))),
      first_row_type: rs[0]?.row_type ?? '',
      last_row_type: rs[rs.length - 1]?.row_type ?? '',
      total_sequence: rs.filter(r => r.row_type === 'TOTAL').map(r => r.name_compact).join('>'),
      code3_equal_to_later_total_count: rs.filter(r => r.row_type === 'CODE3' && r.equals_later_total_row_index !== '').length,
      detail_followed_by_code3_breakdown_count: rs.filter(isDetailWithCode3Breakdown).length,
    };
  }));
}

// ---------- ambiguity ----------

export type AmbiguityType =
  | 'INDENT_GIVES_NO_PARENT'
  | 'PARENT_RULES_DISAGREE'
  | 'CODE3_SAME_FORM_EQUALS_TOTAL'
  | 'DETAIL_HAS_CODE3_BREAKDOWN'
  | 'CODE3_DETAIL_RUN_SUM_MISMATCH'
  | 'HIER_CODE_FORM_MIX'
  | 'PAGE_HEAD_PARENT_ON_EARLIER_PAGE'
  | 'TOTAL_SCOPE_NOT_ARITHMETICALLY_MATCHED';

export interface Ambiguity {
  source_file: string;
  table_block_id: string;
  row_index: number;
  source_page: number;
  source_line_start: number;
  raw_excerpt: string;
  ambiguity_type: AmbiguityType;
  candidate_interpretations: string;
  evidence: string;
}

const desc = (r: RowSurvey | undefined) => (r ? `#${r.row_index} ${r.row_type} ${r.code_raw} ${r.name_compact}`.replace(/\s+/gu, ' ') : 'none');

export function findAmbiguities(rows: RowSurvey[], _contexts: ContextSurvey[]): Ambiguity[] {
  const out: Ambiguity[] = [];
  const byBlock = new Map<string, Map<number, RowSurvey>>();
  for (const r of rows) {
    if (!byBlock.has(r.table_block_id)) byBlock.set(r.table_block_id, new Map());
    byBlock.get(r.table_block_id)!.set(r.row_index, r);
  }
  const add = (r: RowSurvey, type: AmbiguityType, candidates: string, evidence: string) => out.push({
    source_file: r.source_file, table_block_id: r.table_block_id, row_index: r.row_index, source_page: r.source_page,
    source_line_start: r.source_line_start, raw_excerpt: `${r.row_type} ${r.request_no_raw} ${r.code_raw} ${r.name_compact}`.replace(/\s+/gu, ' ').trim(),
    ambiguity_type: type, candidate_interpretations: candidates, evidence,
  });

  for (const r of rows) {
    const block = byBlock.get(r.table_block_id)!;
    const get = (i: number | '') => (i === '' ? undefined : block.get(i));
    const a = get(r.candidate_parent_rule_a_row_index);
    const b = get(r.candidate_parent_rule_b_row_index);
    const indentNote = `indent_col=${indentColumn(r)} page=${r.source_page}`;

    if (r.candidate_parent_status === 'ONLY_A' && !r.first_row_on_page) {
      add(r, 'INDENT_GIVES_NO_PARENT', `rule A: ${desc(a)} | rule B: none`, `no earlier row on the page has a smaller indent column; ${indentNote}`);
    }
    if (r.candidate_parent_status === 'DISAGREE') {
      add(r, 'PARENT_RULES_DISAGREE', `rule A: ${desc(a)} | rule B: ${desc(b)}`, `${indentNote}; rule A col=${a ? indentColumn(a) : ''} rule B col=${b ? indentColumn(b) : ''}`);
    }
    if (r.row_type === 'CODE3' && r.equals_later_total_row_index !== '' && !r.all_zero) {
      add(r, 'CODE3_SAME_FORM_EQUALS_TOTAL', 'CODE3 closed by a TOTAL row | CODE3 parent of a DETAIL run (same 3-digit form)',
        `7 cells equal TOTAL #${r.equals_later_total_row_index} ${r.equals_later_total_name}; code3_page_level=${r.code3_page_level}/${r.code3_page_level_count}; following_detail_run=${r.following_detail_run_count}`);
    }
    if (isDetailWithCode3Breakdown(r)) {
      add(r, 'DETAIL_HAS_CODE3_BREAKDOWN', 'following CODE3 rows are children of this DETAIL | following CODE3 rows are siblings/parents of later DETAIL rows',
        `7 cells equal the sum of following CODE3 rows up to #${r.next_type_prefix_sum_end_row_index}`);
    }
    if (r.row_type === 'CODE3' && r.following_detail_run_sum_equals === false) {
      add(r, 'CODE3_DETAIL_RUN_SUM_MISMATCH', 'following DETAIL run is the full child set | DETAIL run is partial or not children',
        `following_detail_run_count=${r.following_detail_run_count}; sum differs; next_type_prefix_sum_end=${r.next_type_prefix_sum_end_row_index}`);
    }
    if (r.hier_code_form === 'CODE2_UNPADDED') {
      add(r, 'HIER_CODE_FORM_MIX', 'same HIER grammar as zero-padded 2-digit / 1-digit HIER rows | different hierarchy role',
        `code_raw=${r.code_raw}; equals_later_total=${r.equals_later_total_name || 'none'}; previous=${r.previous_row_type}`);
    }
    if (r.page_boundary_before && r.row_type !== 'HIER' && a && a.source_page !== r.source_page) {
      add(r, 'PAGE_HEAD_PARENT_ON_EARLIER_PAGE', `carry rule A parent ${desc(a)} across the page | page-local state only (no parent)`,
        `parent candidate on page ${a.source_page}; ${indentNote}; parent indent_col=${indentColumn(a)} (columns are not comparable across pages)`);
    }
    if (r.row_type === 'TOTAL') {
      if (r.equals_earlier_row_index === '' && r.equals_sum_of_earlier_totals !== true) {
        add(r, 'TOTAL_SCOPE_NOT_ARITHMETICALLY_MATCHED', 'closes the rows since the previous TOTAL | closes the whole block | other scope',
          `no earlier non-TOTAL row has identical cells and earlier TOTALs do not sum to it; preceding_total=${r.preceding_total_type || 'none'}; rows_after=${r.rows_after_in_block}`);
      }
    }
  }
  return out;
}

// ---------- pattern summary ----------

const countBy = <T>(items: T[], key: (t: T) => string): Record<string, number> => {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return Object.fromEntries([...m].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
};

export function buildPatternSummary(rows: RowSurvey[], contexts: ContextSurvey[], blocks: BlockSurvey[], ambiguities: Ambiguity[]) {
  const by = (t: RowType) => rows.filter(r => r.row_type === t);
  const key = (r: RowSurvey) => `${r.table_block_id}#${r.row_index}`;
  const index = new Map(rows.map(r => [key(r), r]));
  const parentType = (r: RowSurvey, rule: 'a' | 'b') => {
    const i = rule === 'a' ? r.candidate_parent_rule_a_row_index : r.candidate_parent_rule_b_row_index;
    return i === '' ? 'none' : index.get(`${r.table_block_id}#${i}`)!.row_type;
  };
  const ctx = contexts.filter(c => c.line_class === 'CONTEXT');
  const boundaries = rows.filter(r => r.page_boundary_before).map(r => {
    const prev = index.get(`${r.table_block_id}#${r.previous_row_index}`)!;
    return { prev: prev.row_type, next: r.row_type, prevCode3Level: prev.code3_page_level, nextCode3Level: r.code3_page_level };
  });
  const minCode3Col = new Map<string, number>();
  for (const r of by('CODE3')) {
    const k = `${r.table_block_id}#${r.source_page}`;
    minCode3Col.set(k, Math.min(minCode3Col.get(k) ?? Infinity, indentColumn(r)));
  }
  const shift = rows.filter(r => r.page_boundary_before).map(r => {
    const prev = index.get(`${r.table_block_id}#${r.previous_row_index}`)!;
    const a = minCode3Col.get(`${r.table_block_id}#${prev.source_page}`);
    const b = minCode3Col.get(`${r.table_block_id}#${r.source_page}`);
    return a === undefined || b === undefined ? 'NO_CODE3_ON_ONE_SIDE' : a === b ? 'SAME_MIN_CODE3_COLUMN' : 'MIN_CODE3_COLUMN_SHIFTED';
  });
  const pageDetailVsCode3 = new Map<string, { d: Set<number>; c: Set<number> }>();
  for (const r of rows) {
    if (r.row_type !== 'DETAIL' && r.row_type !== 'CODE3') continue;
    const k = `${r.table_block_id}#${r.source_page}`;
    if (!pageDetailVsCode3.has(k)) pageDetailVsCode3.set(k, { d: new Set(), c: new Set() });
    pageDetailVsCode3.get(k)![r.row_type === 'DETAIL' ? 'd' : 'c'].add(indentColumn(r));
  }
  return {
    context: {
      contextLinesPerBlock: countBy(blocks, b => String(ctx.filter(c => c.table_block_id === b.table_block_id).length)),
      contextRowsBeforeInBlock: countBy(ctx, c => String(c.rows_before_in_block)),
      syntacticClass: countBy(ctx, c => c.syntactic_class),
      markers: countBy(ctx, c => `${c.syntactic_class} 所管=${c.marker_shozokan} 特別会計=${c.marker_tokubetsu_kaikei} 勘定=${c.marker_kanjou} 括弧=${c.has_parenthetical}`),
      distinctTexts: countBy(ctx, c => `${c.code_raw} ${c.text_compact}`),
      pageLabelClass: countBy(contexts.filter(c => c.line_class === 'PAGE_LABEL'), c => c.syntactic_class),
      hierPresenceByContextClass: countBy(blocks, b => `${b.context_syntactic_class} HIER>0=${b.HIER_count > 0}`),
    },
    hier: {
      count: by('HIER').length,
      codeForm: countBy(by('HIER'), r => r.hier_code_form),
      codeFormByNameSuffix勘定: countBy(by('HIER'), r => `${r.hier_code_form} 勘定suffix=${r.name_compact.endsWith('勘定')}`),
      codeFormByPosition: countBy(by('HIER'), r => `${r.hier_code_form} row_index=${r.row_index === 1 ? '1' : '>1'} prev=${r.previous_row_type || 'none'} next=${r.next_row_type}`),
      codeFormByEqualsLaterTotal: countBy(by('HIER'), r => `${r.hier_code_form} equals_later_total=${r.equals_later_total_name || 'none'}`),
      leadingColumn: countBy(by('HIER'), r => `${r.hier_code_form} lead=${r.line_leading_column}`),
    },
    code3: {
      count: by('CODE3').length,
      pageLevelCount: countBy(by('CODE3'), r => String(r.code3_page_level_count)),
      pageLevel: countBy(by('CODE3'), r => String(r.code3_page_level)),
      nestedCode3RowsLevelGt1: by('CODE3').filter(r => Number(r.code3_page_level) > 1).length,
      blocksByMaxLevels: countBy(blocks, b => String(b.CODE3_indent_levels)),
      blocksWithMultipleLevels: blocks.filter(b => b.CODE3_indent_levels > 1).map(b => `${b.table_block_id} levels=${b.CODE3_indent_levels}`),
      sameCodeAtDifferentLevelsInBlock: (() => {
        const m = new Map<string, Set<number>>();
        for (const r of by('CODE3')) {
          const k = `${r.table_block_id}#${r.code_raw}`;
          if (!m.has(k)) m.set(k, new Set());
          m.get(k)!.add(Number(r.code3_page_level));
        }
        return [...m.values()].filter(s => s.size > 1).length;
      })(),
      arithmetic: countBy(by('CODE3'), r => `detail_run=${r.following_detail_run_count > 0 ? (r.following_detail_run_sum_equals ? 'SUM_EQ' : 'SUM_NE') : 'NONE'} equals_later_total=${r.equals_later_total_name || 'none'}`),
      equalsTotalByPageLevel: countBy(by('CODE3').filter(r => r.equals_later_total_row_index !== ''), r => `level=${r.code3_page_level}/${r.code3_page_level_count}`),
      ruleBParentType: countBy(by('CODE3'), r => parentType(r, 'b')),
      /** CODE3 equal to a later 組織計 (non-zero) directly followed by a CODE3: compare code columns on the same page. */
      totalMatchedCode3VsNextCode3Column: countBy(
        by('CODE3').filter(r => r.equals_later_total_name === '組織計' && !r.all_zero && r.next_row_type === 'CODE3'),
        r => {
          const n = index.get(`${r.table_block_id}#${r.next_row_index}`)!;
          if (n.source_page !== r.source_page) return 'NEXT_ON_OTHER_PAGE';
          const [x, y] = [indentColumn(r), indentColumn(n)];
          return x < y ? 'SHALLOWER_THAN_NEXT' : x === y ? 'SAME_COLUMN_AS_NEXT' : 'DEEPER_THAN_NEXT';
        }),
    },
    detail: {
      count: by('DETAIL').length,
      ruleAParentType: countBy(by('DETAIL'), r => parentType(r, 'a')),
      ruleBParentType: countBy(by('DETAIL'), r => parentType(r, 'b')),
      candidateStatus: countBy(by('DETAIL'), r => r.candidate_parent_status),
      nearestPrevCode3OnEarlierPage: by('DETAIL').filter(r => {
        const p = r.nearest_prev_code3_row_index;
        return p !== '' && index.get(`${r.table_block_id}#${p}`)!.source_page !== r.source_page;
      }).length,
      totalBetweenNearestCode3AndDetail: by('DETAIL').filter(r => r.preceding_total_row_index !== '' && r.nearest_prev_code3_row_index !== '' && r.preceding_total_row_index > r.nearest_prev_code3_row_index).length,
      withCode3Breakdown: by('DETAIL').filter(isDetailWithCode3Breakdown).length,
      pagesByDetailCodeColumnVsMinCode3Column: countBy([...pageDetailVsCode3.values()].filter(v => v.d.size && v.c.size), v => {
        const minC = Math.min(...v.c);
        const ds = [...v.d];
        return ds.every(d => d === minC) ? 'DETAIL_EQ_MIN_CODE3' : ds.every(d => d > minC) ? 'DETAIL_GT_MIN_CODE3' : ds.every(d => d < minC) ? 'DETAIL_LT_MIN_CODE3' : 'MIXED';
      }),
    },
    total: {
      byName: countBy(by('TOTAL'), r => r.name_compact),
      transition: countBy(by('TOTAL'), r => `${r.name_compact} prev=${r.previous_row_type} next=${r.next_row_type || 'BLOCK_END'}`),
      equalsSumOfEarlierTotals: countBy(by('TOTAL'), r => `${r.name_compact} ${r.equals_sum_of_earlier_totals === '' ? 'no_earlier_total' : r.equals_sum_of_earlier_totals}`),
      equalsEarlier: countBy(by('TOTAL'), r => `${r.name_compact} equals_earlier=${r.equals_earlier_row_type || 'none'}${r.equals_earlier_row_type === 'CODE3' ? ` level=${index.get(`${r.table_block_id}#${r.equals_earlier_row_index}`)!.code3_page_level}` : ''}`),
      blockTotalSequence: countBy(blocks, b => `${b.context_syntactic_class} ${b.total_sequence}`),
    },
    pageBoundary: {
      count: boundaries.length,
      rowTypeTransition: countBy(boundaries, b => `${b.prev}>${b.next}`),
      minCode3ColumnAcrossBoundary: countBy(shift, s => s),
      pageHeadNeedsEarlierPageParentRuleA: ambiguities.filter(a => a.ambiguity_type === 'PAGE_HEAD_PARENT_ON_EARLIER_PAGE').length,
    },
    ambiguity: {
      total: ambiguities.length,
      byType: countBy(ambiguities, a => a.ambiguity_type),
      rowsWithAny: new Set(ambiguities.map(a => `${a.table_block_id}#${a.row_index}`)).size,
      blocksWithAny: new Set(ambiguities.map(a => a.table_block_id)).size,
    },
    arithmeticCaveat: { allZeroRows: rows.filter(r => r.all_zero).length },
  };
}
