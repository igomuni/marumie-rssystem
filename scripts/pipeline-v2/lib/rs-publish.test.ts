import { describe, it, expect } from 'vitest';
import {
  compactRsProject, compactRsBudgetSummary, compactRsFundingGraph, compactPolicy, compactNote,
  compactMultiYearContract, compactMofRsLink, computeDroppedFieldsReport,
} from './rs-publish';
import type { RsBudgetSummaryRecord, RsFundingGraph, RsPolicyLawRelation, RsProjectNote, RsMultiYearContract, MofRsProjectLinkGroup } from '../types';
import type { RsProject } from './rs-projects';

const SRC = { domain: 'rssystem.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };
const RS_BASE = {
  schemaVersion: 2 as const, sourceSystem: 'rs' as const, sourceYear: 2024, reviewYear: 2024, sheetType: '', projectId: '1', projectIdRaw: '1',
  projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
};

describe('compactRsProject', () => {
  it('projectId等の共通列は残しつつ内部専用フィールド（recordId/sources等）は落とす', () => {
    const project: RsProject = {
      ...RS_BASE, recordType: 'rs_project', recordId: 'rsproject_1', projectIdRawVariants: ['1'], purpose: '目的', currentIssues: '',
      overview: '', overviewUrl: '', projectCategory: '', startYear: 2020, startYearUnknown: null, endYear: null, endYearRaw: '',
      noPlannedEnd: null, majorExpense: '', note: '', implementationMethods: { direct: true, subsidy: null, burden: null, grant: null, contribution: null, other: null },
      legacyProjectNumber: '', displayOrderRaw: '', extraFields: {}, officialProjectUrl: 'https://example.com', accountClass: '一般会計',
      sources: [SRC], sourceKinds: ['download-csv:1-2'],
    };
    const out = compactRsProject(project);
    expect(out.projectId).toBe('1');
    expect(out.purpose).toBe('目的');
    expect(out.officialProjectUrl).toBe('https://example.com');
    expect(out).not.toHaveProperty('recordId');
    expect(out).not.toHaveProperty('sources');
    expect(out).not.toHaveProperty('extraFields');
  });
});

describe('compactRsBudgetSummary', () => {
  it('amountsからnullを除去し、0は残す', () => {
    const row: RsBudgetSummaryRecord = {
      ...RS_BASE, recordType: 'rs_budget_summary', recordId: 'rssum_1', fiscalYear: 2024, scopeLevel: 'account', accountType: 'general',
      accountClass: '一般会計', account: '一般会計', subAccount: '', executionRateRaw: '', changeReason: '', specialNotes: '', note: '',
      amounts: { '当初予算': 100, '補正予算': 0, '執行額': null }, extraFields: {}, source: SRC,
    };
    const out = compactRsBudgetSummary(row);
    expect(out.amounts).toEqual({ '当初予算': 100, '補正予算': 0 });
  });
});

describe('compactRsFundingGraph', () => {
  it('診断情報（rootNodeIds/externalRootBlockIds/orphanBlockIds/cyclicComponents）とunresolved/duplicateを保持する', () => {
    const graph: RsFundingGraph = {
      schemaVersion: 2, recordType: 'rs_funding_graph', reviewYear: 2024, sourceYear: 2024, projectId: '1', projectName: 'X', ministry: 'A省',
      nodes: [], semanticEdges: [], unresolvedRelationIds: ['rel1'], unresolvedRelationDetails: [],
      metrics: {
        blockCount: 1, nodeCount: 1, relationEvidenceCount: 0, semanticEdgeCount: 0, indirectExpenseCount: 0,
        responsibleOrganizationNodeId: null, hasResponsibleOrganizationRoot: false, rootNodeIds: ['n1'], externalRootBlockIds: [],
        orphanBlockIds: ['n1'], duplicateRelationPairCount: 0, duplicateRelationEvidenceExtraCount: 0, hasCycle: false,
        cyclicComponents: [], weakComponentCount: 1, weakComponentSizes: [1], maxOutDegree: 0, maxInDegree: 0,
        sameNameMultipleBlocks: [], unresolvedRelationEvidenceCount: 1,
      },
      duplicateRelationPairs: [],
    };
    const out = compactRsFundingGraph(graph);
    expect(out.metrics).toMatchObject({ rootNodeIds: ['n1'], orphanBlockIds: ['n1'] });
    expect(out.unresolvedRelationIds).toEqual(['rel1']);
    expect(out.duplicateRelationPairs).toEqual([]);
    // 回帰テスト: cyclicComponents=[]（循環無しという確定した検証結果）はpick()のmeaningful()
    // フィルタで空配列として落とされ、UI側でmetrics.cyclicComponents.flat()がundefined参照で
    // クラッシュするバグを実機（Playwright）で検出した。空配列でもキー自体は必ず残す
    expect(out.metrics).toHaveProperty('cyclicComponents');
    expect((out.metrics as { cyclicComponents: unknown[] }).cyclicComponents).toEqual([]);
  });

  it('nodes/edgesも空配列フィールド（nameVariants/roles/noteVariants等）を落とさない', () => {
    const graph: RsFundingGraph = {
      schemaVersion: 2, recordType: 'rs_funding_graph', reviewYear: 2024, sourceYear: 2024, projectId: '1', projectName: 'X', ministry: 'A省',
      nodes: [{ nodeId: 'n1', nodeType: 'spending_block', blockId: 'A', name: 'A', nameVariants: [], roles: [], recipientCountValues: [], totalAmountValuesYen: [], evidenceRowIds: [], summaryRowCount: 0 }],
      semanticEdges: [{ edgeId: 'e1', sourceNodeId: 'n1', targetNodeId: 'n1', amountYen: null, amountStatus: 'not_provided_by_5-2', evidenceRelationIds: [], evidenceCount: 0, noteVariants: [], sourceNameVariants: [], targetNameVariants: [], fromResponsibleOrganizationValues: [] }],
      unresolvedRelationIds: [], unresolvedRelationDetails: [],
      metrics: {
        blockCount: 1, nodeCount: 1, relationEvidenceCount: 0, semanticEdgeCount: 1, indirectExpenseCount: 0,
        responsibleOrganizationNodeId: null, hasResponsibleOrganizationRoot: false, rootNodeIds: [], externalRootBlockIds: [],
        orphanBlockIds: [], duplicateRelationPairCount: 0, duplicateRelationEvidenceExtraCount: 0, hasCycle: false,
        cyclicComponents: [], weakComponentCount: 1, weakComponentSizes: [1], maxOutDegree: 0, maxInDegree: 0,
        sameNameMultipleBlocks: [], unresolvedRelationEvidenceCount: 0,
      },
      duplicateRelationPairs: [],
    };
    const out = compactRsFundingGraph(graph) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    expect(out.nodes[0]).toHaveProperty('nameVariants');
    expect(out.nodes[0]).toHaveProperty('roles');
    expect(out.edges[0]).toHaveProperty('noteVariants');
    expect(out.edges[0]).toHaveProperty('evidenceRelationIds');
  });
});

describe('compactPolicy: 空のプレースホルダー行を除外する', () => {
  it('政策・施策・法令・計画のいずれも無ければnullを返す', () => {
    const row: RsPolicyLawRelation = {
      ...RS_BASE, recordType: 'rs_policy_law_relation', recordId: 'rspol_1', policyMeasureNo: '', policyOwnerMinistry: '', policy: '',
      measure: '', policyMeasureUrl: '', lawNo: '', lawName: '', lawNumber: '', lawId: '', article: '', paragraph: '', item: '',
      planNo: '', planName: '', planUrl: '', extraFields: {}, source: SRC,
    };
    expect(compactPolicy(row)).toBeNull();
  });
});

describe('compactNote: noteが空ならnull', () => {
  it('note空文字はnull', () => {
    const row = { note: '' } as RsProjectNote;
    expect(compactNote(row)).toBeNull();
  });
});

describe('compactMultiYearContract: hasContract=falseならnull', () => {
  it('契約情報が無いプレースホルダー行を除外する', () => {
    const row = { hasContract: false } as RsMultiYearContract;
    expect(compactMultiYearContract(row)).toBeNull();
  });
});

describe('compactMofRsLink: link groupが複数事業を束ねる意味論を保持する', () => {
  it('projectIds/projectCountを保持する（1 link groupが複数RS事業を束ねることがあるため）', () => {
    const link: MofRsProjectLinkGroup = {
      schemaVersion: 2, recordType: 'mof_rs_project_link_group', linkId: 'l1', reviewYear: 2025, fiscalYear: 2024,
      phase: 'initial', revision: null, matchMethod: 'exact-name-key', naturalKey: 'k',
      mofRecordIds: ['mof1'], rsRecordIds: ['rs1', 'rs2'], projectIds: ['1', '2'],
      mofAmountYen: 100, rsAmountYen: 90, differenceYen: 10, rsMatchEvidence: [],
    };
    const out = compactMofRsLink(link);
    expect(out.projectIds).toEqual(['1', '2']);
    expect(out.projectCount).toBe(2);
    expect(out.mofAmountYen).toBe(100);
    expect(out).not.toHaveProperty('naturalKey');
    expect(out).not.toHaveProperty('mofRecordIds');
    expect(out).not.toHaveProperty('rsRecordIds');
    expect(out).not.toHaveProperty('matchMethod');
  });
});

describe('computeDroppedFieldsReport', () => {
  it('funding-graph.edgesは全フィールド保持する', () => {
    const report = computeDroppedFieldsReport().find(r => r.dataset === 'funding-graph.edges');
    expect(report?.droppedFields).toEqual([]);
  });

  it('各レポートのkeptFieldsはsourceFieldsの部分集合である', () => {
    for (const report of computeDroppedFieldsReport()) {
      for (const f of report.keptFields) expect(report.sourceFields).toContain(f);
    }
  });
});
