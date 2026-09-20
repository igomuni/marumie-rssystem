import { describe, it, expect } from 'vitest';
import { normalizeFundingRelations } from './rs-funding';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('normalizeFundingRelations: 一般有向グラフとして保持する', () => {
  it('重複する辺（同一source/target）を削除・統合しない', () => {
    const rows = [
      { ...BASE, '支出元の支出先ブロック': 'A', '支出先の支出先ブロック': 'B', '支出先の支出先ブロック名': 'B社' },
      { ...BASE, '支出元の支出先ブロック': 'A', '支出先の支出先ブロック': 'B', '支出先の支出先ブロック名': 'B社' },
    ];
    const { relations } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(relations).toHaveLength(2);
    expect(relations[0].relationId).not.toBe(relations[1].relationId);
  });

  it('循環（A→B→A）を許容する', () => {
    const rows = [
      { ...BASE, '支出元の支出先ブロック': 'A', '支出先の支出先ブロック': 'B', '支出先の支出先ブロック名': 'B' },
      { ...BASE, '支出元の支出先ブロック': 'B', '支出先の支出先ブロック': 'A', '支出先の支出先ブロック名': 'A' },
    ];
    const { relations } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(relations).toHaveLength(2);
  });

  it('ソースが無い行（事業自体からの直接支出）も保持する', () => {
    const rows = [{ ...BASE, '支出元の支出先ブロック': '', '支出先の支出先ブロック': 'A', '支出先の支出先ブロック名': 'A社', '担当組織からの支出': '○' }];
    const { relations } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(relations).toHaveLength(1);
    expect(relations[0].sourceBlockId).toBeNull();
    expect(relations[0].fromResponsibleOrganization).toBe(true);
  });

  it('ターゲットが無い行は辺として保持しない', () => {
    const rows = [{ ...BASE, '支出元の支出先ブロック': 'A', '支出先の支出先ブロック': '', '支出先の支出先ブロック名': '' }];
    const { relations } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(relations).toHaveLength(0);
  });

  it('国自らが支出する間接経費は別レコードとして保持する', () => {
    const rows = [{ ...BASE, '国自らが支出する間接経費': '有', '国自らが支出する間接経費の項目': '人件費', '国自らが支出する間接経費の金額': '1000' }];
    const { indirect } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(indirect).toHaveLength(1);
    expect(indirect[0].amountYen).toBe(1000);
  });

  it('マップ対象外の非空列はextraFields・source inventoryのextra_preservedに現れる', () => {
    const rows = [{ ...BASE, '支出元の支出先ブロック': 'A', '支出先の支出先ブロック': 'B', '支出先の支出先ブロック名': 'B', '将来追加された列': '値' }];
    const { relations, sourceInventory } = normalizeFundingRelations('/root', '/root/x.zip', 'x.csv', rows, 2024);
    expect(relations[0].extraFields).toEqual({ '将来追加された列': '値' });
    const col = sourceInventory.columns.find(c => c.column === '将来追加された列');
    expect(col?.status).toBe('extra_preserved');
  });
});
