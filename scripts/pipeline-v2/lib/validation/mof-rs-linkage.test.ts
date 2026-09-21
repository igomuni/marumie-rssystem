import { describe, it, expect } from 'vitest';
import {
  classifyUnlinkedReasons, checkLinkTaxonomyConsistency, diagnoseJointMinistryFallback,
  analyzeLinkDifferenceTaxonomy, analyzeMultiProjectGroups, diagnoseSupplementalExactFallback,
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

  it('review指摘: budgetMinistry欠損（missing-link-key）はprimary keyが完成していないため候補にしない', () => {
    const mof = mofItem({ ministry: '厚生労働省' });
    const candidate = rsItem({ budgetMinistry: '', ministry: '厚生労働省' }); // rsKeyFrom()がnullになる
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate]);
    expect(result.candidates).toHaveLength(0);
  });

  it('review指摘: budgetMinistryがministryと無関係（部分文字列に含まれない）なら候補にしない', () => {
    // primary keyは完成しているが、budgetMinistryにnormalized ministryが含まれない
    // （「joint-ministry（複合所管）」ではなく単に別の省庁が書かれているだけのケース）
    const mof = mofItem({ ministry: '厚生労働省' });
    const candidate = rsItem({ budgetMinistry: '経済産業省', ministry: '厚生労働省' });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate]);
    expect(result.candidates).toHaveLength(0);
  });

  it('review指摘: project 2836 fixtureで従来どおりexact reconciliationを維持する（strict化の回帰確認）', () => {
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 259_342_596_000 });
    const existingLinked = rsItem({ recordId: 'existing', ministry: '厚生労働省', budgetMinistry: '厚生労働省', budgetAmountYen: 6_009_122_000 });
    const candidate = rsItem({ recordId: 'candidate', projectId: '2836', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 253_333_474_000 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [existingLinked, candidate]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exactReconciliation).toBe(true);
  });

  it('review指摘: 同一altGroupKeyに複数候補がある場合、合算した額でexactReconciliationを判定する（過大評価の防止）', () => {
    // 単独では両方ともMOF額を下回るが、2件合算するとMOF額をちょうど超える
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 150 });
    const candidateA = rsItem({ recordId: 'candidateA', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const candidateB = rsItem({ recordId: 'candidateB', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidateA, candidateB]);
    expect(result.candidates).toHaveLength(2);
    // 個別には100<150で一見「まだ足りない」ように見えるが、合算(200)はMOF額(150)を超えている
    for (const c of result.candidates) {
      expect(c.reconstructedRsAmountYen).toBe(200);
      expect(c.differenceAfterYen).toBe(-50);
      expect(c.exactReconciliation).toBe(false);
    }
    expect(result.findings[0].metrics?.exactReconciliationCount).toBe(0);
  });

  it('review指摘: 同一altGroupKeyの複数候補を合算するとちょうどMOF額に一致する場合、exactReconciliationCountはグループ単位で1回だけ数える', () => {
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 200 });
    const candidateA = rsItem({ recordId: 'candidateA', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 120 });
    const candidateB = rsItem({ recordId: 'candidateB', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 80 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidateA, candidateB]);
    expect(result.candidates).toHaveLength(2);
    for (const c of result.candidates) {
      expect(c.reconstructedRsAmountYen).toBe(200);
      expect(c.exactReconciliation).toBe(true);
    }
    // candidateCountは2件のままだが、exactReconciliationCountはグループ単位で1（候補単位で2にしない）
    expect(result.findings[0].metrics?.candidateCount).toBe(2);
    expect(result.findings[0].metrics?.exactReconciliationCount).toBe(1);
  });
});

describe('checkLinkTaxonomyConsistency', () => {
  const scope = { reviewYear: 2025, fiscalYear: 2025 };
  const taxonomy = {
    findings: [] as never[],
    linkedRecordCount: 100,
    unsupportedBudgetType: { recordCount: 10, amountYen: 0 },
    missingLinkKey: { recordCount: 5, amountYen: 0, missingFieldCounts: {} },
    validKeyNoMatch: { recordCount: 3, amountYen: 0 },
  };

  it('taxonomyとsummaryが一致していればfindingsは空', () => {
    const summary = { linkedRsRecordCount: 100, unlinkedRsRecordCount: 8, unsupportedBudgetTypeRecordCount: 10 };
    const findings = checkLinkTaxonomyConsistency(taxonomy, summary, 118, scope);
    expect(findings).toHaveLength(0);
  });

  it('linkedRecordCountがsummaryと不一致ならinvariant error', () => {
    const summary = { linkedRsRecordCount: 999, unlinkedRsRecordCount: 8, unsupportedBudgetTypeRecordCount: 10 };
    const findings = checkLinkTaxonomyConsistency(taxonomy, summary, 118, scope);
    expect(findings.some(f => f.severity === 'error' && f.category === 'invariant' && f.message.includes('linkedRecordCount'))).toBe(true);
  });

  it('missingLinkKey+validKeyNoMatchがsummary.unlinkedRsRecordCountと不一致ならinvariant error', () => {
    const summary = { linkedRsRecordCount: 100, unlinkedRsRecordCount: 999, unsupportedBudgetTypeRecordCount: 10 };
    const findings = checkLinkTaxonomyConsistency(taxonomy, summary, 118, scope);
    expect(findings.some(f => f.message.includes('unlinkedRsRecordCount'))).toBe(true);
  });

  it('unsupportedBudgetTypeがsummaryと不一致ならinvariant error', () => {
    const summary = { linkedRsRecordCount: 100, unlinkedRsRecordCount: 8, unsupportedBudgetTypeRecordCount: 999 };
    const findings = checkLinkTaxonomyConsistency(taxonomy, summary, 118, scope);
    expect(findings.some(f => f.message.includes('unsupportedBudgetTypeRecordCount'))).toBe(true);
  });

  it('taxonomy全bucketの合計がRS全レコード数と不一致ならinvariant error', () => {
    const summary = { linkedRsRecordCount: 100, unlinkedRsRecordCount: 8, unsupportedBudgetTypeRecordCount: 10 };
    const findings = checkLinkTaxonomyConsistency(taxonomy, summary, 999, scope);
    expect(findings.some(f => f.message.includes('全レコード数'))).toBe(true);
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

describe('diagnoseSupplementalExactFallback', () => {
  /** missing-link-key（rsKeyFrom()===null）を作るため、budgetMinistry/sectionName/subItemNameを空にする */
  function missingKeyItem(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
    return rsItem({
      fiscalYear: 2025, budgetMinistry: '', sectionName: '', subItemName: '', organizationOrAccount: '', account: '', subAccount: '',
      supplementalInfo: '', ...overrides,
    });
  }

  it('fwspace-pair（項　目）がpair-uniqueとして安全候補になり、exact reconciliationする', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('pair-unique');
    expect(result.candidates[0].reconciliation).toBe('exact');
    expect(result.summary.safeExactRecordCount).toBe(1);
    expect(result.summary.safeExactGroupCount).toBe(1);
  });

  it('区切り文字が無く項・目を分離できない場合は候補にしない（substring一致を許さない）', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金' });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費諸謝金' }); // fwspace/slash区切りが無い一つの塊
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(0);
    expect(result.summary.parseRejectedCount).toBe(1);
    expect(result.summary.parsedCandidateCount).toBe(0);
  });

  it('full path（一般会計／所管／組織／項／目）でscopeまで完全一致すればexplicit-scope-exact（P2a）になる', () => {
    const mof = mofItem({ sectionName: '情報処理費', subItemName: '委託費', ministry: '総務省', organization: '総合通信基盤局' });
    const rs = missingKeyItem({ supplementalInfo: '一般会計／総務省／総合通信基盤局／情報処理費／委託費' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-exact');
    expect(result.summary.p2aFullPathExactCount).toBe(1);
  });

  it('full pathの明示scopeがMOF targetと矛盾する場合は項・目と金額が一致してもsafeにしない（explicit-scope-conflict）', () => {
    const mof = mofItem({ sectionName: '総合研究費', subItemName: '庁費', ministry: '法務省', organization: '法務総合研究所', amountYen: 500 });
    const rs = missingKeyItem({ supplementalInfo: '一般会計／法務省／総務総合研究所／総合研究費／庁費', budgetAmountYen: 500 }); // 組織名がsource typo相当で不一致
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-conflict');
    expect(result.summary.safeExactRecordCount).toBe(0);
    expect(result.summary.explicitScopeConflictCount).toBe(1);
  });

  it('pairがMOF複数targetに存在しても、RS構造化scope(ministry)でexactに1件へ絞れればrs-scope-resolvedになる', () => {
    const mofA = mofItem({ recordId: 'mof_a', sectionName: '共通経費', subItemName: '庁費', ministry: '厚生労働省', organization: '厚生労働本省' });
    const mofB = mofItem({ recordId: 'mof_b', sectionName: '共通経費', subItemName: '庁費', ministry: '農林水産省', organization: '農林水産本省' });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '厚生労働省' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mofA, mofB], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('rs-scope-resolved');
    expect(result.candidates[0].targetNaturalKey).toContain('厚生労働省');
  });

  it('構造化scopeで絞り込んでも複数残る場合はambiguous-targetとして候補にしない', () => {
    const mofA = mofItem({ recordId: 'mof_a', sectionName: '共通経費', subItemName: '庁費', ministry: '厚生労働省', organization: '厚生労働本省' });
    const mofC = mofItem({ recordId: 'mof_c', sectionName: '共通経費', subItemName: '庁費', ministry: '厚生労働省', organization: '検疫所' });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '厚生労働省' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mofA, mofC], [rs]);
    expect(result.candidates).toHaveLength(0);
    expect(result.summary.ambiguousTargetCount).toBe(1);
  });

  it('section/itemはglobally uniqueだがreview時点RS scopeと過年度MOF scopeが一致しない場合はhistorical-scope-mismatch（P2c）としてsafeから除外する', () => {
    const mof = mofItem({ sectionName: '費目X', subItemName: '項目Y', ministry: '厚生労働省', organization: '厚生労働本省' });
    const rs = missingKeyItem({ supplementalInfo: '費目X　項目Y', ministry: '消費者庁' }); // 明示scopeは無い。組織移管等で現在の府省庁名が異なる
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('historical-scope-mismatch');
    expect(result.summary.p2cHistoricalScopeMismatchCount).toBe(1);
    expect(result.summary.safeExactRecordCount).toBe(0);
  });

  it('同一targetへ複数のP2候補がある場合は合算してからreconciliationする', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1500 });
    const rsA = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 900 });
    const rsB = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 600 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rsA, rsB]);
    expect(result.candidates).toHaveLength(2);
    for (const c of result.candidates) {
      expect(c.candidateGroupAmountYen).toBe(1500);
      expect(c.reconciliation).toBe('exact');
    }
    expect(result.summary.safeExactGroupCount).toBe(1);
    expect(result.summary.safeExactRecordCount).toBe(2);
  });

  it('既存P1リンク済み金額 + P2候補合計 = MOF額でexactになる', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const linkedRs = rsItem({ recordId: 'rsitem_linked', fiscalYear: 2025, sectionName: '共通経費', subItemName: '庁費', budgetMinistry: '外務省', organizationOrAccount: '在外公館', budgetAmountYen: 400 });
    const candidateRs = missingKeyItem({ recordId: 'rsitem_candidate', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 600 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [linkedRs, candidateRs]);
    const candidate = result.candidates.find(c => c.rsRecordId === 'rsitem_candidate')!;
    expect(candidate.existingRsAmountYen).toBe(400);
    expect(candidate.reconstructedRsAmountYen).toBe(1000);
    expect(candidate.reconciliation).toBe('exact');
  });

  it('P1だけで既にMOF額を満たしているtargetへP2を追加するとovercountになる', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 400 });
    const linkedRs = rsItem({ recordId: 'rsitem_linked', fiscalYear: 2025, sectionName: '共通経費', subItemName: '庁費', budgetMinistry: '外務省', organizationOrAccount: '在外公館', budgetAmountYen: 400 });
    const candidateRs = missingKeyItem({ recordId: 'rsitem_candidate', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 600 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [linkedRs, candidateRs]);
    const candidate = result.candidates.find(c => c.rsRecordId === 'rsitem_candidate')!;
    expect(candidate.reconciliation).toBe('overcount');
  });

  it('target選択に金額を使わない: MOF額とRS額が大きく異なっていても名称一致だけでtargetを決める', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1 });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 999_999_999 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('pair-unique'); // 金額が大きく乖離していてもtargetは決まる
    expect(result.candidates[0].reconciliation).not.toBe('exact'); // reconciliationはあくまで金額次第
  });

  it('fiscalYearが一致しない行・rsPhaseが対応しない行・rsKeyFromが非nullの行はP2対象から除外する', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房' });
    const wrongYear = missingKeyItem({ recordId: 'wrong_year', fiscalYear: 2024, supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣' });
    const unsupportedType = missingKeyItem({ recordId: 'unsupported_type', budgetType: '前年度から繰越し', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣' });
    const alreadyKeyed = rsItem({ recordId: 'already_keyed', fiscalYear: 2025, sectionName: '内閣官房共通費', subItemName: '諸謝金', budgetMinistry: '内閣', organizationOrAccount: '内閣官房', supplementalInfo: '内閣官房共通費　諸謝金' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [wrongYear, unsupportedType, alreadyKeyed]);
    expect(result.candidates).toHaveLength(0);
    expect(result.summary.parsedCandidateCount).toBe(0);
  });
});
