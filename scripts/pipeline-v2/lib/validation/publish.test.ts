import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import {
  independentRsShard, independentMofSectionShard, checkArtifactExists,
  checkRsProjectCounts, checkRsShardReferentialIntegrity, checkRsBudgetSummaryPreservation,
  checkRsBudgetItemPreservation, checkRsFalsePreservation, checkRsIndexBudgetSummaryReconstruction,
  checkMofSectionCounts, checkMofSectionSemantics, checkMofDetailRecords, checkMofDetailEventAggregation,
  checkLinksPublishCounts, checkLinksSemanticEquality, checkLinksManifestSetCounts,
  checkRootManifestConsistency, readGzipJson,
  type RsPublishIndex, type MofPublishIndex, type PublishedLink, type MofSectionDetail,
} from './publish';
import type { RsBudgetItemRecordV2, RsBudgetSummaryRecord, MofDerivedSection, MofRsProjectLinkGroup, MofBudgetItemRecord, MofDerivedBudgetEvent } from '../../types';
import type { RsProject } from '../rs-projects';

function project(overrides: Partial<RsProject>): RsProject {
  return {
    schemaVersion: 2, sourceSystem: 'rs', sourceYear: 2024, reviewYear: 2024, sheetType: '', projectId: '1', projectIdRaw: '1',
    projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
    recordType: 'rs_project', recordId: 'rsproj_1', purpose: '', currentIssues: '', overview: '', overviewUrl: '', startYear: 2020, endYear: null,
    noPlannedEnd: null, projectCategory: '', legacyProjectNumber: '', implementationMethods: null, note: '',
    projectIdRawVariants: [], sources: [], officialProjectUrl: '', accountClass: '', sourceKinds: [],
    ...overrides,
  } as RsProject;
}
function summary(overrides: Partial<RsBudgetSummaryRecord> & { amounts: Record<string, number | null> }): RsBudgetSummaryRecord {
  return {
    reviewYear: 2024, projectId: '1', fiscalYear: 2024, scopeLevel: 'account',
    accountType: 'general', accountClass: '一般会計', account: '一般会計', subAccount: '',
    executionRateRaw: '', changeReason: '', specialNotes: '', note: '', recordId: 'rssum_1',
    ...overrides,
  } as RsBudgetSummaryRecord;
}
function section(overrides: Partial<MofDerivedSection>): MofDerivedSection {
  return {
    id: 'mofsec_abcdef1234567890abcd', fiscalYear: 2024, accountType: 'general', ministry: 'X', organization: 'Y',
    specialAccount: '', subAccount: '', agency: '', sectionCode: '001', sectionName: 'S', itemCount: 1, eventCount: 1, stages: [],
    ...overrides,
  };
}
function link(overrides: Partial<MofRsProjectLinkGroup>): MofRsProjectLinkGroup {
  return {
    schemaVersion: 2, recordType: 'mof_rs_project_link_group', linkId: 'l1', reviewYear: 2024, fiscalYear: 2024,
    phase: 'initial', revision: null, matchMethod: 'exact-name-key', naturalKey: 'k',
    mofRecordIds: ['mof_1'], rsRecordIds: ['rs_1'], projectIds: ['1'],
    mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0,
    rsMatchEvidence: [{ rsRecordId: 'rs_1', projectId: '1', method: 'exact-name-key', sourceField: 'structured-fields' }],
    ...overrides,
  };
}

describe('independentRsShard / independentMofSectionShard', () => {
  it('rsShard()と同じアルゴリズム（sha256("rs-project:"+id)先頭2桁）を独立に計算する', () => {
    const expected = crypto.createHash('sha256').update('rs-project:42').digest('hex').slice(0, 2);
    expect(independentRsShard('42')).toBe(expected);
  });
  it('mofSectionShard()と同じくmofsec_プレフィックス直後2文字を取る', () => {
    expect(independentMofSectionShard('mofsec_abcdef1234567890')).toBe('ab');
  });
});

describe('checkArtifactExists', () => {
  it('ファイルが存在すればfindingsは空', () => {
    expect(checkArtifactExists('x', __filename, {})).toHaveLength(0);
  });
  it('ファイルが存在しなければinvariant error', () => {
    const findings = checkArtifactExists('rs-publish-artifact-presence', '/nonexistent/path.json', { reviewYear: 2024 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].category).toBe('invariant');
  });
});

describe('checkRsProjectCounts', () => {
  it('件数・集合が一致すればfindingsは空', () => {
    const normProjects = [project({ projectId: '1' }), project({ projectId: '2' })];
    const index: RsPublishIndex = { projectCount: 2, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'] }, { projectId: '2', shard: 'bb', profiles: ['core'] }] };
    const findings = checkRsProjectCounts(2024, normProjects, index, { projectCount: 2, completeness: 'full' });
    expect(findings).toHaveLength(0);
  });

  it('Normalizedにあるがindexに無いprojectIdを検出する', () => {
    const normProjects = [project({ projectId: '1' }), project({ projectId: '2' })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'] }] };
    const findings = checkRsProjectCounts(2024, normProjects, index, { projectCount: 1, completeness: 'full' });
    expect(findings.some(f => f.message.includes('無いprojectId'))).toBe(true);
  });

  it('indexにあるがNormalizedに無い（unexpected）projectIdを検出する', () => {
    const normProjects = [project({ projectId: '1' })];
    const index: RsPublishIndex = { projectCount: 2, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'] }, { projectId: '999', shard: 'cc', profiles: ['core'] }] };
    const findings = checkRsProjectCounts(2024, normProjects, index, { projectCount: 2, completeness: 'full' });
    expect(findings.some(f => f.message.includes('Normalizedに無いprojectId'))).toBe(true);
  });

  it('index.projectCountとmanifest.projectCountの不一致を検出する', () => {
    const normProjects = [project({ projectId: '1' })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'] }] };
    const findings = checkRsProjectCounts(2024, normProjects, index, { projectCount: 999, completeness: 'full' });
    expect(findings.some(f => f.message.includes('manifest.projectCount'))).toBe(true);
  });
});

describe('checkRsShardReferentialIntegrity', () => {
  it('shardが独立計算と一致し、core bundleが実在すればfindingsは空', () => {
    const shard = independentRsShard('1');
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard, profiles: ['core'] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, (profile, s) => (profile === 'core' && s === shard ? { '1': {} } : null));
    expect(findings).toHaveLength(0);
  });

  it('index.shardが独立計算と不一致ならerror', () => {
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'wrong', profiles: ['core'] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, () => ({}));
    expect(findings.some(f => f.message.includes('独立計算したshard'))).toBe(true);
  });

  it('core profileがあるのにshard内にbundleが無ければerror', () => {
    const shard = independentRsShard('1');
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard, profiles: ['core'] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, () => ({})); // bundleに'1'キーが無い
    expect(findings.some(f => f.message.includes('bundleが存在しない'))).toBe(true);
  });

  it('coreはprofilesに列挙が無くても常時必須として検査する', () => {
    const shard = independentRsShard('1');
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard, profiles: [] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, () => ({})); // core bundle無し、profilesにもcore無し
    expect(findings.some(f => f.message.includes('coreは全projectに必須'))).toBe(true);
  });

  it('profilesにcontextが列挙されているのにbundleが無ければerror', () => {
    const shard = independentRsShard('1');
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard, profiles: ['core', 'context'] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, (profile, s) => (profile === 'core' && s === shard ? { '1': {} } : null));
    expect(findings.some(f => f.message.includes('context/') && f.message.includes('bundleが存在しない'))).toBe(true);
  });

  it('context/spendingが実在しprofilesにも列挙されていればfindingsは空', () => {
    const shard = independentRsShard('1');
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard, profiles: ['core', 'context', 'spending'] }] };
    const findings = checkRsShardReferentialIntegrity(2024, index, () => ({ '1': {} }));
    expect(findings).toHaveLength(0);
  });
});

describe('checkRsBudgetSummaryPreservation', () => {
  it('件数・内容が一致すればfindingsは空', () => {
    const normSummaries = [summary({ amounts: { '当初予算': 100, '歳出予算現額': 100 } })];
    const readCoreShard = () => ({ '1': { budgetSummaries: [{ fiscalYear: 2024, scopeLevel: 'account', amounts: { '当初予算': 100, '歳出予算現額': 100 }, accountType: 'general', accountClass: '一般会計', account: '一般会計' }] } });
    const result = checkRsBudgetSummaryPreservation(2024, normSummaries, new Set(['1']), readCoreShard, () => 'aa');
    expect(result.findings).toHaveLength(0);
    expect(result.sourceCount).toBe(1);
  });

  it('空文字列フィールド（account等）はpick()で省略されるため、undefinedとの比較で一致とみなす', () => {
    const normSummaries = [summary({ scopeLevel: 'project_total', accountType: '', accountClass: '', account: '', subAccount: '', amounts: { '計（歳出予算現額合計）': 100 } })];
    // Publish側はpick()で空文字列フィールドを省略した想定（account等のkeyが無い）
    const readCoreShard = () => ({ '1': { budgetSummaries: [{ fiscalYear: 2024, scopeLevel: 'project_total', amounts: { '計（歳出予算現額合計）': 100 } }] } });
    const result = checkRsBudgetSummaryPreservation(2024, normSummaries, new Set(['1']), readCoreShard, () => 'aa');
    expect(result.findings).toHaveLength(0);
  });

  it('件数不一致を検出する', () => {
    const normSummaries = [summary({ recordId: 'a', amounts: {} }), summary({ recordId: 'b', amounts: {} })];
    const readCoreShard = () => ({ '1': { budgetSummaries: [{}] } });
    const result = checkRsBudgetSummaryPreservation(2024, normSummaries, new Set(['1']), readCoreShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-summary-count')).toBe(true);
  });

  it('明示0がPublishから消えていれば対応する行が見つからずerrorになる', () => {
    const normSummaries = [summary({ amounts: { '当初予算': 0 } })];
    const readCoreShard = () => ({ '1': { budgetSummaries: [{ fiscalYear: 2024, scopeLevel: 'account', amounts: {}, accountType: 'general', accountClass: '一般会計', account: '一般会計' }] } }); // 0が消えている
    const result = checkRsBudgetSummaryPreservation(2024, normSummaries, new Set(['1']), readCoreShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-summary-value')).toBe(true);
  });
});

describe('checkRsBudgetItemPreservation', () => {
  function item(overrides: Partial<RsBudgetItemRecordV2>): RsBudgetItemRecordV2 {
    return {
      reviewYear: 2024, projectId: '1', fiscalYear: 2024, accountType: 'general', account: '一般会計', subAccount: '',
      budgetType: '当初予算', budgetAmountYen: 100, nextYearRequestYen: null, requestFiscalYear: null,
      recordId: 'rsitem_1', accountClass: '', budgetMinistry: 'A省', organizationOrAccount: '', sectionName: 'S', subItemName: 'I',
      supplementalInfo: '', note: '',
      ...overrides,
    } as RsBudgetItemRecordV2;
  }

  it('recordIdが一致し値も一致すればfindingsは空', () => {
    const items = [item({})];
    const readContextShard = () => ({ '1': { budgetItems: [{ recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 100 }] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings).toHaveLength(0);
  });

  it('recordIdがPublishに無ければmissingとして検出する', () => {
    const items = [item({})];
    const readContextShard = () => ({ '1': { budgetItems: [] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-missing')).toBe(true);
  });

  it('明示0(budgetAmountYen=0)がPublishに残っていることを検査する', () => {
    const items = [item({ budgetAmountYen: 0 })];
    const readContextShard = () => ({ '1': { budgetItems: [{ recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 0 }] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings).toHaveLength(0);
  });

  it('明示0がPublishから消えていれば（keyが無い）不一致として検出する', () => {
    const items = [item({ budgetAmountYen: 0 })];
    const readContextShard = () => ({ '1': { budgetItems: [{ recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I' }] } }); // budgetAmountYen key無し
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-value')).toBe(true);
  });

  it('値の不一致を検出する', () => {
    const items = [item({ budgetAmountYen: 100 })];
    const readContextShard = () => ({ '1': { budgetItems: [{ recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 999 }] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-value' && f.message.includes('budgetAmountYen'))).toBe(true);
  });

  it('Publish側にrecordIdが重複していればduplicateとして検出する', () => {
    const items = [item({})];
    const row = { recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 100 };
    const readContextShard = () => ({ '1': { budgetItems: [row, row] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-duplicate')).toBe(true);
  });

  it('NormalizedにないrecordIdがPublishに存在すればunexpectedとして検出する', () => {
    const items = [item({})];
    const readContextShard = () => ({
      '1': {
        budgetItems: [
          { recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 100 },
          { recordId: 'rsitem_ghost', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 999 },
        ],
      },
    });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-unexpected')).toBe(true);
  });

  it('sourceCountとpublishedCountが不一致ならfindingとして検出する（metricsだけに留めない）', () => {
    const items = [item({ recordId: 'rsitem_1' }), item({ recordId: 'rsitem_2' })];
    const readContextShard = () => ({ '1': { budgetItems: [{ recordId: 'rsitem_1', fiscalYear: 2024, budgetType: '当初予算', accountType: 'general', account: '一般会計', budgetMinistry: 'A省', sectionName: 'S', subItemName: 'I', budgetAmountYen: 100 }] } });
    const result = checkRsBudgetItemPreservation(2024, items, new Set(['1']), readContextShard, () => 'aa');
    expect(result.findings.some(f => f.check === 'rs-publish-budget-item-count')).toBe(true);
  });
});

describe('checkRsFalsePreservation', () => {
  it('noPlannedEnd=falseがPublishに残っていればfindingsは空', () => {
    const projects = [project({ noPlannedEnd: false })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'], hasFundingGraph: false, hasMofLink: false }] };
    const readCoreShard = () => ({ '1': { project: { noPlannedEnd: false } } });
    const result = checkRsFalsePreservation(2024, projects, index, readCoreShard, () => 'aa');
    expect(result.findings).toHaveLength(0);
  });

  it('noPlannedEnd=falseのkeyが消えていればerror', () => {
    const projects = [project({ noPlannedEnd: false })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'], hasFundingGraph: false, hasMofLink: false }] };
    const readCoreShard = () => ({ '1': { project: {} } }); // noPlannedEndが消えている
    const result = checkRsFalsePreservation(2024, projects, index, readCoreShard, () => 'aa');
    expect(result.findings.some(f => f.message.includes('noPlannedEnd'))).toBe(true);
  });

  it('hasFundingGraph/hasMofLinkはfalseでもkeyが常に存在するはず', () => {
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'] }] }; // key自体が無い
    const result = checkRsFalsePreservation(2024, [], index, () => null, () => 'aa');
    expect(result.findings.some(f => f.message.includes('hasFundingGraph'))).toBe(true);
    expect(result.findings.some(f => f.message.includes('hasMofLink'))).toBe(true);
  });

  it('hasFundingGraph=falseの行ではhasCycle等の欠落をerrorにしない（review指摘: 条件付きフィールド）', () => {
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'], hasFundingGraph: false, hasMofLink: false }] };
    const result = checkRsFalsePreservation(2024, [], index, () => null, () => 'aa');
    expect(result.findings.some(f => f.message.includes('hasCycle'))).toBe(false);
  });

  it('hasFundingGraph=trueなのにhasCycle等が欠けていればerror', () => {
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: ['core'], hasFundingGraph: true, hasMofLink: false }] };
    const result = checkRsFalsePreservation(2024, [], index, () => null, () => 'aa');
    expect(result.findings.some(f => f.message.includes('hasCycle'))).toBe(true);
  });
});

describe('checkRsIndexBudgetSummaryReconstruction', () => {
  it('current-yearのproject_total行から独立再構成した値がindexと一致すればfindingsは空', () => {
    const normSummaries = [summary({ scopeLevel: 'project_total', fiscalYear: 2024, amounts: { '当初予算（合計）': 100, '補正予算（合計）': 20, '計（歳出予算現額合計）': 150 } })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: [], budgetSummary: { initial: 100, supplements: 20, total: 150 } }] };
    const result = checkRsIndexBudgetSummaryReconstruction(2024, normSummaries, index);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedProjects).toBe(1);
  });

  it('total!=initial+supplementsはerrorにしない（current budgetの定義であり正常）', () => {
    const normSummaries = [summary({ scopeLevel: 'project_total', fiscalYear: 2024, amounts: { '当初予算（合計）': 100, '補正予算（合計）': 20, '計（歳出予算現額合計）': 999 } })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: [], budgetSummary: { initial: 100, supplements: 20, total: 999 } }] };
    const result = checkRsIndexBudgetSummaryReconstruction(2024, normSummaries, index);
    expect(result.findings).toHaveLength(0);
  });

  it('sheets-onlyプロジェクト（budgetSummary無し）はmissing扱いしない（project 18717型の回帰防止）', () => {
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: [] }] }; // budgetSummary無し
    const result = checkRsIndexBudgetSummaryReconstruction(2024, [], index); // Normalizedにも無し
    expect(result.findings).toHaveLength(0);
    expect(result.checkedProjects).toBe(0);
  });

  it('project 18717型: 同一project/FYに複数project_total行があり、後続行が全blankなら明示値を上書きしない', () => {
    const normSummaries = [
      summary({ recordId: 'r1', scopeLevel: 'project_total', fiscalYear: 2024, amounts: { '当初予算（合計）': 100, '計（歳出予算現額合計）': 100 } }),
      summary({ recordId: 'r2', scopeLevel: 'project_total', fiscalYear: 2024, amounts: {} }), // 全blank行
    ];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: [], budgetSummary: { initial: 100, total: 100 } }] };
    const result = checkRsIndexBudgetSummaryReconstruction(2024, normSummaries, index);
    expect(result.findings).toHaveLength(0);
  });

  it('独立再構成した値とindexが不一致ならerror', () => {
    const normSummaries = [summary({ scopeLevel: 'project_total', fiscalYear: 2024, amounts: { '当初予算（合計）': 100 } })];
    const index: RsPublishIndex = { projectCount: 1, projects: [{ projectId: '1', shard: 'aa', profiles: [], budgetSummary: { initial: 999 } }] };
    const result = checkRsIndexBudgetSummaryReconstruction(2024, normSummaries, index);
    expect(result.findings).toHaveLength(1);
  });
});

describe('checkMofSectionCounts', () => {
  it('件数・集合が一致すればfindingsは空', () => {
    const s = section({});
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 0, eventCount: 0, sections: [{ ...s, shard: 'ab', relationCount: 0 }] };
    const findings = checkMofSectionCounts(2024, [], [s], [], index, { sectionCount: 1 });
    expect(findings).toHaveLength(0);
  });

  it('recordCount/eventCountの不一致を検出する', () => {
    const s = section({});
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 999, eventCount: 999, sections: [{ ...s, shard: 'ab', relationCount: 0 }] };
    const findings = checkMofSectionCounts(2024, [], [s], [], index, { sectionCount: 1 });
    expect(findings.some(f => f.check === 'mof-publish-record-count')).toBe(true);
    expect(findings.some(f => f.check === 'mof-publish-event-count')).toBe(true);
  });

  it('section id集合の不一致（missing/unexpected）を検出する', () => {
    const s1 = section({ id: 'mofsec_1' });
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 0, eventCount: 0, sections: [{ ...section({ id: 'mofsec_2' }), shard: 'ab', relationCount: 0 }] };
    const findings = checkMofSectionCounts(2024, [], [s1], [], index, { sectionCount: 1 });
    expect(findings.some(f => f.message.includes('無いsection id'))).toBe(true);
  });
});

describe('checkMofSectionSemantics', () => {
  it('shardが独立計算と一致し、semantic valueも一致すればfindingsは空', () => {
    const s = section({ id: 'mofsec_abcdef1234567890abcd', currentBudgetYen: 1000 });
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 0, eventCount: 0, sections: [{ ...s, shard: independentMofSectionShard(s.id), relationCount: 0 }] };
    const findings = checkMofSectionSemantics(2024, [s], index);
    expect(findings).toHaveLength(0);
  });

  it('shardが不一致ならerror', () => {
    const s = section({ id: 'mofsec_abcdef1234567890abcd' });
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 0, eventCount: 0, sections: [{ ...s, shard: 'zz', relationCount: 0 }] };
    const findings = checkMofSectionSemantics(2024, [s], index);
    expect(findings.some(f => f.check === 'mof-publish-section-shard')).toBe(true);
  });

  it('金額フィールドの不一致を検出する', () => {
    const s = section({ id: 'mofsec_abcdef1234567890abcd', currentBudgetYen: 1000 });
    const index: MofPublishIndex = { sectionCount: 1, recordCount: 0, eventCount: 0, sections: [{ ...s, currentBudgetYen: 999, shard: independentMofSectionShard(s.id), relationCount: 0 }] };
    const findings = checkMofSectionSemantics(2024, [s], index);
    expect(findings.some(f => f.check === 'mof-publish-section-value' && f.message.includes('currentBudgetYen'))).toBe(true);
  });
});

describe('checkMofDetailRecords / checkMofDetailEventAggregation', () => {
  function mofItem(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
    return {
      schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'mofrec_1', fiscalYear: 2024,
      phase: 'initial', budgetStatus: 'initial', revision: null,
      accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
      sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
      sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
      source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip', dataset: 'd', year: 2024, zipEntry: 'e.csv', rowNumber: 5 },
      sourceAmountColumn: 'col', amountYen: 100,
      ...overrides,
    } as MofBudgetItemRecord;
  }
  function mofEvent(overrides: Partial<MofDerivedBudgetEvent>): MofDerivedBudgetEvent {
    return {
      schemaVersion: 2, recordType: 'budget_event', eventId: 'evt_1', sourceSystem: 'mof',
      fiscalYear: 2024, eventType: 'initial_budget_state', amountYen: 100, budgetStatus: 'initial', revision: null,
      accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
      sectionCode: '001', sectionName: 'S', subItemName: 'I',
      sourceRecordIds: ['mofrec_1'], source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
      ...overrides,
    } as MofDerivedBudgetEvent;
  }
  const derivedSections = [section({ id: 'mofsec_1', accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '', sectionCode: '001', sectionName: 'S' })];
  const validDetail: MofSectionDetail = {
    records: [{ id: 'mofrec_1', itemId: 'ik', phase: 'initial', budgetStatus: 'initial', revision: null, sourceAmountColumn: 'col', sourceRef: 0 }],
    sources: [{ domain: 'mof.go.jp', dataset: 'd', year: 2024, path: 'x', zipEntry: 'e.csv', rowNumber: 5 }],
    events: [{ eventType: 'initial_budget_state', budgetStatus: 'initial', revision: null, amountYen: 100, evidence: [{ eventId: 'evt_1', amountYen: 100, itemName: 'I', itemIds: ['ik'], recordIds: ['mofrec_1'] }] }],
  };

  it('checkMofDetailRecords: recordが一致すればfindingsは空', () => {
    const items = [mofItem({})];
    const result = checkMofDetailRecords(2024, items, derivedSections, () => validDetail);
    expect(result.findings).toHaveLength(0);
  });

  it('checkMofDetailRecords: section detailが読めなければmof-publish-detail-missingを検出する（silent passしない）', () => {
    const items = [mofItem({})];
    const result = checkMofDetailRecords(2024, items, derivedSections, () => null);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-missing')).toBe(true);
  });

  it('checkMofDetailRecords: itemId/revision/sourceAmountColumnの不一致を検出する', () => {
    const items = [mofItem({})];
    const badDetail: MofSectionDetail = { ...validDetail, records: [{ ...validDetail.records[0], itemId: 'wrong', revision: 3, sourceAmountColumn: 'other' }] };
    const result = checkMofDetailRecords(2024, items, derivedSections, () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-record-value')).toBe(true);
  });

  it('checkMofDetailRecords: sourceRefが指すsourceの内容がNormalizedと不一致なら検出する', () => {
    const items = [mofItem({})];
    const badDetail: MofSectionDetail = { ...validDetail, sources: [{ domain: 'mof.go.jp', dataset: 'wrong-dataset' }] };
    const result = checkMofDetailRecords(2024, items, derivedSections, () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-source-ref')).toBe(true);
  });

  it('checkMofDetailEventAggregation: 合計・evidenceが一致すればfindingsは空', () => {
    const events = [mofEvent({})];
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => validDetail);
    expect(result.findings).toHaveLength(0);
  });

  it('checkMofDetailEventAggregation: section detailが読めなければmof-publish-detail-missingを検出する（silent passしない）', () => {
    const events = [mofEvent({})];
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => null);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-missing')).toBe(true);
  });

  it('checkMofDetailEventAggregation: 合計額が同じでもevidenceが欠落していれば検出する', () => {
    const events = [mofEvent({}), mofEvent({ eventId: 'evt_2', amountYen: 0 })];
    // evt_2のamountYen=0なので合計は変わらないが、evt_2分のevidenceがpublishedに無い
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => validDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-evidence-missing')).toBe(true);
  });

  it('checkMofDetailEventAggregation: evidenceの値がDerived eventと不一致なら検出する', () => {
    const events = [mofEvent({})];
    const badDetail: MofSectionDetail = { ...validDetail, events: [{ ...validDetail.events[0], evidence: [{ ...validDetail.events[0].evidence![0], amountYen: 999 }] }] };
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-evidence-value')).toBe(true);
  });

  it('checkMofDetailEventAggregation: evidenceのitemIdsが不一致なら検出する（amountYen/recordIdsが一致していても見逃さない）', () => {
    const events = [mofEvent({})];
    const badDetail: MofSectionDetail = { ...validDetail, events: [{ ...validDetail.events[0], evidence: [{ ...validDetail.events[0].evidence![0], itemIds: ['wrong-item'] }] }] };
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-evidence-value')).toBe(true);
  });

  it('checkMofDetailEventAggregation: evidenceのitemNameが不一致なら検出する', () => {
    const events = [mofEvent({})];
    const badDetail: MofSectionDetail = { ...validDetail, events: [{ ...validDetail.events[0], evidence: [{ ...validDetail.events[0].evidence![0], itemName: 'wrong-name' }] }] };
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-evidence-value')).toBe(true);
  });

  it('checkMofDetailEventAggregation: evidenceが重複していれば検出する', () => {
    const events = [mofEvent({})];
    const badDetail: MofSectionDetail = { ...validDetail, events: [{ ...validDetail.events[0], evidence: [validDetail.events[0].evidence![0], validDetail.events[0].evidence![0]] }] };
    const result = checkMofDetailEventAggregation(2024, events, derivedSections, [mofItem({})], () => badDetail);
    expect(result.findings.some(f => f.check === 'mof-publish-detail-evidence-duplicate')).toBe(true);
  });
});

describe('checkLinksPublishCounts / checkLinksSemanticEquality / checkLinksManifestSetCounts', () => {
  it('件数・semantic valueが一致すればfindingsは空', () => {
    const d = link({});
    const p: PublishedLink = { linkId: 'l1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', sectionIds: ['s1'], projectIds: ['1'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0 };
    const countFindings = checkLinksPublishCounts(2024, 2024, [d], { links: [p] }, { linkGroupCount: 1, projectCount: 1, sectionCount: 1 });
    expect(countFindings).toHaveLength(0);
    const semanticFindings = checkLinksSemanticEquality(2024, 2024, [d], { links: [p] });
    expect(semanticFindings).toHaveLength(0);
  });

  it('件数不一致を検出する', () => {
    const findings = checkLinksPublishCounts(2024, 2024, [link({}), link({ linkId: 'l2' })], { links: [] }, { linkGroupCount: 0, projectCount: 0, sectionCount: 0 });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('linkIdがPublishに見つからなければerror', () => {
    const findings = checkLinksSemanticEquality(2024, 2024, [link({ linkId: 'missing' })], { links: [] });
    expect(findings.some(f => f.message.includes('見つからない'))).toBe(true);
  });

  it('projectIdsのsemantic不一致を検出する', () => {
    const d = link({ projectIds: ['1', '2'] });
    const p: PublishedLink = { linkId: 'l1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', sectionIds: [], projectIds: ['1'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0 };
    const findings = checkLinksSemanticEquality(2024, 2024, [d], { links: [p] });
    expect(findings.some(f => f.message.includes('semantic value'))).toBe(true);
  });

  it('differenceYenの算術不一致を検出する', () => {
    const d = link({});
    const p: PublishedLink = { linkId: 'l1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', sectionIds: [], projectIds: ['1'], mofAmountYen: 100, rsAmountYen: 50, differenceYen: 999 };
    const findings = checkLinksSemanticEquality(2024, 2024, [d], { links: [p] });
    expect(findings.some(f => f.message.includes('mofAmountYen-rsAmountYen'))).toBe(true);
  });

  it('manifestのprojectCount/sectionCountをpublished linksから独立再構成して検算する', () => {
    const p: PublishedLink = { linkId: 'l1', phase: 'initial', revision: null, matchMethod: 'exact-name-key', sectionIds: ['s1', 's2'], projectIds: ['1', '2'], mofAmountYen: 100, rsAmountYen: 100, differenceYen: 0 };
    const okFindings = checkLinksManifestSetCounts(2024, 2024, { links: [p] }, { linkGroupCount: 1, projectCount: 2, sectionCount: 2 });
    expect(okFindings).toHaveLength(0);
    const badFindings = checkLinksManifestSetCounts(2024, 2024, { links: [p] }, { linkGroupCount: 1, projectCount: 999, sectionCount: 2 });
    expect(badFindings.length).toBeGreaterThan(0);
  });
});

describe('checkRootManifestConsistency', () => {
  it('全sub-productが一致すればfindingsは空', () => {
    const root = { rs: [{ reviewYear: 2024, projectCount: 100 }], mof: [{ fiscalYear: 2024, sectionCount: 50 }], links: [{ reviewYear: 2024, fiscalYear: 2024, linkGroupCount: 10, projectCount: 5, sectionCount: 3 }] };
    const result = checkRootManifestConsistency(root, [{ reviewYear: 2024, projectCount: 100 }], [{ fiscalYear: 2024, sectionCount: 50 }], [{ reviewYear: 2024, fiscalYear: 2024, linkGroupCount: 10, projectCount: 5, sectionCount: 3 }]);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedProducts).toBe(3);
  });

  it('root manifestのrs projectCountがsub-productと不一致ならerror', () => {
    const root = { rs: [{ reviewYear: 2024, projectCount: 999 }], mof: [], links: [] };
    const result = checkRootManifestConsistency(root, [{ reviewYear: 2024, projectCount: 100 }], [], []);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe('readGzipJson（実際のgzip JSON fixtureを読む統合テスト）', () => {
  it('gzip圧縮したJSONを正しく展開して読める', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gzip-'));
    const filePath = path.join(tmpDir, 'sample.json.gz');
    const payload = { hello: 'world', count: 42 };
    fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8')));
    const result = readGzipJson<typeof payload>(filePath);
    expect(result).toEqual(payload);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ファイルが存在しなければnullを返す', () => {
    expect(readGzipJson('/nonexistent/path.json.gz')).toBeNull();
  });
});
