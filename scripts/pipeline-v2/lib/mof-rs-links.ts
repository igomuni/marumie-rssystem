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
import { stableId } from './stable-id';
import {
  type Stage, stageKey, mofKeyFrom, rsKeyFrom, rsPhase,
  evaluateSupplementalExact, selectSupplementalExactTier1Candidates,
} from './mof-rs-match-core';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsProjectLinkGroup, MofRsMatchEvidence, MofRsGroupMatchMethod, MofRsSupplementalResolution } from '../types';

// P1 matching primitive（Stage/stageKey/mofKeyFrom/rsKeyFrom/rsPhase）とP2 matching core
// （evaluateSupplementalExact/selectSupplementalExactTier1Candidates）はlib/mof-rs-match-core.ts
// へ集約した（P2 production昇格。55_sonnet-p2-tier1-production-activation-instructions.md）。
// production/validation双方が同じTier-1昇格条件を参照する（二重実装しない）。
// Stage/stageKey/mofKeyFrom/rsKeyFrom/rsPhaseは呼び出し元（mof-rs-links.test.ts等）との
// 後方互換のためここでも再exportする。
export type { Stage };
export { stageKey, mofKeyFrom, rsKeyFrom, rsPhase };

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

interface GroupEntry { row: RsBudgetItemRecordV2; evidence: MofRsMatchEvidence }

export function buildMofRsLinks(
  reviewYear: number, fiscalYear: number, mofRows: MofBudgetItemRecord[], rsRowsAllYears: RsBudgetItemRecordV2[]
): MofRsLinkResult {
  const rsRows = rsRowsAllYears.filter(r => r.fiscalYear === fiscalYear);
  const rsById = new Map(rsRows.map(r => [r.recordId, r]));

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

  const groupedRs = new Map<string, { stage: Stage; key: string; entries: GroupEntry[] }>();
  let unsupported = 0;

  // P1: 構造化key完全一致。missing-link-key（key===null）はここではunlinkedへ計上しない
  // （P2でlinkされる可能性があるため。最終的なunlinkedはsupported-linkedから算出する）
  for (const r of rsRows) {
    const stage = rsPhase(r);
    if (!stage) { unsupported++; continue; }
    const key = rsKeyFrom(r);
    if (!key) continue;
    const groupKey = `${stageKey(stage)}\x1f${key}`;
    const entry = groupedRs.get(groupKey) ?? { stage, key, entries: [] };
    entry.entries.push({ row: r, evidence: { rsRecordId: r.recordId, projectId: r.projectId, method: 'exact-name-key', sourceField: 'structured-fields' } });
    groupedRs.set(groupKey, entry);
  }

  // P2 Tier-1: supplementalInfoから復元したexplicit-scope-exact（無条件）・
  // pair-unique/rs-scope-resolved（safe target groupがexactの場合のみ）を、
  // 既存P1 groupへmerge、または無ければ新規groupとして追加する（1 MOF target = 1 link groupを維持）。
  // Tier-1判定はlib/mof-rs-match-core.tsのselectSupplementalExactTier1Candidates()に一本化されており、
  // ここで独自の昇格条件を再実装しない
  const { candidates } = evaluateSupplementalExact(mofRows, rsRows, fiscalYear);
  const tier1 = selectSupplementalExactTier1Candidates(candidates);
  for (const c of tier1) {
    const row = rsById.get(c.rsRecordId);
    if (!row) continue; // 通常発生しない（P2候補はrsRowsForYearから抽出されている）。防御的にskip
    const stage = rsPhase(row)!; // P2対象はrsPhase!==nullの行に限定済み（evaluateSupplementalExactのtargetRowsフィルタ）
    const groupKey = `${stageKey(stage)}\x1f${c.targetNaturalKey}`;
    const entry = groupedRs.get(groupKey) ?? { stage, key: c.targetNaturalKey, entries: [] };
    entry.entries.push({
      row,
      evidence: {
        rsRecordId: row.recordId, projectId: row.projectId, method: 'supplemental-exact', sourceField: 'supplementalInfo',
        resolution: c.targetResolution as MofRsSupplementalResolution, parseKind: c.parseKind,
      },
    });
    groupedRs.set(groupKey, entry);
  }

  const links: MofRsProjectLinkGroup[] = [];
  const linkedRecordIds = new Set<string>();
  const sortedGroups = [...groupedRs.values()].sort((a, b) => {
    const ka = `${stageKey(a.stage)}\x1f${a.key}`;
    const kb = `${stageKey(b.stage)}\x1f${b.key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  for (const { stage, key, entries } of sortedGroups) {
    const mrows = mofMaps.get(stageKey(stage))?.get(key) ?? [];
    if (mrows.length === 0) continue; // valid-key-no-match（P1）。P2はtargetが実在する前提のため通常ここに来ない
    for (const e of entries) linkedRecordIds.add(e.row.recordId);
    const rsAmount = entries.reduce((sum, e) => sum + (e.row.budgetAmountYen ?? 0), 0);
    const mofAmount = mrows.reduce((sum, m) => sum + (m._linkAmountYen ?? 0), 0);
    const sortedEntries = [...entries].sort((a, b) => (a.row.recordId < b.row.recordId ? -1 : a.row.recordId > b.row.recordId ? 1 : 0));
    const methods = new Set(entries.map(e => e.evidence.method));
    const matchMethod: MofRsGroupMatchMethod = methods.size > 1 ? 'mixed' : [...methods][0];
    links.push({
      schemaVersion: 2,
      recordType: 'mof_rs_project_link_group',
      linkId: stableId([reviewYear, fiscalYear, stage[0], stage[1], key], 'mofrs_'),
      reviewYear,
      fiscalYear,
      phase: stage[0],
      revision: stage[1],
      matchMethod,
      naturalKey: key,
      mofRecordIds: mrows.map(m => m.recordId).sort(),
      rsRecordIds: sortedEntries.map(e => e.row.recordId),
      projectIds: [...new Set(entries.map(e => e.row.projectId))].sort(),
      mofAmountYen: mofAmount,
      rsAmountYen: rsAmount,
      differenceYen: mofAmount - rsAmount,
      rsMatchEvidence: sortedEntries.map(e => e.evidence),
    });
  }

  const supportedCount = rsRows.length - unsupported;
  const linkedRsRecordCount = linkedRecordIds.size;

  return {
    links,
    linkGroupCount: links.length,
    linkedRsRecordCount,
    unlinkedRsRecordCount: supportedCount - linkedRsRecordCount,
    unsupportedBudgetTypeRecordCount: unsupported,
    linkedProjectCount: new Set(links.flatMap(l => l.projectIds)).size,
    mofAmountAcrossGroupsYen: links.reduce((sum, l) => sum + l.mofAmountYen, 0),
    rsAmountAcrossGroupsYen: links.reduce((sum, l) => sum + l.rsAmountYen, 0),
  };
}
