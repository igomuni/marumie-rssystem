import { describe, expect, it } from 'vitest';
import { directMatch } from './budget-request-page-classification-direct';

const L = (...t: string[]) => t.map(text => ({ text }));
describe('page classification v0 frozen direct matcher', () => {
  it('行内 whitespace（全角空白含む）の差は許容する', () => {
    expect(directMatch(L('  令和　６年度 概算要求額 総表  '))).toEqual({ kind: 'DIRECT', family: 'SUMMARY' });
  });
  it('目次の項目行（title が行末でない）は hit しない', () => {
    expect(directMatch(L('1.令和６年度歳出概算要求額総表・・・・・・・1'))).toEqual({ kind: 'NONE' });
  });
  it('先頭 5 行より後ろは見ない', () => {
    expect(directMatch(L('a', 'b', 'c', 'd', 'e', '令和６年度概算要求定員表'))).toEqual({ kind: 'NONE' });
    expect(directMatch(L('a', 'b', 'c', 'd', '令和６年度概算要求定員表'))).toEqual({ kind: 'DIRECT', family: 'STAFFING' });
  });
  it('重要政策推進枠は specific として別 family。異なる family が併存すれば CONFLICT', () => {
    expect(directMatch(L('令和６年度重要政策推進枠要望額明細表'))).toEqual({ kind: 'DIRECT', family: 'PRIORITY_DETAIL' });
    expect(directMatch(L('令和６年度歳出概算要求書', '令和６年度概算要求額総表'))).toEqual({ kind: 'CONFLICT', families: ['SUMMARY', 'COVER'] });
  });
  it('NFKC・fuzzy はしない（半角数字の年度でも「令和」始まりなら hit、「令和」なしは hit しない）', () => {
    expect(directMatch(L('令和6年度概算要求額明細表'))).toEqual({ kind: 'DIRECT', family: 'DETAIL' });
    expect(directMatch(L('概算要求額明細表'))).toEqual({ kind: 'NONE' });
  });
});
