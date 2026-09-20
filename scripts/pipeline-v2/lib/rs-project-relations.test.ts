import { describe, it, expect } from 'vitest';
import { normalizeProjectRelations } from './rs-project-relations';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeProjectRelations('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeProjectRelations', () => {
  it('関連事業の事業IDは先頭0を除去して正規化する', () => {
    const rows = [{ ...BASE, '関連事業の事業ID': '007', '関連性': '類似事業' }];
    const { rows: [row] } = run(rows);
    expect(row.relatedProjectId).toBe('7');
    expect(row.relatedProjectIdRaw).toBe('007');
    expect(row.hasRelation).toBe(true);
  });

  it('関連事業列が全て空欄ならhasRelation=false', () => {
    const rows = [{ ...BASE }];
    const { rows: [row] } = run(rows);
    expect(row.hasRelation).toBe(false);
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });
});
