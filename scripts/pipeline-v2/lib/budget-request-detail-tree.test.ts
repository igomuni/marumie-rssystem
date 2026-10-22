import { describe, expect, it } from 'vitest';
import { groupMoku, mokuReq, parseMoku, walkRows } from './budget-request-detail-tree';

// 明細表 CSV の行（必要な列だけ）
const row = (row_type: string, 事項: string, req = '', prev = '', 要求番号 = '', source_page = '1') => ({ row_type, 事項, 前年度予算額: prev, '６年度概算要求額': req, 要求番号, source_page });

describe('parseMoku', () => {
  it('splits the code and keeps a missing middle digit as is', () => {
    expect(parseMoku('95016‑ 111‑02‑0000 職員基本給')).toEqual({ c1: '95016', x: '111', yy: '02', zz: '0000', name: '職員基本給', raw: '95016‑ 111‑02‑0000 職員基本給' });
    expect(parseMoku('02‑0100 職員俸給')).toBeNull();
  });
});

describe('walkRows', () => {
  const kous = [{ code: '010', name: '事務取扱費' }, { code: '020', name: '施設費' }];
  it('assigns 事項 and 目 to the listed 項; sub-headings (CODE3 not followed by DETAIL) do not move the range', () => {
    const w = walkRows([
      row('CODE3', '010 事務取扱費', '100'),
      row('DETAIL', '01‑95 事務取扱いに必要な経費', '100', '', '1'),
      row('CODE3', '001 既定定員に伴う経費'),
      row('CODE_5_4_2_4', '95016‑2111‑02‑0000 職員基本給', '60'),
      row('CODE_5_4_2_4', '95016‑2111‑03‑0000 職員諸手当', '40'),
      row('CODE3', '020 施設費', '5'),
      row('DETAIL', '01‑95 施設整備に必要な経費', '5', '', '2'),
      row('CODE_5_4_2_4', '95016‑2214‑12‑0000 施設整備費', '5'),
    ], kous, '事項');
    expect(w.jikous.map(j => [j.owner, j.name, j.moku.map(m => m.name)])).toEqual([
      [{ kou: 0 }, '事務取扱いに必要な経費', ['職員基本給', '職員諸手当']],
      [{ kou: 1 }, '施設整備に必要な経費', ['施設整備費']],
    ]);
    expect(w.unlisted).toEqual([]);
  });
  it('cuts the range at a 項 heading missing from the list (目次に無い項) and closes it at CONTEXT', () => {
    const w = walkRows([
      row('CODE3', '010 事務取扱費', '100'),
      row('DETAIL', '01‑95 事務取扱いに必要な経費', '100', '', '1'),
      row('CODE_5_4_2_4', '95016‑2111‑02‑0000 職員基本給', '100'),
      row('CODE3', '019 石油石炭税財源エネルギー対策特別会計へ繰入'),
      row('DETAIL', '01‑63 繰入れに必要な経費', '', '', '2'),
      row('CODE_5_4_2_4', '63051‑2306‑22‑2605 石油石炭税財源のエネルギー対策特別会計へ繰入', '164800000'),
      row('CONTEXT', '9101 東日本大震災復興特別会計'),
      row('CODE_5_4_2_4', '95016‑2111‑02‑0000 職員基本給', '7'),
    ], kous, '事項');
    expect(w.jikous[0].moku.map(mokuReq)).toEqual([100]);
    expect(w.jikous[1].owner).toEqual({ unlisted: '019|石油石炭税財源エネルギー対策特別会計へ繰入' });
    expect(w.unlisted.map(u => u.code)).toEqual(['019']);
    expect(w.orphan).toEqual({ beforeKou: 0, afterContext: 1 });
  });
  it('keeps a heading with a smaller code (followed by 事項) inside the current 項', () => {
    const w = walkRows([
      row('CODE3', '020 施設費', '9'),
      row('DETAIL', '01‑95 施設整備に必要な経費', '5', '', '1'),
      row('CODE3', '011 特別対策費', '4'),
      row('DETAIL', '02‑95 特別対策に必要な経費', '4', '', '2'),
    ], kous, '事項');
    expect(w.jikous.map(j => j.owner)).toEqual([{ kou: 1 }, { kou: 1 }]);
    expect(w.unlisted).toEqual([]);
  });
  it('does not cut at a heading with a larger code when the next 事項 belongs to the current 項 in the TOC', () => {
    const k2 = [{ code: '010', name: '人事院', jikouNames: new Set(['人事行政に必要な経費', '人事交流に必要な経費']) }];
    const w = walkRows([
      row('CODE3', '010 人事院', '10'),
      row('DETAIL', '01‑95 人事行政に必要な経費', '6', '', '1'),
      row('CODE3', '026 諸外国との人事交流に要する経費', '4'),
      row('DETAIL', '02‑95 人事交流に必要な経費', '4', '', '2'),
    ], k2, '事項');
    expect(w.jikous.map(j => j.owner)).toEqual([{ kou: 0 }, { kou: 0 }]);
  });
  it('treats the second of two identical headings as the 項 (organization row first)', () => {
    const w = walkRows([
      row('CODE3', '010 事務取扱費', '12'),
      row('CODE3', '010 事務取扱費', '10'),
      row('DETAIL', '01‑95 事務取扱いに必要な経費', '10', '', '1'),
    ], kous, '事項');
    expect(w.jikous.map(j => j.owner)).toEqual([{ kou: 0 }]);
  });
  it('uses the sum of the sub-items (細分) only when the 目 row itself is blank', () => {
    const w = walkRows([
      row('CODE3', '010 事務取扱費', '30'),
      row('DETAIL', '01‑95 事務取扱いに必要な経費', '30', '', '1'),
      row('CODE_5_4_2_4', '95016‑2111‑02‑0000 職員基本給'),
      row('CODE_NN_NNNN', '02‑0100 職員俸給', '8', '6'),
      row('CODE_NN_NNNN', '02‑0200 扶養手当', '2', '1'),
      row('CODE_5_4_2_4', '95016‑2111‑03‑0000 職員諸手当', '20'),
      row('CODE_NN_NNNN', '03‑0300 通勤手当', '20'),
    ], kous, '事項');
    const ms = w.jikous[0].moku;
    expect(ms.map(mokuReq)).toEqual([10, 20]);
    expect(groupMoku(ms).map(g => [g.name, g.req, g.prev, g.fromSub, g.blanks])).toEqual([['職員基本給', 10, 7, 1, 0], ['職員諸手当', 20, null, 0, 0]]);
  });
});
