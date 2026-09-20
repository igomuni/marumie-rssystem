/**
 * RS正規化済みの2-2（budget-items）・2-1（budget-summaries）から金額イベントを作る。
 * Python参照実装 pipeline_v2/derive.py の build_rs_events と同じロジック。
 *
 * 2-2は目粒度の当初/補正/繰越/予備費等/現額/執行額/翌年度繰越/翌年度要求を持つが、
 * 執行額・前年度繰越・翌年度要求は事業・会計単位の集計（2-1）でしか取れないため、
 * 2-1のaccountレベル行から別途イベント化する（目粒度には無い情報として補完する）。
 */
import { stableId } from './stable-id';
import type { RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsDerivedBudgetEvent, RsDerivedEventType } from '../types';

/** RS2-2の「予算種別」原本表記からイベント種別へ分類する。予備費「等」は断定せずreserve_or_otherに留める */
function rsBudgetEventType(budgetType: string): RsDerivedEventType {
  if (budgetType === '当初予算') return 'initial_budget';
  if (/^第\d+次補正予算$/.test(budgetType)) return 'supplementary_budget';
  if (budgetType === '前年度から繰越し') return 'carryover_in';
  if (budgetType.startsWith('予備費等')) return 'reserve_or_other';
  if (!budgetType) return 'unclassified_budget';
  return 'other_budget';
}

/** 2-1のaccountレベル行からのみ取れる3指標（目粒度には存在しない） */
const SUMMARY_DERIVED_COLUMNS: [string, RsDerivedEventType][] = [
  ['執行額', 'execution'],
  ['前年度から繰越し', 'carryover_in_project_account'],
  ['翌年度要求額', 'next_year_request_project_account'],
];

export function buildRsEvents(
  reviewYear: number, itemRows: RsBudgetItemRecordV2[], summaryRows: RsBudgetSummaryRecord[]
): { events: RsDerivedBudgetEvent[]; eventTypeCounts: Record<string, number>; fiscalYears: number[] } {
  const events: RsDerivedBudgetEvent[] = [];

  for (const r of itemRows) {
    if (r.budgetAmountYen !== null) {
      events.push({
        schemaVersion: 2,
        recordType: 'budget_event',
        eventId: stableId([r.recordId, 'budget'], 'rsevt_'),
        sourceSystem: 'rs',
        reviewYear,
        fiscalYear: r.fiscalYear,
        eventType: rsBudgetEventType(r.budgetType),
        sourceBudgetType: r.budgetType,
        amountYen: r.budgetAmountYen,
        projectId: r.projectId,
        projectName: r.projectName,
        accountType: r.accountType,
        // MOF突合用の「所管」（budgetMinistry）をイベントのministryとして使う。
        // RsBaseFields.ministry（共通列「府省庁」）は事業マスタ側の情報のため、
        // MOF照合を前提とするこのイベントではbudgetMinistryを使う
        ministry: r.budgetMinistry,
        account: r.account,
        subAccount: r.subAccount,
        organizationOrAccount: r.organizationOrAccount,
        sectionName: r.sectionName,
        subItemName: r.subItemName,
        sourceRecordIds: [r.recordId],
        source: r.source,
      });
    }
    if (r.nextYearRequestYen !== null) {
      events.push({
        schemaVersion: 2,
        recordType: 'budget_event',
        eventId: stableId([r.recordId, 'next-request'], 'rsevt_'),
        sourceSystem: 'rs',
        reviewYear,
        fiscalYear: r.requestFiscalYear,
        sourceFiscalYear: r.fiscalYear,
        eventType: 'next_year_request',
        amountYen: r.nextYearRequestYen,
        projectId: r.projectId,
        projectName: r.projectName,
        accountType: r.accountType,
        ministry: r.budgetMinistry,
        account: r.account,
        subAccount: r.subAccount,
        organizationOrAccount: r.organizationOrAccount,
        sectionName: r.sectionName,
        subItemName: r.subItemName,
        sourceRecordIds: [r.recordId],
        source: r.source,
      });
    }
  }

  for (const r of summaryRows) {
    if (r.scopeLevel !== 'account') continue;
    for (const [column, eventType] of SUMMARY_DERIVED_COLUMNS) {
      const value = r.amounts[column];
      if (value === null || value === undefined) continue;
      const isNextRequest = eventType.startsWith('next_year_request');
      const fiscalYear = isNextRequest && r.fiscalYear !== null ? r.fiscalYear + 1 : r.fiscalYear;
      events.push({
        schemaVersion: 2,
        recordType: 'budget_event',
        eventId: stableId([r.recordId, eventType], 'rsevt_'),
        sourceSystem: 'rs',
        reviewYear,
        fiscalYear,
        sourceFiscalYear: r.fiscalYear,
        eventType,
        amountYen: value,
        projectId: r.projectId,
        projectName: r.projectName,
        accountType: r.accountType,
        account: r.account,
        subAccount: r.subAccount,
        sourceRecordIds: [r.recordId],
        source: r.source,
      });
    }
  }

  events.sort((a, b) => {
    const ka = [String(a.fiscalYear), a.eventType, a.projectId, a.eventId].join('\x1f');
    const kb = [String(b.fiscalYear), b.eventType, b.projectId, b.eventId].join('\x1f');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const eventTypeCounts: Record<string, number> = {};
  for (const e of events) eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] ?? 0) + 1;
  const fiscalYears = [...new Set(events.map(e => e.fiscalYear).filter((y): y is number => y !== null))].sort((a, b) => a - b);

  return { events, eventTypeCounts: Object.fromEntries(Object.entries(eventTypeCounts).sort()), fiscalYears };
}
