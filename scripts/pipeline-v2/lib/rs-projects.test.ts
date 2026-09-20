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
    const { projects } = mergeProjects(sourceRows, [], 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe('4');
  });

  it('projectIdが空の行はprojects.jsonlから除外する', () => {
    const rows = [{ ...BASE, '予算事業ID': '' }];
    const { rows: sourceRows } = run(rows);
    const { projects } = mergeProjects(sourceRows, [], 2024);
    expect(projects).toHaveLength(0);
  });

  it('複数行が同一projectIdの場合、後の行の値で上書きする（ただしsourcesは蓄積する）', () => {
    const rows = [
      { ...BASE, '予算事業ID': '1', '事業名': '旧名称' },
      { ...BASE, '予算事業ID': '1', '事業名': '新名称' },
    ];
    const { rows: sourceRows } = run(rows);
    const { projects } = mergeProjects(sourceRows, [], 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe('新名称');
    expect(projects[0].sources).toHaveLength(2);
  });
});

describe('mergeProjects: レビューシートとのマージ', () => {
  const SHEET_BASE = {
    schemaVersion: 2 as const, recordType: 'rs_review_sheet' as const, sourceYear: 2024, reviewYear: 2024,
    ministryFromFile: 'デジタル庁', policy: '', measure: '', responsibleOffice: '', accountClass: '一般会計',
    officialProjectUrl: '', reviewTeamFinding: '', extraFields: {},
    source: { domain: 'rssystem.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'sheets-form1', year: 2024 },
  };

  it('1-2に無いprojectIdはレビューシートのみから事業を作る', () => {
    const sheetRows = [{
      ...SHEET_BASE, recordId: 'rssheet_1', sheetForm: 'form1' as const, projectId: '99', projectIdRaw: '99',
      projectName: 'シート限定事業', projectCategory: 'existing_or_new_start' as const,
      startYear: 2020, startYearRaw: '2020', endYear: null, endYearRaw: '',
      priorBudgetFiscalYear: 2023, priorBudgetYen: null, priorExecutionYen: null,
      currentInitialFiscalYear: 2024, currentInitialYen: null, nextRequestFiscalYear: 2025, nextRequestYen: null,
      requestDifferenceYen: null, externalExpertFinding: '', reflectionAmountYen: null, improvementReflection: '',
      externalReviewTarget: '', externalReviewReason: '', latestExternalReviewYearRaw: '',
    }];
    const { projects, conflicts } = mergeProjects([], sheetRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe('シート限定事業');
    expect(projects[0].sourceKinds).toEqual(['sheets:form1']);
    expect(conflicts).toHaveLength(0);
  });

  it('1-2側が空欄の項目のみレビューシートで補完する（1-2側の値がある項目は上書きしない）', () => {
    const rows = [{ ...BASE, '予算事業ID': '1', '事業名': '', '事業終了（予定）年度': '2030' }];
    const { rows: sourceRows } = run(rows);
    const sheetRows = [{
      ...SHEET_BASE, recordId: 'rssheet_1', sheetForm: 'form2' as const, projectId: '1', projectIdRaw: '1',
      projectName: 'シート由来の名称', projectCategory: 'new_request' as const,
      nextRequestFiscalYear: 2025, nextRequestYen: null,
    }];
    const { projects, conflicts } = mergeProjects(sourceRows, sheetRows, 2024);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe('シート由来の名称');
    expect(projects[0].endYear).toBe(2030);
    expect(conflicts).toHaveLength(0);
  });

  it('1-2とレビューシートで値が食い違う場合はconflictsに記録し、1-2側を優先したまま残す', () => {
    const rows = [{ ...BASE, '予算事業ID': '1', '事業名': '1-2の名称' }];
    const { rows: sourceRows } = run(rows);
    const sheetRows = [{
      ...SHEET_BASE, recordId: 'rssheet_1', sheetForm: 'form2' as const, projectId: '1', projectIdRaw: '1',
      projectName: 'シートの名称（食い違い）', projectCategory: 'new_request' as const,
      nextRequestFiscalYear: 2025, nextRequestYen: null,
    }];
    const { projects, conflicts } = mergeProjects(sourceRows, sheetRows, 2024);
    expect(projects[0].projectName).toBe('1-2の名称');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('projectName');
    expect(conflicts[0].downloadValue).toBe('1-2の名称');
    expect(conflicts[0].sheetValue).toBe('シートの名称（食い違い）');
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
