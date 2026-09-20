import { describe, expect, it } from 'vitest';
import { budgetFor, connectionCount, filterProjects, selectProject, sortProjects, type RsFilters, type RsProject } from './rs-model';
const make = (id: string, amount: number | null, linked = false): RsProject => ({
  id: `2025:${id}`, projectId: id, reviewYear: 2025, projectName: `事業${id}`, organizations: ['デジタル庁'], shard: 'a', accountsByYear: { 2024: ['general'] },
  budgets: [{ fiscalYear: 2024, requestFiscalYear: 2025, initialBudgetYen: amount, currentBudgetYen: amount, executionYen: 0, nextYearRequestYen: 9 }],
  connections: [{ fiscalYear: 2024, entityCount: linked ? 2 : 0 }, { fiscalYear: 2025, entityCount: 0 }],
});
const projects = [make('1', 0, true), make('2', 100), make('10', null)];
const filters: RsFilters = { fiscalYear: 2024, accounts: [], organizations: [], query: '', regex: false, connection: 'all', minAmount: '', maxAmount: '' };
describe('RS population, years and filters', () => {
  it('keeps every project including unlinked and missing budget projects', () => {
    expect(filterProjects(projects, filters)).toHaveLength(3);
    expect(filterProjects(projects, { ...filters, fiscalYear: 2021 })).toHaveLength(3);
  });
  it('scopes connections and amounts to fiscalYear, not reviewYear', () => {
    expect(filterProjects(projects, { ...filters, connection: 'linked' })).toEqual([projects[0]]);
    expect(filterProjects(projects, { ...filters, connection: 'unlinked' })).toEqual(projects.slice(1));
    expect(filterProjects(projects, { ...filters, fiscalYear: 2025, connection: 'linked' })).toEqual([]);
    expect(budgetFor(projects[0], 2025)).toBeUndefined();
    expect(connectionCount(projects[0], 2025)).toBe(0);
  });
  it('distinguishes zero, missing, and invalid amount ranges', () => {
    expect(filterProjects(projects, { ...filters, minAmount: '0', maxAmount: '0' })).toEqual([projects[0]]);
    expect(filterProjects(projects, { ...filters, minAmount: '101', maxAmount: '100' })).toEqual([]);
    expect(filterProjects(projects, { ...filters, minAmount: 'x' })).toEqual([]);
  });
  it('combines multi-select and literal/regex searches', () => {
    expect(filterProjects(projects, { ...filters, organizations: ['デジタル庁'], accounts: ['special','general'], query: '事業[12](?![0-9])', regex: true })).toHaveLength(2);
    expect(filterProjects(projects, { ...filters, query: '事業[12](?![0-9])' })).toEqual([]);
    expect(filterProjects(projects, { ...filters, query: '[', regex: true })).toEqual([]);
    expect(filterProjects(projects, { ...filters, accounts: ['special'] })).toEqual([]);
  });
  it('sorts without mutating and puts missing amounts last in both directions', () => {
    expect(sortProjects(projects, 2024, {key:'amount',direction:'desc'})).toEqual([projects[1], projects[0], projects[2]]);
    expect(sortProjects(projects, 2024, {key:'amount',direction:'asc'})).toEqual(projects);
  });
  it('selects by reviewYear plus projectId and falls back only within visible projects', () => {
    const nextReview = { ...projects[0], id: '2024:1', reviewYear: 2024 };
    expect(selectProject([...projects,nextReview], '2024:1')).toBe(nextReview);
    expect(selectProject(projects, 'missing')).toBe(projects[0]);
    expect(selectProject([], '2025:1')).toBeUndefined();
  });
});
