import { describe, it, expect } from 'vitest';
import { checkMofSettlementEquation, checkMofDerivedEventProvenance, checkMofStructuralZero } from './mof-money';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent } from '../../types';

function item(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'r1', fiscalYear: 2024,
    phase: 'settlement', budgetStatus: 'settled', revision: null,
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
    sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    budgetAmountYen: 1000, carryoverInYen: 0, reserveUseYen: 0, budgetRuleIncreaseYen: 0,
    reallocationYen: 0, transferAdjustmentYen: 0, currentBudgetYen: 1000,
    spentYen: 800, carryoverOutYen: 100, unusedYen: 100,
    ...overrides,
  };
}
function event(overrides: Partial<MofDerivedBudgetEvent>): MofDerivedBudgetEvent {
  return {
    schemaVersion: 2, recordType: 'budget_event', eventId: 'evt_1', sourceSystem: 'mof',
    fiscalYear: 2024, eventType: 'initial_budget_state', amountYen: 0,
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemName: 'I',
    sourceRecordIds: ['r1'], source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    ...overrides,
  };
}

describe('checkMofSettlementEquation', () => {
  it('整合する行はfindingsが空', () => {
    const result = checkMofSettlementEquation([item({})]);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('内訳合計と現額の不一致を検出する', () => {
    // currentBudgetYenだけを崩すと現額→支出済等の等式も連鎖して崩れるため、
    // unusedYenを合わせて調整し「内訳合計と現額」の不一致だけを単独で発生させる
    const result = checkMofSettlementEquation([item({ currentBudgetYen: 999, unusedYen: 99 })]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
    expect(result.findings[0].metrics).toMatchObject({ side: 'components-to-current' });
  });

  it('現額と支出済+繰越+不用の不一致を検出する', () => {
    const result = checkMofSettlementEquation([item({ spentYen: 700 })]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].metrics).toMatchObject({ side: 'current-to-spent' });
  });

  it('必要フィールドがnullな行は対象外', () => {
    const result = checkMofSettlementEquation([item({ budgetRuleIncreaseYen: null })]);
    expect(result.checked).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('決算以外のphaseは対象外', () => {
    const result = checkMofSettlementEquation([item({ phase: 'initial' })]);
    expect(result.checked).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

describe('checkMofDerivedEventProvenance', () => {
  it('initial_budget_stateが正常なら findings無し', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e = event({ eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], [i]);
    expect(result.missingExpectedEvents).toBe(0);
    expect(result.amountMismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('settlement行は10件のeventを期待する', () => {
    const i = item({});
    const events: MofDerivedBudgetEvent[] = [
      event({ eventId: 'e1', eventType: 'settlement_budget_appropriation', amountYen: 1000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e2', eventType: 'carryover_in', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e3', eventType: 'reserve_use', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e4', eventType: 'budget_rule_increase', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e5', eventType: 'reallocation', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e6', eventType: 'transfer_adjustment', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e7', eventType: 'current_budget_state', amountYen: 1000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e8', eventType: 'spent', amountYen: 800, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e9', eventType: 'carryover_out', amountYen: 100, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e10', eventType: 'unused', amountYen: 100, sourceRecordIds: ['r1'] }),
    ];
    const result = checkMofDerivedEventProvenance(events, [i]);
    expect(result.expectedEvents).toBe(10);
    expect(result.actualEvents).toBe(10);
    expect(result.missingExpectedEvents).toBe(0);
    expect(result.duplicateOrUnexpectedEvents).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('sourceがあるのにeventが丸ごと欠落していれば検出する', () => {
    const i = item({ phase: 'supplement', supplementDeltaYen: 50 });
    const result = checkMofDerivedEventProvenance([], [i]);
    expect(result.missingExpectedEvents).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
  });

  it('同じsourceから同じeventが重複生成されていれば検出する', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e1 = event({ eventId: 'e1', eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const e2 = event({ eventId: 'e2', eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e1, e2], [i]);
    expect(result.duplicateOrUnexpectedEvents).toBe(1);
  });

  it('金額不一致を検出する', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e = event({ eventType: 'initial_budget_state', amountYen: 999, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], [i]);
    expect(result.amountMismatches).toBe(1);
  });

  it('sourceRecordIdが実在しなければerror', () => {
    const e = event({ sourceRecordIds: ['does-not-exist'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.findings.some(f => f.message.includes('実在しない'))).toBe(true);
  });

  it('未知のeventTypeはsilent skipせずwarning診断を出す', () => {
    // itemsを空にして「期待eventの欠落」ノイズを排除し、未知eventType診断だけを単独確認する
    const e = event({ eventType: 'future_event_type', sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.eventTypeMismatches).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('warning');
    expect(result.findings[0].category).toBe('semantic-diagnostic');
  });

  it('parliamentary_amendmentはenacted-submitted===amountYenを検算する', () => {
    const i1 = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted' });
    const i2 = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted' });
    const e = event({
      eventType: 'parliamentary_amendment', amountYen: 100, submittedAmountYen: 400, enactedAmountYen: 500,
      sourceRecordIds: ['s1', 'e1'],
    });
    const result = checkMofDerivedEventProvenance([e], [i1, i2]);
    expect(result.parliamentaryEventsChecked).toBe(1);
    expect(result.parliamentaryIntegrityErrors).toBe(0);
  });

  it('parliamentary_amendmentの算術不一致を検出する', () => {
    const i1 = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted' });
    const e = event({ eventType: 'parliamentary_amendment', amountYen: 999, submittedAmountYen: 400, enactedAmountYen: 500, sourceRecordIds: ['s1'] });
    const result = checkMofDerivedEventProvenance([e], [i1]);
    expect(result.parliamentaryIntegrityErrors).toBe(1);
  });

  it('parliamentary_amendmentの参照切れを検出する', () => {
    const e = event({ eventType: 'parliamentary_amendment', amountYen: 0, submittedAmountYen: 0, enactedAmountYen: 0, sourceRecordIds: ['does-not-exist'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.parliamentaryIntegrityErrors).toBe(1);
    expect(result.findings.some(f => f.check === 'mof-parliamentary-amendment-integrity')).toBe(true);
  });
});

describe('checkMofStructuralZero', () => {
  it('政府関係機関のtransferAdjustmentYen=0を集約1件のinfoとして報告する', () => {
    const items = [
      item({ recordId: 'a1', accountType: 'agency', transferAdjustmentYen: 0 }),
      item({ recordId: 'a2', accountType: 'agency', transferAdjustmentYen: 0 }),
    ];
    const result = checkMofStructuralZero(items);
    expect(result.agencyTransferAdjustmentRows).toBe(2);
    expect(result.agencyTransferAdjustmentAnomalies).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('info');
    expect(result.findings[0].metrics).toMatchObject({ count: 2 });
  });

  it('政府関係機関以外は対象外', () => {
    const result = checkMofStructuralZero([item({ accountType: 'general', transferAdjustmentYen: 0 })]);
    expect(result.findings).toHaveLength(0);
  });

  it('政府関係機関でtransferAdjustmentYenが0以外ならinvariant errorにする（前提が崩れているケース）', () => {
    const result = checkMofStructuralZero([item({ accountType: 'agency', transferAdjustmentYen: 500 })]);
    expect(result.agencyTransferAdjustmentAnomalies).toBe(1);
    expect(result.findings[0].severity).toBe('error');
    expect(result.findings[0].category).toBe('invariant');
  });
});
