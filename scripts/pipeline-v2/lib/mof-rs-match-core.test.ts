import { describe, it, expect } from 'vitest';
import { stageKey, mofKeyFrom, rsKeyFrom, rsPhase, parseSupplementalExactInfo, evaluateSupplementalExact } from './mof-rs-match-core';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2 } from '../types';

/**
 * lib/mof-rs-links.ts・lib/validation/mof-rs-linkage.tsから移動したP1 primitiveと
 * P2 matching coreの、抽出後もロジックが破損していないことを確認する最小限のsmoke test。
 * 詳細な分類ルール（R1〜R5・parser優先順位等）の網羅的な回帰テストは、抽出前と同じく
 * lib/validation/mof-rs-linkage.test.tsに残している（`diagnoseSupplementalExactFallback`
 * 経由でevaluateSupplementalExact()を実質的に検証する）。
 */

const SRC = { domain: 'mof.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };
const RS_SRC = { domain: 'rssystem.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };

function mofItem(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'mof_1', fiscalYear: 2024, phase: 'initial', budgetStatus: 'enacted',
    revision: null, accountType: 'general', ministry: '外務省', organization: '在外公館', specialAccount: '', subAccount: '',
    agency: '', sectionCode: '027', sectionName: '経済協力費', subItemCode: '', subItemName: '在外公館必要経費',
    sectionNaturalKey: '', legacySectionKey: '', itemNaturalKey: '', scopeNameItemKey: '', source: SRC,
    amountYen: 1000, ...overrides,
  };
}

function rsItem(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
  return {
    schemaVersion: 2, sourceSystem: 'rs', sourceYear: 2024, reviewYear: 2024, sheetType: '', projectId: '1', projectIdRaw: '1',
    projectName: 'X', policyMinistry: '', ministry: '外務省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
    recordType: 'rs_budget_item', recordId: 'rsitem_1', fiscalYear: 2024, accountType: 'general', accountClass: '一般会計', account: '一般会計', subAccount: '',
    budgetType: '当初予算', budgetMinistry: '外務省', organizationOrAccount: '在外公館', sectionName: '経済協力費', subItemName: '在外公館必要経費', supplementalInfo: '',
    budgetAmountYen: 900, budgetAmountRaw: '900', nextYearRequestYen: null, nextYearRequestRaw: '', requestFiscalYear: null, note: '',
    mofNameNaturalKey: 'general|外務省|在外公館|経済協力費|在外公館必要経費', extraFields: {}, source: RS_SRC, ...overrides,
  };
}

describe('P1 primitives（mof-rs-links.tsからの移動）', () => {
  it('stageKeyはphase+revisionから安定したキーを作る', () => {
    expect(stageKey(['initial', null])).toBe('initial\x1f');
    expect(stageKey(['supplement', 1])).toBe('supplement\x1f1');
  });

  it('mofKeyFrom/rsKeyFromは同じ語彙で一致するキーを作る（一般会計）', () => {
    const mof = mofItem({});
    const rs = rsItem({});
    expect(mofKeyFrom(mof)).toBe(rsKeyFrom(rs));
  });

  it('rsPhaseは当初予算/補正予算をStageへ変換する', () => {
    expect(rsPhase(rsItem({ budgetType: '当初予算' }))).toEqual(['initial', null]);
    expect(rsPhase(rsItem({ budgetType: '第2次補正予算' }))).toEqual(['supplement', 2]);
    expect(rsPhase(rsItem({ budgetType: '前年度から繰越し' }))).toBeNull();
  });
});

describe('P2 matching core（mof-rs-linkage.tsからの移動）smoke test', () => {
  it('parseSupplementalExactInfo: fwspace-pairを解析できる', () => {
    const parsed = parseSupplementalExactInfo('内閣官房共通費　諸謝金', 'general');
    expect(parsed).toEqual({ kind: 'fwspace-pair', sectionName: '内閣官房共通費', subItemName: '諸謝金' });
  });

  it('evaluateSupplementalExact: missing-link-key行をpair-uniqueとしてexact reconciliationする', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = rsItem({ budgetMinistry: '', sectionName: '', subItemName: '', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000 });
    const result = evaluateSupplementalExact([mof], [rs], 2024);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('pair-unique');
    expect(result.candidates[0].reconciliation).toBe('exact');
    expect(result.summary.safeExactRecordCount).toBe(1);
  });
});
