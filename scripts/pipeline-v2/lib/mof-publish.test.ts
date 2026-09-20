import { describe, it, expect } from 'vitest';
import { sectionIdOf, mofSectionShard, buildMofSectionDetails, buildMofIndexRow } from './mof-publish';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent, MofDerivedSection } from '../types';

const SRC = { domain: 'mof.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };

function item(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'mof_1', fiscalYear: 2024, phase: 'initial', budgetStatus: 'enacted',
    revision: null, accountType: 'general', ministry: '外務省', organization: '在外公館', specialAccount: '', subAccount: '',
    agency: '', sectionCode: '027', sectionName: '経済協力費', subItemCode: '', subItemName: '在外公館必要経費',
    sectionNaturalKey: '', legacySectionKey: '', itemNaturalKey: 'general|外務省|在外公館|経済協力費|在外公館必要経費',
    scopeNameItemKey: '', source: SRC, amountYen: 1000, ...overrides,
  };
}

describe('mofSectionShard: mofsec_プレフィックスを除いたハッシュ本体から2桁取り出す', () => {
  it('先頭2桁が定数（プレフィックス由来）にならず、複数のsectionIdで分散する', () => {
    const ids = [
      sectionIdOf(item({ sectionCode: '001', sectionName: 'A' })),
      sectionIdOf(item({ sectionCode: '002', sectionName: 'B' })),
      sectionIdOf(item({ sectionCode: '003', sectionName: 'C' })),
      sectionIdOf(item({ sectionCode: '004', sectionName: 'D' })),
      sectionIdOf(item({ sectionCode: '005', sectionName: 'E' })),
    ];
    // 全IDは 'mofsec_' で始まるため、素朴に id.slice(0,2) すると全て 'mo' に潰れてしまう
    // （実データで1311件が1shardに収束するバグとして発見）。mofSectionShard()はこれを回避する
    expect(new Set(ids.map(id => id.slice(0, 2))).size).toBe(1);
    const shards = new Set(ids.map(mofSectionShard));
    expect(shards.size).toBeGreaterThan(1);
    for (const s of shards) expect(s).toMatch(/^[0-9a-f]{2}$/);
  });
});

describe('buildMofSectionDetails: sections.jsonl/stage-gaps.jsonlと同じsectionIdで結合できる', () => {
  it('同一の項キーから作ったitemはrecordのitemIdとして正しく紐づく', () => {
    const row = item({});
    const details = buildMofSectionDetails(2024, [row], [], [], [], []);
    const sid = sectionIdOf(row);
    const detail = details.get(sid);
    expect(detail).toBeDefined();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].id).toBe(row.itemNaturalKey);
    expect(detail!.records[0].itemId).toBe(row.itemNaturalKey);
  });

  it('イベントのsourceRecordIdsから同一sectionへイベントを集約する', () => {
    const row = item({});
    const sid = sectionIdOf(row);
    const event: MofDerivedBudgetEvent = {
      schemaVersion: 2, recordType: 'budget_event', eventId: 'evt1', sourceSystem: 'mof', fiscalYear: 2024,
      eventType: 'initial_budget_state', amountYen: 1000, accountType: 'general', ministry: '外務省', organization: '在外公館',
      specialAccount: '', subAccount: '', agency: '', sectionCode: '027', sectionName: '経済協力費', subItemName: '在外公館必要経費',
      sourceRecordIds: [row.recordId], source: SRC, budgetStatus: 'enacted',
    };
    const details = buildMofSectionDetails(2024, [row], [event], [], [], []);
    const detail = details.get(sid)!;
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].amountYen).toBe(1000);
    expect(detail.events[0].evidence[0].recordIds).toEqual([row.recordId]);
  });
});

describe('buildMofIndexRow', () => {
  it('shardはmofSectionShardの出力と一致する', () => {
    const section: MofDerivedSection = {
      id: sectionIdOf(item({})), fiscalYear: 2024, accountType: 'general', ministry: '外務省', organization: '在外公館',
      specialAccount: '', subAccount: '', agency: '', sectionCode: '027', sectionName: '経済協力費', itemCount: 1, eventCount: 1, stages: [],
    };
    const row = buildMofIndexRow(section, {}, 0);
    expect(row.shard).toBe(mofSectionShard(section.id));
  });
});
