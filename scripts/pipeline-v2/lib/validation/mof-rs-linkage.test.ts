import { describe, it, expect } from 'vitest';
import {
  classifyUnlinkedReasons, diagnoseJointMinistryFallback,
  analyzeLinkDifferenceTaxonomy, analyzeMultiProjectGroups,
} from './mof-rs-linkage';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsProjectLinkGroup } from '../../types';

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

function link(overrides: Partial<MofRsProjectLinkGroup>): MofRsProjectLinkGroup {
  return {
    schemaVersion: 2, recordType: 'mof_rs_project_link_group', linkId: 'l1', reviewYear: 2024, fiscalYear: 2024,
    phase: 'initial', revision: null, matchMethod: 'exact-name-key', naturalKey: 'k',
    mofRecordIds: ['mof_1'], rsRecordIds: ['rsitem_1'], projectIds: ['1'],
    mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0, ...overrides,
  };
}

describe('classifyUnlinkedReasons', () => {
  it('primary keyがMOF groupに一致すればlinkedとしてカウントし、どのbucketにも入れない', () => {
    const result = classifyUnlinkedReasons([mofItem({})], [rsItem({})]);
    expect(result.linkedRecordCount).toBe(1);
    expect(result.unsupportedBudgetType.recordCount).toBe(0);
    expect(result.missingLinkKey.recordCount).toBe(0);
    expect(result.validKeyNoMatch.recordCount).toBe(0);
  });

  it('rsPhase()が対応しないbudgetTypeはunsupported-budget-typeに分類し金額を合算する', () => {
    const rs = rsItem({ budgetType: '前年度から繰越し', budgetAmountYen: 500 });
    const result = classifyUnlinkedReasons([], [rs]);
    expect(result.unsupportedBudgetType).toEqual({ recordCount: 1, amountYen: 500 });
  });

  it('budgetMinistry等が欠けていればmissing-link-keyに分類し、欠けたfieldを記録する', () => {
    const rs = rsItem({ budgetMinistry: '', budgetAmountYen: 300 });
    const result = classifyUnlinkedReasons([], [rs]);
    expect(result.missingLinkKey).toMatchObject({ recordCount: 1, amountYen: 300 });
    expect(result.missingLinkKey.missingFieldCounts.budgetMinistry).toBe(1);
  });

  it('keyは揃っているがMOF側に一致するgroupが無ければvalid-key-no-matchに分類する', () => {
    const rs = rsItem({ budgetAmountYen: 700 });
    const result = classifyUnlinkedReasons([], [rs]); // MOF側が空なので一致しない
    expect(result.validKeyNoMatch).toEqual({ recordCount: 1, amountYen: 700 });
  });

  it('reasonごとに金額を正しく合算する', () => {
    const rows = [
      rsItem({ recordId: 'a', budgetType: '前年度から繰越し', budgetAmountYen: 100 }),
      rsItem({ recordId: 'b', budgetType: '前年度から繰越し', budgetAmountYen: 200 }),
      rsItem({ recordId: 'c', budgetMinistry: '', budgetAmountYen: 50 }),
    ];
    const result = classifyUnlinkedReasons([], rows);
    expect(result.unsupportedBudgetType).toEqual({ recordCount: 2, amountYen: 300 });
    expect(result.missingLinkKey.recordCount).toBe(1);
    expect(result.missingLinkKey.amountYen).toBe(50);
  });
});

describe('diagnoseJointMinistryFallback', () => {
  it('primaryでlink済みの行は候補にしない', () => {
    const result = diagnoseJointMinistryFallback(2025, 2025, [mofItem({})], [rsItem({})]);
    expect(result.candidates).toHaveLength(0);
  });

  it('budgetMinistryとministryが同一なら候補にしない（差し替える意味が無い）', () => {
    const rs = rsItem({ budgetMinistry: '厚生労働省及び内閣府', ministry: '厚生労働省及び内閣府' });
    const result = diagnoseJointMinistryFallback(2025, 2025, [], [rs]);
    expect(result.candidates).toHaveLength(0);
  });

  it('primary(budgetMinistry)で未接続でも、common ministryに差し替えると一意なMOF targetに一致すれば候補にする', () => {
    // MOF: 厚生労働省 / 既存でlink済みのRS（ministry=budgetMinistry=厚生労働省で一致）と、
    // budgetMinistry="内閣府及び厚生労働省"（合同表記）で未接続のRS行
    const mof = mofItem({ ministry: '厚生労働省' });
    const existingLinked = rsItem({ recordId: 'existing', ministry: '厚生労働省', budgetMinistry: '厚生労働省', budgetAmountYen: 6_009_122_000 });
    const candidate = rsItem({ recordId: 'candidate', projectId: '2836', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 253_333_474_000 });
    const mofWithAmount = { ...mof, amountYen: 259_342_596_000 };
    const result = diagnoseJointMinistryFallback(2025, 2025, [mofWithAmount], [existingLinked, candidate]);

    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.rsRecordId).toBe('candidate');
    expect(c.projectId).toBe('2836');
    expect(c.existingRsAmountYen).toBe(6_009_122_000);
    expect(c.candidateRsAmountYen).toBe(253_333_474_000);
    expect(c.reconstructedRsAmountYen).toBe(259_342_596_000);
    expect(c.mofAmountYen).toBe(259_342_596_000);
    expect(c.differenceAfterYen).toBe(0);
    expect(c.exactReconciliation).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('info');
    expect(result.findings[0].category).toBe('semantic-diagnostic');
  });

  it('altKeyに一致するMOF targetが無ければ候補にしない', () => {
    const candidate = rsItem({ budgetMinistry: '内閣府及び厚生労働省', ministry: '厚生労働省' });
    const result = diagnoseJointMinistryFallback(2025, 2025, [], [candidate]); // MOF側が空
    expect(result.candidates).toHaveLength(0);
  });

  it('altKeyで一致してもreconstructedがMOF額と一致しなければexactReconciliation=false', () => {
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 999 });
    const candidate = rsItem({ ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exactReconciliation).toBe(false);
  });
});

describe('analyzeLinkDifferenceTaxonomy', () => {
  it('差額0/MOF>RS/RS>MOFを分類する', () => {
    const links = [
      link({ linkId: 'a', mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0 }),
      link({ linkId: 'b', mofAmountYen: 100, rsAmountYen: 80, differenceYen: 20 }),
      link({ linkId: 'c', mofAmountYen: 80, rsAmountYen: 100, differenceYen: -20 }),
    ];
    const result = analyzeLinkDifferenceTaxonomy(links);
    expect(result.exactZeroGroupCount).toBe(1);
    expect(result.mofGreaterGroupCount).toBe(1);
    expect(result.rsGreaterGroupCount).toBe(1);
    expect(result.nonZeroGroupCount).toBe(2);
    expect(result.netDifferenceYen).toBe(0);
    expect(result.absoluteDifferenceYen).toBe(40);
  });

  it('ratio bucketを正しく分類し、MOF=0は別bucketにする', () => {
    const links = [
      link({ linkId: 'lt0.5', mofAmountYen: 100, rsAmountYen: 40, differenceYen: 60 }),
      link({ linkId: 'mid', mofAmountYen: 100, rsAmountYen: 70, differenceYen: 30 }),
      link({ linkId: 'near1', mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0 }),
      link({ linkId: 'gt1.1', mofAmountYen: 100, rsAmountYen: 150, differenceYen: -50 }),
      link({ linkId: 'mofzero', mofAmountYen: 0, rsAmountYen: 50, differenceYen: -50 }),
    ];
    const result = analyzeLinkDifferenceTaxonomy(links);
    expect(result.ratioBuckets).toEqual({ lt0_5: 1, between0_5and0_9: 1, between0_9and1_1: 1, gt1_1: 1, mofZero: 1 });
  });

  it('top10/top100 concentrationを計算する', () => {
    const links = [
      link({ linkId: 'big', mofAmountYen: 1000, rsAmountYen: 0, differenceYen: 1000 }),
      link({ linkId: 'small1', mofAmountYen: 100, rsAmountYen: 90, differenceYen: 10 }),
      link({ linkId: 'small2', mofAmountYen: 100, rsAmountYen: 90, differenceYen: 10 }),
    ];
    const result = analyzeLinkDifferenceTaxonomy(links);
    expect(result.absoluteDifferenceYen).toBe(1020);
    expect(result.top10AbsoluteDifferenceYen).toBe(1020); // 3件しかないので全部top10に入る
    expect(result.top10Share).toBeCloseTo(1, 5);
  });

  it('空配列でも0除算せずfindingsを返す', () => {
    const result = analyzeLinkDifferenceTaxonomy([]);
    expect(result.top10Share).toBe(0);
    expect(result.top100Share).toBe(0);
  });
});

describe('analyzeMultiProjectGroups', () => {
  it('単一projectのgroupのみならmultiProjectGroupCount=0', () => {
    const links = [link({ projectIds: ['1'] }), link({ linkId: 'l2', projectIds: ['2'] })];
    const result = analyzeMultiProjectGroups(links);
    expect(result.multiProjectGroupCount).toBe(0);
    expect(result.maxProjectCountPerGroup).toBe(1);
  });

  it('複数projectを持つgroupを検出し、shareとmaxを計算する', () => {
    const links = [
      link({ linkId: 'multi', projectIds: ['1', '2', '3'] }),
      link({ linkId: 'single', projectIds: ['4'] }),
    ];
    const result = analyzeMultiProjectGroups(links);
    expect(result.multiProjectGroupCount).toBe(1);
    expect(result.multiProjectGroupShare).toBeCloseTo(0.5, 5);
    expect(result.maxProjectCountPerGroup).toBe(3);
  });

  it('空配列でも0除算しない', () => {
    const result = analyzeMultiProjectGroups([]);
    expect(result.multiProjectGroupShare).toBe(0);
    expect(result.maxProjectCountPerGroup).toBe(0);
  });
});
