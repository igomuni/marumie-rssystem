/**
 * Pipeline V2 Validator Hardening Stage B: RS monetary invariants。
 * 独立検証（docs/chats/20260921_0954_V2パイプラインの検証/02_rs-money-preservation.md）で
 * 確認済みの金額保存性を、golden件数ではなく式・sourceRecordId単位の自動回帰検証へ落とし込む。
 *
 * 原則: 差異を検出・報告するだけで、自動補正しない。Pipeline本体（normalize/derive）は変更しない。
 */
import { rsBudgetEventType } from '../rs-derive-events';
import type { RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsDerivedBudgetEvent, RsDerivedEventType } from '../../types';
import type { Finding } from '../validate-checks';

/** 会計別行（scopeLevel='account'）で使う列名 */
const ACCOUNT_EQUATION = {
  current: '歳出予算現額',
  initial: '当初予算',
  supplements: ['第1次補正予算', '第2次補正予算', '第3次補正予算', '第4次補正予算', '第5次補正予算'],
  carryover: '前年度から繰越し',
  reserves: ['予備費等1', '予備費等2', '予備費等3', '予備費等4'],
};
/** 事業合計行（scopeLevel='project_total'）で使う列名 */
const PROJECT_TOTAL_EQUATION = {
  current: '計（歳出予算現額合計）',
  initial: '当初予算（合計）',
  supplements: ['補正予算（合計）'],
  carryover: '前年度からの繰越し（合計）',
  reserves: ['予備費等（合計）'],
};

/**
 * B-1: RS 2-1 current budget equation。
 * 歳出予算現額 = 当初予算 + 補正予算(1〜5次) + 前年度から繰越し + 予備費等(1〜4)。
 * targetカラム自体がblank（null）の行は検算対象外とする（02_rs-money-preservation.md 6章の
 * scope anomaly行と同じ扱い。会計区分blankなのにaccount列だけ埋まる等、targetが無い行は
 * 「無い値を0とみなして検算する」のではなく検算不能として除外する）。
 */
export function checkRsCurrentBudgetEquation(summaries: RsBudgetSummaryRecord[]): { findings: Finding[]; checked: number; mismatches: number } {
  const findings: Finding[] = [];
  let checked = 0;
  let mismatches = 0;

  for (const r of summaries) {
    const eq = r.scopeLevel === 'account' ? ACCOUNT_EQUATION : PROJECT_TOTAL_EQUATION;
    const current = r.amounts[eq.current];
    if (current === null || current === undefined) continue;
    checked++;

    const initial = r.amounts[eq.initial] ?? 0;
    const carryover = r.amounts[eq.carryover] ?? 0;
    const supplements = eq.supplements.reduce((sum, col) => sum + (r.amounts[col] ?? 0), 0);
    const reserves = eq.reserves.reduce((sum, col) => sum + (r.amounts[col] ?? 0), 0);
    const expected = initial + supplements + carryover + reserves;

    if (expected !== current) {
      mismatches++;
      findings.push({
        severity: 'error', check: 'rs-current-budget-equation', category: 'invariant',
        scope: { reviewYear: r.reviewYear, projectId: r.projectId, fiscalYear: r.fiscalYear ?? undefined, recordId: r.recordId },
        metrics: { expectedCurrentBudgetYen: expected, actualCurrentBudgetYen: current, differenceYen: current - expected, scopeLevel: r.scopeLevel },
        message: `projectId=${r.projectId} recordId=${r.recordId}: 歳出予算現額の検算不一致（期待${expected} 実際${current}）`,
      });
    }
  }
  return { findings, checked, mismatches };
}

/** 2-2側で2-1会計サマリと比較可能なbudgetType（2-1にしか無い執行額・翌年度要求額等は対象外） */
const RECONCILABLE_BUDGET_TYPES = [
  '当初予算', '第1次補正予算', '第2次補正予算', '第3次補正予算', '第4次補正予算', '第5次補正予算',
  '前年度から繰越し', '予備費等1', '予備費等2', '予備費等3', '予備費等4',
];

function accountGroupKey(projectId: string, fiscalYear: number | null, accountType: string, account: string, subAccount: string): string {
  return [projectId, fiscalYear, accountType, account, subAccount].join('\x1f');
}
function itemKey(projectId: string, fiscalYear: number | null, accountType: string, account: string, subAccount: string, budgetType: string): string {
  return [accountGroupKey(projectId, fiscalYear, accountType, account, subAccount), budgetType].join('\x1f');
}

/**
 * B-2: RS 2-1 ↔ 2-2 monetary reconciliation。
 * (projectId, fiscalYear, accountType, account, subAccount, budgetType)粒度で2-2目別合計と
 * 2-1会計別サマリを突合する。2-1にしか無い指標（執行額・翌年度要求額等）は対象外。
 *
 * 実データで確認: 同一(projectId, fiscalYear, accountType, account, subAccount)キーに対して
 * 2-1会計別行が複数存在することがある（当初予算だけ非0の行・補正予算だけ非0の行、等に分かれて
 * 出現し、互いに他方の列は明示的0を持つ）。行ごとに独立比較すると誤ってmismatch判定してしまうため、
 * 同一キーの行は列ごとに合算してから2-2側の合計と比較する（合算すると2-2側と一致することを
 * projectId=1151等の実データで確認済み）。reviewYearと異なる過去年度（継続事業の履歴行）は
 * このvalidatorの手前でどの行が「正」かを断定できないため対象外にする
 * （publish-v2.tsのindexBudgetByProjectがproject_totalで`row.fiscalYear === reviewYear`を
 * 条件にしているのと同じ理由・同じ既存Pipeline規約に合わせた制約）。
 */
export function checkRsSummaryItemReconciliation(
  reviewYear: number, summaries: RsBudgetSummaryRecord[], items: RsBudgetItemRecordV2[]
): { findings: Finding[]; checkedGroups: number; mismatches: number } {
  const findings: Finding[] = [];
  let checkedGroups = 0;
  let mismatches = 0;

  const itemSumByKey = new Map<string, number>();
  const itemGroupExists = new Set<string>();
  for (const item of items) {
    if (item.fiscalYear !== reviewYear) continue;
    if (!RECONCILABLE_BUDGET_TYPES.includes(item.budgetType)) continue;
    const key = itemKey(item.projectId, item.fiscalYear, item.accountType, item.account, item.subAccount, item.budgetType);
    itemGroupExists.add(key);
    if (item.budgetAmountYen !== null) itemSumByKey.set(key, (itemSumByKey.get(key) ?? 0) + item.budgetAmountYen);
  }

  interface GroupIdentity { reviewYear: number; projectId: string; fiscalYear: number | null }
  const groupIdentity = new Map<string, GroupIdentity>();
  const summarySumByGroup = new Map<string, Record<string, number>>();
  const summaryHasValueByGroup = new Map<string, Set<string>>();
  for (const summary of summaries) {
    if (summary.scopeLevel !== 'account' || summary.fiscalYear !== reviewYear) continue;
    const groupKey = accountGroupKey(summary.projectId, summary.fiscalYear, summary.accountType, summary.account, summary.subAccount);
    groupIdentity.set(groupKey, { reviewYear: summary.reviewYear, projectId: summary.projectId, fiscalYear: summary.fiscalYear });
    const sums = summarySumByGroup.get(groupKey) ?? {};
    const hasValue = summaryHasValueByGroup.get(groupKey) ?? new Set<string>();
    for (const budgetType of RECONCILABLE_BUDGET_TYPES) {
      const value = summary.amounts[budgetType];
      if (value !== null && value !== undefined) {
        sums[budgetType] = (sums[budgetType] ?? 0) + value;
        hasValue.add(budgetType);
      }
    }
    summarySumByGroup.set(groupKey, sums);
    summaryHasValueByGroup.set(groupKey, hasValue);
  }

  for (const [groupKey, identity] of groupIdentity) {
    const sums = summarySumByGroup.get(groupKey)!;
    const hasValue = summaryHasValueByGroup.get(groupKey)!;
    const scope = { reviewYear: identity.reviewYear, projectId: identity.projectId, fiscalYear: identity.fiscalYear ?? undefined };

    for (const budgetType of RECONCILABLE_BUDGET_TYPES) {
      const key = `${groupKey}\x1f${budgetType}`;
      const hasItems = itemGroupExists.has(key);
      const itemSum = itemSumByKey.get(key) ?? 0;

      if (hasValue.has(budgetType)) {
        checkedGroups++;
        const summaryValue = sums[budgetType];
        if (itemSum !== summaryValue) {
          mismatches++;
          findings.push({
            severity: 'error', check: 'rs-summary-item-reconciliation', category: 'invariant', scope,
            metrics: { summaryAmountYen: summaryValue, itemAmountYen: itemSum, differenceYen: itemSum - summaryValue, budgetType },
            message: `projectId=${identity.projectId} fiscalYear=${identity.fiscalYear} budgetType=${budgetType}: 2-1会計サマリ(同一キー内合算)と2-2目別合計が不一致（2-1=${summaryValue} 2-2=${itemSum}）`,
          });
        }
      } else if (hasItems && itemSum !== 0) {
        // 2-1側がblankなのに2-2に非0の目別金額がある：報告書で確認済みのケースには無いが、
        // 金額影響がありうるためinvariant扱いとする
        mismatches++;
        findings.push({
          severity: 'error', check: 'rs-summary-item-reconciliation', category: 'invariant', scope,
          metrics: { summaryAmountYen: null, itemAmountYen: itemSum, differenceYen: itemSum, budgetType },
          message: `projectId=${identity.projectId} fiscalYear=${identity.fiscalYear} budgetType=${budgetType}: 2-1側がblankだが2-2に非0の目別金額(${itemSum})がある`,
        });
      } else if (hasItems && itemSum === 0) {
        // 02_rs-money-preservation.md 4章で確認済みのEXPECTED_VARIANCE（2-2にのみ明示的0円のevidence）
        findings.push({
          severity: 'info', check: 'rs-summary-item-reconciliation', category: 'semantic-diagnostic', scope,
          metrics: { budgetType },
          message: `projectId=${identity.projectId} fiscalYear=${identity.fiscalYear} budgetType=${budgetType}: 2-2にのみ明示的0円のevidenceがある（2-1はblank。既知のEXPECTED_VARIANCE）`,
        });
      }
    }
  }
  return { findings, checkedGroups, mismatches };
}

const ITEM_EVENT_TYPES = new Set<RsDerivedEventType>([
  'initial_budget', 'supplementary_budget', 'carryover_in', 'reserve_or_other', 'unclassified_budget', 'other_budget',
]);
const SUMMARY_EVENT_COLUMNS: Partial<Record<RsDerivedEventType, string>> = {
  execution: '執行額', carryover_in_project_account: '前年度から繰越し', next_year_request_project_account: '翌年度要求額',
};

/**
 * B-3: Derived RS Budget Event provenance。
 * Derived eventのsourceRecordIdsを使ってNormalized 2-2/2-1へ逆照合し、金額・fiscalYear・
 * イベント種別分類（rsBudgetEventType()）が実際のPipelineコードから再現可能であることを確認する。
 */
export function checkRsDerivedEventProvenance(
  events: RsDerivedBudgetEvent[], items: RsBudgetItemRecordV2[], summaries: RsBudgetSummaryRecord[]
): { findings: Finding[]; checkedEvents: number; missingSourceRecords: number; amountMismatches: number } {
  const findings: Finding[] = [];
  let checkedEvents = 0;
  let missingSourceRecords = 0;
  let amountMismatches = 0;

  const itemsById = new Map(items.map(i => [i.recordId, i]));
  const summariesById = new Map(summaries.map(s => [s.recordId, s]));

  const pushMissing = (e: RsDerivedBudgetEvent, sourceId: string | undefined) => {
    missingSourceRecords++;
    findings.push({
      severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant',
      scope: { reviewYear: e.reviewYear, projectId: e.projectId, eventId: e.eventId, recordId: sourceId },
      message: `eventId=${e.eventId}: sourceRecordId=${sourceId ?? '(なし)'}のNormalizedレコードが実在しない`,
    });
  };
  const pushAmountMismatch = (e: RsDerivedBudgetEvent, expected: number | null, field: string) => {
    amountMismatches++;
    findings.push({
      severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant',
      scope: { reviewYear: e.reviewYear, projectId: e.projectId, eventId: e.eventId, recordId: e.sourceRecordIds[0] },
      metrics: { expectedAmountYen: expected, actualAmountYen: e.amountYen, sourceField: field },
      message: `eventId=${e.eventId}: ${field}(${expected})とevent.amountYen(${e.amountYen})が不一致`,
    });
  };
  const pushFyMismatch = (e: RsDerivedBudgetEvent, expected: number | null, actual: number | null, field: string) => {
    findings.push({
      severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant',
      scope: { reviewYear: e.reviewYear, projectId: e.projectId, eventId: e.eventId, recordId: e.sourceRecordIds[0] },
      metrics: { expected, actual, field },
      message: `eventId=${e.eventId}: ${field}が期待値(${expected})と不一致（実際${actual}）`,
    });
  };

  for (const e of events) {
    checkedEvents++;
    const sourceId = e.sourceRecordIds[0] as string | undefined;

    if (ITEM_EVENT_TYPES.has(e.eventType) || e.eventType === 'next_year_request') {
      const item = sourceId ? itemsById.get(sourceId) : undefined;
      if (!item) { pushMissing(e, sourceId); continue; }

      if (e.eventType === 'next_year_request') {
        if (item.nextYearRequestYen !== e.amountYen) pushAmountMismatch(e, item.nextYearRequestYen, 'nextYearRequestYen');
        if (item.requestFiscalYear !== e.fiscalYear) pushFyMismatch(e, item.requestFiscalYear, e.fiscalYear, 'fiscalYear(requestFiscalYear)');
        if (item.fiscalYear !== (e.sourceFiscalYear ?? null)) pushFyMismatch(e, item.fiscalYear, e.sourceFiscalYear ?? null, 'sourceFiscalYear');
      } else {
        if (item.budgetAmountYen !== e.amountYen) pushAmountMismatch(e, item.budgetAmountYen, 'budgetAmountYen');
        if (item.fiscalYear !== e.fiscalYear) pushFyMismatch(e, item.fiscalYear, e.fiscalYear, 'fiscalYear');
        const expectedType = rsBudgetEventType(item.budgetType);
        if (expectedType !== e.eventType) {
          findings.push({
            severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant',
            scope: { reviewYear: e.reviewYear, projectId: e.projectId, eventId: e.eventId, recordId: sourceId },
            metrics: { expectedEventType: expectedType, actualEventType: e.eventType, sourceBudgetType: item.budgetType },
            message: `eventId=${e.eventId}: budgetType「${item.budgetType}」のrsBudgetEventType()判定(${expectedType})とevent.eventType(${e.eventType})が不一致`,
          });
        }
      }
    } else if (e.eventType in SUMMARY_EVENT_COLUMNS) {
      const summary = sourceId ? summariesById.get(sourceId) : undefined;
      if (!summary) { pushMissing(e, sourceId); continue; }

      const column = SUMMARY_EVENT_COLUMNS[e.eventType]!;
      const expectedAmount = summary.amounts[column] ?? null;
      if (expectedAmount !== e.amountYen) pushAmountMismatch(e, expectedAmount, `amounts["${column}"]`);
      if (summary.fiscalYear !== (e.sourceFiscalYear ?? null)) pushFyMismatch(e, summary.fiscalYear, e.sourceFiscalYear ?? null, 'sourceFiscalYear');
      const expectedFiscalYear = e.eventType === 'next_year_request_project_account' && summary.fiscalYear !== null ? summary.fiscalYear + 1 : summary.fiscalYear;
      if (expectedFiscalYear !== e.fiscalYear) pushFyMismatch(e, expectedFiscalYear, e.fiscalYear, 'fiscalYear');
    }
    // 上記どちらにも属さないeventType（将来追加分）は現時点で検査対象外。無視して静かに通す。
  }
  return { findings, checkedEvents, missingSourceRecords, amountMismatches };
}

/**
 * B-4: explicit zero / blank propagation。件数確認ではなくrecordId単位で、
 * budgetAmountYen/nextYearRequestYenの明示0がDerived eventとして残ること、
 * blank(null)からはeventが生成されないことを検査する。
 */
export function checkRsZeroBlankPropagation(
  items: RsBudgetItemRecordV2[], events: RsDerivedBudgetEvent[]
): { findings: Finding[]; explicitZeroSourceRows: number; explicitZeroEvents: number; blankSourceRows: number; blankUnexpectedEvents: number } {
  const findings: Finding[] = [];
  let explicitZeroSourceRows = 0;
  let explicitZeroEvents = 0;
  let blankSourceRows = 0;
  let blankUnexpectedEvents = 0;

  const budgetEventBySourceId = new Map(events.filter(e => ITEM_EVENT_TYPES.has(e.eventType)).map(e => [e.sourceRecordIds[0], e]));
  const nextRequestEventBySourceId = new Map(events.filter(e => e.eventType === 'next_year_request').map(e => [e.sourceRecordIds[0], e]));

  const checkField = (item: RsBudgetItemRecordV2, value: number | null, eventBySourceId: Map<string, RsDerivedBudgetEvent>, fieldLabel: string) => {
    const scope = { reviewYear: item.reviewYear, projectId: item.projectId, recordId: item.recordId };
    if (value === 0) {
      explicitZeroSourceRows++;
      const ev = eventBySourceId.get(item.recordId);
      if (ev) explicitZeroEvents++;
      else findings.push({
        severity: 'error', check: 'rs-zero-blank-propagation', category: 'source-preservation', scope,
        metrics: { field: fieldLabel },
        message: `recordId=${item.recordId}: ${fieldLabel}=0の明示的な0円がDerived eventとして残っていない`,
      });
    } else if (value === null) {
      blankSourceRows++;
      const ev = eventBySourceId.get(item.recordId);
      if (ev) {
        blankUnexpectedEvents++;
        findings.push({
          severity: 'error', check: 'rs-zero-blank-propagation', category: 'source-preservation', scope,
          metrics: { field: fieldLabel, unexpectedEventId: ev.eventId },
          message: `recordId=${item.recordId}: ${fieldLabel}がblank(null)なのにDerived event(${ev.eventId})が生成されている`,
        });
      }
    }
  };

  for (const item of items) {
    checkField(item, item.budgetAmountYen, budgetEventBySourceId, 'budgetAmountYen');
    checkField(item, item.nextYearRequestYen, nextRequestEventBySourceId, 'nextYearRequestYen');
  }

  return { findings, explicitZeroSourceRows, explicitZeroEvents, blankSourceRows, blankUnexpectedEvents };
}
