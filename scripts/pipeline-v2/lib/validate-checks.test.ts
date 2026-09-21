import { describe, it, expect } from 'vitest';
import {
  checkNoUnknownNonEmptyColumns, checkFundingRelationBlockReferences,
  checkExplicitZeroPreserved, checkMofRsLinkIntegrity, compareLinkBaseline, decideExitFailure,
  checkDerivedArtifactPresence,
  type Finding,
} from './validate-checks';
import type { SourceInventory, RsSpendingBlockRecord, RsFundingRelationRecord, RsBudgetItemRecordV2, MofBudgetItemRecord, MofRsProjectLinkGroup } from '../types';

function inventory(columns: SourceInventory['columns']): SourceInventory {
  return { datasetCode: '1-1', datasetName: 'd', sourceYear: 2024, path: 'x', zipEntry: 'x.csv', rowCount: 1, columnCount: columns.length, headerSha256: '', columns };
}

describe('checkNoUnknownNonEmptyColumns', () => {
  it('mapped/extra_preservedのみならfindingsは空', () => {
    const findings = checkNoUnknownNonEmptyColumns([inventory([
      { column: 'a', nonEmptyCount: 1, status: 'mapped' },
      { column: 'b', nonEmptyCount: 1, status: 'extra_preserved' },
      { column: 'c', nonEmptyCount: 0, status: 'empty_unmapped' },
    ])]);
    expect(findings).toHaveLength(0);
  });

  it('mapped/extra_preservedのどちらでもない非空列があればerror', () => {
    const findings = checkNoUnknownNonEmptyColumns([inventory([
      { column: 'x', nonEmptyCount: 5, status: 'unknown_nonempty' as SourceInventory['columns'][number]['status'] },
    ])]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('RS SourceInventory.sourceYearはreview yearであり、根拠のないscope.fiscalYearを付けない（Stage A review fix）', () => {
    const findings = checkNoUnknownNonEmptyColumns([inventory([
      { column: 'x', nonEmptyCount: 5, status: 'unknown_nonempty' as SourceInventory['columns'][number]['status'] },
    ])]);
    expect(findings[0].scope?.fiscalYear).toBeUndefined();
    expect(findings[0].metrics).toMatchObject({ sourceYear: 2024 });

    // 呼び出し元validateRsYear()のwithReviewYear()相当の合成を再現し、
    // reviewYearだけが付与されfiscalYearは付与されないことを確認する
    const reviewYear = 2024;
    const withScope = { ...findings[0], scope: { ...findings[0].scope, reviewYear } };
    expect(withScope.scope.reviewYear).toBe(2024);
    expect(withScope.scope.fiscalYear).toBeUndefined();
  });
});

const RS_BASE = {
  schemaVersion: 2 as const, sourceSystem: 'rs' as const, sourceYear: 2024, reviewYear: 2024, sheetType: '',
  projectIdRaw: '1', projectName: 'X', policyMinistry: '', ministry: 'A省', bureau: '', department: '', division: '', office: '', team: '', unit: '', ministryOrderRaw: '',
};
const SRC = { domain: 'rssystem.go.jp' as const, path: 'x', file: 'x.csv', dataset: 'd', year: 2024 };

function block(blockId: string, blockName = ''): RsSpendingBlockRecord {
  return { ...RS_BASE, projectId: '1', recordType: 'rs_spending_block', nodeId: `project:1:block:${blockId}`, blockId, blockName, blockNames: [blockName], recipientCountValues: [], roles: [], totalAmountValuesYen: [], evidenceRowIds: [], sources: [], summaryRowCount: 1, extraFields: {} };
}
function relation(sourceBlockId: string | null, targetBlockId: string, targetBlockName = ''): RsFundingRelationRecord {
  return { ...RS_BASE, projectId: '1', recordType: 'rs_funding_relation', relationId: 'rel1', sourceBlockId, sourceBlockName: '', fromResponsibleOrganization: null, targetBlockId, targetBlockName, note: '', sourceRowId: 'r1', extraFields: {}, source: SRC };
}

describe('checkFundingRelationBlockReferences', () => {
  it('参照先ブロックが5-1に実在すればunresolvedCount=0', () => {
    const { unresolvedCount } = checkFundingRelationBlockReferences([block('A'), block('B')], [relation('A', 'B')]);
    expect(unresolvedCount).toBe(0);
  });

  it('5-1に存在しないblockIdを参照する行はunresolvedCountに計上する', () => {
    const { unresolvedCount } = checkFundingRelationBlockReferences([block('A')], [relation('A', 'B-not-exist')]);
    expect(unresolvedCount).toBe(1);
  });

  it('ブロック名の表記が5-1と異なる場合はinfoとして記録する（断定・補正しない）', () => {
    const { findings } = checkFundingRelationBlockReferences([block('A'), block('B', 'ブロックB')], [relation('A', 'B', '別名のブロックB')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });
});

describe('checkExplicitZeroPreserved', () => {
  it('明示的な0とblank(null)が両方存在すればfindingsは空', () => {
    const items = [{ budgetAmountYen: 0 } as RsBudgetItemRecordV2, { budgetAmountYen: null } as RsBudgetItemRecordV2];
    expect(checkExplicitZeroPreserved(items)).toHaveLength(0);
  });

  it('明示的な0が1件も無ければwarning', () => {
    const items = [{ budgetAmountYen: 100 } as RsBudgetItemRecordV2, { budgetAmountYen: null } as RsBudgetItemRecordV2];
    const findings = checkExplicitZeroPreserved(items);
    expect(findings.some(f => f.severity === 'warning')).toBe(true);
  });
});

describe('checkMofRsLinkIntegrity', () => {
  const mofItem = { recordId: 'mof1' } as MofBudgetItemRecord;
  const rsItem = { recordId: 'rs1', projectId: '1' } as RsBudgetItemRecordV2;
  const validLink: MofRsProjectLinkGroup = {
    schemaVersion: 2, recordType: 'mof_rs_project_link_group', linkId: 'l1', reviewYear: 2024, fiscalYear: 2024,
    phase: 'initial', revision: null, matchMethod: 'exact-name-key', naturalKey: 'k', mofRecordIds: ['mof1'],
    rsRecordIds: ['rs1'], projectIds: ['1'], mofAmountYen: 100, rsAmountYen: 90, differenceYen: 10,
  };

  it('全て整合していればfindingsは空', () => {
    expect(checkMofRsLinkIntegrity([validLink], [mofItem], [rsItem])).toHaveLength(0);
  });

  it('存在しないmofRecordIdを参照していればerror', () => {
    const link = { ...validLink, mofRecordIds: ['mof-not-exist'] };
    const findings = checkMofRsLinkIntegrity([link], [mofItem], [rsItem]);
    expect(findings.some(f => f.severity === 'error' && f.message.includes('mofRecordId'))).toBe(true);
  });

  it('differenceYenがmofAmountYen-rsAmountYenと一致しなければerror', () => {
    const link = { ...validLink, differenceYen: 999 };
    const findings = checkMofRsLinkIntegrity([link], [mofItem], [rsItem]);
    expect(findings.some(f => f.message.includes('differenceYen'))).toBe(true);
  });

  it('同一RS recordが同一stageで複数link groupに重複所属していればerror', () => {
    const link2 = { ...validLink, linkId: 'l2', naturalKey: 'k2' };
    const findings = checkMofRsLinkIntegrity([validLink, link2], [mofItem], [rsItem]);
    expect(findings.some(f => f.message.includes('重複所属'))).toBe(true);
  });

  it('invariant violationはcategory=invariantかつstructured scope/metricsを持つ（Stage A）', () => {
    const link = { ...validLink, differenceYen: 999 };
    const findings = checkMofRsLinkIntegrity([link], [mofItem], [rsItem]);
    const finding = findings.find(f => f.message.includes('differenceYen'))!;
    expect(finding.category).toBe('invariant');
    expect(finding.scope?.linkId).toBe('l1');
    expect(finding.metrics).toMatchObject({ mofAmountYen: 100, rsAmountYen: 90, differenceYen: 999, expectedDifferenceYen: 10 });
  });

  it('重複所属findingはrecordIdをscopeに、重複先linkIdをsampleIdsに持つ（Stage A）', () => {
    const link2 = { ...validLink, linkId: 'l2', naturalKey: 'k2' };
    const findings = checkMofRsLinkIntegrity([validLink, link2], [mofItem], [rsItem]);
    const finding = findings.find(f => f.message.includes('重複所属'))!;
    expect(finding.scope?.recordId).toBe('rs1');
    expect(finding.sampleIds).toEqual(['l1', 'l2']);
  });
});

describe('compareLinkBaseline（Stage A: baseline driftとinvariantの分離）', () => {
  const scope = { reviewYear: 2025, fiscalYear: 2024 };

  it('baselineと一致すればfindingsは空', () => {
    const golden = { linkGroupCount: 100, mofAmountAcrossGroupsYen: 5000 };
    const summary = { linkGroupCount: 100, mofAmountAcrossGroupsYen: 5000 };
    expect(compareLinkBaseline(golden, summary, scope)).toHaveLength(0);
  });

  it('baselineと不一致ならcategory=baseline-drift・severity=warning（errorではない）', () => {
    const golden = { linkGroupCount: 100 };
    const summary = { linkGroupCount: 102 };
    const findings = compareLinkBaseline(golden, summary, scope);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('baseline-drift');
    expect(findings[0].scope).toEqual(scope);
    expect(findings[0].metrics).toMatchObject({ key: 'linkGroupCount', expected: 100, actual: 102 });
  });
});

describe('decideExitFailure（Stage A: exit codeはerrorのみに連動）', () => {
  const invariantError: Finding = { severity: 'error', check: 'x', category: 'invariant', message: 'x' };
  const baselineDrift: Finding = { severity: 'warning', check: 'y', category: 'baseline-drift', message: 'y' };
  const info: Finding = { severity: 'info', check: 'z', message: 'z' };

  it('invariant違反（error）があれば常に失敗', () => {
    expect(decideExitFailure([invariantError])).toBe(true);
    expect(decideExitFailure([invariantError], { strictBaseline: false })).toBe(true);
  });

  it('baseline driftのみでは既定では失敗にしない', () => {
    expect(decideExitFailure([baselineDrift, info])).toBe(false);
  });

  it('--strict-baseline相当（strictBaseline:true）ならbaseline driftも失敗にする', () => {
    expect(decideExitFailure([baselineDrift], { strictBaseline: true })).toBe(true);
  });

  it('findingsが空、またはinfoのみなら失敗にしない', () => {
    expect(decideExitFailure([])).toBe(false);
    expect(decideExitFailure([info], { strictBaseline: true })).toBe(false);
  });
});

describe('checkDerivedArtifactPresence（Stage B/C共通のorchestration gap対策）', () => {
  it('sourceにレコードがありartifactも存在すればfindingsは空（RS想定）', () => {
    expect(checkDerivedArtifactPresence('rs-derived-artifact-presence', 153404, true, { reviewYear: 2024 })).toHaveLength(0);
  });

  it('sourceにレコードがあるのにartifactが存在しなければinvariant error（RS想定）', () => {
    const findings = checkDerivedArtifactPresence('rs-derived-artifact-presence', 153404, false, { reviewYear: 2024 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].category).toBe('invariant');
    expect(findings[0].check).toBe('rs-derived-artifact-presence');
    expect(findings[0].scope).toEqual({ reviewYear: 2024 });
  });

  it('sourceにレコードがあるのにartifactが存在しなければinvariant error（MOF想定）', () => {
    const findings = checkDerivedArtifactPresence('mof-derived-artifact-presence', 8358, false, { fiscalYear: 2024 });
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('mof-derived-artifact-presence');
    expect(findings[0].metrics).toMatchObject({ sourceRecordCount: 8358 });
  });

  it('sourceが0件ならartifact不存在でもfindingsは空（対象年度がまだ無いだけのケース）', () => {
    expect(checkDerivedArtifactPresence('rs-derived-artifact-presence', 0, false, { reviewYear: 2026 })).toHaveLength(0);
  });
});
