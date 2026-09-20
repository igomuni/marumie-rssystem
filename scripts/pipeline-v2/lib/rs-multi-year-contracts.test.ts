import { describe, it, expect } from 'vitest';
import { normalizeMultiYearContracts } from './rs-multi-year-contracts';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeMultiYearContracts('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeMultiYearContracts', () => {
  it('契約額・契約先をマップし、契約情報があればhasContract=true', () => {
    const rows = [{ ...BASE, '契約額（国庫債務負担行為等による契約）': '100000', '契約先名（国庫債務負担行為等による契約）': '株式会社X' }];
    const { rows: [row] } = run(rows);
    expect(row.amountYen).toBe(100000);
    expect(row.recipientName).toBe('株式会社X');
    expect(row.hasContract).toBe(true);
  });

  it('全て空欄ならhasContract=false', () => {
    const rows = [{ ...BASE }];
    const { rows: [row] } = run(rows);
    expect(row.hasContract).toBe(false);
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
