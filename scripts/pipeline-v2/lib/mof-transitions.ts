/**
 * MOF段階間（提出→成立、当初→補正→決算）の項目同一性リンク生成。
 * derive-mof.tsから副作用の無い部分を切り出し、テスト可能にしたもの。
 * Python参照実装 pipeline_v2/derive.py の _semantic_item_key/_transition_links と同じロジック。
 */
import { normalizeText, stableId } from './stable-id';
import type { MofBudgetItemRecord, MofIdentityRelation } from '../types';

/** 項目の同一性キー（目コードを含まない。目コードは帳票によって役割が変わるため） */
export function semanticItemKey(row: Pick<MofBudgetItemRecord, 'sectionNaturalKey' | 'subItemName'>): string {
  return [row.sectionNaturalKey, normalizeText(row.subItemName)].join('|');
}

export interface TransitionStats {
  sourceRecords: number;
  targetRecords: number;
  linkedSourceRecords: number;
  linkedTargetRecords: number;
  unlinkedSourceRecords: number;
  unlinkedTargetRecords: number;
  relationCount: number;
}

/**
 * 2段階間の項目同一性リンクを作る。
 * 1. 完全一致キー（項自然キー+目名）で同一項目とみなす
 * 2. 完全一致で拾えなかった残りだけ、コードを含まない scope+項名+目名 キーで
 *    フォールバックする。ただし双方が単一の項に属す場合のみ（曖昧な場合は結合しない）
 */
export function transitionLinks(
  sourceRows: MofBudgetItemRecord[],
  targetRows: MofBudgetItemRecord[],
  sourceLabel: string,
  targetLabel: string
): { links: MofIdentityRelation[]; stats: TransitionStats } {
  const sourceExact = new Map<string, MofBudgetItemRecord[]>();
  const targetExact = new Map<string, MofBudgetItemRecord[]>();
  const sourceByName = new Map<string, MofBudgetItemRecord[]>();
  const targetByName = new Map<string, MofBudgetItemRecord[]>();
  const push = (map: Map<string, MofBudgetItemRecord[]>, key: string, row: MofBudgetItemRecord) => {
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  };
  for (const row of sourceRows) { push(sourceExact, semanticItemKey(row), row); push(sourceByName, row.scopeNameItemKey, row); }
  for (const row of targetRows) { push(targetExact, semanticItemKey(row), row); push(targetByName, row.scopeNameItemKey, row); }

  const links: MofIdentityRelation[] = [];
  const matchedSource = new Set<string>();
  const matchedTarget = new Set<string>();

  for (const key of [...sourceExact.keys()].filter(k => targetExact.has(k)).sort()) {
    const srows = sourceExact.get(key)!;
    const trows = targetExact.get(key)!;
    links.push({
      schemaVersion: 2,
      recordType: 'budget_item_relation',
      relationId: stableId([sourceLabel, targetLabel, 'exact', key], 'rel_'),
      sourceStage: sourceLabel,
      targetStage: targetLabel,
      relationType: 'same_item',
      evidenceMethod: 'exact-key',
      sourceRecordIds: srows.map(r => r.recordId).sort(),
      targetRecordIds: trows.map(r => r.recordId).sort(),
    });
    srows.forEach(r => matchedSource.add(r.recordId));
    trows.forEach(r => matchedTarget.add(r.recordId));
  }

  for (const key of [...sourceByName.keys()].filter(k => targetByName.has(k)).sort()) {
    const srows = (sourceByName.get(key) ?? []).filter(r => !matchedSource.has(r.recordId));
    const trows = (targetByName.get(key) ?? []).filter(r => !matchedTarget.has(r.recordId));
    if (srows.length === 0 || trows.length === 0) continue;
    const sourceSections = new Set(srows.map(r => r.sectionNaturalKey));
    const targetSections = new Set(trows.map(r => r.sectionNaturalKey));
    if (sourceSections.size !== 1 || targetSections.size !== 1) continue;
    links.push({
      schemaVersion: 2,
      recordType: 'budget_item_relation',
      relationId: stableId([sourceLabel, targetLabel, 'scope-name', key], 'rel_'),
      sourceStage: sourceLabel,
      targetStage: targetLabel,
      relationType: 'code_changed',
      evidenceMethod: 'same-scope-same-name',
      sourceRecordIds: srows.map(r => r.recordId).sort(),
      targetRecordIds: trows.map(r => r.recordId).sort(),
    });
    srows.forEach(r => matchedSource.add(r.recordId));
    trows.forEach(r => matchedTarget.add(r.recordId));
  }

  return {
    links,
    stats: {
      sourceRecords: sourceRows.length,
      targetRecords: targetRows.length,
      linkedSourceRecords: matchedSource.size,
      linkedTargetRecords: matchedTarget.size,
      unlinkedSourceRecords: sourceRows.length - matchedSource.size,
      unlinkedTargetRecords: targetRows.length - matchedTarget.size,
      relationCount: links.length,
    },
  };
}
