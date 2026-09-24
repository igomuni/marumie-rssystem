import { describe, it, expect } from 'vitest';
import { buildSettlementIdentityRelations } from './mof-rs-settlement-identity';
import type { MofBudgetItemRecord, MofRsProjectLinkGroup } from '../types';
import { SETTLEMENT_ITEM_SCHEMA_VERSION, type SettlementItemRecord } from './mof-settlement-items';

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
    schemaVersion: SETTLEMENT_ITEM_SCHEMA_VERSION, recordType: 'mof_settlement_item', fiscalYear: 2024, itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
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

describe('buildSettlementIdentityRelations: exact join（Phase B1）', () => {
  it('一般会計: 単一link groupがexactにitemNaturalKeyへ辿れ、settlement itemとjoinする', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations(
      [mofRow({})], [linkGroup({})], [settlementItem({})], 2024, 2024, 'available',
    );
    expect(relations).toHaveLength(1);
    expect(relations[0].accountType).toBe('general');
    expect(relations[0].settlementItemNaturalKey).toBe('ik');
    expect(relations[0].projectIds).toEqual(['7']);
    expect(relations[0].sourceLinks).toHaveLength(1);
    expect(relations[0].sourceLinks[0].linkId).toBe('link_1');
    expect(relations[0].sourceLinks[0].budgetItemNaturalKey).toBe('ik');
    expect(relations[0].sourceLinks[0].resolutionMethod).toBe('exact-item-key');
    expect(relations[0].currentBudgetYen).toBe(1000);
    expect(relations[0].spentYen).toBe(800);
    expect(diagnostics.exactJoinLinkGroupCount).toBe(1);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(0);
    expect(diagnostics.relationCountByResolutionMethod['exact-item-key']).toBe(1);
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
    expect(relations[0].settlementItemNaturalKey).toBe('ik-sp');
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
    expect(diagnostics.unresolvedLinkGroups[0].budgetItemNaturalKeyCandidates).toEqual(['ik-a', 'ik-b']);
  });

  it('artifact_missing: settlement-items.jsonl自体が存在しない年度はrelationCount=0で即座に返し、unresolvedLinkGroupsを展開しない', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations([mofRow({})], [linkGroup({}), linkGroup({ linkId: 'link_2' })], [], 2024, 2023, 'artifact_missing');
    expect(relations).toHaveLength(0);
    expect(diagnostics.settlementDataStatus).toBe('artifact_missing');
    expect(diagnostics.sourceLinkGroupCount).toBe(2);
    expect(diagnostics.relationCount).toBe(0);
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(0);
    expect(diagnostics.unresolvedLinkGroups).toHaveLength(0);
  });

  it('no_settlement_rows: settlement行が0件の年度はrelationCount=0で即座に返し、unresolvedLinkGroupsを展開しない', () => {
    const { relations, diagnostics } = buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [], 2024, 2025, 'no_settlement_rows');
    expect(relations).toHaveLength(0);
    expect(diagnostics.settlementDataStatus).toBe('no_settlement_rows');
    expect(diagnostics.sourceLinkGroupCount).toBe(1);
    expect(diagnostics.relationCount).toBe(0);
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(0);
    expect(diagnostics.unresolvedLinkGroups).toHaveLength(0);
  });
});

describe('buildSettlementIdentityRelations: scopeNameItemKey unique fallback（Phase B2）', () => {
  it('復興特会golden case: 予算側項コード36→決算側項コード701、項名・目名は同じ場合、unique-name-fallbackで安全に接続する', () => {
    const mofRows = [mofRow({
      recordId: 'mof_fukko', accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興',
      sectionCode: '36', sectionName: '東日本大震災復興支援事業費', subItemCode: '00', subItemName: '農業用施設等災害関連事業費補助',
      itemNaturalKey: 'special|X|東日本大震災復興特別会計|復興|36|東日本大震災復興支援事業費|00|農業用施設等災害関連事業費補助',
      scopeNameItemKey: 'special|X|東日本大震災復興特別会計|復興|東日本大震災復興支援事業費|農業用施設等災害関連事業費補助',
    })];
    const links = [linkGroup({ linkId: 'link_fukko', mofRecordIds: ['mof_fukko'] })];
    const settlement = [settlementItem({
      itemNaturalKey: 'special|X|東日本大震災復興特別会計|復興|701|東日本大震災復興支援事業費|00|農業用施設等災害関連事業費補助',
      scopeNameItemKey: 'special|X|東日本大震災復興特別会計|復興|東日本大震災復興支援事業費|農業用施設等災害関連事業費補助',
      accountType: 'special', specialAccount: '東日本大震災復興特別会計', subAccount: '復興',
      sectionCode: '701', subItemCode: '00',
    })];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(relations).toHaveLength(1);
    expect(relations[0].settlementItemNaturalKey).toContain('701');
    expect(relations[0].sourceLinks[0].budgetItemNaturalKey).toContain('36');
    expect(relations[0].sourceLinks[0].resolutionMethod).toBe('unique-name-fallback');
    expect(relations[0].currentBudgetYen).toBe(1000);
    expect(diagnostics.exactJoinLinkGroupCount).toBe(0);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(1);
    expect(diagnostics.accountTypeFallbackCounts.special).toBe(1);
    expect(diagnostics.relationCountByResolutionMethod['unique-name-fallback']).toBe(1);
  });

  it('exact itemNaturalKeyが存在する場合はfallbackを試みず必ずexactを優先する', () => {
    const mofRows = [mofRow({ itemNaturalKey: 'ik-exact', scopeNameItemKey: 'sk-shared' })];
    const links = [linkGroup({})];
    // exact一致するitemに加え、同じscopeNameItemKeyを持つ別itemも存在する（fallbackなら曖昧になる状況）
    const settlement = [
      settlementItem({ itemNaturalKey: 'ik-exact', scopeNameItemKey: 'sk-shared', currentBudgetYen: 1000 }),
      settlementItem({ itemNaturalKey: 'ik-other', scopeNameItemKey: 'sk-shared', currentBudgetYen: 9999 }),
    ];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(relations).toHaveLength(1);
    expect(relations[0].settlementItemNaturalKey).toBe('ik-exact');
    expect(relations[0].currentBudgetYen).toBe(1000);
    expect(relations[0].sourceLinks[0].resolutionMethod).toBe('exact-item-key');
    expect(diagnostics.exactJoinLinkGroupCount).toBe(1);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(0);
    expect(diagnostics.ambiguousNameFallbackLinkGroupCount).toBe(0);
  });

  it('fallback候補が2件以上の場合はambiguous-name-fallbackとして残し、自動選択・relation作成をしない', () => {
    const mofRows = [mofRow({ itemNaturalKey: 'ik-budget-only', scopeNameItemKey: 'sk-shared' })];
    const links = [linkGroup({})];
    const settlement = [
      settlementItem({ itemNaturalKey: 'ik-cand-1', scopeNameItemKey: 'sk-shared' }),
      settlementItem({ itemNaturalKey: 'ik-cand-2', scopeNameItemKey: 'sk-shared' }),
    ];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(relations).toHaveLength(0);
    expect(diagnostics.ambiguousNameFallbackLinkGroupCount).toBe(1);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(0);
    const entry = diagnostics.unresolvedLinkGroups[0];
    expect(entry.reason).toBe('ambiguous_name_fallback');
    expect(entry.linkId).toBe('link_1');
    expect(entry.scopeNameItemKey).toBe('sk-shared');
    expect(entry.settlementCandidateItemNaturalKeys).toEqual(['ik-cand-1', 'ik-cand-2']);
  });

  it('fallback候補が0件の場合はunmatchedとして残す（推測フォールバックしない）', () => {
    const mofRows = [mofRow({ itemNaturalKey: 'ik-budget-only', scopeNameItemKey: 'sk-no-match' })];
    const links = [linkGroup({})];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, [], 2024, 2024, 'available');
    expect(relations).toHaveLength(0);
    expect(diagnostics.unmatchedSettlementLinkGroupCount).toBe(1);
    expect(diagnostics.unresolvedLinkGroups[0].reason).toBe('unmatched');
    expect(diagnostics.unresolvedLinkGroups[0].scopeNameItemKey).toBe('sk-no-match');
  });

  it('projectIds/sourceLinksはfallback時もB1と同じく既存formal budget link由来のみで、RS↔決算の新規金額マッチを行わない', () => {
    const mofRows = [mofRow({ itemNaturalKey: 'ik-budget', scopeNameItemKey: 'sk-shared' })];
    const links = [linkGroup({ projectIds: ['42'], rsAmountYen: 123, mofAmountYen: 123 })];
    const settlement = [settlementItem({ itemNaturalKey: 'ik-settlement', scopeNameItemKey: 'sk-shared', currentBudgetYen: 999999 })];
    const { relations } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(relations[0].projectIds).toEqual(['42']);
    // settlement金額は選択したsettlement itemの値そのままで、RS/MOF budget linkの金額と混ざらない
    expect(relations[0].currentBudgetYen).toBe(999999);
  });
});

describe('buildSettlementIdentityRelations: budget-side uniqueness guard（review指摘、B2原則「曖昧なら自動選択しない」の境界条件強化）', () => {
  it('budget-side ambiguity: 同一phase+revision+scopeNameItemKeyに異なるbudgetItemNaturalKeyが2件あれば、settlement候補が1件でもfallbackしない', () => {
    const mofRows = [
      mofRow({ recordId: 'mof_a', itemNaturalKey: 'ik-a', scopeNameItemKey: 'sk-shared' }),
      mofRow({ recordId: 'mof_b', itemNaturalKey: 'ik-b', scopeNameItemKey: 'sk-shared' }),
    ];
    const links = [
      linkGroup({ linkId: 'link_a', mofRecordIds: ['mof_a'] }),
      linkGroup({ linkId: 'link_b', mofRecordIds: ['mof_b'] }),
    ];
    // settlement候補は1件のみ（ik-a/ik-bのどちらとも一致しないitemNaturalKey）
    const settlement = [settlementItem({ itemNaturalKey: 'ik-settlement', scopeNameItemKey: 'sk-shared' })];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(relations).toHaveLength(0);
    expect(diagnostics.ambiguousNameFallbackLinkGroupCount).toBe(2);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(0);
    const reasons = diagnostics.unresolvedLinkGroups.map(g => g.reason);
    expect(reasons).toEqual(['ambiguous_name_fallback', 'ambiguous_name_fallback']);
    for (const entry of diagnostics.unresolvedLinkGroups) {
      expect(entry.budgetItemNaturalKeyCandidates).toEqual(['ik-a', 'ik-b']);
      expect(entry.scopeNameItemKey).toBe('sk-shared');
      expect(entry.settlementCandidateItemNaturalKeys).toEqual(['ik-settlement']);
    }
  });

  it('phase/revisionが異なれば同名でもbudget-side ambiguityにしない（当初→補正のcode変更を妨げない）', () => {
    const mofRows = [
      mofRow({ recordId: 'mof_initial', itemNaturalKey: 'ik-initial', scopeNameItemKey: 'sk-shared' }),
      mofRow({ recordId: 'mof_supp', itemNaturalKey: 'ik-supp', scopeNameItemKey: 'sk-shared' }),
    ];
    const links = [
      linkGroup({ linkId: 'link_initial', phase: 'initial', revision: null, mofRecordIds: ['mof_initial'], projectIds: ['7'] }),
      linkGroup({ linkId: 'link_supp', phase: 'supplement', revision: 1, mofRecordIds: ['mof_supp'], projectIds: ['7'] }),
    ];
    const settlement = [settlementItem({ itemNaturalKey: 'ik-settlement', scopeNameItemKey: 'sk-shared' })];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    expect(diagnostics.ambiguousNameFallbackLinkGroupCount).toBe(0);
    expect(diagnostics.uniqueNameFallbackLinkGroupCount).toBe(2);
    // 同一settlement itemへ両方merge（B1由来のidentity集約）されるので1 relationになる
    expect(relations).toHaveLength(1);
    expect(relations[0].sourceLinks).toHaveLength(2);
    expect(relations[0].sourceLinks.every(s => s.resolutionMethod === 'unique-name-fallback')).toBe(true);
  });

  it('exact precedence: budget側に同名衝突があっても、itemNaturalKey exact matchが存在するlinkはexactで解決される', () => {
    const mofRows = [
      mofRow({ recordId: 'mof_exact', itemNaturalKey: 'ik-exact', scopeNameItemKey: 'sk-shared' }),
      mofRow({ recordId: 'mof_other', itemNaturalKey: 'ik-other', scopeNameItemKey: 'sk-shared' }),
    ];
    const links = [
      linkGroup({ linkId: 'link_exact', mofRecordIds: ['mof_exact'], projectIds: ['1'] }),
      linkGroup({ linkId: 'link_other', mofRecordIds: ['mof_other'], projectIds: ['2'] }),
    ];
    // ik-exactはsettlement側にexact一致item、名称candidateとしても衝突しているscopeNameItemKeyを共有
    const settlement = [settlementItem({ itemNaturalKey: 'ik-exact', scopeNameItemKey: 'sk-shared' })];
    const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, links, settlement, 2024, 2024, 'available');
    const exactRelation = relations.find(r => r.settlementItemNaturalKey === 'ik-exact');
    expect(exactRelation).toBeDefined();
    expect(exactRelation?.sourceLinks).toHaveLength(1);
    expect(exactRelation?.sourceLinks[0].resolutionMethod).toBe('exact-item-key');
    expect(exactRelation?.projectIds).toEqual(['1']);
    // ik-otherはexact一致が無くfallbackを試みるが、ik-exact/ik-otherが同一phase+revision+
    // scopeNameItemKeyで衝突しているため、settlement候補が1件(ik-exact)でも自動選択しない
    expect(diagnostics.ambiguousNameFallbackLinkGroupCount).toBe(1);
    const otherEntry = diagnostics.unresolvedLinkGroups.find(g => g.linkId === 'link_other');
    expect(otherEntry?.reason).toBe('ambiguous_name_fallback');
    expect(otherEntry?.budgetItemNaturalKeyCandidates).toEqual(['ik-exact', 'ik-other']);
  });
});

describe('buildSettlementIdentityRelations: stale settlement-items artifact検出', () => {
  it('B1形式のstale settlement item（schemaVersion旧版）を読むと、静かにfallback=0へ後退せず例外を投げる', () => {
    const staleItem: SettlementItemRecord = { ...settlementItem({}), schemaVersion: 1 };
    expect(() => buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [staleItem], 2024, 2024, 'available'))
      .toThrow(/settlement-items\.jsonl is incompatible/);
  });

  it('scopeNameItemKeyが欠落したstale settlement item（旧shape）を読むと例外を投げる', () => {
    const staleItem = { ...settlementItem({}) } as Partial<SettlementItemRecord>;
    delete staleItem.scopeNameItemKey;
    expect(() => buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [staleItem as SettlementItemRecord], 2024, 2024, 'available'))
      .toThrow(/settlement-items\.jsonl is incompatible/);
  });

  it('artifact_missing/no_settlement_rowsではstale検出より前に即座returnするため、settlementItemsが空でも例外を投げない', () => {
    expect(() => buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [], 2024, 2023, 'artifact_missing')).not.toThrow();
    expect(() => buildSettlementIdentityRelations([mofRow({})], [linkGroup({})], [], 2024, 2025, 'no_settlement_rows')).not.toThrow();
  });
});
