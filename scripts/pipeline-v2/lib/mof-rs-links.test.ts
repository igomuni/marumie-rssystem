import { describe, it, expect } from 'vitest';
import { buildMofRsLinks } from './mof-rs-links';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsMatchEvidence } from '../types';

/** discriminated unionのsupplemental-exact側フィールドへtest内で安全にアクセスするための絞り込み */
function asSupplementalExact(ev: MofRsMatchEvidence) {
  if (ev.method !== 'supplemental-exact') throw new Error(`expected supplemental-exact evidence, got ${ev.method}`);
  return ev;
}

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

  it('review指摘（provenance準備）: 各link groupにrsRecordIds全件と1:1対応するrsMatchEvidenceを持つ', () => {
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rsItem({})]);
    expect(result.links[0].matchMethod).toBe('exact-name-key');
    expect(result.links[0].rsMatchEvidence).toEqual([
      { rsRecordId: 'rsitem_1', projectId: '1', method: 'exact-name-key', sourceField: 'structured-fields' },
    ]);
  });

  it('review指摘（provenance準備）: 1 targetに複数RS行が乗る場合、rsMatchEvidenceはrecordId順にソートされ全件を1:1で持つ', () => {
    const rsA = rsItem({ recordId: 'rsitem_b', projectId: '2', budgetAmountYen: 100 });
    const rsB = rsItem({ recordId: 'rsitem_a', projectId: '1', budgetAmountYen: 200 });
    const result = buildMofRsLinks(2024, 2024, [mofItem({})], [rsA, rsB]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.links[0].rsRecordIds).toEqual(['rsitem_a', 'rsitem_b']);
    expect(result.links[0].rsMatchEvidence).toEqual([
      { rsRecordId: 'rsitem_a', projectId: '1', method: 'exact-name-key', sourceField: 'structured-fields' },
      { rsRecordId: 'rsitem_b', projectId: '2', method: 'exact-name-key', sourceField: 'structured-fields' },
    ]);
  });
});

describe('buildMofRsLinks: P2 Tier-1 production admission（55_sonnet-p2-tier1-production-activation-instructions.md）', () => {
  /** missing-link-key（rsKeyFrom()===null）を作るため、budgetMinistry/sectionName/subItemNameを空にする */
  function missingKeyItem(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
    return rsItem({
      budgetMinistry: '', sectionName: '', subItemName: '', organizationOrAccount: '', account: '', subAccount: '',
      supplementalInfo: '', ...overrides,
    });
  }

  it('P2a（explicit-scope-exact）はreconciliationがnon-exactでもproduction admissionされ、evidenceはsupplemental-exact', () => {
    const mof = mofItem({ sectionName: '内閣官房共通費', subItemName: '諸謝金', ministry: '内閣', organization: '内閣官房', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '一般会計／内閣／内閣官房／内閣官房共通費／諸謝金', budgetAmountYen: 1 }); // MOF額と大きく乖離（non-exact）
    const result = buildMofRsLinks(2024, 2024, [mof], [rs]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.linkedRsRecordCount).toBe(1);
    expect(result.links[0].matchMethod).toBe('supplemental-exact'); // P2-only group
    expect(result.links[0].rsMatchEvidence).toEqual([
      { rsRecordId: 'rsitem_1', projectId: '1', method: 'supplemental-exact', sourceField: 'supplementalInfo', resolution: 'explicit-scope-exact', parseKind: 'slash-path' },
    ]);
  });

  it('P2b（pair-unique）はsafe target groupのreconciliationがexactの場合のみproduction admissionされる', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 1000 }); // exact
    const result = buildMofRsLinks(2024, 2024, [mof], [rs]);
    expect(result.linkGroupCount).toBe(1);
    expect(asSupplementalExact(result.links[0].rsMatchEvidence[0]).resolution).toBe('pair-unique');
  });

  it('P2b（pair-unique）はreconciliationがimprove（non-exact）ならwithheldされ、production linkに一切現れない', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 500 }); // non-exact（improve）
    const result = buildMofRsLinks(2024, 2024, [mof], [rs]);
    expect(result.linkGroupCount).toBe(0);
    expect(result.linkedRsRecordCount).toBe(0);
  });

  it('P2b（rs-scope-resolved）はRS構造化scopeで1件へ絞り込め、かつexactの場合のみadmissionされる', () => {
    const mofA = mofItem({ recordId: 'mof_a', sectionName: '共通経費', subItemName: '庁費', ministry: '厚生労働省', organization: '厚生労働本省', amountYen: 1000 });
    const mofB = mofItem({ recordId: 'mof_b', sectionName: '共通経費', subItemName: '庁費', ministry: '農林水産省', organization: '農林水産本省' });
    const rs = missingKeyItem({ supplementalInfo: '共通経費　庁費', ministry: '厚生労働省', budgetAmountYen: 1000 });
    const result = buildMofRsLinks(2024, 2024, [mofA, mofB], [rs]);
    expect(result.linkGroupCount).toBe(1);
    expect(asSupplementalExact(result.links[0].rsMatchEvidence[0]).resolution).toBe('rs-scope-resolved');
    expect(result.links[0].naturalKey).toContain('厚生労働省');
  });

  it('P2b候補が複数行で合算するとexactになる場合は全件admissionされる（subset選択しない）', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rsA = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 400 });
    const rsB = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 600 });
    const result = buildMofRsLinks(2024, 2024, [mof], [rsA, rsB]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.links[0].rsRecordIds).toEqual(['rsitem_a', 'rsitem_b']);
    expect(result.links[0].rsAmountYen).toBe(1000);
  });

  it('一部の行だけを選べばexactになる場合でも、subset選択せず全P2bをwithheldする', () => {
    // MOF=1000。rsA単独なら1000でexactだが、rsBも同じsafe target groupに乗るため
    // 合算(1500)で判定する。合算はexactにならないので、rsAだけを都合よく選んで
    // admitすることはしない（両方withheld）
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const rsA = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 1000 });
    const rsB = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 500 });
    const result = buildMofRsLinks(2024, 2024, [mof], [rsA, rsB]);
    expect(result.linkGroupCount).toBe(0);
    expect(result.linkedRsRecordCount).toBe(0);
  });

  it('既存P1 groupへP2が追加されるとlinkIdは不変・MOF額は1回だけ計上・RS額はP1+P2・matchMethod=mixed・evidence 1:1', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const p1Row = rsItem({ recordId: 'rsitem_p1', sectionName: '共通経費', subItemName: '庁費', budgetMinistry: '外務省', organizationOrAccount: '在外公館', budgetAmountYen: 600 });
    const p2Row = missingKeyItem({ recordId: 'rsitem_p2', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 400 });
    const p1OnlyResult = buildMofRsLinks(2024, 2024, [mof], [p1Row]);
    const mixedResult = buildMofRsLinks(2024, 2024, [mof], [p1Row, p2Row]);

    expect(mixedResult.linkGroupCount).toBe(1);
    expect(mixedResult.links[0].linkId).toBe(p1OnlyResult.links[0].linkId); // linkId不変
    expect(mixedResult.links[0].mofAmountYen).toBe(1000); // MOF額は1回だけ計上
    expect(mixedResult.links[0].rsAmountYen).toBe(1000); // P1(600)+P2(400)
    expect(mixedResult.links[0].matchMethod).toBe('mixed');
    expect(mixedResult.links[0].rsRecordIds).toEqual(['rsitem_p1', 'rsitem_p2']);
    expect(mixedResult.links[0].rsMatchEvidence).toHaveLength(2);
    expect(mixedResult.links[0].rsMatchEvidence.find(e => e.rsRecordId === 'rsitem_p1')?.method).toBe('exact-name-key');
    expect(mixedResult.links[0].rsMatchEvidence.find(e => e.rsRecordId === 'rsitem_p2')?.method).toBe('supplemental-exact');
  });

  it('同一targetにP2a+P2bが乗り、full safe groupがexactなら両方admitする', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const p2a = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '一般会計／外務省／在外公館／共通経費／庁費', budgetAmountYen: 600 });
    const p2b = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 400 });
    const result = buildMofRsLinks(2024, 2024, [mof], [p2a, p2b]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.links[0].rsRecordIds).toEqual(['rsitem_a', 'rsitem_b']);
    expect(result.links[0].matchMethod).toBe('supplemental-exact');
  });

  it('同一targetにP2a+P2bが乗り、full safe groupがnon-exactならP2aのみadmitしP2bはwithholdする', () => {
    const mof = mofItem({ sectionName: '共通経費', subItemName: '庁費', ministry: '外務省', organization: '在外公館', amountYen: 1000 });
    const p2a = missingKeyItem({ recordId: 'rsitem_a', supplementalInfo: '一般会計／外務省／在外公館／共通経費／庁費', budgetAmountYen: 600 });
    const p2b = missingKeyItem({ recordId: 'rsitem_b', supplementalInfo: '共通経費　庁費', ministry: '外務省', budgetAmountYen: 500 }); // 600+500=1100 != 1000
    const result = buildMofRsLinks(2024, 2024, [mof], [p2a, p2b]);
    expect(result.linkGroupCount).toBe(1);
    expect(result.links[0].rsRecordIds).toEqual(['rsitem_a']); // P2aのみ
    expect(result.links[0].matchMethod).toBe('supplemental-exact');
  });

  it('historical-scope-mismatch/explicit-scope-conflict/ambiguous targetはいずれもproductionへ昇格しない', () => {
    // historical-scope-mismatch: 現在のministryが過年度MOF scopeと一致しない
    const mofHist = mofItem({ sectionName: '費目X', subItemName: '項目Y', ministry: '厚生労働省', organization: '厚生労働本省' });
    const histRow = missingKeyItem({ recordId: 'rsitem_hist', supplementalInfo: '費目X　項目Y', ministry: '消費者庁', budgetAmountYen: 1000 });

    // explicit-scope-conflict: 明示scopeがMOF targetと矛盾
    const mofConflict = mofItem({ recordId: 'mof_conflict', sectionName: '総合研究費', subItemName: '庁費', ministry: '法務省', organization: '法務総合研究所' });
    const conflictRow = missingKeyItem({ recordId: 'rsitem_conflict', supplementalInfo: '一般会計／法務省／総務総合研究所／総合研究費／庁費', budgetAmountYen: 1000 });

    // ambiguous: 構造化scopeで絞り込んでも複数残る
    const mofAmbA = mofItem({ recordId: 'mof_amb_a', sectionName: '共通経費2', subItemName: '庁費2', ministry: '厚生労働省', organization: '厚生労働本省' });
    const mofAmbB = mofItem({ recordId: 'mof_amb_b', sectionName: '共通経費2', subItemName: '庁費2', ministry: '厚生労働省', organization: '検疫所' });
    const ambRow = missingKeyItem({ recordId: 'rsitem_amb', supplementalInfo: '共通経費2　庁費2', ministry: '厚生労働省', budgetAmountYen: 1000 });

    const result = buildMofRsLinks(2024, 2024, [mofHist, mofConflict, mofAmbA, mofAmbB], [histRow, conflictRow, ambRow]);
    expect(result.linkGroupCount).toBe(0);
    expect(result.linkedRsRecordCount).toBe(0);
  });
});
