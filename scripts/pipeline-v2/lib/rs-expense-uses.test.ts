import { describe, it, expect } from 'vitest';
import { normalizeExpenseUses } from './rs-expense-uses';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeExpenseUses('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeExpenseUses', () => {
  it('費目・使途・金額をマップする', () => {
    const rows = [{ ...BASE, '支出先ブロック番号': 'A', '費目': '委託費', '使途': '調査', '金額': '5000' }];
    const { rows: [row] } = run(rows);
    expect(row.blockId).toBe('A');
    expect(row.expenseItem).toBe('委託費');
    expect(row.use).toBe('調査');
    expect(row.amountYen).toBe(5000);
  });

  it('金額が空欄ならamountYenはnull（0に潰さない）', () => {
    const rows = [{ ...BASE, '金額': '' }];
    const { rows: [row] } = run(rows);
    expect(row.amountYen).toBeNull();
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
