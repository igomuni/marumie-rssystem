import { describe, it, expect } from 'vitest';
import { buildFundingGraphsForYear } from './rs-funding-graph';
import type { RsSpendingBlockRecord, RsFundingRelationRecord, RsIndirectExpenseRecord } from '../types';
import type { RsProject } from './rs-projects';

const RS_BASE = {
  schemaVersion: 2 as const, sourceSystem: 'rs' as const, sourceYear: 2024, reviewYear: 2024, sheetType: '',
  projectIdRaw: '1', projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
};
const SRC = { domain: 'rssystem.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };

function block(pid: string, blockId: string): RsSpendingBlockRecord {
  return {
    ...RS_BASE, projectId: pid, recordType: 'rs_spending_block', nodeId: `project:${pid}:block:${blockId}`, blockId,
    blockName: `ブロック${blockId}`, blockNames: [], recipientCountValues: [], roles: [], totalAmountValuesYen: [],
    evidenceRowIds: [], sources: [], summaryRowCount: 1, extraFields: {},
  };
}

function relation(pid: string, sourceBlockId: string | null, targetBlockId: string, fromOrg: boolean | null = null): RsFundingRelationRecord {
  return {
    ...RS_BASE, projectId: pid, recordType: 'rs_funding_relation',
    relationId: `rel_${pid}_${sourceBlockId}_${targetBlockId}_${Math.random()}`,
    sourceBlockId, sourceBlockName: '', fromResponsibleOrganization: fromOrg, targetBlockId, targetBlockName: '',
    note: '', sourceRowId: 'row1', extraFields: {}, source: SRC,
  };
}

function project(pid: string): RsProject {
  return {
    ...RS_BASE, projectId: pid, recordType: 'rs_project', recordId: `rsproject_${pid}`, projectIdRawVariants: [pid],
    purpose: '', currentIssues: '', overview: '', overviewUrl: '', projectCategory: '', startYear: null, startYearUnknown: null,
    endYear: null, endYearRaw: '', noPlannedEnd: null, majorExpense: '', note: '',
    implementationMethods: { direct: null, subsidy: null, burden: null, grant: null, contribution: null, other: null },
    legacyProjectNumber: '', displayOrderRaw: '', extraFields: {}, officialProjectUrl: '', accountClass: '',
    sources: [SRC], sourceKinds: ['download-csv:1-2'],
  };
}

const NO_INDIRECT: RsIndirectExpenseRecord[] = [];

describe('buildFundingGraphsForYear: 一般有向グラフとして保持する', () => {
  it('循環（A→B→A）をhasCycle=trueとして保持し、削除しない', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A'), block('1', 'B')],
      [relation('1', 'A', 'B'), relation('1', 'B', 'A')],
      NO_INDIRECT, [project('1')]);
    expect(graphs[0].metrics.hasCycle).toBe(true);
    expect(graphs[0].semanticEdges).toHaveLength(2);
  });

  it('重複辺（同一source→target）を統合せず、duplicateRelationPairsとして記録する', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A'), block('1', 'B')],
      [relation('1', 'A', 'B'), relation('1', 'A', 'B')],
      NO_INDIRECT, [project('1')]);
    expect(graphs[0].semanticEdges).toHaveLength(1);
    expect(graphs[0].semanticEdges[0].evidenceCount).toBe(2);
    expect(graphs[0].metrics.duplicateRelationPairCount).toBe(1);
  });

  it('孤立ブロック（辺が無い）はorphanBlockIdsに記録する', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A'), block('1', 'B')],
      [relation('1', 'A', 'A')].filter(() => false), // 辺なし
      NO_INDIRECT, [project('1')]);
    expect(graphs[0].metrics.orphanBlockIds.sort()).toEqual(['A', 'B']);
  });

  it('担当組織からの支出（sourceBlockId空）は合成の担当組織ノードを作る', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A')],
      [relation('1', null, 'A', true)],
      NO_INDIRECT, [project('1')]);
    expect(graphs[0].metrics.hasResponsibleOrganizationRoot).toBe(true);
    expect(graphs[0].nodes.some(n => n.nodeType === 'responsible_organization')).toBe(true);
  });

  it('辺の金額は5-2に存在しないため常にnullのまま、amountStatusで明示する', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A'), block('1', 'B')], [relation('1', 'A', 'B')], NO_INDIRECT, [project('1')]);
    expect(graphs[0].semanticEdges[0].amountYen).toBeNull();
    expect(graphs[0].semanticEdges[0].amountStatus).toBe('not_provided_by_5-2');
  });

  it('sourceBlockIdもfromResponsibleOrganizationも無い行はunresolvedRelationIdsに記録する', () => {
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A')], [relation('1', null, 'A', null)], NO_INDIRECT, [project('1')]);
    expect(graphs[0].unresolvedRelationIds).toHaveLength(1);
    expect(graphs[0].semanticEdges).toHaveLength(0);
  });
});

describe('buildFundingGraphsForYear: rootNodeIds/externalRootBlockIds/orphanBlockIdsの区別', () => {
  it('担当組織1点から複数ブロックへ配る星型では、rootは担当組織ノード1個のみ（ブロック自体はrootでもorphanでもない）', () => {
    // FY2025 PID:1相当（8ブロックへ担当組織から配る構造）を単純化した固定fixture
    const blocks = [block('1', 'A'), block('1', 'B'), block('1', 'C')];
    const rels = blocks.map(b => relation('1', null, b.blockId, true));
    const { graphs } = buildFundingGraphsForYear(2024, blocks, rels, NO_INDIRECT, [project('1')]);
    const m = graphs[0].metrics;
    expect(m.rootNodeIds).toHaveLength(1);
    expect(m.rootNodeIds[0]).toBe(m.responsibleOrganizationNodeId);
    expect(m.externalRootBlockIds).toHaveLength(0);
    expect(m.orphanBlockIds).toHaveLength(0);
  });

  it('辺が一切無い複数ブロックは、全ブロックがrootNodeIdsかつorphanBlockIds（externalRootBlockIdsは0）', () => {
    // FY2025 PID:3339相当（30ブロック・relation 0件）を単純化した固定fixture
    const blocks = [block('1', 'A'), block('1', 'B'), block('1', 'C')];
    const { graphs } = buildFundingGraphsForYear(2024, blocks, [], NO_INDIRECT, [project('1')]);
    const m = graphs[0].metrics;
    expect(m.rootNodeIds).toHaveLength(3);
    expect(m.orphanBlockIds).toHaveLength(3);
    expect(m.externalRootBlockIds).toHaveLength(0);
  });

  it('他ブロックへ資金を渡すが自身は誰からも受け取らないブロックはexternalRootBlockIds（rootかつorphanではない）', () => {
    // FY2025 PID:2776相当（block-to-blockの単純な1辺）を単純化した固定fixture
    const { graphs } = buildFundingGraphsForYear(2024,
      [block('1', 'A'), block('1', 'B')], [relation('1', 'A', 'B')], NO_INDIRECT, [project('1')]);
    const m = graphs[0].metrics;
    expect(m.rootNodeIds).toEqual(['project:1:block:A']);
    expect(m.externalRootBlockIds).toEqual(['A']);
    expect(m.orphanBlockIds).toHaveLength(0);
  });
});
