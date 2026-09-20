import { describe, it, expect } from 'vitest';
import { sectionKeyOf, aggregateMofSections } from './mof-sections';
import type { MofAccountType, MofBudgetItemRecord, MofDerivedBudgetEvent } from '../types';

const fields = {
  accountType: 'general' as MofAccountType, ministry: 'デジタル庁', organization: 'デジタル庁',
  specialAccount: '', subAccount: '', agency: '', sectionCode: '003', sectionName: '情報通信技術調達等適正・効率化推進費',
};

function item(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'r1', fiscalYear: 2024,
    phase: 'initial', budgetStatus: 'enacted', revision: null,
    ...fields,
    subItemCode: '01', subItemName: '目1',
    sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik1', scopeNameItemKey: 'sk1',
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    ...overrides,
  };
}

function event(overrides: Partial<MofDerivedBudgetEvent>): MofDerivedBudgetEvent {
  return {
    schemaVersion: 2, recordType: 'budget_event', eventId: 'e1', sourceSystem: 'mof',
    fiscalYear: 2024, eventType: 'initial_budget_state', amountYen: 0,
    ...fields,
    subItemName: '目1', sourceRecordIds: ['r1'],
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    ...overrides,
  };
}

describe('sectionKeyOf', () => {
  it('8フィールドをまとめて識別キーにする', () => {
    expect(sectionKeyOf(fields)).toBe(sectionKeyOf(fields));
  });
});

describe('aggregateMofSections', () => {
  it('PID:4相当（デジタル庁の実例）でunresolvedPreSettlementDeltaYenを再現する', () => {
    const items = [item({ recordId: 'r1' })];
    const events: MofDerivedBudgetEvent[] = [
      event({ eventId: 'e1', eventType: 'initial_budget_state', budgetStatus: 'enacted', amountYen: 480327293000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e2', eventType: 'supplement_adjustment', amountYen: 205412304000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e3', eventType: 'settlement_budget_appropriation', amountYen: 176048747050, sourceRecordIds: ['r1'] }),
    ];
    const { sections, stageGaps } = aggregateMofSections(items, events, 2024);
    expect(sections).toHaveLength(1);
    expect(sections[0].initialYen).toBe(480327293000);
    expect(sections[0].supplementDeltaYen).toBe(205412304000);
    expect(sections[0].settlementBudgetYen).toBe(176048747050);
    expect(sections[0].unresolvedPreSettlementDeltaYen).toBe(-509690849950);
    expect(stageGaps).toHaveLength(1);
    expect(stageGaps[0].classification).toBe('unresolved');
  });

  it('初回提出額と成立額は別々に持ち、合算しない', () => {
    const items = [item({ recordId: 'r1' })];
    const events: MofDerivedBudgetEvent[] = [
      event({ eventId: 'e1', eventType: 'initial_budget_state', budgetStatus: 'submitted', amountYen: 100 }),
      event({ eventId: 'e2', eventType: 'initial_budget_state', budgetStatus: 'enacted', amountYen: 120 }),
    ];
    const { sections } = aggregateMofSections(items, events, 2024);
    expect(sections[0].initialSubmittedYen).toBe(100);
    expect(sections[0].initialEnactedYen).toBe(120);
    // 成立額が優先。提出+成立を足し合わせた220にはならない
    expect(sections[0].initialYen).toBe(120);
  });

  it('補正後予算と決算が一致すればstage gapを作らない', () => {
    const items = [item({ recordId: 'r1' })];
    const events: MofDerivedBudgetEvent[] = [
      event({ eventId: 'e1', eventType: 'initial_budget_state', budgetStatus: 'enacted', amountYen: 1000 }),
      event({ eventId: 'e2', eventType: 'supplement_adjustment', amountYen: 100 }),
      event({ eventId: 'e3', eventType: 'settlement_budget_appropriation', amountYen: 1100 }),
    ];
    const { sections, stageGaps } = aggregateMofSections(items, events, 2024);
    expect(sections[0].unresolvedPreSettlementDeltaYen).toBeUndefined();
    expect(stageGaps).toHaveLength(0);
  });

  it('0円のイベントもstagesに残す（evidenceとして捨てない）', () => {
    const items = [item({ recordId: 'r1' })];
    const events: MofDerivedBudgetEvent[] = [event({ eventId: 'e1', eventType: 'reserve_use', amountYen: 0 })];
    const { sections } = aggregateMofSections(items, events, 2024);
    expect(sections[0].stages).toContain('reserve_use');
    expect(sections[0].eventCount).toBe(1);
  });
});
