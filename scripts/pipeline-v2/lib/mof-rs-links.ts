/**
 * MOF正規化済みbudget-items（初期・補正）とRS正規化済みbudget-items（2-2）を、
 * accountType+所管+組織/勘定+項+目の完全一致キーで突合する。
 * Python参照実装 pipeline_v2/derive.py の build_mof_rs_links と同じロジック。
 *
 * 断定しない設計: 1 natural keyに複数RS事業が乗る場合は1リンクグループとして
 * 金額を突合するのみで、個々のRS行とMOF行を1:1と断定しない。決算(settlement)は
 * このリンクに含めない（初期・補正のみ対象）。
 *
 * MOF突合キーにはRS側の`budgetMinistry`（2-2「所管」列）を使う。`ministry`
 * （共通列「府省庁」）で代用すると、府省庁≠所管の行（実データで過半数）で
 * リンクが成立しなくなる（2026-09-20の`budgetMinistry`分離と同じ理由）。
 */
import { normalizeText, stableId } from './stable-id';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsProjectLinkGroup, MofRsMatchEvidence } from '../types';

export type Stage = readonly [phase: 'initial' | 'supplement', revision: number | null];

export function stageKey(stage: Stage): string {
  return `${stage[0]}\x1f${stage[1] ?? ''}`;
}

export function mofKeyFrom(m: MofBudgetItemRecord): string | null {
  if (!m.sectionName || !m.subItemName) return null;
  let parts: string[];
  if (m.accountType === 'general') {
    parts = ['general', m.ministry ?? '', m.organization ?? '', m.sectionName, m.subItemName];
  } else if (m.accountType === 'special') {
    parts = ['special', m.ministry ?? '', m.specialAccount ?? '', m.subAccount ?? '', m.sectionName, m.subItemName];
  } else {
    return null;
  }
  return parts.map(normalizeText).join('|');
}

export function rsKeyFrom(r: RsBudgetItemRecordV2): string | null {
  if (!r.sectionName || !r.subItemName || !r.budgetMinistry) return null;
  let parts: string[];
  if (r.accountType === 'general') {
    parts = ['general', r.budgetMinistry, r.organizationOrAccount ?? '', r.sectionName, r.subItemName];
  } else if (r.accountType === 'special') {
    parts = ['special', r.budgetMinistry, r.account ?? '', r.subAccount ?? '', r.sectionName, r.subItemName];
  } else {
    return null;
  }
  return parts.map(normalizeText).join('|');
}

export function rsPhase(r: RsBudgetItemRecordV2): Stage | null {
  const bt = r.budgetType ?? '';
  if (bt === '当初予算') return ['initial', null];
  const m = /^第(\d+)次補正予算$/.exec(bt);
  if (m) return ['supplement', Number(m[1])];
  return null;
}

export interface MofRsLinkResult {
  links: MofRsProjectLinkGroup[];
  linkGroupCount: number;
  linkedRsRecordCount: number;
  unlinkedRsRecordCount: number;
  unsupportedBudgetTypeRecordCount: number;
  linkedProjectCount: number;
  mofAmountAcrossGroupsYen: number;
  rsAmountAcrossGroupsYen: number;
}

export function buildMofRsLinks(
  reviewYear: number, fiscalYear: number, mofRows: MofBudgetItemRecord[], rsRowsAllYears: RsBudgetItemRecordV2[]
): MofRsLinkResult {
  const rsRows = rsRowsAllYears.filter(r => r.fiscalYear === fiscalYear);

  // stage -> key -> mof rows（対象amountを付与済み）
  const mofMaps = new Map<string, Map<string, (MofBudgetItemRecord & { _linkAmountYen: number })[]>>();
  for (const m of mofRows) {
    let stage: Stage;
    let amount: number;
    if (m.phase === 'initial' && m.budgetStatus === 'enacted') {
      stage = ['initial', null];
      amount = m.amountYen ?? 0;
    } else if (m.phase === 'supplement') {
      stage = ['supplement', m.revision ?? 0];
      amount = m.supplementDeltaYen ?? 0;
    } else {
      continue;
    }
    const key = mofKeyFrom(m);
    if (!key) continue;
    const sk = stageKey(stage);
    if (!mofMaps.has(sk)) mofMaps.set(sk, new Map());
    const byKey = mofMaps.get(sk)!;
    const list = byKey.get(key) ?? [];
    list.push({ ...m, _linkAmountYen: amount });
    byKey.set(key, list);
  }

  const groupedRs = new Map<string, { stage: Stage; key: string; rows: RsBudgetItemRecordV2[] }>();
  let unlinked = 0;
  let unsupported = 0;
  for (const r of rsRows) {
    const stage = rsPhase(r);
    if (!stage) { unsupported++; continue; }
    const key = rsKeyFrom(r);
    if (!key) { unlinked++; continue; }
    const groupKey = `${stageKey(stage)}\x1f${key}`;
    const entry = groupedRs.get(groupKey) ?? { stage, key, rows: [] };
    entry.rows.push(r);
    groupedRs.set(groupKey, entry);
  }

  const links: MofRsProjectLinkGroup[] = [];
  let linkedRsRecords = 0;
  const sortedGroups = [...groupedRs.values()].sort((a, b) => {
    const ka = `${stageKey(a.stage)}\x1f${a.key}`;
    const kb = `${stageKey(b.stage)}\x1f${b.key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  for (const { stage, key, rows } of sortedGroups) {
    const mrows = mofMaps.get(stageKey(stage))?.get(key) ?? [];
    if (mrows.length === 0) { unlinked += rows.length; continue; }
    linkedRsRecords += rows.length;
    const rsAmount = rows.reduce((sum, r) => sum + (r.budgetAmountYen ?? 0), 0);
    const mofAmount = mrows.reduce((sum, m) => sum + (m._linkAmountYen ?? 0), 0);
    links.push({
      schemaVersion: 2,
      recordType: 'mof_rs_project_link_group',
      linkId: stableId([reviewYear, fiscalYear, stage[0], stage[1], key], 'mofrs_'),
      reviewYear,
      fiscalYear,
      phase: stage[0],
      revision: stage[1],
      matchMethod: 'exact-name-key',
      naturalKey: key,
      mofRecordIds: mrows.map(m => m.recordId).sort(),
      rsRecordIds: rows.map(r => r.recordId).sort(),
      projectIds: [...new Set(rows.map(r => r.projectId))].sort(),
      mofAmountYen: mofAmount,
      rsAmountYen: rsAmount,
      differenceYen: mofAmount - rsAmount,
      rsMatchEvidence: [...rows]
        .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0))
        .map((r): MofRsMatchEvidence => ({
          rsRecordId: r.recordId, projectId: r.projectId, method: 'exact-name-key', sourceField: 'structured-fields',
        })),
    });
  }

  return {
    links,
    linkGroupCount: links.length,
    linkedRsRecordCount: linkedRsRecords,
    unlinkedRsRecordCount: unlinked,
    unsupportedBudgetTypeRecordCount: unsupported,
    linkedProjectCount: new Set(links.flatMap(l => l.projectIds)).size,
    mofAmountAcrossGroupsYen: links.reduce((sum, l) => sum + l.mofAmountYen, 0),
    rsAmountAcrossGroupsYen: links.reduce((sum, l) => sum + l.rsAmountYen, 0),
  };
}
