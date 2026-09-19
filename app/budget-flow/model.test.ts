import { describe, expect, it } from 'vitest';
import { filterAmountRange, parseAmountRange, sortEntities, initialEnactedAmount, filterEntities, orderedEvents, eventLabel, type EntitySummary, type EventGroup } from './model';
const entity = (name: string, stage = 'initial'): EntitySummary => ({ id: name, sectionName: name, sectionCode: '01', accountType: 'special', ministry: '復興庁', organization: '', specialAccount: '東日本大震災復興', subAccount: '', agency: '', fiscalYear: 2024, sourceYear: 2024, stages: [stage], eventCount: 1, relationCount: 0 });
describe('Budget Flow filters and event presentation', () => {
  it('preserves distinct names under the same section code, including zero-valued rows', () => {
    const rows = [entity('復興債費'), entity('復興庁共通費')];
    expect(filterEntities(rows, 'special', '０１', 'all')).toHaveLength(2);
    expect(filterEntities(rows, 'special', '復興債費', 'all')).toEqual([rows[0]]);
    expect(filterEntities(rows, 'general', '', 'all')).toHaveLength(0);
  });
  it('does not substitute initial data for missing settlements', () => {
    expect(filterEntities([entity('復興債費')], '', '', 'settlement')).toHaveLength(0);
  });
  it('keeps submitted and enacted initial states distinct and ordered', () => {
    const event = (status: string): EventGroup => ({ eventType: 'initial_budget_state', budgetStatus: status, revision: null, amountYen: 0, evidence: [] });
    const rows = orderedEvents([event('enacted'), event('submitted')]);
    expect(rows.map(eventLabel)).toEqual(['当初予算・提出案', '当初予算・成立']);
    expect(rows).toHaveLength(2);
  });
});

describe('multi-select and search', () => {
  const rows = [entity('復興債費'), { ...entity('研究費', 'settlement'), accountType: 'general', ministry: '文部科学省', organization: '研究局' }];
  it('combines OR within selections and AND between filters', () => {
    expect(filterEntities(rows, ['special', 'general'], '', 'all', ['復興庁', '研究局'])).toEqual(rows);
    expect(filterEntities(rows, ['general'], '', 'all', ['復興庁'])).toEqual([]);
    expect(filterEntities(rows, [], '', 'settlement', ['研究局'])).toEqual([rows[1]]);
    expect(filterEntities(rows, [], '', 'all', [])).length(2);
  });
  it('distinguishes literal and regex search and rejects invalid expressions', () => {
    expect(filterEntities(rows, [], '復興|研究', 'all')).toEqual([]);
    expect(filterEntities(rows, [], '復興|研究', 'all', [], true)).toEqual(rows);
    expect(filterEntities(rows, [], '[', 'all', [], true)).toEqual([]);
    expect(filterEntities(rows, [], '^研究費', 'all', [], true)).toEqual([rows[1]]);
  });
});

it('only displays the enacted initial balance and preserves zero', () => {
  const event: EventGroup = { eventType: 'initial_budget_state', budgetStatus: 'submitted', revision: null, amountYen: 100, evidence: [] };
  expect(initialEnactedAmount([event])).toBeNull();
  expect(initialEnactedAmount([{ ...event, budgetStatus: 'enacted', amountYen: 0 }])).toBe(0);
  expect(initialEnactedAmount([{ ...event, eventType: 'spent', budgetStatus: 'enacted' }])).toBeNull();
});

describe('amount ranges and list sorting', () => {
  const rows = [entity('項10'), entity('項2'), entity('欠損'), entity('未取得')];
  const amounts = { 項10: 100, 項2: 0, 欠損: null };
  it('applies inclusive bounds without treating absent values as zero', () => {
    expect(filterAmountRange(rows, amounts, parseAmountRange('', ''))).toEqual(rows);
    expect(filterAmountRange(rows, amounts, parseAmountRange('0', '100'))).toEqual(rows.slice(0, 2));
    expect(filterAmountRange(rows, amounts, parseAmountRange('', '0'))).toEqual([rows[1]]);
    expect(filterAmountRange(rows, amounts, parseAmountRange('100', ''))).toEqual([rows[0]]);
    expect(parseAmountRange('１,０００', '2000')).toMatchObject({ min: 1000, max: 2000, error: '' });
    for (const [min, max] of [['2', '1'], ['abc', ''], ['-1', ''], ['0.5', ''], ['9007199254740992', '']]) {
      expect(parseAmountRange(min, max).error).not.toBe('');
      expect(filterAmountRange(rows, amounts, parseAmountRange(min, max))).toEqual([]);
    }
  });
  it('sorts numeric amounts, keeps missing values last and preserves the input', () => {
    expect(sortEntities(rows, amounts, { key: 'amount', direction: 'asc' })).toEqual([rows[1], rows[0], rows[2], rows[3]]);
    expect(sortEntities(rows, amounts, { key: 'amount', direction: 'desc' })).toEqual(rows);
    expect(sortEntities(rows.slice(0, 2), amounts, { key: 'sectionName', direction: 'asc' })).toEqual([rows[1], rows[0]]);
    expect(rows.map(e => e.sectionName)).toEqual(['項10', '項2', '欠損', '未取得']);
  });
});
