import { describe, it, expect } from 'vitest';
import { normalizeSpending } from './rs-spending';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('normalizeSpending: block/recipient/contract separation', () => {
  it('ブロック集計行と支出先行を別レコードに分離する', () => {
    const rows = [
      { ...BASE, '支出先ブロック番号': 'A', '支出先ブロック名': 'ブロックA', '支出先の数': '2', 'ブロックの合計支出額': '1000' },
      { ...BASE, '支出先ブロック番号': 'A', '支出先名': '株式会社X', '法人番号': '123', '支出先の合計支出額': '500' },
    ];
    const { blocks, recipients, contracts } = normalizeSpending('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockName).toBe('ブロックA');
    expect(recipients).toHaveLength(1);
    expect(recipients[0].recipientName).toBe('株式会社X');
    expect(contracts).toHaveLength(0);
  });

  it('同一ブロック番号の集計行は1ブロックにまとめ、複数の値を配列で保持する', () => {
    const rows = [
      { ...BASE, '支出先ブロック番号': 'A', '支出先ブロック名': '名前1', 'ブロックの合計支出額': '100' },
      { ...BASE, '支出先ブロック番号': 'A', '支出先ブロック名': '名前2', 'ブロックの合計支出額': '200' },
    ];
    const { blocks } = normalizeSpending('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockNames).toEqual(['名前1', '名前2']);
    expect(blocks[0].totalAmountValuesYen).toEqual([100, 200]);
    expect(blocks[0].summaryRowCount).toBe(2);
  });

  it('契約行に支出先名が無い場合は直前の支出先へ紐づける', () => {
    const rows = [
      { ...BASE, '支出先ブロック番号': 'A', '支出先名': '株式会社X', '法人番号': '123' },
      { ...BASE, '支出先ブロック番号': 'A', '契約概要': '契約1', '金額': '500' }, // 支出先名なし
    ];
    const { recipients, contracts } = normalizeSpending('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].recipientId).toBe(recipients[0].recipientId);
    expect(contracts[0].recipientLinkMethod).toBe('preceding-row');
  });

  it('同一行に支出先名と契約情報がある場合はsame-rowとして紐づける', () => {
    const rows = [{ ...BASE, '支出先ブロック番号': 'A', '支出先名': '株式会社Y', '契約概要': '契約1', '金額': '300' }];
    const { contracts } = normalizeSpending('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(contracts[0].recipientLinkMethod).toBe('same-row');
  });

  it('同一支出先（同名・同法人番号）の重複行は1レコードに畳む', () => {
    const rows = [
      { ...BASE, '支出先ブロック番号': 'A', '支出先名': '株式会社X', '法人番号': '123', '支出先の合計支出額': '100' },
      { ...BASE, '支出先ブロック番号': 'A', '支出先名': '株式会社X', '法人番号': '123', '支出先の合計支出額': '100' },
    ];
    const { recipients } = normalizeSpending('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].evidenceRowIds).toHaveLength(2);
  });
});
