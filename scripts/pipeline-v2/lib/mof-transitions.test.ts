import { describe, it, expect } from 'vitest';
import { semanticItemKey, transitionLinks } from './mof-transitions';
import type { MofBudgetItemRecord } from '../types';

function row(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2,
    recordType: 'mof_budget_item',
    recordId: 'r1',
    fiscalYear: 2024,
    phase: 'initial',
    budgetStatus: 'enacted',
    revision: null,
    accountType: 'general',
    ministry: '外務省',
    organization: '在外公館',
    specialAccount: '',
    subAccount: '',
    agency: '',
    sectionCode: '027',
    sectionName: '経済協力費',
    subItemCode: '01',
    subItemName: '在外公館必要経費',
    sectionNaturalKey: 'general|外務省|在外公館|027|経済協力費',
    legacySectionKey: 'general|外務省|在外公館|027',
    itemNaturalKey: 'general|外務省|在外公館|027|経済協力費|01|在外公館必要経費',
    scopeNameItemKey: 'general|外務省|在外公館|経済協力費|在外公館必要経費',
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    ...overrides,
  };
}

describe('semanticItemKey', () => {
  it('項自然キー+目名で作る（目コードを含まない）', () => {
    const a = row({ subItemCode: '01' });
    const b = row({ subItemCode: '99' }); // コードが変わっても
    expect(semanticItemKey(a)).toBe(semanticItemKey(b)); // 同一視する
  });
  it('目名が違えば別キーになる', () => {
    expect(semanticItemKey(row({ subItemName: 'A' }))).not.toBe(semanticItemKey(row({ subItemName: 'B' })));
  });
});

describe('transitionLinks', () => {
  it('完全一致キーで同一項目をsame_itemとしてリンクする', () => {
    const source = [row({ recordId: 's1' })];
    const target = [row({ recordId: 't1' })];
    const { links, stats } = transitionLinks(source, target, 'initial_enacted', 'settlement');
    expect(links).toHaveLength(1);
    expect(links[0].relationType).toBe('same_item');
    expect(links[0].evidenceMethod).toBe('exact-key');
    expect(stats.linkedSourceRecords).toBe(1);
    expect(stats.unlinkedSourceRecords).toBe(0);
  });

  it('項コードが変わっても項名が同じでscope+項名+目名が一致すればcode_changedとしてリンクする', () => {
    const source = [row({ recordId: 's1', sectionCode: '027', sectionNaturalKey: 'general|外務省|在外公館|027|経済協力費' })];
    const target = [row({ recordId: 't1', sectionCode: '028', sectionNaturalKey: 'general|外務省|在外公館|028|経済協力費' })];
    const { links } = transitionLinks(source, target, 'a', 'b');
    expect(links).toHaveLength(1);
    expect(links[0].relationType).toBe('code_changed');
    expect(links[0].evidenceMethod).toBe('same-scope-same-name');
  });

  it('scope-nameフォールバックは片方が複数の項にまたがる場合は結合しない（曖昧な統合を避ける）', () => {
    const source = [
      row({ recordId: 's1', sectionCode: '01', sectionNaturalKey: 'k1', scopeNameItemKey: 'shared' }),
      row({ recordId: 's2', sectionCode: '02', sectionNaturalKey: 'k2', scopeNameItemKey: 'shared' }),
    ];
    const target = [row({ recordId: 't1', sectionCode: '03', sectionNaturalKey: 'k3', scopeNameItemKey: 'shared' })];
    const { links, stats } = transitionLinks(source, target, 'a', 'b');
    expect(links).toHaveLength(0);
    expect(stats.unlinkedSourceRecords).toBe(2);
  });

  it('完全一致で既にリンク済みのレコードはscope-nameフォールバックで二重に使わない', () => {
    const source = [row({ recordId: 's1' })];
    const target = [row({ recordId: 't1' })];
    const { links } = transitionLinks(source, target, 'a', 'b');
    // exact-keyで1件マッチ、scope-nameで拾う残りが無いことを確認
    expect(links).toHaveLength(1);
    expect(links.filter(l => l.evidenceMethod === 'same-scope-same-name')).toHaveLength(0);
  });

  it('一致しない項目はunlinkedとして数える', () => {
    const source = [row({ recordId: 's1', subItemName: 'A' })];
    const target = [row({ recordId: 't1', subItemName: 'B', scopeNameItemKey: 'different' })];
    const { links, stats } = transitionLinks(source, target, 'a', 'b');
    expect(links).toHaveLength(0);
    expect(stats.unlinkedSourceRecords).toBe(1);
    expect(stats.unlinkedTargetRecords).toBe(1);
  });
});
