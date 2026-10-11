import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSource } from './budget-request-total-table';
import {
  buildPatternSummary,
  findAmbiguities,
  measureRow,
  surveyBlocks,
  surveySource,
} from './budget-request-total-table-hierarchy-p0';

// Reuses the frozen v0 fixtures (verbatim raw-text excerpts).
const fixtureDir = path.join(process.cwd(), 'tests/fixtures/budget-request-total-table/2024');
const load = (name: string) => {
  const text = fs.readFileSync(path.join(fixtureDir, `${name}.txt`), 'utf8');
  const v0 = parseSource(text, name, name);
  return { text, v0, survey: surveySource(text, v0) };
};
const row = (s: ReturnType<typeof load>['survey'], pred: (r: ReturnType<typeof load>['survey']['rows'][number]) => boolean) => {
  const found = s.rows.find(pred);
  if (!found) throw new Error('row not found');
  return found;
};

describe('raw geometry', () => {
  it('measures request/code/name/tail columns on the first physical line', () => {
    const line = '6     50‑15 客観的根拠に基づく教育政策立案の推進に必                                      0         4,383,885';
    const g = measureRow(`${line}         4,383,885                 0          4,915,977        4,915,977             532,092    131`, { row_type: 'DETAIL', request_no_raw: '6', code_raw: '50‑15' });
    expect(g).toMatchObject({ line_leading_column: 0, request_no_start_column: 0, code_start_column: 6, name_start_column: 12 });
    expect(g.numeric_tail_start_column).toBe(line.indexOf('0 '));
  });

  it('surveys every v0 row with unchanged provenance and does not mutate v0 output', () => {
    const { text, v0, survey } = load('mext-02');
    const before = JSON.stringify(v0.rows);
    const again = surveySource(text, v0);
    expect(JSON.stringify(v0.rows)).toBe(before);
    expect(survey.rows.map(r => [r.row_index, r.source_page, r.source_line_start, r.source_line_end]))
      .toEqual(v0.rows.map(r => [r.row_index, r.source_page, r.source_line_start, r.source_line_end]));
    expect(JSON.stringify(again)).toBe(JSON.stringify(survey));
  });
});

describe('context and HIER (syntactic classes only)', () => {
  it('classifies CONTEXT lines by code width and literal markers', () => {
    const mext = load('mext-02').survey.contexts.find(c => c.line_class === 'CONTEXT')!;
    expect(mext).toMatchObject({ syntactic_class: 'CONTEXT_CODE2', code_raw: '24', text_compact: '文部科学省所管', marker_shozokan: true, rows_before_in_block: 0 });
    const env = load('env-000157013').survey.contexts.find(c => c.line_class === 'CONTEXT')!;
    expect(env).toMatchObject({ syntactic_class: 'CONTEXT_CODE4', code_raw: '9905', marker_tokubetsu_kaikei: true, marker_kanjou: true });
  });

  it('records HIER code form without assigning a role', () => {
    const hier = load('env-000157013').survey.rows.filter(r => r.row_type === 'HIER');
    expect(hier.map(r => [r.code_raw, r.hier_code_form])).toEqual([['05', 'CODE2_ZERO_PADDED'], ['2', 'CODE1']]);
  });
});

describe('arithmetic observations', () => {
  it('detects a CODE3 equal to the sum of its following DETAIL run (mext 010 文部科学本省共通費)', () => {
    const r = row(load('mext-02').survey, x => x.row_type === 'CODE3' && x.name_compact === '文部科学本省共通費');
    expect([r.following_detail_run_count, r.following_detail_run_sum_equals]).toEqual([3, true]);
    // The organization row 010 文部科学本省 has the same form and column but is followed by a CODE3, not a DETAIL run.
    const org = row(load('mext-02').survey, x => x.row_type === 'CODE3' && x.name_compact === '文部科学本省');
    expect([org.following_detail_run_count, org.code_start_column]).toEqual([0, r.code_start_column]);
  });

  it('detects a DETAIL broken down by following CODE3 rows (env nested CODE3)', () => {
    const { survey } = load('env-000157010');
    const d = row(survey, x => x.row_type === 'DETAIL' && x.request_no_raw === '38');
    expect(d.next_row_type).toBe('CODE3');
    expect(d.next_type_prefix_sum_end_row_index).toBe(d.row_index + 1);
    expect(findAmbiguities(survey.rows, survey.contexts).some(a => a.ambiguity_type === 'DETAIL_HAS_CODE3_BREAKDOWN' && a.row_index === d.row_index)).toBe(true);
  });

  it('reports TOTAL relations as observed (excerpt omits organizations, so 所管計 does not equal earlier totals)', () => {
    const t = row(load('mext-02').survey, x => x.name_compact === '所管計');
    expect([t.equals_sum_of_earlier_totals, t.preceding_total_type, t.rows_after_in_block]).toEqual([false, '組織計', 0]);
  });
});

describe('parent candidates and ambiguity', () => {
  it('keeps Rule A / Rule B as candidates and lists page-head carry-over', () => {
    const { survey } = load('mext-02');
    const first = row(survey, x => x.request_no_raw === '22');
    expect(first).toMatchObject({ page_boundary_before: true, source_page: 2, candidate_parent_rule_b_row_index: '' });
    // The excerpt omits the rest of page 1, so the nearest earlier CODE3 is 030 (in the full source it is 060).
    expect(survey.rows.find(x => x.row_index === first.candidate_parent_rule_a_row_index)?.code_raw).toBe('030');
    const types = findAmbiguities(survey.rows, survey.contexts).filter(a => a.row_index === first.row_index).map(a => a.ambiguity_type);
    expect(types).toContain('PAGE_HEAD_PARENT_ON_EARLIER_PAGE');
  });

  it('builds block survey and summary deterministically', () => {
    const names = ['mext-02', 'env-000157010', 'env-000157012', 'env-000157013', 'meti-enegen'];
    const run = () => {
      const loaded = names.map(load);
      const rows = loaded.flatMap(l => l.survey.rows);
      const contexts = loaded.flatMap(l => l.survey.contexts);
      const blocks = surveyBlocks(loaded.map(l => l.v0), rows, contexts);
      const amb = findAmbiguities(rows, contexts);
      return JSON.stringify({ blocks, amb, summary: buildPatternSummary(rows, contexts, blocks, amb) });
    };
    const out = run();
    expect(run()).toBe(out);
    const parsed = JSON.parse(out);
    expect(parsed.blocks).toHaveLength(5);
    expect(parsed.blocks[0]).toMatchObject({ table_block_id: 'mext-02#b1', page_boundary_count: 3, context_code_raw: '24', CODE3_count: expect.any(Number) });
  });
});
