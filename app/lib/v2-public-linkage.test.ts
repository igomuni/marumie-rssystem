import { describe, expect, it } from 'vitest';
import {
  availableReviewYearsForFiscalYear,
  buildV2SectionProjectCounts,
  findV2SectionForLegacyRow,
  legacyBudgetTypeToV2Stage,
  legacyItemNaturalKey,
  legacySectionNaturalKey,
  lookupV2Section,
  mapLegacySectionsToV2,
  matchMethodLabel,
  normalizeSpecialAccount,
  phaseLabel,
  type LegacySectionIdentity,
  type V2MofSectionIndexRow,
  type V2RootManifest,
  type V2StandaloneLink,
} from './v2-public-linkage';

const base: V2MofSectionIndexRow = {
  id: 'mofsec_abc',
  fiscalYear: 2025,
  accountType: 'general',
  ministry: 'デジタル庁',
  organization: 'デジタル庁',
  specialAccount: '',
  subAccount: '',
  agency: '',
  sectionCode: '002',
  sectionName: 'デジタル社会形成推進費',
  itemCount: 8,
  eventCount: 17,
  stages: ['initial_budget_state'],
  shard: 'ab',
  relationCount: 0,
};

describe('V2 public linkage UI helpers', () => {
  it('match methodを利用者向け日本語へ変換する', () => {
    expect(matchMethodLabel('exact-name-key')).toBe('構造化項目一致');
    expect(matchMethodLabel('supplemental-exact')).toBe('補足情報から復元');
    expect(matchMethodLabel('mixed')).toBe('複合');
  });

  it('予算stageをUIラベルへ変換する', () => {
    expect(phaseLabel('initial', null)).toBe('当初予算');
    expect(phaseLabel('supplement', 2)).toBe('第2次補正予算');
  });

  it('特別会計の接尾辞差を吸収する', () => {
    expect(normalizeSpecialAccount('エネルギー対策特別会計')).toBe('エネルギー対策');
    expect(normalizeSpecialAccount('エネルギー対策')).toBe('エネルギー対策');
  });

  it('既存MOF行をV2 sectionへ意味キーで一意に接続できる', () => {
    const found = findV2SectionForLegacyRow([base], {
      accountType: 'general',
      ministry: 'デジタル庁',
      organization: 'デジタル庁',
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionCode: '002',
      sectionName: 'デジタル社会形成推進費',
    });
    expect(found?.id).toBe('mofsec_abc');
  });

  it('候補が複数なら曖昧な自動接続をしない', () => {
    const found = findV2SectionForLegacyRow([base, { ...base, id: 'mofsec_def' }], {
      accountType: 'general',
      ministry: 'デジタル庁',
      organization: 'デジタル庁',
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionCode: '002',
      sectionName: 'デジタル社会形成推進費',
    });
    expect(found).toBeNull();
  });

  it('legacy budgetTypeをV2 stageへ変換する', () => {
    expect(legacyBudgetTypeToV2Stage('当初予算')).toEqual({ phase: 'initial', revision: null });
    expect(legacyBudgetTypeToV2Stage('補正予算（第2号）')).toEqual({ phase: 'supplement', revision: 2 });
    expect(legacyBudgetTypeToV2Stage('暫定予算')).toBeNull();
    expect(legacyBudgetTypeToV2Stage('決算')).toBeNull();
  });

  it('legacy item(general)からV2 itemNaturalKeyを再現する', () => {
    const legacy: LegacySectionIdentity = {
      accountType: 'general',
      ministry: 'デジタル庁',
      organization: 'デジタル庁',
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionCode: '002',
      sectionName: 'デジタル社会形成推進費',
    };
    const key = legacyItemNaturalKey(legacy, { subItemCode: '01', subItemName: 'システム整備費' });
    expect(key).toBe(`${legacySectionNaturalKey(legacy)}|01|システム整備費`);
    expect(key).toBe('general|デジタル庁|デジタル庁|002|デジタル社会形成推進費|01|システム整備費');
  });

  it('legacy item(special)からV2 itemNaturalKeyを再現する', () => {
    const legacy: LegacySectionIdentity = {
      accountType: 'special',
      ministry: '経済産業省',
      organization: '',
      specialAccount: 'エネルギー対策特別会計',
      subAccount: 'エネルギー需給勘定',
      agency: '',
      sectionCode: '010',
      sectionName: '省エネルギー対策費',
    };
    const key = legacyItemNaturalKey(legacy, { subItemCode: '03', subItemName: '補助金' });
    expect(key).toBe('special|経済産業省|エネルギー対策特別会計|エネルギー需給勘定|010|省エネルギー対策費|03|補助金');
  });

  it('legacy item(agency)からV2 itemNaturalKeyを再現する', () => {
    const legacy: LegacySectionIdentity = {
      accountType: 'agency',
      ministry: '',
      organization: '',
      specialAccount: '',
      subAccount: '国民生活金融公庫業務',
      agency: '沖縄振興開発金融公庫',
      sectionCode: '001',
      sectionName: '業務経費',
    };
    const key = legacyItemNaturalKey(legacy, { subItemCode: '02', subItemName: '貸付金' });
    expect(key).toBe('agency|沖縄振興開発金融公庫|国民生活金融公庫業務|001|業務経費|02|貸付金');
  });

  it('legacy sectionsをV2 sectionsへ一括接続し、matched/unmatched/ambiguousを分類する', () => {
    const matchedLegacy: LegacySectionIdentity = {
      accountType: 'general',
      ministry: 'デジタル庁',
      organization: 'デジタル庁',
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionCode: '002',
      sectionName: 'デジタル社会形成推進費',
    };
    const unmatchedLegacy: LegacySectionIdentity = { ...matchedLegacy, sectionCode: '999', sectionName: '存在しない項' };
    const ambiguousLegacy: LegacySectionIdentity = { ...matchedLegacy, sectionCode: '003', sectionName: '重複する項' };
    const v2Rows: V2MofSectionIndexRow[] = [
      base,
      { ...base, id: 'mofsec_amb1', sectionCode: '003', sectionName: '重複する項' },
      { ...base, id: 'mofsec_amb2', sectionCode: '003', sectionName: '重複する項' },
    ];

    const result = mapLegacySectionsToV2([matchedLegacy, unmatchedLegacy, ambiguousLegacy], v2Rows);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.ambiguousCount).toBe(1);
    expect(lookupV2Section(result, matchedLegacy)?.id).toBe('mofsec_abc');
    expect(lookupV2Section(result, unmatchedLegacy)).toBeNull();
    expect(lookupV2Section(result, ambiguousLegacy)).toBeNull();
  });

  it('sectionId+stageごとにdistinct projectIdsを集計する', () => {
    const links: V2StandaloneLink[] = [
      {
        linkId: 'l1', phase: 'initial', revision: null, matchMethod: 'exact-name-key',
        sectionIds: ['mofsec_abc'], projectIds: ['p1', 'p2'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0,
      },
      {
        linkId: 'l2', phase: 'initial', revision: null, matchMethod: 'exact-name-key',
        sectionIds: ['mofsec_abc'], projectIds: ['p2', 'p3'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0,
      },
      {
        linkId: 'l3', phase: 'supplement', revision: 2, matchMethod: 'supplemental-exact',
        sectionIds: ['mofsec_abc'], projectIds: ['p4'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0,
      },
    ];
    const counts = buildV2SectionProjectCounts(links);
    expect(counts.get('mofsec_abc\x1finitial\x1f')?.size).toBe(3);
    expect(counts.get('mofsec_abc\x1fsupplement\x1f2')?.size).toBe(1);
  });

  it('fiscalYearに紐づくreviewYear候補を新しい順で求める', () => {
    const manifest: V2RootManifest = {
      schemaVersion: 1,
      publishSchemaVersion: 2,
      generatedAt: '2026-01-01T00:00:00Z',
      mof: [],
      rs: [],
      links: [
        { reviewYear: 2024, fiscalYear: 2023, linkGroupCount: 1, projectCount: 1, sectionCount: 1, gzipBytes: 1 },
        { reviewYear: 2025, fiscalYear: 2023, linkGroupCount: 1, projectCount: 1, sectionCount: 1, gzipBytes: 1 },
        { reviewYear: 2025, fiscalYear: 2025, linkGroupCount: 1, projectCount: 1, sectionCount: 1, gzipBytes: 1 },
      ],
    };
    expect(availableReviewYearsForFiscalYear(manifest, 2023)).toEqual([2025, 2024]);
    expect(availableReviewYearsForFiscalYear(manifest, 2025)).toEqual([2025]);
    expect(availableReviewYearsForFiscalYear(manifest, 2099)).toEqual([]);
  });
});
