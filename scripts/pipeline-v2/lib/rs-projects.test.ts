import { describe, it, expect } from 'vitest';
import { normalizeProjectRows, mergeProjects } from './rs-projects';

const BASE = {
  'シート種別': 'レビューシート', '事業年度': '2024', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('canonicalProjectId normalization via mergeProjects', () => {
  it('先頭0付きIDは正規化後の同一IDへ畳まれる（"004"と"4"は同一事業）', () => {
    const rows = [
      { ...BASE, '予算事業ID': '004' },
      { ...BASE, '予算事業ID': '4' },
    ];
    const sourceRows = normalizeProjectRows('/root', '/root/x.zip', 'x.csv', rows, 2024);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe('4');
  });

  it('projectIdが空の行はprojects.jsonlから除外する', () => {
    const rows = [{ ...BASE, '予算事業ID': '' }];
    const sourceRows = normalizeProjectRows('/root', '/root/x.zip', 'x.csv', rows, 2024);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(0);
  });

  it('複数行が同一projectIdの場合、後の行の値で上書きする', () => {
    const rows = [
      { ...BASE, '予算事業ID': '1', '事業名': '旧名称' },
      { ...BASE, '予算事業ID': '1', '事業名': '新名称' },
    ];
    const sourceRows = normalizeProjectRows('/root', '/root/x.zip', 'x.csv', rows, 2024);
    const projects = mergeProjects(sourceRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe('新名称');
    expect(projects[0].sources).toHaveLength(2);
  });
});
