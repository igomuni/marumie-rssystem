import { describe, expect, it } from 'vitest';
import { filterEntities, orderedEvents, eventLabel, type EntitySummary, type EventGroup } from './model';
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
