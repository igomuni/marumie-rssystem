/**
 * MOF金額イベント（derive-mof.tsのbudget-events.jsonl）を項（section）単位に集約する。
 * Python参照実装 pipeline_v2/publish.py の publish_mof_year 内、section集計・
 * unresolvedPreSettlementDeltaYen算出ロジックと同じ（参照実装はpublish時に計算しているが、
 * このPoCではderive層の責務としてMOF Derivedに含める）。
 */
import { normalizeText, stableId } from './stable-id';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent, MofDerivedSection, MofStageGap } from '../types';

interface SectionFields {
  accountType: string;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
}

/** 項の識別キー（8フィールドの正規化済み連結）。publish層の公開IDとは別の内部キー */
export function sectionKeyOf(f: SectionFields): string {
  return [f.accountType, f.ministry, f.organization, f.specialAccount, f.subAccount, f.agency, f.sectionCode, f.sectionName]
    .map(normalizeText).join('|');
}

const SIMPLE_AMOUNT_FIELDS: { eventType: string; field: keyof MofDerivedSection }[] = [
  { eventType: 'supplement_adjustment', field: 'supplementDeltaYen' },
  { eventType: 'settlement_budget_appropriation', field: 'settlementBudgetYen' },
  { eventType: 'current_budget_state', field: 'currentBudgetYen' },
  { eventType: 'spent', field: 'spentYen' },
  { eventType: 'carryover_out', field: 'carryoverOutYen' },
  { eventType: 'unused', field: 'unusedYen' },
];

export function aggregateMofSections(
  items: MofBudgetItemRecord[],
  events: MofDerivedBudgetEvent[],
  fiscalYear: number
): { sections: MofDerivedSection[]; stageGaps: MofStageGap[] } {
  const recordToSection = new Map<string, string>();
  const recordToItem = new Map<string, string>();
  const sectionMeta = new Map<string, SectionFields>();
  const sectionItems = new Map<string, Set<string>>();

  for (const row of items) {
    const key = sectionKeyOf(row);
    recordToSection.set(row.recordId, key);
    recordToItem.set(row.recordId, row.itemNaturalKey);
    if (!sectionMeta.has(key)) {
      sectionMeta.set(key, {
        accountType: row.accountType, ministry: row.ministry, organization: row.organization,
        specialAccount: row.specialAccount, subAccount: row.subAccount, agency: row.agency,
        sectionCode: row.sectionCode, sectionName: row.sectionName,
      });
    }
    const set = sectionItems.get(key) ?? new Set<string>();
    set.add(row.itemNaturalKey);
    sectionItems.set(key, set);
  }

  const eventCounts = new Map<string, number>();
  const stagesBySection = new Map<string, Set<string>>();
  const amountsBySection = new Map<string, Map<string, number>>();
  const initialBySection = new Map<string, { submitted: number; hasSubmitted: boolean; enacted: number; hasEnacted: boolean }>();

  for (const ev of events) {
    const sourceIds = (ev.sourceRecordIds ?? []).filter(id => recordToSection.has(id));
    const sectionKeys = sourceIds.length > 0
      ? [...new Set(sourceIds.map(id => recordToSection.get(id)!))]
      : [sectionKeyOf(ev)];
    for (const key of sectionKeys) {
      if (!sectionMeta.has(key)) {
        sectionMeta.set(key, {
          accountType: ev.accountType, ministry: ev.ministry, organization: ev.organization,
          specialAccount: ev.specialAccount, subAccount: ev.subAccount, agency: ev.agency,
          sectionCode: ev.sectionCode, sectionName: ev.sectionName,
        });
      }
      eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
      const stages = stagesBySection.get(key) ?? new Set<string>();
      stages.add(ev.eventType);
      stagesBySection.set(key, stages);

      if (ev.eventType === 'initial_budget_state') {
        const acc = initialBySection.get(key) ?? { submitted: 0, hasSubmitted: false, enacted: 0, hasEnacted: false };
        if (ev.budgetStatus === 'submitted') { acc.submitted += ev.amountYen; acc.hasSubmitted = true; }
        else if (ev.budgetStatus === 'enacted') { acc.enacted += ev.amountYen; acc.hasEnacted = true; }
        initialBySection.set(key, acc);
      } else {
        const amounts = amountsBySection.get(key) ?? new Map<string, number>();
        amounts.set(ev.eventType, (amounts.get(ev.eventType) ?? 0) + ev.amountYen);
        amountsBySection.set(key, amounts);
      }
    }
  }

  const sections: MofDerivedSection[] = [];
  const stageGaps: MofStageGap[] = [];
  for (const [key, meta] of [...sectionMeta.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const id = stableId([key], 'mofsec_');
    const items_ = sectionItems.get(key) ?? new Set<string>();
    const amounts = amountsBySection.get(key) ?? new Map<string, number>();
    const initial = initialBySection.get(key);

    const section: MofDerivedSection = {
      id,
      fiscalYear,
      accountType: meta.accountType as MofDerivedSection['accountType'],
      ministry: meta.ministry,
      organization: meta.organization,
      specialAccount: meta.specialAccount,
      subAccount: meta.subAccount,
      agency: meta.agency,
      sectionCode: meta.sectionCode,
      sectionName: meta.sectionName,
      itemCount: items_.size,
      eventCount: eventCounts.get(key) ?? 0,
      stages: [...(stagesBySection.get(key) ?? [])].filter(Boolean).sort(),
    };

    if (initial?.hasSubmitted) section.initialSubmittedYen = initial.submitted;
    if (initial?.hasEnacted) section.initialEnactedYen = initial.enacted;
    if (initial?.hasEnacted || initial?.hasSubmitted) {
      section.initialYen = initial.hasEnacted ? initial.enacted : initial.submitted;
    }
    for (const { eventType, field } of SIMPLE_AMOUNT_FIELDS) {
      if (amounts.has(eventType)) (section as unknown as Record<string, number>)[field as string] = amounts.get(eventType)!;
    }

    // 補正後予算(initialYen+supplementDeltaYen)と決算書の歳出予算額の差。
    // 原因（移替・予備費等）は公式の対応表が無い限り断定しない
    if (section.initialYen !== undefined && section.settlementBudgetYen !== undefined) {
      const postSupplement = section.initialYen + (section.supplementDeltaYen ?? 0);
      const gap = section.settlementBudgetYen - postSupplement;
      if (gap !== 0) {
        section.unresolvedPreSettlementDeltaYen = gap;
        stageGaps.push({
          sectionId: id,
          fiscalYear,
          sectionName: meta.sectionName,
          from: 'post_supplement_budget',
          to: 'settlement_budget_appropriation',
          deltaYen: gap,
          classification: 'unresolved',
          note: '公式の移替・予備費等の対応関係が無い限りtransfer/reserve等に分類しない',
        });
      }
    }

    sections.push(section);
  }

  return { sections, stageGaps };
}
