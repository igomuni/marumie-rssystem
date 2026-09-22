import { describe, it, expect } from 'vitest';
import {
  classifyUnlinkedReasons, checkLinkTaxonomyConsistency, diagnoseJointMinistryFallback,
  analyzeLinkDifferenceTaxonomy, analyzeMultiProjectGroups, diagnoseSupplementalExactFallback,
  checkSupplementalExactProductionPolicy,
} from './mof-rs-linkage';
import { evaluateSupplementalExact, mofKeyFrom, stageKey } from '../mof-rs-match-core';
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
    mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0,
    rsMatchEvidence: [{ rsRecordId: 'rsitem_1', projectId: '1', method: 'exact-name-key', sourceField: 'structured-fields' }],
    ...overrides,
  };
}

describe('classifyUnlinkedReasons', () => {
  it('production linkedなrecordはlinkedとしてカウントし、どのbucketにも入れない', () => {
    const result = classifyUnlinkedReasons([rsItem({})], new Set(['rsitem_1']));
    expect(result.linkedRecordCount).toBe(1);
    expect(result.unsupportedBudgetType.recordCount).toBe(0);
    expect(result.missingLinkKey.recordCount).toBe(0);
    expect(result.validKeyNoMatch.recordCount).toBe(0);
  });

  it('rsPhase()が対応しないbudgetTypeはunsupported-budget-typeに分類し金額を合算する', () => {
    const rs = rsItem({ budgetType: '前年度から繰越し', budgetAmountYen: 500 });
    const result = classifyUnlinkedReasons([rs], new Set());
    expect(result.unsupportedBudgetType).toEqual({ recordCount: 1, amountYen: 500 });
  });

  it('budgetMinistry等が欠けていればmissing-link-keyに分類し、欠けたfieldを記録する', () => {
    const rs = rsItem({ budgetMinistry: '', budgetAmountYen: 300 });
    const result = classifyUnlinkedReasons([rs], new Set());
    expect(result.missingLinkKey).toMatchObject({ recordCount: 1, amountYen: 300 });
    expect(result.missingLinkKey.missingFieldCounts.budgetMinistry).toBe(1);
  });

  it('keyは揃っているがproduction未linkならvalid-key-no-matchに分類する', () => {
    const rs = rsItem({ budgetAmountYen: 700 });
    const result = classifyUnlinkedReasons([rs], new Set()); // production側で未link
    expect(result.validKeyNoMatch).toEqual({ recordCount: 1, amountYen: 700 });
  });

  it('reasonごとに金額を正しく合算する', () => {
    const rows = [
      rsItem({ recordId: 'a', budgetType: '前年度から繰越し', budgetAmountYen: 100 }),
      rsItem({ recordId: 'b', budgetType: '前年度から繰越し', budgetAmountYen: 200 }),
      rsItem({ recordId: 'c', budgetMinistry: '', budgetAmountYen: 50 }),
    ];
    const result = classifyUnlinkedReasons(rows, new Set());
    expect(result.unsupportedBudgetType).toEqual({ recordCount: 2, amountYen: 300 });
    expect(result.missingLinkKey.recordCount).toBe(1);
    expect(result.missingLinkKey.amountYen).toBe(50);
  });

  it('review指摘: P2でproduction linkされた行（rsKeyFrom===null）はmissing-link-keyへ数えない', () => {
    // budgetMinistryが空でrsKeyFrom()===nullだが、production側では（P2で）linkされている
    const rs = rsItem({ budgetMinistry: '', budgetAmountYen: 1000 });
    const result = classifyUnlinkedReasons([rs], new Set(['rsitem_1']));
    expect(result.linkedRecordCount).toBe(1);
    expect(result.missingLinkKey.recordCount).toBe(0);
  });
});

describe('diagnoseJointMinistryFallback', () => {
  it('primaryでlink済みの行は候補にしない', () => {
    const result = diagnoseJointMinistryFallback(2025, 2025, [mofItem({})], [rsItem({})], []);
    expect(result.candidates).toHaveLength(0);
  });

  it('budgetMinistryとministryが同一なら候補にしない（差し替える意味が無い）', () => {
    const rs = rsItem({ budgetMinistry: '厚生労働省及び内閣府', ministry: '厚生労働省及び内閣府' });
    const result = diagnoseJointMinistryFallback(2025, 2025, [], [rs], []);
    expect(result.candidates).toHaveLength(0);
  });

  it('primary(budgetMinistry)で未接続でも、common ministryに差し替えると一意なMOF targetに一致すれば候補にする', () => {
    // MOF: 厚生労働省 / 既存でlink済みのRS（ministry=budgetMinistry=厚生労働省で一致）と、
    // budgetMinistry="内閣府及び厚生労働省"（合同表記）で未接続のRS行
    const mof = mofItem({ ministry: '厚生労働省' });
    const existingLinked = rsItem({ recordId: 'existing', ministry: '厚生労働省', budgetMinistry: '厚生労働省', budgetAmountYen: 6_009_122_000 });
    const candidate = rsItem({ recordId: 'candidate', projectId: '2836', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 253_333_474_000 });
    const mofWithAmount = { ...mof, amountYen: 259_342_596_000 };
    // review指摘: existing linked金額はactual production link基準。P1のみの合算再構築ではない
    const productionLinks = [link({ naturalKey: mofKeyFrom(mofWithAmount)!, rsRecordIds: ['existing'], rsAmountYen: 6_009_122_000 })];
    const result = diagnoseJointMinistryFallback(2025, 2025, [mofWithAmount], [existingLinked, candidate], productionLinks);

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
    const result = diagnoseJointMinistryFallback(2025, 2025, [], [candidate], []); // MOF側が空
    expect(result.candidates).toHaveLength(0);
  });

  it('altKeyで一致してもreconstructedがMOF額と一致しなければexactReconciliation=false', () => {
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 999 });
    const candidate = rsItem({ ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate], []);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exactReconciliation).toBe(false);
  });

  it('review指摘: budgetMinistry欠損（missing-link-key）はprimary keyが完成していないため候補にしない', () => {
    const mof = mofItem({ ministry: '厚生労働省' });
    const candidate = rsItem({ budgetMinistry: '', ministry: '厚生労働省' }); // rsKeyFrom()がnullになる
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate], []);
    expect(result.candidates).toHaveLength(0);
  });

  it('review指摘: budgetMinistryがministryと無関係（部分文字列に含まれない）なら候補にしない', () => {
    // primary keyは完成しているが、budgetMinistryにnormalized ministryが含まれない
    // （「joint-ministry（複合所管）」ではなく単に別の省庁が書かれているだけのケース）
    const mof = mofItem({ ministry: '厚生労働省' });
    const candidate = rsItem({ budgetMinistry: '経済産業省', ministry: '厚生労働省' });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidate], []);
    expect(result.candidates).toHaveLength(0);
  });

  it('review指摘: project 2836 fixtureで従来どおりexact reconciliationを維持する（strict化の回帰確認）', () => {
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 259_342_596_000 });
    const existingLinked = rsItem({ recordId: 'existing', ministry: '厚生労働省', budgetMinistry: '厚生労働省', budgetAmountYen: 6_009_122_000 });
    const candidate = rsItem({ recordId: 'candidate', projectId: '2836', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 253_333_474_000 });
    const productionLinks = [link({ naturalKey: mofKeyFrom(mof)!, rsRecordIds: ['existing'], rsAmountYen: 6_009_122_000 })];
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [existingLinked, candidate], productionLinks);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exactReconciliation).toBe(true);
  });

  it('review指摘: 同一altGroupKeyに複数候補がある場合、合算した額でexactReconciliationを判定する（過大評価の防止）', () => {
    // 単独では両方ともMOF額を下回るが、2件合算するとMOF額をちょうど超える
    const mof = mofItem({ ministry: '厚生労働省', amountYen: 150 });
    const candidateA = rsItem({ recordId: 'candidateA', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const candidateB = rsItem({ recordId: 'candidateB', ministry: '厚生労働省', budgetMinistry: '内閣府及び厚生労働省', budgetAmountYen: 100 });
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidateA, candidateB], []);
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
    const result = diagnoseJointMinistryFallback(2025, 2025, [mof], [candidateA, candidateB], []);
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

  it('review指摘: 一般会計マーカーが無い4token（所管/組織/項/目）full pathもexplicit-scope-exactとして解析する', () => {
    const mof = mofItem({ sectionName: '国土交通統計調査費', subItemName: '諸謝金', ministry: '国土交通省', organization: '国土交通本省' });
    const rs = missingKeyItem({ supplementalInfo: '国土交通省/国土交通本省/国土交通統計調査費/諸謝金' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-exact');
  });

  it('review指摘: 先頭の「※新規予算項目」等のnoteを除いた上でfull pathを解析する', () => {
    const mof = mofItem({ sectionName: '消防防災体制等整備費', subItemName: '密集市街地火災対策支援補助金', ministry: '総務省', organization: '消防庁' });
    const rs = missingKeyItem({ supplementalInfo: '※新規予算項目／一般会計 / 総務省 / 消防庁 / 消防防災体制等整備費 / 密集市街地火災対策支援補助金' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-exact');
  });

  it('review指摘: 特別会計のマーカー無しfull path（specialAccount/ministry/subAccount/項/目の順）も解析する', () => {
    const mof = mofItem({
      accountType: 'special', ministry: '内閣府、文部科学省、経済産業省及び環境省', specialAccount: 'エネルギー対策', subAccount: '電源開発促進勘定',
      sectionName: '脱炭素成長型経済構造移行推進機構出資', subItemName: '脱炭素成長型経済構造移行推進機構出資金',
    });
    const rs = missingKeyItem({
      accountType: 'special',
      supplementalInfo: 'エネルギー対策 / 内閣府、文部科学省、経済産業省及び環境省 / 電源開発促進勘定 / 脱炭素成長型経済構造移行推進機構出資 / 脱炭素成長型経済構造移行推進機構出資金',
    });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-exact');
  });

  it('review指摘: 一般会計行の（会計）一般会計ラベルをspecialAccountとして誤って矛盾判定しない', () => {
    // 修正前は（会計）一般会計 → stripAccountSuffix()で"一般"がspecialAccountとして格納され、
    // 一般会計MOF targetのspecialAccount=""と比較して誤ってexplicit-scope-conflictになっていた
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '（会計）一般会計／（項）内閣官房共通費／（目）諸謝金', budgetAmountYen: 1000 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).not.toBe('explicit-scope-conflict');
    expect(result.candidates[0].reconciliation).toBe('exact');
  });

  it('review指摘: 同一targetへ異なるsafe resolution種別（explicit-scope-exact + rs-scope-resolved）の候補が乗る場合は合算してreconciliationする', () => {
    // 修正前はtargetResolution別に別groupへ分けていたため、同一targetに複数のsafe候補が
    // 異なるresolution種別で乗ると、それぞれ独立に（過小な）金額でexact/no-improve判定されていた
    const mofA = mofItem({ recordId: 'mof_a', sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const mofB = mofItem({ recordId: 'mof_b', sectionName: '共通経費', subItemName: '庁費', ministry: '農林水産省', organization: '農林水産本省' });
    const rowA = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '一般会計／外務省／在外公館／共通経費／庁費', budgetAmountYen: 600 });
    const rowB = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 400 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mofA, mofB], [rowA, rowB]);
    const candA = result.candidates.find(c => c.rsRecordId === 'rsitem_a')!;
    const candB = result.candidates.find(c => c.rsRecordId === 'rsitem_b')!;
    expect(candA.targetResolution).toBe('explicit-scope-exact');
    expect(candB.targetResolution).toBe('rs-scope-resolved');
    expect(candA.targetNaturalKey).toBe(candB.targetNaturalKey);
    expect(candA.candidateGroupAmountYen).toBe(1000);
    expect(candB.candidateGroupAmountYen).toBe(1000);
    expect(candA.reconciliation).toBe('exact');
    expect(candB.reconciliation).toBe('exact');
  });

  it('review指摘: 同一targetへexplicit-scope-exact + pair-uniqueが同時に乗り、合算するとMOF額を超過する場合はovercountになる', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rowExact = missingKeyItem({ recordId: 'rsitem_exact', supplementalInfo: '一般会計／外務省／在外公館／共通経費／庁費', budgetAmountYen: 1000 });
    const rowPairUnique = missingKeyItem({ recordId: 'rsitem_pair', supplementalInfo: '共通経費　庁費', budgetAmountYen: 100 });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rowExact, rowPairUnique]);
    const candExact = result.candidates.find(c => c.rsRecordId === 'rsitem_exact')!;
    const candPair = result.candidates.find(c => c.rsRecordId === 'rsitem_pair')!;
    expect(candExact.targetResolution).toBe('explicit-scope-exact');
    expect(candPair.targetResolution).toBe('pair-unique');
    expect(candExact.candidateGroupAmountYen).toBe(1100);
    // 修正前はexplicit-scope-exact単独(1000円)がMOF額(1000円)とexact判定され、
    // pair-unique単独(100円)は別groupでno-improve扱いになり、超過が検出できなかった
    expect(candExact.reconciliation).toBe('overcount');
    expect(candPair.reconciliation).toBe('overcount');
  });

  it('review指摘: 明示（所管）はMOFのorganizationへのfallbackを許さずministryとexact比較する（明示scopeは弱めない）', () => {
    // 補足情報の（所管）観光庁 はMOFのministry=国土交通省と一致しない。RS共通ministry列とは異なり、
    // organization一致で救済すると明示scope矛盾を見逃す（R5「明示scopeは弱めない」に反する）
    const mof = mofItem({ sectionName: '観光振興費', subItemName: '職員旅費', ministry: '国土交通省', organization: '観光庁' });
    const rs = missingKeyItem({ supplementalInfo: '（所管）観光庁／（項）観光振興費／（目）職員旅費' });
    const result = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].targetResolution).toBe('explicit-scope-conflict');
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

  // review指摘（53_sonnet-p2-shared-core-extraction-instructions.md）: shared core抽出後、
  // validationのdiagnoseSupplementalExactFallback()がlib/mof-rs-match-core.tsの
  // evaluateSupplementalExact()と同じ判定・同じ値を返すことを直接確認する
  it('shared core検証: P2a（explicit-scope-exact）行でevaluateSupplementalExact()とdiagnoseSupplementalExactFallback()が同じ判定・値を返す', () => {
    const mof = mofItem({ sectionName: '情報処理費', subItemName: '委託費', ministry: '総務省', organization: '総合通信基盤局', amountYen: 500 });
    const rs = missingKeyItem({ supplementalInfo: '一般会計／総務省／総合通信基盤局／情報処理費／委託費', budgetAmountYen: 500 });
    const direct = evaluateSupplementalExact([mof], [rs], 2025);
    const wrapped = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rs]);
    expect(wrapped.candidates).toEqual(direct.candidates);
    expect(wrapped.summary).toEqual(direct.summary);
    expect(direct.candidates[0].targetResolution).toBe('explicit-scope-exact');
    expect(direct.candidates[0].reconciliation).toBe('exact');
  });

  it('shared core検証: P2b（pair-unique）exact groupでevaluateSupplementalExact()とdiagnoseSupplementalExactFallback()が同じ判定・値を返す', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rsA = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 400 });
    const rsB = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 600 });
    const direct = evaluateSupplementalExact([mof], [rsA, rsB], 2025);
    const wrapped = diagnoseSupplementalExactFallback(2025, 2025, [mof], [rsA, rsB]);
    expect(wrapped.candidates).toEqual(direct.candidates);
    expect(wrapped.summary).toEqual(direct.summary);
    expect(direct.candidates.every(c => c.targetResolution === 'pair-unique')).toBe(true);
    expect(direct.candidates.every(c => c.reconciliation === 'exact')).toBe(true);
    expect(direct.summary.safeExactGroupCount).toBe(1);
  });
});

describe('checkSupplementalExactProductionPolicy', () => {
  function missingKeyItem(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
    return rsItem({
      fiscalYear: 2025, budgetMinistry: '', sectionName: '', subItemName: '', organizationOrAccount: '', account: '', subAccount: '',
      supplementalInfo: '', ...overrides,
    });
  }

  it('Tier-1で期待されるP2 recordがproduction linkに正しく反映されていればfindingsは空', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000 });
    const productionLink = link({
      naturalKey: 'general|内閣|内閣官房|内閣官房共通費|諸謝金', phase: 'initial', revision: null,
      rsRecordIds: ['rsitem_1'], rsAmountYen: 1000,
      matchMethod: 'supplemental-exact',
      rsMatchEvidence: [{ rsRecordId: 'rsitem_1', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'pair-unique', parseKind: 'fwspace-pair' }],
    });
    const result = checkSupplementalExactProductionPolicy(2025, 2025, [mof], [rs], [productionLink]);
    expect(result.findings).toHaveLength(0);
    expect(result.metrics.productionP2RecordCount).toBe(1);
    expect(result.metrics.productionP2GroupCount).toBe(1);
  });

  it('Tier-1で期待されるP2候補がproduction linkに存在しなければerror', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000 });
    const result = checkSupplementalExactProductionPolicy(2025, 2025, [mof], [rs], []); // production linkが空
    expect(result.findings.some(f => f.message.includes('production linkに存在しない'))).toBe(true);
  });

  it('review指摘: production linkのphase/revisionが期待stageと不一致ならerror（naturalKeyのみの比較では見逃す失敗クラス）', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000, budgetType: '当初予算' }); // stage=['initial', null]
    // naturalKeyは一致するが、production側がsupplement(revision=1)として誤ってlinkされているケース
    const wrongStageLink = link({
      naturalKey: 'general|内閣|内閣官房|内閣官房共通費|諸謝金', phase: 'supplement', revision: 1,
      rsRecordIds: ['rsitem_1'], rsAmountYen: 1000, matchMethod: 'supplemental-exact',
      rsMatchEvidence: [{ rsRecordId: 'rsitem_1', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'pair-unique', parseKind: 'fwspace-pair' }],
    });
    const result = checkSupplementalExactProductionPolicy(2025, 2025, [mof], [rs], [wrongStageLink]);
    expect(result.findings.some(f => f.message.includes('phase'))).toBe(true);
    expect(result.findings.some(f => f.message.includes('revision'))).toBe(true);
  });

  it('Tier-1で昇格されないはずのP2 recordがproduction linkに存在すればerror', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 500 }); // non-exact→Tier-1非該当のはず
    const unexpectedLink = link({
      naturalKey: 'general|外務省|在外公館|共通経費|庁費', phase: 'initial', revision: null,
      rsRecordIds: ['rsitem_1'], rsAmountYen: 500, matchMethod: 'supplemental-exact',
      rsMatchEvidence: [{ rsRecordId: 'rsitem_1', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'pair-unique', parseKind: 'fwspace-pair' }],
    });
    const result = checkSupplementalExactProductionPolicy(2025, 2025, [mof], [rs], [unexpectedLink]);
    expect(result.findings.some(f => f.message.includes('昇格されないはず'))).toBe(true);
  });

  it('review指摘: 同一naturalKeyが異なるstageで別groupになる場合、productionP2GroupCountはlinkId単位で正しく2と数える', () => {
    const mofInitial = mofItem({ recordId: 'mof_initial', sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const mofSupplement = mofItem({ recordId: 'mof_supplement', phase: 'supplement', revision: 1, sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', supplementDeltaYen: 200 } as Partial<MofBudgetItemRecord>);
    const rsInitial = missingKeyItem({ recordId: 'rsitem_initial', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 1000, budgetType: '当初予算' });
    const rsSupplement = missingKeyItem({ recordId: 'rsitem_supplement', supplementalInfo: '内閣官房共通費　諸謝金', ministry: '内閣', budgetAmountYen: 200, budgetType: '第1次補正予算' });
    const naturalKey = 'general|内閣|内閣官房|内閣官房共通費|諸謝金';
    const linkInitial = link({
      linkId: 'l-initial', naturalKey, phase: 'initial', revision: null, rsRecordIds: ['rsitem_initial'], rsAmountYen: 1000, matchMethod: 'supplemental-exact',
      rsMatchEvidence: [{ rsRecordId: 'rsitem_initial', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'pair-unique', parseKind: 'fwspace-pair' }],
    });
    const linkSupplement = link({
      linkId: 'l-supplement', naturalKey, phase: 'supplement', revision: 1, rsRecordIds: ['rsitem_supplement'], rsAmountYen: 200, matchMethod: 'supplemental-exact',
      rsMatchEvidence: [{ rsRecordId: 'rsitem_supplement', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'pair-unique', parseKind: 'fwspace-pair' }],
    });
    const result = checkSupplementalExactProductionPolicy(2025, 2025, [mofInitial, mofSupplement], [rsInitial, rsSupplement], [linkInitial, linkSupplement]);
    expect(result.findings).toHaveLength(0);
    expect(result.metrics.productionP2RecordCount).toBe(2);
    expect(result.metrics.productionP2GroupCount).toBe(2); // naturalKeyは同じだがstageが違う2 groupとして正しく数える
  });
});
