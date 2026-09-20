import { describe, it, expect } from 'vitest';
import {
  checkNoUnknownNonEmptyColumns, checkFundingRelationBlockReferences,
  checkExplicitZeroPreserved, checkMofRsLinkIntegrity,
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
});
