import { describe, it, expect } from 'vitest';
import { normalizeSubsidyRules } from './rs-subsidy-rules';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeSubsidyRules('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeSubsidyRules', () => {
  it('補助率等の列が1つでもあればhasRule=true', () => {
    const rows = [{ ...BASE, '補助率': '1/2' }];
    const { rows: [row] } = run(rows);
    expect(row.rateRaw).toBe('1/2');
    expect(row.hasRule).toBe(true);
  });

  it('全て空欄ならhasRule=false', () => {
    const rows = [{ ...BASE }];
    const { rows: [row] } = run(rows);
    expect(row.hasRule).toBe(false);
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
