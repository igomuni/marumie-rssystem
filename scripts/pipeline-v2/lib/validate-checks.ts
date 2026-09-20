/**
 * Pipeline V2 validation層の個別チェックロジック。
 * 仕様: 20260920_Pipeline_V2_RS全情報・資金フロー拡張_実装仕様.md 11節、
 * 20260920_MOF_RS_Linkage先行検証_Sonnet引継ぎ.mdのValidation節。
 *
 * 原則: 差異を自動補正しない。既存データを壊さず、レポートとして可視化するだけ。
 */
import type {
  SourceInventory, RsSpendingBlockRecord, RsFundingRelationRecord,
  RsProjectSheetConflict, MofRsProjectLinkGroup, RsBudgetItemRecordV2, MofBudgetItemRecord,
} from '../types';

export interface Finding {
  severity: 'error' | 'warning' | 'info';
  check: string;
  message: string;
}

/** 11.2 no silent drop: unknown_nonempty（mapped/extra_preservedのどちらでもない非空列）はerror */
export function checkNoUnknownNonEmptyColumns(inventories: SourceInventory[]): Finding[] {
  const findings: Finding[] = [];
  for (const inv of inventories) {
    for (const col of inv.columns) {
      if (col.status !== 'mapped' && col.status !== 'extra_preserved' && col.nonEmptyCount > 0) {
        findings.push({
          severity: 'error',
          check: 'no-silent-drop',
          message: `${inv.datasetCode}(${inv.sourceYear}): 列「${col.column}」が非空(${col.nonEmptyCount}件)なのにmapped/extra_preservedのどちらでもない`,
        });
      }
    }
  }
  return findings;
}

/**
 * 11.3 5-1/5-2整合性: 5-2のsourceBlockId/targetBlockIdが同一事業の5-1に実在するかを検査する。
 * 実在しない場合はrs-funding-graph.tsのunresolvedRelationIdsとして既に可視化されるため、
 * ここではその整合性（blockName不一致含む）を独立に再検算し、二重の検証にする。
 */
export function checkFundingRelationBlockReferences(
  blocks: RsSpendingBlockRecord[], relations: RsFundingRelationRecord[]
): { findings: Finding[]; unresolvedCount: number; blockNameMismatchCount: number } {
  const blockKey = (projectId: string, blockId: string) => `${projectId}\x1f${blockId}`;
  const blockById = new Map<string, RsSpendingBlockRecord>();
  for (const b of blocks) blockById.set(blockKey(b.projectId, b.blockId), b);

  const findings: Finding[] = [];
  let unresolvedCount = 0;
  let blockNameMismatchCount = 0;
  for (const r of relations) {
    if (r.sourceBlockId) {
      const b = blockById.get(blockKey(r.projectId, r.sourceBlockId));
      if (!b) unresolvedCount++;
      else if (r.sourceBlockName && b.blockName && r.sourceBlockName !== b.blockName && !b.blockNames.includes(r.sourceBlockName)) {
        blockNameMismatchCount++;
      }
    }
    if (r.targetBlockId) {
      const b = blockById.get(blockKey(r.projectId, r.targetBlockId));
      if (!b) unresolvedCount++;
      else if (r.targetBlockName && b.blockName && r.targetBlockName !== b.blockName && !b.blockNames.includes(r.targetBlockName)) {
        blockNameMismatchCount++;
      }
    }
  }
  if (blockNameMismatchCount > 0) {
    findings.push({
      severity: 'info',
      check: '5-1-5-2-consistency',
      message: `5-2のブロック名表記が5-1の記録と${blockNameMismatchCount}件で異なる（原本の表記揺れ。断定せず情報として記録）`,
    });
  }
  return { findings, unresolvedCount, blockNameMismatchCount };
}

/** 11.5 explicit zero / blank: budgetAmountYenに明示的な0とnull（blank）が両方存在することを確認する
 *  （0円計上を「予算措置なし」と誤って消していないかの回帰チェック） */
export function checkExplicitZeroPreserved(items: RsBudgetItemRecordV2[]): Finding[] {
  const hasExplicitZero = items.some(r => r.budgetAmountYen === 0);
  const hasBlank = items.some(r => r.budgetAmountYen === null);
  const findings: Finding[] = [];
  if (items.length > 0 && !hasExplicitZero) {
    findings.push({ severity: 'warning', check: 'explicit-zero-preserved', message: 'budgetAmountYen=0の行が1件も無い（0円計上が消えていないか要確認）' });
  }
  if (items.length > 0 && !hasBlank) {
    findings.push({ severity: 'info', check: 'explicit-zero-preserved', message: 'budgetAmountYen=null（blank）の行が1件も無い' });
  }
  return findings;
}

/**
 * MOF↔RS linkageの整合性検査（MOF_RS_Linkage先行検証doc Validation節1-5）。
 * mofRecordIds/rsRecordIdsの実在確認、projectIdsの再構成一致、差額の整合、
 * 同一RS recordの複数link groupへの重複所属が無いことを検査する。
 */
export function checkMofRsLinkIntegrity(
  links: MofRsProjectLinkGroup[], mofItems: MofBudgetItemRecord[], rsItems: RsBudgetItemRecordV2[]
): Finding[] {
  const findings: Finding[] = [];
  const mofIds = new Set(mofItems.map(m => m.recordId));
  const rsById = new Map(rsItems.map(r => [r.recordId, r]));

  const rsRecordStageMembership = new Map<string, string[]>();
  for (const link of links) {
    for (const id of link.mofRecordIds) {
      if (!mofIds.has(id)) findings.push({ severity: 'error', check: 'mof-rs-link-integrity', message: `linkId=${link.linkId}: mofRecordId=${id}が実在しない` });
    }
    const actualProjectIds = new Set<string>();
    for (const id of link.rsRecordIds) {
      const r = rsById.get(id);
      if (!r) { findings.push({ severity: 'error', check: 'mof-rs-link-integrity', message: `linkId=${link.linkId}: rsRecordId=${id}が実在しない` }); continue; }
      actualProjectIds.add(r.projectId);
      const stageId = `${link.phase}:${link.revision ?? ''}`;
      const list = rsRecordStageMembership.get(`${id}\x1f${stageId}`) ?? [];
      list.push(link.linkId);
      rsRecordStageMembership.set(`${id}\x1f${stageId}`, list);
    }
    const expectedProjectIds = [...actualProjectIds].sort();
    if (JSON.stringify(link.projectIds) !== JSON.stringify(expectedProjectIds)) {
      findings.push({ severity: 'error', check: 'mof-rs-link-integrity', message: `linkId=${link.linkId}: projectIdsがrsRecordIdsから再構成した集合と不一致` });
    }
    if (link.mofAmountYen - link.rsAmountYen !== link.differenceYen) {
      findings.push({ severity: 'error', check: 'mof-rs-link-integrity', message: `linkId=${link.linkId}: mofAmountYen-rsAmountYen !== differenceYen` });
    }
  }
  for (const [key, linkIds] of rsRecordStageMembership) {
    if (linkIds.length > 1) {
      const [recordId] = key.split('\x1f');
      findings.push({ severity: 'error', check: 'mof-rs-link-integrity', message: `rsRecordId=${recordId}が同一stageで複数link group(${linkIds.join(',')})に重複所属している` });
    }
  }
  return findings;
}

/** project-sheet-conflicts.jsonlの件数をレポートするだけ（断定せず両方残す設計のため、自動補正しない） */
export function summarizeProjectSheetConflicts(conflicts: RsProjectSheetConflict[]): Finding[] {
  if (conflicts.length === 0) return [];
  const byField = new Map<string, number>();
  for (const c of conflicts) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
  return [{
    severity: 'info',
    check: 'sheets-download-csv-conflicts',
    message: `1-2とreview-sheetsの食い違い${conflicts.length}件（内訳: ${[...byField.entries()].map(([f, n]) => `${f}=${n}`).join(', ')}）。断定せず1-2側を優先したまま保持済み`,
  }];
}
