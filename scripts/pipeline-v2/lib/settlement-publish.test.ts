import { describe, it, expect } from 'vitest';
import { compactSettlementIdentity, compactSettlementDiagnostics } from './settlement-publish';
import { sectionIdOf } from './mof-publish';
import type { MofRsSettlementDiagnostics, MofRsSettlementIdentityRelation } from './mof-rs-settlement-identity';
import type { SettlementItemRecord } from './mof-settlement-items';

function relation(overrides: Partial<MofRsSettlementIdentityRelation>): MofRsSettlementIdentityRelation {
  return {
    schemaVersion: 2, recordType: 'mof_rs_settlement_identity_relation', reviewYear: 2024, fiscalYear: 2024,
    accountType: 'general', settlementItemNaturalKey: 'ik', projectIds: ['7'],
    sourceLinks: [{ linkId: 'link_1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', projectIds: ['7'], budgetItemNaturalKey: 'ik', resolutionMethod: 'exact-item-key' }],
    settlementSourceRecordCount: 1, budgetAppropriationYen: 1000, currentBudgetYen: 1000, spentYen: 800, carryoverOutYen: 100, unusedYen: 100,
    ...overrides,
  };
}

function settlementItem(overrides: Partial<SettlementItemRecord>): SettlementItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_settlement_item', fiscalYear: 2024, itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
    budgetAppropriationYen: 1000, carryoverInYen: 0, reserveUseYen: 0, budgetRuleIncreaseYen: 0,
    reallocationYen: 0, transferAdjustmentYen: 0, currentBudgetYen: 1000,
    spentYen: 800, carryoverOutYen: 100, unusedYen: 100,
    sourceRecordCount: 1, sourceRecordIds: ['s_1'],
    equationChecked: true, componentsToCurrentBudgetMismatch: false, currentBudgetToSpentMismatch: false,
    ...overrides,
  };
}

describe('compactSettlementIdentity', () => {
  it('settlementItemNaturalKey→settlementItemId、budgetItemNaturalKey→budgetItemIdへ公開field名を変換する', () => {
    const items = new Map([['ik', settlementItem({})]]);
    const identity = compactSettlementIdentity(relation({}), items);
    expect(identity.settlementItemId).toBe('ik');
    expect(identity.sources[0].budgetItemId).toBe('ik');
    expect(identity.sources[0].linkId).toBe('link_1');
    expect(identity.sources[0].resolutionMethod).toBe('exact-item-key');
  });

  it('sourceにphase/revision/matchMethod/projectIdsを重複保持しない', () => {
    const items = new Map([['ik', settlementItem({})]]);
    const identity = compactSettlementIdentity(relation({}), items);
    expect(Object.keys(identity.sources[0]).sort()).toEqual(['budgetItemId', 'linkId', 'resolutionMethod']);
  });

  it('settlementSectionIdはbudget側ではなくsettlement itemのnormalized MOF行から求める', () => {
    const items = new Map([['ik-settlement', settlementItem({
      itemNaturalKey: 'ik-settlement', accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興',
      sectionCode: '701', sectionName: '東日本大震災復興支援事業費',
    })]]);
    const r = relation({
      settlementItemNaturalKey: 'ik-settlement', accountType: 'special',
      sourceLinks: [{ linkId: 'link_1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', projectIds: ['7'], budgetItemNaturalKey: 'ik-budget-code-36', resolutionMethod: 'unique-name-fallback' }],
    });
    const identity = compactSettlementIdentity(r, items);
    // sectionIdはbudget側('ik-budget-code-36'由来)ではなく、settlement item自身(項コード701)から計算される
    const expectedSectionId = sectionIdOf(items.get('ik-settlement')!);
    expect(identity.settlementSectionId).toBe(expectedSectionId);
    expect(identity.sources[0].budgetItemId).toBe('ik-budget-code-36');
    expect(identity.settlementItemId).toBe('ik-settlement');
  });

  it('対応するsettlement itemが見つからない場合はfail-fastする（relation/derived不整合の検出）', () => {
    const items = new Map<string, SettlementItemRecord>();
    expect(() => compactSettlementIdentity(relation({}), items)).toThrow(/settlement item not found/);
  });

  it('amountsはrelationの値をそのまま透過する（0とnullを区別する）', () => {
    const items = new Map([['ik', settlementItem({})]]);
    const r = relation({ budgetAppropriationYen: 0, carryoverOutYen: null });
    const identity = compactSettlementIdentity(r, items);
    expect(identity.amounts.budgetAppropriationYen).toBe(0);
    expect(identity.amounts.carryoverOutYen).toBeNull();
  });
});

describe('compactSettlementDiagnostics', () => {
  it('ambiguous/unmatchedのcandidate詳細を含む内部診断フィールドを公開しない', () => {
    const diagnostics: MofRsSettlementDiagnostics = {
      schemaVersion: 2, reviewYear: 2024, fiscalYear: 2024, settlementDataStatus: 'available',
      sourceLinkGroupCount: 10, exactJoinLinkGroupCount: 7, uniqueNameFallbackLinkGroupCount: 1,
      ambiguousNameFallbackLinkGroupCount: 1, unmatchedSettlementLinkGroupCount: 1, spansMultipleItemsLinkGroupCount: 0,
      noMofItemKeyLinkGroupCount: 0, relationCount: 8,
      relationCountByResolutionMethod: { 'exact-item-key': 7, 'unique-name-fallback': 1, mixed: 0 },
      accountTypeFallbackCounts: { special: 1 }, multiSourceSettlementItemCount: 2, linkedProjectCount: 8,
      accountTypeCounts: { general: 6, special: 2 },
      unresolvedLinkGroups: [{ linkId: 'link_x', reason: 'ambiguous_name_fallback', projectIds: ['1'], budgetItemNaturalKeyCandidates: ['ik'], settlementCandidateItemNaturalKeys: ['a', 'b'] }],
    };
    const summary = compactSettlementDiagnostics(diagnostics);
    expect(summary).not.toHaveProperty('unresolvedLinkGroups');
    expect(summary.relationCount).toBe(8);
    expect(summary.ambiguousNameFallbackLinkGroupCount).toBe(1);
    expect(summary.accountTypeFallbackCounts).toEqual({ special: 1 });
  });
});
