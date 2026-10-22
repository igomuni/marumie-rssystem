import { describe, expect, it } from 'vitest';
import { mofMokuCode, pairByName, reqMokuCode } from './budget-request-mof-detail';

describe('pairByName', () => {
  it('sums same-name rows, keeps the MOF order, and puts request-only rows after the last MOF row with the same code', () => {
    const req = [
      { name: '庁費', code: '95016-09', amt: 10 }, { name: '職員旅費', code: '95016-08', amt: 3 },
      { name: '庁費', code: '95016-09', amt: 5 }, { name: '調査費', code: '95016-09', amt: 7 }, { name: '拠出金', code: '95016-16', amt: 0 },
    ];
    const mof = [{ name: '職員旅費', code: '95016-08', amt: 2 }, { name: '庁費', code: '95016-09', amt: 12 }, { name: '移転費', code: '95016-09', amt: 1 }];
    expect(pairByName(req, mof)).toEqual([
      ['職員旅費', '95016-08', 3, 2], ['庁費', '95016-09', 15, 12], ['移転費', '95016-09', null, 1], ['調査費', '95016-09', 7, null], ['拠出金', '95016-16', 0, null],
    ]);
  });
  it('treats a blank amount on a present side as 0 and an absent side as null', () => {
    expect(pairByName([{ name: 'A', amt: null }], [])).toEqual([['A', '', 0, null]]);
  });
});

describe('codes', () => {
  it('takes 主要経費＋目的別 and 目別 on both sides', () => {
    expect(reqMokuCode('95016-2725-16-9902')).toBe('95016-16');
    expect(reqMokuCode('65061-9-18-1010、65061-9-18-1020')).toBe('65061-18');
    expect(mofMokuCode({ 主要経費別分類コード: '95', 目的別分類コード: '016', 目別分類コード: '16' })).toBe('95016-16');
  });
});
