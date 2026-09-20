import { describe, it, expect } from 'vitest';
import { normalizeLogicModel, normalizeLogicRelations } from './rs-logic-model';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('normalizeLogicModel: node集約と年度別観測値の分離', () => {
  it('同一番号・種別の複数行を1nodeへ集約し、年度列は観測値へ分離する', () => {
    const rows = [
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '種別（アクティビティ・アウトプット・アウトカム）': 'アウトプット', '2023': '100', '2024': '200', '2025': '' },
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '種別（アクティビティ・アウトプット・アウトカム）': 'アウトプット', '2023': '', '2024': '', '2025': '300' },
    ];
    const { nodes, observations } = normalizeLogicModel('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].evidenceRowIds).toHaveLength(2);
    expect(observations).toHaveLength(3);
    expect(observations.map(o => o.fiscalYear).sort()).toEqual([2023, 2024, 2025]);
  });

  it('番号・種別が異なれば別nodeになる', () => {
    const rows = [
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '種別（アクティビティ・アウトプット・アウトカム）': 'アウトプット' },
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '2', '種別（アクティビティ・アウトプット・アウトカム）': 'アウトカム' },
    ];
    const { nodes } = normalizeLogicModel('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(nodes).toHaveLength(2);
  });

  it('空欄の年度列からは観測値を作らない', () => {
    const rows = [{ ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '2024': '' }];
    const { observations } = normalizeLogicModel('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(observations).toHaveLength(0);
  });

  it('マップ対象外の非空列が複数行で競合する場合は配列化して保持する', () => {
    const rows = [
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '将来追加された列': '値1' },
      { ...BASE, 'アクティビティ・アウトプット・アウトカムの番号': '1', '将来追加された列': '値2' },
    ];
    const { nodes } = normalizeLogicModel('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(nodes[0].extraFields['将来追加された列']).toEqual(['値1', '値2']);
  });
});

function runRelations(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeLogicRelations('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  return { rows: [...result.rows], sourceInventory: result.sourceInventory() };
}

describe('normalizeLogicRelations', () => {
  it('派生元・派生先の番号が揃っていればhasRelation=true', () => {
    const rows = [{
      ...BASE,
      '派生元ーアクティビティ・アウトプット・アウトカムの番号': '1', '派生元ー種別（アクティビティ・アウトプット・アウトカム）': 'アウトプット',
      '派生先ーアクティビティ・アウトプット・アウトカムの番号': '2', '派生先ー種別（アクティビティ・アウトプット・アウトカム）': 'アウトカム',
    }];
    const { rows: [row] } = runRelations(rows);
    expect(row.hasRelation).toBe(true);
    expect(row.sourceLogicNodeId).not.toBe('');
    expect(row.targetLogicNodeId).not.toBe('');
  });

  it('派生先が無ければhasRelation=false・targetLogicNodeIdは空', () => {
    const rows = [{ ...BASE, '派生元ーアクティビティ・アウトプット・アウトカムの番号': '1' }];
    const { rows: [row] } = runRelations(rows);
    expect(row.hasRelation).toBe(false);
    expect(row.targetLogicNodeId).toBe('');
  });
});
