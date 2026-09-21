import { describe, it, expect } from 'vitest';
import {
  checkRsCurrentBudgetEquation, checkRsSummaryItemReconciliation,
  checkRsDerivedEventProvenance, checkRsZeroBlankPropagation,
} from './rs-money';
import type { RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsDerivedBudgetEvent } from '../../types';

function summary(overrides: Partial<RsBudgetSummaryRecord> & { amounts: Record<string, number | null> }): RsBudgetSummaryRecord {
  return {
    reviewYear: 2024, projectId: '1', fiscalYear: 2024, scopeLevel: 'account',
    accountType: 'general', accountClass: '一般会計', account: '一般会計', subAccount: '',
    recordId: 'rssum_1',
    ...overrides,
  } as RsBudgetSummaryRecord;
}
function item(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
  return {
    reviewYear: 2024, projectId: '1', fiscalYear: 2024, accountType: 'general', account: '一般会計', subAccount: '',
    budgetType: '当初予算', budgetAmountYen: null, nextYearRequestYen: null, requestFiscalYear: null,
    recordId: 'rsitem_1',
    ...overrides,
  } as RsBudgetItemRecordV2;
}
function event(overrides: Partial<RsDerivedBudgetEvent>): RsDerivedBudgetEvent {
  return {
    schemaVersion: 2, recordType: 'budget_event', eventId: 'rsevt_1', sourceSystem: 'rs',
    reviewYear: 2024, fiscalYear: 2024, eventType: 'initial_budget', amountYen: 0,
    projectId: '1', projectName: 'X', accountType: 'general', account: '一般会計', subAccount: '',
    sourceRecordIds: ['rsitem_1'], source: {} as RsDerivedBudgetEvent['source'],
    ...overrides,
  };
}

describe('checkRsCurrentBudgetEquation', () => {
  it('account行: 各成分の合計が歳出予算現額と一致すればfindingsは空', () => {
    const s = summary({ amounts: { '歳出予算現額': 130, '当初予算': 100, '第1次補正予算': 20, '前年度から繰越し': 10, '予備費等1': 0, '予備費等2': null, '予備費等3': null, '予備費等4': null, '第2次補正予算': null, '第3次補正予算': null, '第4次補正予算': null, '第5次補正予算': null } });
    const result = checkRsCurrentBudgetEquation([s]);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('1円でも不一致ならerror + invariant', () => {
    const s = summary({ amounts: { '歳出予算現額': 131, '当初予算': 100, '第1次補正予算': 20, '前年度から繰越し': 10 } });
    const result = checkRsCurrentBudgetEquation([s]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].severity).toBe('error');
    expect(result.findings[0].category).toBe('invariant');
    expect(result.findings[0].metrics).toMatchObject({ expectedCurrentBudgetYen: 130, actualCurrentBudgetYen: 131, differenceYen: 1 });
  });

  it('歳出予算現額自体がblank(null)の行は検算対象外', () => {
    const s = summary({ amounts: { '歳出予算現額': null, '当初予算': 100 } });
    const result = checkRsCurrentBudgetEquation([s]);
    expect(result.checked).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('0円を含む行も検算対象（歳出予算現額=0で全成分0なら一致）', () => {
    const s = summary({ amounts: { '歳出予算現額': 0, '当初予算': 0, '第1次補正予算': null, '前年度から繰越し': null } });
    const result = checkRsCurrentBudgetEquation([s]);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
  });

  it('project_total行はcurrentBudgetEquation用の別カラム名で検算する', () => {
    const s = summary({ scopeLevel: 'project_total', accountType: '', account: '', subAccount: '', amounts: { '計（歳出予算現額合計）': 150, '当初予算（合計）': 100, '補正予算（合計）': 30, '前年度からの繰越し（合計）': 20, '予備費等（合計）': 0 } });
    const result = checkRsCurrentBudgetEquation([s]);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
  });
});

describe('checkRsSummaryItemReconciliation', () => {
  it('1:1で一致すればfindingsは空', () => {
    const s = summary({ amounts: { '当初予算': 100 } });
    const i = item({ budgetType: '当初予算', budgetAmountYen: 100 });
    const result = checkRsSummaryItemReconciliation(2024, [s], [i]);
    expect(result.mismatches).toBe(0);
  });

  it('複数itemの合計と2-1が一致すればfindingsは空', () => {
    const s = summary({ amounts: { '当初予算': 150 } });
    const items = [item({ recordId: 'a', budgetType: '当初予算', budgetAmountYen: 100 }), item({ recordId: 'b', budgetType: '当初予算', budgetAmountYen: 50 })];
    const result = checkRsSummaryItemReconciliation(2024, [s], items);
    expect(result.mismatches).toBe(0);
  });

  it('同一キーに複数の2-1行がある場合は列ごとに合算してから比較する（実データで確認した挙動）', () => {
    // 当初予算のみ非0の行と、第1次補正予算のみ非0の行が同じ(account/fiscalYear)キーで別々に存在するケース
    const summaries = [
      summary({ recordId: 's1', amounts: { '当初予算': 0, '第1次補正予算': 20 } }),
      summary({ recordId: 's2', amounts: { '当初予算': 100, '第1次補正予算': 0 } }),
    ];
    const items = [item({ recordId: 'a', budgetType: '当初予算', budgetAmountYen: 100 }), item({ recordId: 'b', budgetType: '第1次補正予算', budgetAmountYen: 20 })];
    const result = checkRsSummaryItemReconciliation(2024, summaries, items);
    expect(result.mismatches).toBe(0);
  });

  it('補正予算(第N次)の不一致を検出する', () => {
    const s = summary({ amounts: { '第1次補正予算': 20 } });
    const i = item({ budgetType: '第1次補正予算', budgetAmountYen: 25 });
    const result = checkRsSummaryItemReconciliation(2024, [s], [i]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
  });

  it('0円の一致もfindingsを出さない', () => {
    const s = summary({ amounts: { '当初予算': 0 } });
    const i = item({ budgetType: '当初予算', budgetAmountYen: 0 });
    const result = checkRsSummaryItemReconciliation(2024, [s], [i]);
    expect(result.mismatches).toBe(0);
  });

  it('2-1にしか無い指標（執行額等）は比較対象外', () => {
    const s = summary({ amounts: { '執行額': 999 } });
    const result = checkRsSummaryItemReconciliation(2024, [s], []);
    expect(result.checkedGroups).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('2-2にのみ明示的0円のevidenceがある場合はinfo（既知のEXPECTED_VARIANCE）', () => {
    const s = summary({ amounts: { '当初予算': null } });
    const i = item({ budgetType: '当初予算', budgetAmountYen: 0 });
    const result = checkRsSummaryItemReconciliation(2024, [s], [i]);
    expect(result.mismatches).toBe(0);
    expect(result.findings[0].severity).toBe('info');
  });

  it('reviewYearと異なる年度の行は対象外', () => {
    const s = summary({ fiscalYear: 2023, amounts: { '当初予算': 999 } });
    const i = item({ fiscalYear: 2023, budgetType: '当初予算', budgetAmountYen: 1 });
    const result = checkRsSummaryItemReconciliation(2024, [s], [i]);
    expect(result.checkedGroups).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

describe('checkRsDerivedEventProvenance', () => {
  it('正常な2-2由来eventはfindings無し', () => {
    const i = item({ budgetType: '当初予算', budgetAmountYen: 100, fiscalYear: 2024 });
    const e = event({ eventType: 'initial_budget', amountYen: 100, fiscalYear: 2024, sourceRecordIds: ['rsitem_1'] });
    const result = checkRsDerivedEventProvenance([e], [i], []);
    expect(result.missingSourceRecords).toBe(0);
    expect(result.amountMismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('sourceRecordIdが実在しなければinvariant error', () => {
    const e = event({ sourceRecordIds: ['does-not-exist'] });
    const result = checkRsDerivedEventProvenance([e], [], []);
    expect(result.missingSourceRecords).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
    expect(result.findings[0].scope?.eventId).toBe('rsevt_1');
  });

  it('金額不一致を検出する', () => {
    const i = item({ budgetType: '当初予算', budgetAmountYen: 100 });
    const e = event({ eventType: 'initial_budget', amountYen: 999, sourceRecordIds: ['rsitem_1'] });
    const result = checkRsDerivedEventProvenance([e], [i], []);
    expect(result.amountMismatches).toBe(1);
  });

  it('next_year_requestのfiscalYear不一致（次年度）を検出する', () => {
    const i = item({ nextYearRequestYen: 50, fiscalYear: 2024, requestFiscalYear: 2025 });
    const e = event({ eventType: 'next_year_request', amountYen: 50, fiscalYear: 2024, sourceFiscalYear: 2024, sourceRecordIds: ['rsitem_1'] });
    const result = checkRsDerivedEventProvenance([e], [i], []);
    expect(result.findings.some(f => f.message.includes('fiscalYear'))).toBe(true);
  });

  it('2-1 summary由来event（execution等）を検証する', () => {
    const s = summary({ amounts: { '執行額': 500 } });
    const e = event({ eventType: 'execution', amountYen: 500, fiscalYear: 2024, sourceFiscalYear: 2024, sourceRecordIds: ['rssum_1'] });
    const result = checkRsDerivedEventProvenance([e], [], [s]);
    expect(result.amountMismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('next_year_request_project_accountはfiscalYear=summary.fiscalYear+1を期待する', () => {
    const s = summary({ fiscalYear: 2024, amounts: { '翌年度要求額': 50 } });
    const badEvent = event({ eventType: 'next_year_request_project_account', amountYen: 50, fiscalYear: 2024, sourceFiscalYear: 2024, sourceRecordIds: ['rssum_1'] });
    const result = checkRsDerivedEventProvenance([badEvent], [], [s]);
    expect(result.findings.some(f => f.message.includes('fiscalYear'))).toBe(true);
  });
});

describe('checkRsZeroBlankPropagation', () => {
  it('明示0がevent化されていればfindings無し', () => {
    const i = item({ budgetAmountYen: 0 });
    const e = event({ eventType: 'initial_budget', amountYen: 0, sourceRecordIds: ['rsitem_1'] });
    const result = checkRsZeroBlankPropagation([i], [e]);
    expect(result.explicitZeroSourceRows).toBe(1);
    expect(result.explicitZeroEvents).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('明示0がeventとして残っていなければerror', () => {
    const i = item({ budgetAmountYen: 0 });
    const result = checkRsZeroBlankPropagation([i], []);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('source-preservation');
  });

  it('blank(null)からはeventが作られないのが正常', () => {
    const i = item({ budgetAmountYen: null, nextYearRequestYen: 100 });
    const result = checkRsZeroBlankPropagation([i], []);
    expect(result.blankSourceRows).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('blank(null)なのにeventが生成されていればerror', () => {
    const i = item({ budgetAmountYen: null, nextYearRequestYen: 100 });
    const e = event({ eventType: 'initial_budget', amountYen: 0, sourceRecordIds: ['rsitem_1'] });
    const result = checkRsZeroBlankPropagation([i], [e]);
    expect(result.blankUnexpectedEvents).toBe(1);
    expect(result.findings).toHaveLength(1);
  });
});
