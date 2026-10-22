import { describe, expect, it } from 'vitest';
import { buildPositionTree, buildTocTree, ns, supplementTocTree, totalTableKouHeads } from './mof-budget-request-match';

// 総表 CSV の行（必要な列だけ）
const tot = (row_type: string, 区分: string, req = '', 要求番号 = '') => ({ row_type, 区分, '８年度概算要求額_計': req, 要求番号, source_page: '1' });
// 目次 CSV の行
const toc = (区分: string, 要求番号 = '') => ({ 区分, 要求番号, ページ: '1' });

// 総表: 017 の項（事項 2 つ。間に事項の下の見出し 006）→ 目次に無い 019（繰入）→ 020
const total = [
  tot('CODE3', '017 地球温暖化対策推進費', '100'),
  tot('DETAIL', '01‑95 地球温暖化対策の推進に必要な経費', '60', '4'),
  tot('CODE3', '006 二国間クレジット制度の構築等事業', '40'),
  tot('DETAIL', '11‑13 気候変動の影響への適応策に関する調査研究に必要な経費', '40', '5'),
  tot('CODE3', '019 石油石炭税財源エネルギー対策特別会計へ繰入', '1648'),
  tot('DETAIL', '01‑63 石油石炭税財源のエネルギー需給勘定へ繰入れに必要な経費', '1648', '6'),
  tot('CODE3', '020 脱炭素成長型経済構造移行推進エネルギー対策特別会計へ繰入', '0'),
  tot('DETAIL', '01‑63 脱炭素成長型経済構造移行費用の繰入れに必要な経費', '0', '7'),
  tot('TOTAL', '組織計', '1748'),
];

describe('totalTableKouHeads', () => {
  it('takes an unlisted heading as a 項 only when the previous 項 closes exactly there (sub-headings inside a 項 do not)', () => {
    const heads = totalTableKouHeads(total, ['017|地球温暖化対策推進費', '020|脱炭素成長型経済構造移行推進エネルギー対策特別会計へ繰入']);
    expect(heads.map(h => [h.code, h.listed, h.isKou])).toEqual([['017', true, true], ['006', false, false], ['019', false, true], ['020', true, true]]);
  });
  it('without a list (no TOC), keeps the first heading and then only headings where the previous 項 closes', () => {
    const heads = totalTableKouHeads(total, null);
    expect(heads.filter(h => h.isKou).map(h => h.code)).toEqual(['017', '019', '020']);
  });
});

describe('supplementTocTree', () => {
  it('inserts the omitted 項 after the previous 項 and moves its 事項 that the TOC put under the previous 項', () => {
    const t = buildTocTree('env', [
      toc('（所管） 31 環境省'), toc('（組織） 010 環境本省'),
      toc('（項） 017 地球温暖化対策推進費'), toc('01-95 地球温暖化対策の推進に必要な経費', '4'), toc('11-13 気候変動の影響への適応策に関する調査研究に必要な経費', '5'),
      toc('01-63 石油石炭税財源のエネルギー需給勘定へ繰入れに必要な経費', '6'),
      toc('（項） 020 脱炭素成長型経済構造移行推進エネルギー対策特別会計へ繰入'), toc('01-63 脱炭素成長型経済構造移行費用の繰入れに必要な経費', '7'),
    ]);
    const added = supplementTocTree(t, total);
    expect(added.map(k => [k.code, k.org, k.fromTotal])).toEqual([['019', '環境本省', true]]);
    expect(t.kous.map(k => [k.idx, k.code])).toEqual([[0, '017'], [1, '019'], [2, '020']]);
    expect(t.jikous.map(j => [j.reqNo, j.kouIdx])).toEqual([['4', 0], ['5', 0], ['6', 1], ['7', 2]]);
  });
});

describe('buildPositionTree', () => {
  it('does not make sub-headings into 項 when there is no TOC', () => {
    const t = buildPositionTree('env', total, () => false);
    expect(t.kous.map(k => k.code)).toEqual(['017', '019', '020']);
    expect(t.jikous.map(j => [j.reqNo, j.kouIdx])).toEqual([['4', 0], ['5', 0], ['6', 1], ['7', 2]]);
  });
});

describe('ns', () => {
  it('turns the confirmed PDF gaiji into the character and leaves unknown private-use code points as they are', () => {
    expect(ns('貨幣交換差減補\uE5E3 金')).toBe('貨幣交換差減補填金');
    expect(ns('Ａ４\uEF63５冊')).toBe('A4\uEF635冊');
  });
});
