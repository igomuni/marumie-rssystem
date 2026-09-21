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
 * Normalized 2-1 ↔ Normalized 2-2 のsource-preservation検証であり、Publish index用の
 * current-year検証（publish-v2.tsのindexBudgetByProject）とは別物。全fiscalYear
 * （過去の継続事業の履歴行を含む）を対象にする。
 *
 * 実データで確認: 同一(projectId, fiscalYear, accountType, account, subAccount)キーに対して
 * 2-1会計別行が複数存在することがある（当初予算だけ非0の行・補正予算だけ非0の行、等に分かれて
 * 出現し、互いに他方の列は明示的0を持つ）。行ごとに独立比較すると誤ってmismatch判定してしまうため、
 * 同一キーの行は列ごとに合算してから2-2側の合計と比較する（合算すると2-2側と一致することを
 * projectId=1151等の実データで確認済み）。
 *
 * summary側group・item側groupのunionを走査する。2-1に対応する会計別行が
 * 一切存在しない2-2 evidence（silent skipされていた既知の逆ケース）も検出対象にする。
 */
export function checkRsSummaryItemReconciliation(
  summaries: RsBudgetSummaryRecord[], items: RsBudgetItemRecordV2[]
): { findings: Finding[]; checkedGroups: number; mismatches: number } {
  const findings: Finding[] = [];
  let checkedGroups = 0;
  let mismatches = 0;

  interface GroupIdentity { reviewYear: number; projectId: string; fiscalYear: number | null }
  const groupIdentity = new Map<string, GroupIdentity>();

  const itemSumByKey = new Map<string, number>();
  for (const item of items) {
    if (!RECONCILABLE_BUDGET_TYPES.includes(item.budgetType)) continue;
    const groupKey = accountGroupKey(item.projectId, item.fiscalYear, item.accountType, item.account, item.subAccount);
    if (!groupIdentity.has(groupKey)) groupIdentity.set(groupKey, { reviewYear: item.reviewYear, projectId: item.projectId, fiscalYear: item.fiscalYear });
    if (item.budgetAmountYen !== null) {
      const key = itemKey(item.projectId, item.fiscalYear, item.accountType, item.account, item.subAccount, item.budgetType);
      itemSumByKey.set(key, (itemSumByKey.get(key) ?? 0) + item.budgetAmountYen);
    }
  }

  const summarySumByGroup = new Map<string, Record<string, number>>();
  const summaryHasValueByGroup = new Map<string, Set<string>>();
  for (const summary of summaries) {
    if (summary.scopeLevel !== 'account') continue;
    const groupKey = accountGroupKey(summary.projectId, summary.fiscalYear, summary.accountType, summary.account, summary.subAccount);
    if (!groupIdentity.has(groupKey)) groupIdentity.set(groupKey, { reviewYear: summary.reviewYear, projectId: summary.projectId, fiscalYear: summary.fiscalYear });
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
    const sums = summarySumByGroup.get(groupKey) ?? {};
    const hasValue = summaryHasValueByGroup.get(groupKey) ?? new Set<string>();
    const scope = { reviewYear: identity.reviewYear, projectId: identity.projectId, fiscalYear: identity.fiscalYear ?? undefined };

    for (const budgetType of RECONCILABLE_BUDGET_TYPES) {
      const key = `${groupKey}\x1f${budgetType}`;
      // itemHasNumericValue: このキー・budgetTypeで少なくとも1件はbudgetAmountYenが
      // non-nullな2-2行がある、という意味。「2-2行が存在する」こと自体（全行blankの
      // グループも含む）とは分けて判定する。分けないと「2-2行はあるが全部blank」な
      // グループをexplicit zero evidenceと誤分類しうる（blank≠0の原則に反する）。
      const itemHasNumericValue = itemSumByKey.has(key);
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
      } else if (itemHasNumericValue && itemSum !== 0) {
        // 2-1側がblankなのに2-2に非0の目別金額がある：報告書で確認済みのケースには無いが、
        // 金額影響がありうるためinvariant扱いとする
        mismatches++;
        findings.push({
          severity: 'error', check: 'rs-summary-item-reconciliation', category: 'invariant', scope,
          metrics: { summaryAmountYen: null, itemAmountYen: itemSum, differenceYen: itemSum, budgetType },
          message: `projectId=${identity.projectId} fiscalYear=${identity.fiscalYear} budgetType=${budgetType}: 2-1側がblankだが2-2に非0の目別金額(${itemSum})がある`,
        });
      } else if (itemHasNumericValue && itemSum === 0) {
        // 02_rs-money-preservation.md 4章で確認済みのEXPECTED_VARIANCE（2-2にのみ明示的0円のevidence）。
        // itemHasNumericValueがtrueの場合のみ「明示的0のevidenceがある」と言える
        // （全行blankの場合はitemHasNumericValue=falseになりこの分岐に来ない）。
        // 過去年度（FY2021等）にも実在するケースのため、fiscalYearをreviewYearに限定しない
        findings.push({
          severity: 'info', check: 'rs-summary-item-reconciliation', category: 'semantic-diagnostic', scope,
          metrics: { budgetType },
          message: `projectId=${identity.projectId} fiscalYear=${identity.fiscalYear} budgetType=${budgetType}: 2-2にのみ明示的0円のevidenceがある（2-1はblank。既知のEXPECTED_VARIANCE）`,
        });
      }
      // 2-2行はあるが全てblank（itemHasNumericValue=false）で2-1側もblankの場合は、
      // 2-1・2-2ともに数値evidenceが無いということなので、報告すべき差異が無く静かにskipする。
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

const KNOWN_EVENT_TYPES = new Set<RsDerivedEventType>([...ITEM_EVENT_TYPES, 'next_year_request', 'execution', 'carryover_in_project_account', 'next_year_request_project_account']);

interface ExpectedRsEventSpec {
  sourceRecordId: string; eventType: RsDerivedEventType;
  expectedAmountYen: number; expectedFiscalYear: number | null; expectedSourceFiscalYear: number | null;
  scope: { reviewYear: number; projectId: string };
}

function rsEventIdentity(sourceRecordId: string, eventType: RsDerivedEventType): string {
  return `${sourceRecordId}\x1f${eventType}`;
}

/**
 * B-3: Derived RS Budget Event provenance（双方向・cardinality検証）。
 *
 * 片方向（Derived event→source）だけでは、非0eventが丸ごと欠落した場合や、
 * 同じsourceから同じeventが重複生成された場合を検出できない。そのため
 * 「sourceのnon-null値ごとに期待されるeventを1件ずつ再構成する」順方向と、
 * 「実在するDerived eventがsourceから正しく再現できるか」逆方向の両方を検査する。
 *
 * logical identityは(sourceRecordId, eventType)。budgetAmountYen由来event（eventType=
 * rsBudgetEventType(item.budgetType)）とnextYearRequestYen由来event（eventType=
 * 'next_year_request'）は常に異なるeventTypeになるため、この組で一意に識別できる。
 */
export function checkRsDerivedEventProvenance(
  events: RsDerivedBudgetEvent[], items: RsBudgetItemRecordV2[], summaries: RsBudgetSummaryRecord[]
): {
  findings: Finding[]; checkedEvents: number; missingSourceRecords: number; amountMismatches: number;
  expectedEvents: number; actualEvents: number; missingExpectedEvents: number; duplicateOrUnexpectedEvents: number;
  fiscalYearMismatches: number; eventTypeMismatches: number;
} {
  const findings: Finding[] = [];
  let missingSourceRecords = 0;
  let amountMismatches = 0;
  let fiscalYearMismatches = 0;
  let eventTypeMismatches = 0;
  let missingExpectedEvents = 0;
  let duplicateOrUnexpectedEvents = 0;

  // 1) sourceのnon-null値から期待eventを再構成する
  const expected: ExpectedRsEventSpec[] = [];
  for (const item of items) {
    if (item.budgetAmountYen !== null) {
      expected.push({
        sourceRecordId: item.recordId, eventType: rsBudgetEventType(item.budgetType),
        expectedAmountYen: item.budgetAmountYen, expectedFiscalYear: item.fiscalYear, expectedSourceFiscalYear: null,
        scope: { reviewYear: item.reviewYear, projectId: item.projectId },
      });
    }
    if (item.nextYearRequestYen !== null) {
      expected.push({
        sourceRecordId: item.recordId, eventType: 'next_year_request',
        expectedAmountYen: item.nextYearRequestYen, expectedFiscalYear: item.requestFiscalYear, expectedSourceFiscalYear: item.fiscalYear,
        scope: { reviewYear: item.reviewYear, projectId: item.projectId },
      });
    }
  }
  for (const summary of summaries) {
    if (summary.scopeLevel !== 'account') continue;
    for (const [eventType, column] of Object.entries(SUMMARY_EVENT_COLUMNS) as [RsDerivedEventType, string][]) {
      const value = summary.amounts[column];
      if (value === null || value === undefined) continue;
      const expectedFiscalYear = eventType === 'next_year_request_project_account' && summary.fiscalYear !== null ? summary.fiscalYear + 1 : summary.fiscalYear;
      expected.push({
        sourceRecordId: summary.recordId, eventType,
        expectedAmountYen: value, expectedFiscalYear, expectedSourceFiscalYear: summary.fiscalYear,
        scope: { reviewYear: summary.reviewYear, projectId: summary.projectId },
      });
    }
  }

  // 2) 実在eventを(sourceRecordId, eventType)でindex化する
  const actualByIdentity = new Map<string, RsDerivedBudgetEvent[]>();
  for (const e of events) {
    const sourceId = e.sourceRecordIds[0];
    if (!sourceId) continue;
    const key = rsEventIdentity(sourceId, e.eventType);
    const list = actualByIdentity.get(key) ?? [];
    list.push(e);
    actualByIdentity.set(key, list);
  }

  // 3) 順方向: 期待した各eventが「1件だけ」「正しい値で」存在するか
  const consumedIdentities = new Set<string>();
  for (const spec of expected) {
    const key = rsEventIdentity(spec.sourceRecordId, spec.eventType);
    consumedIdentities.add(key);
    const matches = actualByIdentity.get(key) ?? [];
    const baseScope = { ...spec.scope, recordId: spec.sourceRecordId };

    if (matches.length === 0) {
      missingExpectedEvents++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope: baseScope,
        metrics: { expectedEventType: spec.eventType, expectedAmountYen: spec.expectedAmountYen },
        message: `recordId=${spec.sourceRecordId}: eventType=${spec.eventType}を期待するDerived eventが存在しない（source側はnon-null）`,
      });
      continue;
    }
    if (matches.length > 1) {
      duplicateOrUnexpectedEvents += matches.length - 1;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant',
        scope: { ...baseScope, eventId: matches[0].eventId },
        metrics: { eventType: spec.eventType, duplicateCount: matches.length },
        sampleIds: matches.map(m => m.eventId),
        message: `recordId=${spec.sourceRecordId}: eventType=${spec.eventType}のDerived eventが${matches.length}件重複生成されている`,
      });
    }

    const e = matches[0];
    const eventScope = { ...baseScope, eventId: e.eventId };
    if (e.amountYen !== spec.expectedAmountYen) {
      amountMismatches++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope: eventScope,
        metrics: { expectedAmountYen: spec.expectedAmountYen, actualAmountYen: e.amountYen },
        message: `eventId=${e.eventId}: 期待金額(${spec.expectedAmountYen})とevent.amountYen(${e.amountYen})が不一致`,
      });
    }
    if (e.fiscalYear !== spec.expectedFiscalYear) {
      fiscalYearMismatches++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope: eventScope,
        metrics: { expectedFiscalYear: spec.expectedFiscalYear, actualFiscalYear: e.fiscalYear, field: 'fiscalYear' },
        message: `eventId=${e.eventId}: fiscalYearが期待値(${spec.expectedFiscalYear})と不一致（実際${e.fiscalYear}）`,
      });
    }
    if ((e.sourceFiscalYear ?? null) !== spec.expectedSourceFiscalYear) {
      fiscalYearMismatches++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope: eventScope,
        metrics: { expectedSourceFiscalYear: spec.expectedSourceFiscalYear, actualSourceFiscalYear: e.sourceFiscalYear ?? null, field: 'sourceFiscalYear' },
        message: `eventId=${e.eventId}: sourceFiscalYearが期待値(${spec.expectedSourceFiscalYear})と不一致（実際${e.sourceFiscalYear ?? null}）`,
      });
    }
  }

  // 4) 逆方向: 実在する各eventがsourceレコードを持ち、期待済みidentityに属するか
  const itemsById = new Map(items.map(i => [i.recordId, i]));
  const summariesById = new Map(summaries.map(s => [s.recordId, s]));
  let checkedEvents = 0;
  for (const e of events) {
    checkedEvents++;
    const sourceId = e.sourceRecordIds[0] as string | undefined;
    const scope = { reviewYear: e.reviewYear, projectId: e.projectId, eventId: e.eventId, recordId: sourceId };

    if (!KNOWN_EVENT_TYPES.has(e.eventType)) {
      eventTypeMismatches++;
      findings.push({
        severity: 'warning', check: 'rs-derived-event-provenance', category: 'semantic-diagnostic', scope,
        metrics: { eventType: e.eventType },
        message: `eventId=${e.eventId}: 未知のeventType「${e.eventType}」はこのvalidatorの対応対象外（診断のみ・silent skipしない）`,
      });
      continue;
    }
    if (!sourceId || (!itemsById.has(sourceId) && !summariesById.has(sourceId))) {
      missingSourceRecords++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope,
        message: `eventId=${e.eventId}: sourceRecordId=${sourceId ?? '(なし)'}のNormalizedレコードが実在しない`,
      });
      continue;
    }
    const key = rsEventIdentity(sourceId, e.eventType);
    if (!consumedIdentities.has(key)) {
      // 対応するsourceのnon-null値が無いのにeventが生成されている（blankから生成された等）
      duplicateOrUnexpectedEvents++;
      findings.push({
        severity: 'error', check: 'rs-derived-event-provenance', category: 'invariant', scope,
        metrics: { eventType: e.eventType },
        message: `eventId=${e.eventId}: 対応するsourceのnon-null値が無いのにeventが生成されている（unexpected event）`,
      });
    }
  }

  return {
    findings, checkedEvents, missingSourceRecords, amountMismatches,
    expectedEvents: expected.length, actualEvents: events.length,
    missingExpectedEvents, duplicateOrUnexpectedEvents, fiscalYearMismatches, eventTypeMismatches,
  };
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
