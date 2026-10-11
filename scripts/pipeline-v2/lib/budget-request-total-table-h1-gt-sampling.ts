/**
 * H1 (structural hierarchy) GT sampling frame and A/B annotation comparison for the FY2024 総表.
 *
 * Sampling / review preparation only: this module does NOT infer parents (no resolver).
 * Spec of the v0 input: docs/budget-request-total-table-csv.md
 */
import { createHash } from 'crypto';
import { AMOUNT_FIELDS, signedValue, type LogicalRow, type SourceResult } from './budget-request-total-table';
import { isDetailWithCode3Breakdown, type Ambiguity, type ContextSurvey, type RowSurvey } from './budget-request-total-table-hierarchy-p0';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// ---------- duplicate blocks ----------

/** Content fingerprint of a block: CONTEXT text + every row's grammar fields, name and 7 cells (no source/page/line). */
export function blockFingerprint(contextText: string, rows: LogicalRow[]): string {
  return sha256(JSON.stringify([
    contextText,
    rows.map(r => [r.row_type, r.request_no_raw, r.code_raw, r.name_compact, r.detail_page_raw,
      AMOUNT_FIELDS.map(f => `${r.cells[f].sign_raw}${r.cells[f].amount_raw}`)]),
  ]));
}

export interface BlockRef { source_file: string; table_block_id: string; fingerprint: string; row_count: number }
export interface DuplicateGroup { fingerprint: string; canonical_table_block_id: string; members: BlockRef[] }

/** Canonical block of each fingerprint group = lexical first (source_file, table_block_id). No manual choice. */
export function canonicalizeBlocks(blocks: BlockRef[]): { canonical: Set<string>; groups: DuplicateGroup[] } {
  const byFp = new Map<string, BlockRef[]>();
  for (const b of blocks) byFp.set(b.fingerprint, [...(byFp.get(b.fingerprint) ?? []), b]);
  const canonical = new Set<string>();
  const groups: DuplicateGroup[] = [];
  for (const [fingerprint, members] of byFp) {
    const sorted = [...members].sort((x, y) => cmp(x.source_file, y.source_file) || cmp(x.table_block_id, y.table_block_id));
    canonical.add(sorted[0].table_block_id);
    if (sorted.length > 1) groups.push({ fingerprint, canonical_table_block_id: sorted[0].table_block_id, members: sorted });
  }
  groups.sort((x, y) => cmp(x.canonical_table_block_id, y.canonical_table_block_id));
  return { canonical, groups };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- strata ----------

export const RELATION_STRATA = [
  ['S1_DETAIL_CHILD_CODE3', 12],
  ['S2_PAGE_CARRY', 12],
  ['S3_NESTED_CODE3', 18],
  ['S4_HIER', 12],
  ['S5_ALL_ZERO', 12],
  ['S6_SINGLE_CHILD_DEGENERATION', 12],
  ['S7_SIMPLE_CODE3_DETAIL', 24],
  ['S8_OTHER_COMMON', 12],
] as const;
export type RelationStratum = typeof RELATION_STRATA[number][0];

export const TOTAL_STRATA = [['T_組織計', 8], ['T_所管計', 8], ['T_会計計', 8]] as const;
export const CONTEXT_SAMPLE_SIZE = 8;

const rowKey = (blockId: string, rowIndex: number) => `${blockId}#${rowIndex}`;
const cellsOf = (r: LogicalRow) => AMOUNT_FIELDS.map(f => signedValue(r.cells[f]).toString()).join(',');

export interface StratumContext {
  survey: RowSurvey[];
  v0Rows: LogicalRow[];
  ambiguities: Ambiguity[];
}

/**
 * Mutually exclusive stratum assignment for every HIER / CODE3 / DETAIL row (first matching predicate wins).
 * Predicates use only P0 survey fields; they define the sampling frame, not a parent decision.
 */
export function assignRelationStrata({ survey, v0Rows, ambiguities }: StratumContext): Map<string, RelationStratum> {
  const v0 = new Map(v0Rows.map(r => [rowKey(r.table_block_id, r.row_index), r]));
  const sv = new Map(survey.map(r => [rowKey(r.table_block_id, r.row_index), r]));
  const flagged = new Set(ambiguities.map(a => rowKey(a.table_block_id, a.row_index)));
  const pageCarry = new Set(ambiguities.filter(a => a.ambiguity_type === 'PAGE_HEAD_PARENT_ON_EARLIER_PAGE').map(a => rowKey(a.table_block_id, a.row_index)));

  // S1: CODE3 rows inside the prefix-sum range of a DETAIL broken down by following CODE3 rows.
  const detailChildCode3 = new Set<string>();
  for (const d of survey.filter(isDetailWithCode3Breakdown)) {
    for (let k = d.row_index + 1; k <= (d.next_type_prefix_sum_end_row_index as number); k++) {
      if (sv.get(rowKey(d.table_block_id, k))?.row_type === 'CODE3') detailChildCode3.add(rowKey(d.table_block_id, k));
    }
  }

  const out = new Map<string, RelationStratum>();
  for (const r of survey) {
    if (r.row_type === 'TOTAL') continue;
    const key = rowKey(r.table_block_id, r.row_index);
    const prev = r.previous_row_index === '' ? undefined : v0.get(rowKey(r.table_block_id, r.previous_row_index));
    const parentA = r.candidate_parent_rule_a_row_index === '' ? undefined : sv.get(rowKey(r.table_block_id, r.candidate_parent_rule_a_row_index));
    let s: RelationStratum;
    if (detailChildCode3.has(key)) s = 'S1_DETAIL_CHILD_CODE3';
    else if (pageCarry.has(key)) s = 'S2_PAGE_CARRY';
    else if (r.row_type === 'CODE3' && r.code3_page_level !== '' && r.code3_page_level >= 2) s = 'S3_NESTED_CODE3';
    else if (r.row_type === 'HIER') s = 'S4_HIER';
    else if (r.all_zero) s = 'S5_ALL_ZERO';
    // S6: the immediately preceding non-TOTAL row has identical 7 cells (parent/child equal-amount degeneration candidate).
    else if (prev && prev.row_type !== 'TOTAL' && cellsOf(prev) === cellsOf(v0.get(key)!)) s = 'S6_SINGLE_CHILD_DEGENERATION';
    else if (r.row_type === 'DETAIL' && !flagged.has(key) && r.candidate_parent_status === 'AGREE'
      && parentA?.row_type === 'CODE3' && parentA.source_page === r.source_page) s = 'S7_SIMPLE_CODE3_DETAIL';
    else s = 'S8_OTHER_COMMON';
    out.set(key, s);
  }
  return out;
}

// ---------- deterministic selection ----------

export const selectionKey = (stratum: string, sourceFile: string, blockId: string, rowIndex: number | string) =>
  `${stratum}|${sourceFile}|${blockId}|${rowIndex}`;

/** Ascending SHA-256 of the selection key; first n. No randomness. */
export function selectByHash<T>(items: T[], key: (t: T) => string, n: number): T[] {
  return items.map(it => ({ it, h: sha256(key(it)) })).sort((a, b) => cmp(a.h, b.h)).slice(0, n).map(x => x.it);
}

export interface SampleUnit {
  sample_id: string;
  unit_kind: 'RELATION' | 'TOTAL_SCOPE' | 'CONTEXT_ROOT';
  stratum: string;
  stratum_population: number;
  source_file: string;
  table_block_id: string;
  target_row_index: number | '';
  target_row_type: string;
  target_code_raw: string;
  target_name_compact: string;
  source_page: number;
  source_line_start: number;
  selection_key: string;
  selection_sha256: string;
  forced_inclusion: boolean;
}

export interface SamplingInput {
  survey: RowSurvey[];
  v0Rows: LogicalRow[];
  ambiguities: Ambiguity[];
  contexts: ContextSurvey[];
  canonical: Set<string>;
}

/** TOTAL rows equal to a CODE3 that sits on the 2nd CODE3 column level of its page (P0: 組織計 single-child degeneration). */
export const isKnownTotalDegeneration = (t: RowSurvey, sv: Map<string, RowSurvey>) =>
  t.row_type === 'TOTAL' && t.equals_earlier_row_type === 'CODE3'
  && sv.get(rowKey(t.table_block_id, t.equals_earlier_row_index as number))?.code3_page_level === 2;

export function buildSample(input: SamplingInput): { units: SampleUnit[]; populations: Record<string, number> } {
  const { survey, contexts, canonical } = input;
  const canon = survey.filter(r => canonical.has(r.table_block_id));
  const strata = assignRelationStrata({ ...input, survey: canon });
  const sv = new Map(canon.map(r => [rowKey(r.table_block_id, r.row_index), r]));
  const units: SampleUnit[] = [];
  const populations: Record<string, number> = {};
  const unit = (kind: SampleUnit['unit_kind'], stratum: string, pop: number, r: RowSurvey, forced: boolean, prefix: string, k: number): SampleUnit => {
    const key = selectionKey(stratum, r.source_file, r.table_block_id, r.row_index);
    return {
      sample_id: `${prefix}-${String(k + 1).padStart(3, '0')}`, unit_kind: kind, stratum, stratum_population: pop,
      source_file: r.source_file, table_block_id: r.table_block_id, target_row_index: r.row_index, target_row_type: r.row_type,
      target_code_raw: r.code_raw, target_name_compact: r.name_compact, source_page: r.source_page, source_line_start: r.source_line_start,
      selection_key: key, selection_sha256: sha256(key), forced_inclusion: forced,
    };
  };

  RELATION_STRATA.forEach(([stratum, n], si) => {
    const pop = canon.filter(r => strata.get(rowKey(r.table_block_id, r.row_index)) === stratum);
    populations[stratum] = pop.length;
    selectByHash(pop, r => selectionKey(stratum, r.source_file, r.table_block_id, r.row_index), n)
      .forEach((r, k) => units.push(unit('RELATION', stratum, pop.length, r, false, `R${si + 1}`, k)));
  });

  TOTAL_STRATA.forEach(([stratum, n], si) => {
    const pop = canon.filter(r => r.row_type === 'TOTAL' && `T_${r.name_compact}` === stratum);
    populations[stratum] = pop.length;
    const forced = pop.filter(t => isKnownTotalDegeneration(t, sv));
    const rest = selectByHash(pop.filter(t => !forced.includes(t)), r => selectionKey(stratum, r.source_file, r.table_block_id, r.row_index), n - forced.length);
    // Forced units first, then hash order; sample_id order is fixed by this sequence.
    [...forced.map(r => [r, true] as const), ...rest.map(r => [r, false] as const)]
      .forEach(([r, f], k) => units.push(unit('TOTAL_SCOPE', stratum, pop.length, r, f, `T${si + 1}`, k)));
  });

  const ctx = contexts.filter(c => c.line_class === 'CONTEXT' && canonical.has(c.table_block_id));
  populations.CONTEXT_ROOT = ctx.length;
  selectByHash(ctx, c => selectionKey('CONTEXT_ROOT', c.source_file, c.table_block_id, 0), CONTEXT_SAMPLE_SIZE).forEach((c, k) => {
    const key = selectionKey('CONTEXT_ROOT', c.source_file, c.table_block_id, 0);
    units.push({
      sample_id: `C-${String(k + 1).padStart(3, '0')}`, unit_kind: 'CONTEXT_ROOT', stratum: 'CONTEXT_ROOT', stratum_population: ctx.length,
      source_file: c.source_file, table_block_id: c.table_block_id, target_row_index: '', target_row_type: 'CONTEXT',
      target_code_raw: c.code_raw, target_name_compact: c.text_compact, source_page: c.source_page, source_line_start: c.source_line,
      selection_key: key, selection_sha256: sha256(key), forced_inclusion: false,
    });
  });
  return { units, populations };
}

/** Annotator-facing view of a block: rows with signed integer cells (△ → negative). */
export function blockRowsForAnnotation(rows: LogicalRow[]) {
  return rows.map(r => ({
    row_index: r.row_index, row_type: r.row_type, request_no_raw: r.request_no_raw, code_raw: r.code_raw, name_compact: r.name_compact,
    source_page: r.source_page, source_line_start: r.source_line_start, source_line_end: r.source_line_end, detail_page_raw: r.detail_page_raw,
    ...Object.fromEntries(AMOUNT_FIELDS.map(f => [f, signedValue(r.cells[f]).toString()])),
  }));
}

/** Raw text of the block's pages, each physical line prefixed with page / line numbers. */
export function blockRawExcerpt(text: string, pages: number[]): string {
  // Same numbering as v0 source_line_*: 1-based over text.split('\n'); a Form Feed starts the next page.
  const out: string[] = [];
  let page = 1;
  text.split('\n').forEach((l, i) => {
    page += (l.match(/\f/gu) ?? []).length;
    if (pages.includes(page)) out.push(`p${page} L${i + 1}| ${l.replace(/\f/gu, '')}`);
  });
  return out.join('\n') + '\n';
}

// ---------- A/B comparison ----------

export const STATUSES = ['RESOLVED', 'AMBIGUOUS', 'NO_PARENT', 'NOT_APPLICABLE'] as const;
export const SCOPE_STATUSES = ['RESOLVED', 'AMBIGUOUS'] as const;

export interface RelationAnnotation { sample_id: string; status: string; parent_ref: string; evidence_codes: string; notes: string }
export interface TotalAnnotation { sample_id: string; scope_status: string; direct_child_row_indices: string; evidence_codes: string; notes: string }

const normRef = (s: string) => s.trim();
const normChildren = (s: string) => [...new Set(s.split(/[;,\s]+/u).filter(Boolean).map(Number))].sort((a, b) => a - b).join(';');

export function relationAgreement(a: RelationAnnotation, b: RelationAnnotation): boolean {
  if (a.status !== b.status) return false;
  return a.status !== 'RESOLVED' || normRef(a.parent_ref) === normRef(b.parent_ref);
}

export function totalAgreement(a: TotalAnnotation, b: TotalAnnotation): boolean {
  if (a.scope_status !== b.scope_status) return false;
  return a.scope_status !== 'RESOLVED' || normChildren(a.direct_child_row_indices) === normChildren(b.direct_child_row_indices);
}

export const normalizeChildren = normChildren;

/** Validate one annotator file against the manifest: every sample_id exactly once and a known status. */
export function validateAnnotations<T extends { sample_id: string }>(rows: T[], ids: string[], status: (t: T) => string, allowed: readonly string[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.sample_id, (seen.get(r.sample_id) ?? 0) + 1);
  for (const id of ids) if (seen.get(id) !== 1) errors.push(`${id}: count=${seen.get(id) ?? 0}`);
  for (const id of seen.keys()) if (!ids.includes(id)) errors.push(`${id}: not in manifest`);
  for (const r of rows) if (!allowed.includes(status(r))) errors.push(`${r.sample_id}: unknown status ${status(r)}`);
  return errors;
}

/** Deterministic 25% audit of A/B-agreed units per stratum: ascending SHA-256 of `AUDIT|<sample_id>`, ceil(n/4). */
export function selectAudit(agreed: { sample_id: string; stratum: string }[]): Set<string> {
  const byStratum = new Map<string, string[]>();
  for (const u of agreed) byStratum.set(u.stratum, [...(byStratum.get(u.stratum) ?? []), u.sample_id]);
  const out = new Set<string>();
  for (const ids of byStratum.values()) {
    selectByHash(ids, id => `AUDIT|${id}`, Math.ceil(ids.length / 4)).forEach(id => out.add(id));
  }
  return out;
}

// ---------- CSV ----------

export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rec.push(field); field = '';
      if (rec.length > 1 || rec[0] !== '') records.push(rec);
      rec = [];
    } else field += c;
  }
  if (field !== '' || rec.length) { rec.push(field); records.push(rec); }
  const [header, ...body] = records;
  return body.map(r => Object.fromEntries(header.map((h, k) => [h.trim(), (r[k] ?? '').trim()])));
}
