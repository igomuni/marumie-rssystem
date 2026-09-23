import { describe, it, expect } from 'vitest';
import { buildSettlementIdentityRelations } from './mof-rs-settlement-identity';
import type { MofBudgetItemRecord, MofRsProjectLinkGroup } from '../types';
import type { SettlementItemRecord } from './mof-settlement-items';

const SRC = { domain: 'mof.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };

function mofRow(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'mof_1', fiscalYear: 2024, phase: 'initial', budgetStatus: 'enacted',
    revision: null, accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
    sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik', scopeNameItemKey: 'sk', source: SRC,
    amountYen: 1000, ...overrides,
  };
}

function linkGroup(overrides: Partial<MofRsProjectLinkGroup>): MofRsProjectLinkGroup {
  return {
    schemaVersion: 2, recordType: 'mof_rs_project_link_group', linkId: 'link_1', reviewYear: 2024, fiscalYear: 2024,
    phase: 'initial', revision: null, matchMethod: 'exact-name-key', naturalKey: 'general|X|Y|S|I',
    mofRecordIds: ['mof_1'], rsRecordIds: ['rsitem_1'], projectIds: ['7'],
    mofAmountYen: 1000, rsAmountYen: 1000, differenceYen: 0, rsMatchEvidence: [],
    ...overrides,
  };
}

function settlementItem(overrides: Partial<SettlementItemRecord>): SettlementItemRecord {
  return {
    schemaVersion: 1, recordType: 'mof_settlement_item', fiscalYear: 2024, itemNaturalKey: 'ik',
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

describe('buildSettlementIdentityRelations', () => {
  it('一般会計: 単一link groupがexactにitemNaturalKeyへ辿れ、settlement itemとjoinする', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations(
      [mofRow({})], [linkGroup({})], [settlementItem({})], 2024, 2024, 'available',
    );
    expect(relations).toHaveLength(1);
    expect(relations[0].accountType).toBe('general');
    expect(relations[0].itemNaturalKey).toBe('ik');
    expect(relations[0].projectIds).toEqual(['7']);
    expect(relations[0].sourceLinks).toHaveLength(1);
    expect(relations[0].sourceLinks[0].linkId).toBe('link_1');
    expect(relations[0].currentBudgetYen).toBe(1000);
    expect(relations[0].spentYen).toBe(800);
    expect(diagnostics.exactJoinLinkGroupCount).toBe(1);
    expect(diagnostics.linkedProjectCount).toBe(1);
    expect(diagnostics.accountTypeCounts.general).toBe(1);
  });

  it('特別会計: accountType/itemNaturalKeyを保持してjoinする', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations(
      [mofRow({ recordId: 'mof_sp', accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興', itemNaturalKey: 'ik-sp' })],
      [linkGroup({ linkId: 'link_sp', mofRecordIds: ['mof_sp'], naturalKey: 'special|X|東日本大震災復興特別会計|復興|S|I' })],
      [settlementItem({ itemNaturalKey: 'ik-sp', accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興' })],
      2024, 2024, 'available',
    );
    expect(relations).toHaveLength(1);
    expect(relations[0].accountType).toBe('special');
    expect(relations[0].itemNaturalKey).toBe('ik-sp');
    expect(diagnostics.accountTypeCounts.special).toBe(1);
  });

  it('決算側にsourceRecordCount>1（複数内訳行合算）のitemがjoinされた場合、multiSourceSettlementItemCountへ計上する', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations(
      [mofRow({})], [linkGroup({})], [settlementItem({ sourceRecordCount: 2 })], 2024, 2024, 'available',
    );
    expect(relations[0].settlementSourceRecordCount).toBe(2);
    expect(diagnostics.multiSourceSettlementItemCount).toBe(1);
  });

  it('同一projectが複数budget stage(initial+supplement)から同一itemNaturalKeyへ到達する場合、relationは1件に集約しevidenceは両方残す', () => {
    const mofRows = [
      mofRow({ recordId: 'mof_initial', phase: 'initial', itemNaturalKey: 'ik' }),
      mofRow({ recordId: 'mof_supp', phase: 'supplement', revision: 1, itemNaturalKey: 'ik' }),
    ];
    const links = [
      linkGroup({ linkId: 'link_initial', phase: 'initial', revision: null, mofRecordIds: ['mof_initial'], projectIds: ['7'] }),
      linkGroup({ linkId: 'link_supp1', phase: 'supplement', revision: 1, mofRecordIds: ['mof_supp'], projectIds: ['7'] }),
    ];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, [settlementItem({})], 2024, 2024, 'available');
    expect(relations).toHaveLength(1);
    expect(relations[0].projectIds).toEqual(['7']);
    expect(relations[0].sourceLinks.map(l => l.linkId).sort()).toEqual(['link_initial', 'link_supp1']);
    expect(diagnostics.linkedProjectCount).toBe(1);
    expect(diagnostics.relationCount).toBe(1);
  });

  it('link groupのmofRecordIdsが複数の異なるitemNaturalKeyにまたがる場合、勝手に配賦せずspans_multiple_itemsとして残す', () => {
    const mofRows = [
      mofRow({ recordId: 'mof_a', itemNaturalKey: 'ik-a' }),
      mofRow({ recordId: 'mof_b', itemNaturalKey: 'ik-b' }),
    ];
    const links = [linkGroup({ mofRecordIds: ['mof_a', 'mof_b'] })];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, [settlementItem({ itemNaturalKey: 'ik-a' }), settlementItem({ itemNaturalKey: 'ik-b' })], 2024, 2024, 'available');
    expect(relations).toHaveLength(0);
    expect(diagnostics.spansMultipleItemsLinkGroupCount).toBe(1);
    expect(diagnostics.unresolvedLinkGroups[0].reason).toBe('spans_multiple_items');
    expect(diagnostics.unresolvedLinkGroups[0].itemNaturalKeyCandidates).toEqual(['ik-a', 'ik-b']);
  });

  it('settlement側にexact itemNaturalKeyが無い場合、fallbackせずunmatchedとして残す', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [], 2024, 2024, 'available');
    expect(relations).toHaveLength(0);
    expect(diagnostics.settlementDataStatus).toBe('available');
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(1);
    expect(diagnostics.unresolvedLinkGroups[0].reason).toBe('no_exact_settlement_item');
  });

  it('settlement-items.jsonl自体が存在しない年度(artifact_missing)は、no_exact_settlement_itemへ計上せずrelationCount=0で即座に返す', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations([mofRow({})], [linkGroup({}), linkGroup({ linkId: 'link_2' })], [], 2024, 2023, 'artifact_missing');
    expect(relations).toHaveLength(0);
    expect(diagnostics.settlementDataStatus).toBe('artifact_missing');
    expect(diagnostics.sourceLinkGroupCount).toBe(2);
    expect(diagnostics.relationCount).toBe(0);
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(0);
    expect(diagnostics.unresolvedLinkGroups).toHaveLength(0);
  });

  it('settlement行が0件の年度(no_settlement_rows)は、no_exact_settlement_itemへ計上せずrelationCount=0で即座に返す', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [], 2024, 2025, 'no_settlement_rows');
    expect(relations).toHaveLength(0);
    expect(diagnostics.settlementDataStatus).toBe('no_settlement_rows');
    expect(diagnostics.sourceLinkGroupCount).toBe(1);
    expect(diagnostics.relationCount).toBe(0);
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(0);
    expect(diagnostics.unresolvedLinkGroups).toHaveLength(0);
  });
});
