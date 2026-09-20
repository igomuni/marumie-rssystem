import { describe, it, expect } from 'vitest';
import { normalizePoliciesLaws } from './rs-policies-laws';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizePoliciesLaws('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizePoliciesLaws', () => {
  it('政策・施策・法令列をマップする', () => {
    const rows = [{ ...BASE, '政策': '政策A', '施策': '施策B', '法令名': '法令C', '条': '3', '項': '2' }];
    const { rows: [row] } = run(rows);
    expect(row.policy).toBe('政策A');
    expect(row.measure).toBe('施策B');
    expect(row.lawName).toBe('法令C');
    expect(row.article).toBe('3');
    expect(row.paragraph).toBe('2');
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
