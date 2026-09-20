import { describe, it, expect } from 'vitest';
import { buildMofRsLinks } from './mof-rs-links';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2 } from '../types';

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

describe('buildMofRsLinks: exact-name-key突合', () => {
  it('MOF初期(enacted)とRS当初予算が完全一致キーでリンクする', () => {
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rsItem({})]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.linkedRsRecordCount).toBe(1);
    expect(result.mofAmountAcrossGroupsYen).toBe(1000);
    expect(result.rsAmountAcrossGroupsYen).toBe(900);
    expect(result.links[0].differenceYen).toBe(100);
  });

  it('budgetMinistryを使う。ministry（府省庁）が異なってもbudgetMinistryが一致すればリンクする', () => {
    const rs = rsItem({ ministry: 'デジタル庁', budgetMinistry: '外務省' });
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rs]);
    expect(result.linkGroupCount).toBe(1);
  });

  it('MOF submitted（未成立）は突合対象にしない', () => {
    const mof = mofItem({ budgetStatus: 'submitted' });
    const result = buildMofRsLinks(2024, 2024, [mof], [rsItem({})]);
    expect(result.linkGroupCount).toBe(0);
    expect(result.unlinkedRsRecordCount).toBe(1);
  });

  it('MOF決算(settlement)は突合対象にしない', () => {
    const mof = mofItem({ phase: 'settlement', budgetStatus: 'enacted' });
    const result = buildMofRsLinks(2024, 2024, [mof], [rsItem({})]);
    expect(result.linkGroupCount).toBe(0);
  });

  it('補正予算はrevision番号込みでリンクする', () => {
    const mof = mofItem({ phase: 'supplement', revision: 1, supplementDeltaYen: 200 } as Partial<MofBudgetItemRecord>);
    const rs = rsItem({ budgetType: '第1次補正予算', budgetAmountYen: 150 });
    const result = buildMofRsLinks(2024, 2024, [mof], [rs]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.mofAmountAcrossGroupsYen).toBe(200);
  });

  it('繰越・予備費等・空欄などの budgetType は unsupportedBudgetTypeRecordCount に計上する', () => {
    const rs = rsItem({ budgetType: '前年度から繰越し' });
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rs]);
    expect(result.unsupportedBudgetTypeRecordCount).toBe(1);
    expect(result.linkGroupCount).toBe(0);
  });

  it('対応するMOF行が無いRS行はunlinkedRsRecordCountに計上する', () => {
    const rs = rsItem({ sectionName: '存在しない項' });
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rs]);
    expect(result.unlinkedRsRecordCount).toBe(1);
    expect(result.linkGroupCount).toBe(0);
  });

  it('fiscalYearが対象と異なるRS行は対象から除外する', () => {
    const rs = rsItem({ fiscalYear: 2025 });
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rs]);
    expect(result.linkGroupCount).toBe(0);
    expect(result.unlinkedRsRecordCount).toBe(0);
    expect(result.unsupportedBudgetTypeRecordCount).toBe(0);
  });
});
