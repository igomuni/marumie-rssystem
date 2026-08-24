import { describe, it, expect } from 'vitest';
import type { MOFJikouItem } from '@/types/mof-jikou';
import { filterMOFJikouItems, hasActiveMOFHierarchyFilter } from '@/app/lib/mof-hierarchy-filter';

function item(overrides: Partial<MOFJikouItem>): MOFJikouItem {
  return {
    id: 'x',
    key: 'x',
    accountType: 'general',
    budgetType: '当初予算',
    documentId: '202611001',
    ministry: '財務省',
    organization: '財務本省',
    specialAccount: '',
    subAccount: '',
    agency: '',
    sectionCode: '001',
    sectionName: '財務本省共通費',
    majorExpenseCode: '95',
    majorExpenseName: 'その他の事項経費',
    name: '事項A',
    amount: 100,
    previousAmount: null,
    difference: null,
    currentAmount: null,
    spent: null,
    carriedOver: null,
    unused: null,
    description: '',
    page: 1,
    sourceUrl: '',
    ...overrides,
  };
}

describe('hasActiveMOFHierarchyFilter', () => {
  it('何も指定していなければ false', () => {
    expect(hasActiveMOFHierarchyFilter({})).toBe(false);
  });

  it('1つでも条件があれば true', () => {
    expect(hasActiveMOFHierarchyFilter({ ministries: ['財務省'] })).toBe(true);
    expect(hasActiveMOFHierarchyFilter({ accountTypes: ['general'] })).toBe(true);
    expect(hasActiveMOFHierarchyFilter({ itemName: { query: '国債' } })).toBe(true);
    expect(hasActiveMOFHierarchyFilter({ minAmount: 100 })).toBe(true);
    expect(hasActiveMOFHierarchyFilter({ maxAmount: 100 })).toBe(true);
  });

  it('空配列・空文字は条件が無いのと同じ', () => {
    expect(hasActiveMOFHierarchyFilter({ ministries: [], itemName: { query: '' } })).toBe(false);
  });
});

describe('filterMOFJikouItems', () => {
  const items = [
    item({ ministry: '財務省', name: '国債整理', amount: 1000, accountType: 'general' }),
    item({ ministry: '厚生労働省', name: '年金給付', amount: 500, accountType: 'special' }),
    item({
      ministry: '',
      accountType: 'agency',
      agency: '沖縄振興開発金融公庫',
      name: '融資業務',
      amount: 10,
    }),
  ];

  it('条件が無ければ全件そのまま返す', () => {
    expect(filterMOFJikouItems(items, {})).toEqual(items);
  });

  it('所管で絞る。政府関係機関は所管が空なので機関名で照合する', () => {
    const result = filterMOFJikouItems(items, { ministries: ['財務省'] });
    expect(result.map(i => i.name)).toEqual(['国債整理']);

    // 政府関係機関はミニストリー欄が空なので、levelsOf と同じ既定の
    // 会計区分ラベル（政府関係機関）で照合する。機関名そのものは組織列に出る
    const agency = filterMOFJikouItems(items, { ministries: ['政府関係機関'] });
    expect(agency.map(i => i.name)).toEqual(['融資業務']);
  });

  it('会計区分で絞る', () => {
    const result = filterMOFJikouItems(items, { accountTypes: ['special', 'agency'] });
    expect(result.map(i => i.name).sort()).toEqual(['年金給付', '融資業務']);
  });

  it('事項名を部分一致で絞る', () => {
    const result = filterMOFJikouItems(items, { itemName: { query: '国債' } });
    expect(result.map(i => i.name)).toEqual(['国債整理']);
  });

  it('事項名を正規表現で絞る', () => {
    const result = filterMOFJikouItems(items, { itemName: { query: '^(国債|年金)', regex: true } });
    expect(result.map(i => i.name).sort()).toEqual(['年金給付', '国債整理'].sort());
  });

  it('不正な正規表現は何も除外しない扱いにする（ReDoS対策と同じ思想で例外を投げない）', () => {
    const result = filterMOFJikouItems(items, { itemName: { query: '(', regex: true } });
    expect(result).toEqual(items);
  });

  it('項名を絞る', () => {
    const items2 = [
      item({ sectionName: '共通費', name: 'A' }),
      item({ sectionName: '施設整備費', name: 'B' }),
    ];
    const result = filterMOFJikouItems(items2, { sectionName: { query: '施設' } });
    expect(result.map(i => i.name)).toEqual(['B']);
  });

  it('金額の範囲で絞る', () => {
    expect(filterMOFJikouItems(items, { minAmount: 500 }).map(i => i.name).sort()).toEqual([
      '国債整理',
      '年金給付',
    ]);
    expect(filterMOFJikouItems(items, { maxAmount: 500 }).map(i => i.name).sort()).toEqual([
      '年金給付',
      '融資業務',
    ]);
    // min=100・max=500: 国債整理(1000)は範囲外、年金給付(500)は範囲内、融資業務(10)は範囲外
    expect(filterMOFJikouItems(items, { minAmount: 100, maxAmount: 500 }).map(i => i.name)).toEqual([
      '年金給付',
    ]);
  });

  it('複数条件は AND で絞る', () => {
    const result = filterMOFJikouItems(items, {
      accountTypes: ['general', 'special'],
      minAmount: 600,
    });
    expect(result.map(i => i.name)).toEqual(['国債整理']);
  });
});
