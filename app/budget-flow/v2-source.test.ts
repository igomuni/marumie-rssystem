import { describe, it, expect } from 'vitest';
import { toEntitySummary, toEntityDetail, v2ShardOf, type V2SectionIndexRow, type V2SectionDetail } from './v2-source';

describe('v2ShardOf: mofsec_プレフィックスを除いた先頭2桁を使う（publish側のmofSectionShardと同じ考え方）', () => {
  it('mofsec_プレフィックス付きIDから正しく2桁を取り出す', () => {
    expect(v2ShardOf('mofsec_e03a0d64707675c275bb')).toBe('e0');
  });
});

describe('toEntitySummary: public/data/v2/mof indexの1行をEntitySummaryへ変換する', () => {
  const row: V2SectionIndexRow = {
    id: 'mofsec_abc', fiscalYear: 2024, accountType: 'general', ministry: '外務省', organization: '在外公館',
    specialAccount: '', subAccount: '', agency: '', sectionCode: '027', sectionName: '経済協力費',
    itemCount: 3, eventCount: 5, stages: ['initial_budget_state'], shard: 'ab', relationCount: 2,
  };

  it('sourceYearはfiscalYearを流用する（MOF正規化にsourceYearの別軸が無いため）', () => {
    const summary = toEntitySummary(row);
    expect(summary.sourceYear).toBe(2024);
    expect(summary.id).toBe('mofsec_abc');
    expect(summary.relationCount).toBe(2);
  });
});

const BASE_DETAIL: V2SectionDetail = {
  section: { id: 'mofsec_abc', fiscalYear: 2024, accountType: 'general', ministry: '外務省', organization: '在外公館', specialAccount: '', subAccount: '', agency: '', sectionCode: '027', sectionName: '経済協力費' },
  items: [{ id: 'item1', name: '在外公館必要経費' }],
  events: [],
  records: [],
  sources: [],
};

describe('toEntityDetail: sectionsシャードの1エントリをEntityDetailへ変換する', () => {
  it('recordsはsourceRefでsources配列を解決してsourceオブジェクトを復元する', () => {
    const detail: V2SectionDetail = {
      ...BASE_DETAIL,
      sources: [{ path: 'mof.go.jp/x.zip', zipEntry: 'x.csv', rowNumber: 5 }],
      records: [{ id: 'rec1', itemId: 'item1', phase: 'initial', budgetStatus: 'enacted', revision: null, sourceAmountColumn: '当初予算額', sourceRef: 0 }],
    };
    const out = toEntityDetail('mofsec_abc', detail);
    expect(out.records[0].source).toEqual({ path: 'mof.go.jp/x.zip', zipEntry: 'x.csv', rowNumber: 5 });
    expect(out.sources['mof.go.jp/x.zip']).toBeDefined();
  });

  it('relationsはsourceRecordIds/targetRecordIdsをそのまま保持し、entityIdsはsectionIdsの和集合', () => {
    const detail: V2SectionDetail = {
      ...BASE_DETAIL,
      relations: [{ relationId: 'rel1', relationType: 'same_item', evidenceMethod: 'exact-key', sourceSectionIds: ['mofsec_abc'], targetSectionIds: ['mofsec_def'], sourceRecordIds: ['r1'], targetRecordIds: ['r2'] }],
    };
    const out = toEntityDetail('mofsec_abc', detail);
    expect(out.relations[0].entityIds.sort()).toEqual(['mofsec_abc', 'mofsec_def']);
    expect(out.relations[0].sourceRecordIds).toEqual(['r1']);
    expect(out.relations[0].targetRecordIds).toEqual(['r2']);
  });

  it('rsLinksはspansEntities/matchMethodを保持し、sourceYearはreviewYearから作る', () => {
    const detail: V2SectionDetail = {
      ...BASE_DETAIL,
      rsLinks: [{ linkId: 'l1', reviewYear: 2025, phase: 'initial', revision: null, matchMethod: 'exact-name-key', projectIds: ['1', '2'], mofAmountYen: 100, rsAmountYen: 90, differenceYen: 10, spansEntities: true }],
    };
    const out = toEntityDetail('mofsec_abc', detail);
    expect(out.links[0]).toMatchObject({ sourceYear: 2025, fiscalYear: 2024, spansEntities: true, projectIds: ['1', '2'] });
  });

  it('comparisons（V1差分）は常に空配列（V2データソースでは比較対象を取得しない）', () => {
    const out = toEntityDetail('mofsec_abc', BASE_DETAIL);
    expect(out.comparisons).toEqual([]);
  });

  it('stages/eventCountはevents配列から導出する', () => {
    const detail: V2SectionDetail = {
      ...BASE_DETAIL,
      events: [
        { eventType: 'initial_budget_state', budgetStatus: 'enacted', revision: null, amountYen: 1000, evidence: [{ eventId: 'e1', amountYen: 1000, itemName: 'x', itemIds: ['item1'], recordIds: ['rec1'] }] },
        { eventType: 'spent', amountYen: 900, evidence: [{ eventId: 'e2', amountYen: 900, itemName: 'x', itemIds: ['item1'], recordIds: ['rec2'] }] },
      ],
    };
    const out = toEntityDetail('mofsec_abc', detail);
    expect(out.stages.sort()).toEqual(['initial_budget_state', 'spent']);
    expect(out.eventCount).toBe(2);
  });
});
