import { describe, it, expect } from 'vitest';
import { normalizeEvaluations } from './rs-evaluations';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeEvaluations('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeEvaluations', () => {
  it('反映額（一般会計・特別会計）は数値化し、その他はtext fieldとして保持する', () => {
    const rows = [{
      ...BASE,
      '反映額（一般会計）': '1000', '反映額（特別会計）－反映額': '2000',
      '行政事業レビュー推進チームの所見': '所見テキスト',
    }];
    const { rows: [row] } = run(rows);
    expect(row.reflectionGeneralYen).toBe(1000);
    expect(row.reflectionSpecialYen).toBe(2000);
    expect(row.reviewTeamFinding).toBe('所見テキスト');
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
