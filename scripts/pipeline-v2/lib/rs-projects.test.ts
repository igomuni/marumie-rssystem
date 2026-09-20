import { describe, it, expect } from 'vitest';
import { normalizeProjectRows, mergeProjects } from './rs-projects';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

/** normalizeProjectRowsのrowsはgenerator（streaming API）。テストではheadersを明示して渡す */
function run(rows: Record<string, string>[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const result = normalizeProjectRows('/root', '/root/x.zip', 'x.csv', rows, 2024, headers);
  const outRows = [...result.rows];
  return { rows: outRows, sourceInventory: result.sourceInventory() };
}

describe('canonicalProjectId normalization via mergeProjects', () => {
  it('先頭0付きIDは正規化後の同一IDへ畳まれる（"004"と"4"は同一事業）', () => {
    const rows = [
      { ...BASE, '予算事業ID': '004' },
      { ...BASE, '予算事業ID': '4' },
    ];
    const { rows: sourceRows } = run(rows);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe('4');
  });

  it('projectIdが空の行はprojects.jsonlから除外する', () => {
    const rows = [{ ...BASE, '予算事業ID': '' }];
    const { rows: sourceRows } = run(rows);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(0);
  });

  it('複数行が同一projectIdの場合、後の行の値で上書きする', () => {
    const rows = [
      { ...BASE, '予算事業ID': '1', '事業名': '旧名称' },
      { ...BASE, '予算事業ID': '1', '事業名': '新名称' },
    ];
    const { rows: sourceRows } = run(rows);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe('新名称');
    expect(projects[0].sources).toHaveLength(2);
  });
});

describe('normalizeProjectRows: 実施方法・extraFields', () => {
  it('実施方法各種はtyped fieldとしてbooleanで保持する', () => {
    const rows = [{
      ...BASE, '予算事業ID': '1',
      '実施方法ー直接実施': '1', '実施方法ー補助': '', '実施方法ーその他': 'その他の方法',
    }];
    const { rows: [row] } = run(rows);
    expect(row.implementationMethods.direct).toBe(true);
    expect(row.implementationMethods.subsidy).toBeNull();
    expect(row.implementationMethods.other).toBe('その他の方法');
  });

  it('マップ対象外の非空列はextraFieldsに保持する', () => {
    const rows = [{ ...BASE, '予算事業ID': '1', '将来追加された列': '値' }];
    const { rows: [row], sourceInventory } = run(rows);
    expect(row.extraFields).toEqual({ '将来追加された列': '値' });
    expect(sourceInventory.columns.find(c => c.column === '将来追加された列')?.status).toBe('extra_preserved');
  });

  it('複数行を正しくstreamingで消費できる（generatorの単一パス消費）', () => {
    const rows = [{ ...BASE, '予算事業ID': '1' }, { ...BASE, '予算事業ID': '2' }];
    const { rows: outRows, sourceInventory } = run(rows);
    expect(outRows).toHaveLength(2);
    expect(sourceInventory.rowCount).toBe(2);
  });
});
