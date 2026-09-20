import { describe, it, expect } from 'vitest';
import { buildRsEvents } from './rs-derive-events';
import type { RsBudgetItemRecordV2, RsBudgetSummaryRecord } from '../types';

const ITEM_BASE: RsBudgetItemRecordV2 = {
  schemaVersion: 2, sourceSystem: 'rs', sourceYear: 2024, reviewYear: 2024, sheetType: '', projectId: '1', projectIdRaw: '1',
  projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
  recordType: 'rs_budget_item', recordId: 'rsitem_1', fiscalYear: 2024, accountType: 'general', accountClass: '一般会計', account: '一般会計', subAccount: '',
  budgetType: '当初予算', budgetMinistry: 'A省', organizationOrAccount: '組織A', sectionName: '項A', subItemName: '目A', supplementalInfo: '',
  budgetAmountYen: 1000, budgetAmountRaw: '1000', nextYearRequestYen: null, nextYearRequestRaw: '', requestFiscalYear: null, note: '',
  mofNameNaturalKey: 'general|A省|組織A|項A|目A', extraFields: {},
  source: { domain: 'rssystem.go.jp', path: 'x', file: 'x.csv', dataset: '予算・執行_予算種別・歳出予算項目', year: 2024 },
};

const SUMMARY_BASE: RsBudgetSummaryRecord = {
  schemaVersion: 2, sourceSystem: 'rs', sourceYear: 2024, reviewYear: 2024, sheetType: '', projectId: '1', projectIdRaw: '1',
  projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
  recordType: 'rs_budget_summary', recordId: 'rssum_1', fiscalYear: 2024, scopeLevel: 'account', accountType: 'general', accountClass: '一般会計',
  account: '一般会計', subAccount: '', executionRateRaw: '', changeReason: '', specialNotes: '', note: '', amounts: {}, extraFields: {},
  source: { domain: 'rssystem.go.jp', path: 'x', file: 'x.csv', dataset: '予算・執行_サマリ', year: 2024 },
};

describe('buildRsEvents: 2-2由来イベント', () => {
  it('当初予算はinitial_budgetに分類する', () => {
    const { events } = buildRsEvents(2024, [ITEM_BASE], []);
    const ev = events.find(e => e.eventId.includes(''));
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('initial_budget');
    expect(events[0].amountYen).toBe(1000);
    expect(ev?.ministry).toBe('A省');
  });

  it('第N次補正予算はsupplementary_budgetに分類する', () => {
    const row = { ...ITEM_BASE, budgetType: '第2次補正予算' };
    const { events } = buildRsEvents(2024, [row], []);
    expect(events[0].eventType).toBe('supplementary_budget');
  });

  it('予備費等はreserve_or_otherに分類する（reserve_useとは異なる型）', () => {
    const row = { ...ITEM_BASE, budgetType: '予備費等1' };
    const { events } = buildRsEvents(2024, [row], []);
    expect(events[0].eventType).toBe('reserve_or_other');
  });

  it('MOF突合用のbudgetMinistryをイベントのministryに使う（RsBaseFields.ministryとは別物）', () => {
    const row = { ...ITEM_BASE, ministry: 'デジタル庁', budgetMinistry: '内閣府' };
    const { events } = buildRsEvents(2024, [row], []);
    expect(events[0].ministry).toBe('内閣府');
  });

  it('翌年度要求額は別イベントとしてfiscalYear=requestFiscalYearで作る', () => {
    const row = { ...ITEM_BASE, nextYearRequestYen: 2000, requestFiscalYear: 2025 };
    const { events } = buildRsEvents(2024, [row], []);
    const req = events.find(e => e.eventType === 'next_year_request');
    expect(req?.amountYen).toBe(2000);
    expect(req?.fiscalYear).toBe(2025);
    expect(req?.sourceFiscalYear).toBe(2024);
  });

  it('金額が無い（budgetAmountYen=null）行からはイベントを作らない', () => {
    const row = { ...ITEM_BASE, budgetAmountYen: null };
    const { events } = buildRsEvents(2024, [row], []);
    expect(events).toHaveLength(0);
  });
});

describe('buildRsEvents: 2-1(account)由来イベント', () => {
  it('scopeLevel=accountの執行額・前年度繰越・翌年度要求のみイベント化する', () => {
    const row = { ...SUMMARY_BASE, amounts: { '執行額': 500, '前年度から繰越し': 100, '翌年度要求額': 200 } };
    const { events } = buildRsEvents(2024, [], [row]);
    expect(events).toHaveLength(3);
    expect(events.find(e => e.eventType === 'execution')?.amountYen).toBe(500);
    const req = events.find(e => e.eventType === 'next_year_request_project_account');
    expect(req?.fiscalYear).toBe(2025);
    expect(req?.sourceFiscalYear).toBe(2024);
  });

  it('scopeLevel=project_totalの行からはイベントを作らない', () => {
    const row = { ...SUMMARY_BASE, scopeLevel: 'project_total' as const, amounts: { '執行額（合計）': 500 } };
    const { events } = buildRsEvents(2024, [], [row]);
    expect(events).toHaveLength(0);
  });

  it('該当列がblank（undefined/null）ならイベントを作らない', () => {
    const row = { ...SUMMARY_BASE, amounts: {} };
    const { events } = buildRsEvents(2024, [], [row]);
    expect(events).toHaveLength(0);
  });
});
