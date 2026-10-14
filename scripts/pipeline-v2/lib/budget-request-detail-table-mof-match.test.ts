import { describe, expect, it } from 'vitest';
import {
  indexMofByMinistryName,
  matchDetailSource,
  parseCsv,
  renderMatchCsv,
  type DetailCsvRow,
  type MofJikouRecord,
} from './budget-request-detail-table-mof-match';

const row = (row_type: string, 事項: string, row_index = '0'): DetailCsvRow => ({ 事項, row_type, row_index, source_page: '1', 頁: '' });
const mof = (sectionName: string, jikouName: string, ministry = '防衛省'): MofJikouRecord =>
  ({ ministry, organization: ministry, sectionCode: '001', sectionName, jikouName, col4Raw: '35' });
const ctx = row('CONTEXT', '45 防衛省所管');

describe('matchDetailSource', () => {
  it('J1 単一で immediate X が sectionName と一致すれば K2_SUPPORTED', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', '艦船整備に必要な経費')]);
    const [r] = matchDetailSource('s', [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 艦船整備に必要な経費')], index);
    expect(r.status).toBe('K2_SUPPORTED');
    expect(r.x_source).toBe('immediate');
    expect(r.mof?.sectionName).toBe('艦船整備費');
  });

  it('immediate X が無ければ、immediate X を持つ直近の先行 DETAIL の X を持ち越す', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', 'A'), mof('艦船整備費', 'B')]);
    const rows = [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 A'), row('CODE_5_4_2_4', 'x'), row('DETAIL', '02‑35 B')];
    const out = matchDetailSource('s', rows, index);
    expect(out[1]).toMatchObject({ status: 'K2_SUPPORTED', x_source: 'anchor', x: '艦船整備費' });
  });

  it('J1 単一でも sectionName が X と違えば unresolved（J1 単独へ fallback しない）', () => {
    const index = indexMofByMinistryName([mof('別の項', 'A')]);
    const [r] = matchDetailSource('s', [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 A')], index);
    expect(r).toMatchObject({ status: 'UNRESOLVED_SECTION_MISMATCH', j1_candidates: 1, k2_candidates: 0, mof: null });
  });

  it('X が取れなければ UNRESOLVED_NO_X', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', 'A')]);
    const [r] = matchDetailSource('s', [ctx, row('DETAIL', '01‑35 A')], index);
    expect(r).toMatchObject({ status: 'UNRESOLVED_NO_X', k2_candidates: null });
  });

  it('J1 複数は K2 で1候補になっても AMBIGUOUS のまま（diagnostic だけ）', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', 'A'), mof('別の項', 'A')]);
    const [r] = matchDetailSource('s', [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 A')], index);
    expect(r).toMatchObject({ status: 'AMBIGUOUS_J1_MULTI', j1_candidates: 2, k2_candidates: 1, mof: null });
  });

  it('事項名は正規化せずに比べる', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', 'Ａ')]);
    const [r] = matchDetailSource('s', [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 A')], index);
    expect(r.status).toBe('UNRESOLVED_J1_NO_CANDIDATE');
  });

  it('CONTEXT の形で source を対象外にする', () => {
    const index = indexMofByMinistryName([]);
    const d = row('DETAIL', '01‑35 A');
    expect(matchDetailSource('s', [d], index)[0].status).toBe('OUT_OF_SCOPE_NO_CONTEXT');
    expect(matchDetailSource('s', [row('CONTEXT', '0617 エネルギー対策特別会計'), d], index)[0].status).toBe('OUT_OF_SCOPE_SPECIAL_ACCOUNT');
    expect(matchDetailSource('s', [row('CONTEXT', '防衛省'), d], index)[0].status).toBe('OUT_OF_SCOPE_CONTEXT_NOT_MINISTRY');
    expect(matchDetailSource('s', [ctx, row('DETAIL', '01 A')], index)[0].status).toBe('OUT_OF_SCOPE_DETAIL_CODE_PATTERN');
  });
});

describe('parseCsv / renderMatchCsv', () => {
  it('引用符・カンマを扱い、値を trim せず、空行を読み飛ばす', () => {
    expect(parseCsv('a,b\n" x,1","say ""hi"""\n\nc ,d\n')).toEqual([{ a: ' x,1', b: 'say "hi"' }, { a: 'c ', b: 'd' }]);
  });

  it('K2_SUPPORTED だけ MOF の列を埋める', () => {
    const index = indexMofByMinistryName([mof('艦船整備費', 'A')]);
    const csv = renderMatchCsv(matchDetailSource('s', [ctx, row('CODE3', '820 艦船整備費'), row('DETAIL', '01‑35 A', '3')], index));
    expect(csv.split('\n')[1]).toBe('s,3,1,,01‑35,A,防衛省,immediate,艦船整備費,1,1,K2_SUPPORTED,防衛省,001,艦船整備費,A,35');
  });
});
