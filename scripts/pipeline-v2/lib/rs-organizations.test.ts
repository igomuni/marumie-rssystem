import { describe, it, expect } from 'vitest';
import { normalizeOrganizations } from './rs-organizations';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('normalizeOrganizations: extraFields・source inventory', () => {
  it('マップ対象外の非空列はextraFieldsに保持し、source inventoryでextra_preservedになる', () => {
    const rows = [{ ...BASE, '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = normalizeOrganizations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    const col = sourceInventory.columns.find(c => c.column === '将来追加された列');
    expect(col?.status).toBe('extra_preserved');
    expect(col?.nonEmptyCount).toBe(1);
  });

  it('空欄の未マップ列はempty_unmappedになる', () => {
    const rows = [{ ...BASE, '将来追加された列': '' }];
    const { sourceInventory } = normalizeOrganizations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    const col = sourceInventory.columns.find(c => c.column === '将来追加された列');
    expect(col?.status).toBe('empty_unmapped');
  });

  it('マップ済み列はmappedになる', () => {
    const rows = [{ ...BASE, '作成責任者': '担当者A' }];
    const { rows: [row], sourceInventory } = normalizeOrganizations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(row.responsiblePerson).toBe('担当者A');
    const col = sourceInventory.columns.find(c => c.column === '作成責任者');
    expect(col?.status).toBe('mapped');
  });

  it('「建制順」はrsBaseのministryOrderRawフォールバック元列としてmapped扱い（実データで検出した抜け漏れの回帰）', () => {
    const rows = [{ ...BASE, '府省庁の建制順': '', '建制順': '5' }];
    const { rows: [row], sourceInventory } = normalizeOrganizations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(row.ministryOrderRaw).toBe('5');
    expect(sourceInventory.columns.find(c => c.column === '建制順')?.status).toBe('mapped');
  });
});
