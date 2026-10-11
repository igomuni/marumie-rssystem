import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSource } from './budget-request-total-table';
import { findAmbiguities, surveySource } from './budget-request-total-table-hierarchy-p0';
import {
  assignRelationStrata, blockFingerprint, blockRawExcerpt, buildSample, canonicalizeBlocks, parseCsv, relationAgreement,
  selectAudit, selectByHash, totalAgreement, validateAnnotations,
} from './budget-request-total-table-h1-gt-sampling';

// Reuses the frozen v0 fixtures (verbatim raw-text excerpts).
const fixtureDir = path.join(process.cwd(), 'tests/fixtures/budget-request-total-table/2024');
const load = (name: string) => {
  const text = fs.readFileSync(path.join(fixtureDir, `${name}.txt`), 'utf8');
  const v0 = parseSource(text, `${name}.txt`, name);
  const s = surveySource(text, v0);
  return { text, v0, ...s };
};

describe('duplicate blocks', () => {
  it('fingerprints content only and picks the lexically first source as canonical', () => {
    const { v0, contexts } = load('env-000157013');
    const ctx = contexts.find(c => c.line_class === 'CONTEXT')!.text_compact;
    const moved = v0.rows.map(r => ({ ...r, source_file: 'z.txt', source_page: r.source_page + 9, table_block_id: 'z#b1' }));
    const fp = blockFingerprint(ctx, v0.rows);
    expect(blockFingerprint(ctx, moved)).toBe(fp);
    expect(blockFingerprint(`${ctx}x`, v0.rows)).not.toBe(fp);
    const refs = [
      { source_file: 'meti.txt', table_block_id: 'meti#b1', fingerprint: fp, row_count: 30 },
      { source_file: 'env.txt', table_block_id: 'env#b1', fingerprint: fp, row_count: 30 },
      { source_file: 'a.txt', table_block_id: 'a#b1', fingerprint: 'other', row_count: 3 },
    ];
    const { canonical, groups } = canonicalizeBlocks(refs);
    expect([...canonical].sort()).toEqual(['a#b1', 'env#b1']);
    expect(groups).toHaveLength(1);
    expect(canonicalizeBlocks([...refs].reverse()).groups[0].canonical_table_block_id).toBe('env#b1');
  });
});

describe('strata and selection', () => {
  it('assigns CODE3 rows under a DETAIL breakdown to S1 before any other stratum', () => {
    const { v0, rows } = load('env-000157010');
    const strata = assignRelationStrata({ survey: rows, v0Rows: v0.rows, ambiguities: findAmbiguities(rows, []) });
    const d = rows.find(r => r.row_type === 'DETAIL' && r.request_no_raw === '38')!;
    expect(strata.get(`${d.table_block_id}#${d.row_index + 1}`)).toBe('S1_DETAIL_CHILD_CODE3');
    expect([...strata.keys()].length).toBe(rows.filter(r => r.row_type !== 'TOTAL').length);
  });

  it('selects by ascending SHA-256 independent of input order and caps at population', () => {
    const ids = Array.from({ length: 30 }, (_, k) => `u${k}`);
    const a = selectByHash(ids, x => x, 5);
    expect(selectByHash([...ids].reverse(), x => x, 5)).toEqual(a);
    expect(selectByHash(ids.slice(0, 3), x => x, 12)).toHaveLength(3);
  });

  it('builds the same sample twice and keeps duplicate copies out of the frame', () => {
    const names = ['mext-02', 'env-000157010', 'env-000157012', 'env-000157013', 'meti-enegen'];
    const run = () => {
      const loaded = names.map(load);
      const rows = loaded.flatMap(l => l.rows);
      const contexts = loaded.flatMap(l => l.contexts);
      const canonical = new Set(loaded.flatMap(l => l.v0.blocks.map(b => b.table_block_id)).filter(id => !id.startsWith('meti')));
      return buildSample({ survey: rows, v0Rows: loaded.flatMap(l => l.v0.rows), ambiguities: findAmbiguities(rows, contexts), contexts, canonical });
    };
    const s = run();
    expect(JSON.stringify(run())).toBe(JSON.stringify(s));
    expect(s.units.some(u => u.table_block_id.startsWith('meti'))).toBe(false);
    expect(new Set(s.units.map(u => u.sample_id)).size).toBe(s.units.length);
    expect(s.units.filter(u => u.unit_kind === 'RELATION').every(u => u.target_row_type !== 'TOTAL')).toBe(true);
  });
});

describe('annotation package and comparison', () => {
  it('numbers raw excerpt lines like v0 source_line_start', () => {
    const { text, v0 } = load('mext-02');
    const excerpt = blockRawExcerpt(text, v0.blocks[0].pages);
    const r = v0.rows.find(x => x.request_no_raw === '22')!;
    const line = excerpt.split('\n').find(l => l.startsWith(`p${r.source_page} L${r.source_line_start}|`))!;
    expect(line).toContain(r.code_raw);
  });

  it('compares A/B exactly and validates coverage of the manifest', () => {
    const base = { sample_id: 'R1-001', evidence_codes: '', notes: '' };
    expect(relationAgreement({ ...base, status: 'RESOLVED', parent_ref: 'row:3' }, { ...base, status: 'RESOLVED', parent_ref: 'row:3' })).toBe(true);
    expect(relationAgreement({ ...base, status: 'RESOLVED', parent_ref: 'row:3' }, { ...base, status: 'RESOLVED', parent_ref: 'row:4' })).toBe(false);
    expect(relationAgreement({ ...base, status: 'AMBIGUOUS', parent_ref: 'row:3' }, { ...base, status: 'AMBIGUOUS', parent_ref: '' })).toBe(true);
    const t = { sample_id: 'T1-001', evidence_codes: '', notes: '' };
    expect(totalAgreement({ ...t, scope_status: 'RESOLVED', direct_child_row_indices: '5;3' }, { ...t, scope_status: 'RESOLVED', direct_child_row_indices: '3; 5' })).toBe(true);
    expect(totalAgreement({ ...t, scope_status: 'RESOLVED', direct_child_row_indices: '3' }, { ...t, scope_status: 'RESOLVED', direct_child_row_indices: '3;5' })).toBe(false);
    expect(validateAnnotations([{ sample_id: 'a', s: 'RESOLVED' }, { sample_id: 'a', s: 'X' }], ['a', 'b'], r => r.s, ['RESOLVED']))
      .toEqual(['a: count=2', 'b: count=0', 'a: unknown status X']);
  });

  it('selects ceil(25%) of agreed units per stratum deterministically', () => {
    const agreed = [...Array.from({ length: 5 }, (_, k) => ({ sample_id: `A-${k}`, stratum: 'A' })), { sample_id: 'B-0', stratum: 'B' }];
    const audit = selectAudit(agreed);
    expect([...audit].filter(id => id.startsWith('A')).length).toBe(2);
    expect(audit.has('B-0')).toBe(true);
    expect([...selectAudit([...agreed].reverse())].sort()).toEqual([...audit].sort());
  });

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\n"x,1","say ""hi"""\n')).toEqual([{ a: 'x,1', b: 'say "hi"' }]);
  });
});
