/**
 * Pipeline V2 Validator Hardening Stage D: MOF↔RS linkage diagnostics。
 * 「リンク件数が現在値と同じか」ではなく「なぜリンクした／しなかったのか」「差額がどの種類か」
 * 「安全に改善できそうな候補があるか」をmachine-readableに診断する。
 *
 * 原則: 診断のみ。production linkage algorithm（lib/mof-rs-links.tsのbuildMofRsLinks）・
 * Normalized/Derived/Publishは一切変更しない。差額はerrorにしない（source-semantics/
 * allocation差が実在するため。09_validator-hardening-plan.md D-3参照）。
 *
 * D-1（unlinked reason taxonomy）はbuildMofRsLinks()と同じ分類境界を再現する必要がある
 * （「なぜこの行がunlinkedか」を独立に別基準で判定すると診断そのものが虚偽になるため）。
 * そのため`mofKeyFrom`/`rsKeyFrom`/`rsPhase`/`stageKey`はlib/mof-rs-links.tsからimportして
 * 再利用する（Stage CでのsemanticItemKey非再利用とは性質が異なる。あちらは独立検算の
 * invariantチェック、こちらはproductionの実際の分類境界を説明する診断）。
 */
import { mofKeyFrom, rsKeyFrom, rsPhase, stageKey, type Stage } from '../mof-rs-links';
import { normalizeText } from '../stable-id';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsProjectLinkGroup } from '../../types';
import type { Finding } from '../validate-checks';

export interface UnlinkedReasonBucket { recordCount: number; amountYen: number }

/**
 * D-1: unlinked reason taxonomy。buildMofRsLinks()と同じ判定順序・同じkey生成で
 * RS recordをunsupported-budget-type/missing-link-key/valid-key-no-matchに分類する。
 */
export function classifyUnlinkedReasons(
  mofRows: MofBudgetItemRecord[], rsRowsForYear: RsBudgetItemRecordV2[]
): {
  findings: Finding[];
  linkedRecordCount: number;
  unsupportedBudgetType: UnlinkedReasonBucket;
  missingLinkKey: UnlinkedReasonBucket & { missingFieldCounts: Record<string, number> };
  validKeyNoMatch: UnlinkedReasonBucket;
} {
  const mofGroupKeys = new Set<string>();
  for (const m of mofRows) {
    let stage: Stage;
    if (m.phase === 'initial' && m.budgetStatus === 'enacted') stage = ['initial', null];
    else if (m.phase === 'supplement') stage = ['supplement', m.revision ?? 0];
    else continue;
    const key = mofKeyFrom(m);
    if (!key) continue;
    mofGroupKeys.add(`${stageKey(stage)}\x1f${key}`);
  }

  let linkedRecordCount = 0;
  const unsupportedBudgetType: UnlinkedReasonBucket = { recordCount: 0, amountYen: 0 };
  const missingLinkKey: UnlinkedReasonBucket & { missingFieldCounts: Record<string, number> } = { recordCount: 0, amountYen: 0, missingFieldCounts: {} };
  const validKeyNoMatch: UnlinkedReasonBucket = { recordCount: 0, amountYen: 0 };

  const bumpMissingField = (field: string) => { missingLinkKey.missingFieldCounts[field] = (missingLinkKey.missingFieldCounts[field] ?? 0) + 1; };

  for (const r of rsRowsForYear) {
    const amount = r.budgetAmountYen ?? 0;
    const stage = rsPhase(r);
    if (!stage) { unsupportedBudgetType.recordCount++; unsupportedBudgetType.amountYen += amount; continue; }

    const key = rsKeyFrom(r);
    if (!key) {
      missingLinkKey.recordCount++; missingLinkKey.amountYen += amount;
      if (!r.budgetMinistry) bumpMissingField('budgetMinistry');
      if (!r.sectionName) bumpMissingField('sectionName');
      if (!r.subItemName) bumpMissingField('subItemName');
      continue;
    }

    if (mofGroupKeys.has(`${stageKey(stage)}\x1f${key}`)) { linkedRecordCount++; continue; }
    validKeyNoMatch.recordCount++; validKeyNoMatch.amountYen += amount;
  }

  return { findings: [], linkedRecordCount, unsupportedBudgetType, missingLinkKey, validKeyNoMatch };
}

export interface JointMinistryFallbackCandidate {
  rsRecordId: string; projectId: string;
  existingRsAmountYen: number; candidateRsAmountYen: number; reconstructedRsAmountYen: number;
  mofAmountYen: number; differenceBeforeYen: number; differenceAfterYen: number; exactReconciliation: boolean;
}

/** rsKeyFrom()と同じ構造だが、budgetMinistryの代わりに指定したministryを使う（診断専用の候補key生成） */
function rsKeyWithMinistry(r: RsBudgetItemRecordV2, ministry: string): string | null {
  if (!r.sectionName || !r.subItemName || !ministry) return null;
  let parts: string[];
  if (r.accountType === 'general') parts = ['general', ministry, r.organizationOrAccount ?? '', r.sectionName, r.subItemName];
  else if (r.accountType === 'special') parts = ['special', ministry, r.account ?? '', r.subAccount ?? '', r.sectionName, r.subItemName];
  else return null;
  return parts.map(normalizeText).join('|');
}

/**
 * D-2: strict joint-ministry fallback diagnostic。production linkには適用しない。
 * primary(budgetMinistry) exactで未接続のRS recordについて、common `ministry`に
 * 差し替えた場合にのみ一意なMOF targetへ接続できる候補を診断する。
 */
export function diagnoseJointMinistryFallback(
  reviewYear: number, fiscalYear: number, mofRows: MofBudgetItemRecord[], rsRowsForYear: RsBudgetItemRecordV2[]
): { findings: Finding[]; candidates: JointMinistryFallbackCandidate[] } {
  const findings: Finding[] = [];

  // MOF側: stage+key -> 合算金額（buildMofRsLinksの_linkAmountYenと同じ定義）
  const mofAmountByGroup = new Map<string, number>();
  for (const m of mofRows) {
    let stage: Stage;
    let amount: number;
    if (m.phase === 'initial' && m.budgetStatus === 'enacted') { stage = ['initial', null]; amount = m.amountYen ?? 0; }
    else if (m.phase === 'supplement') { stage = ['supplement', m.revision ?? 0]; amount = m.supplementDeltaYen ?? 0; }
    else continue;
    const key = mofKeyFrom(m);
    if (!key) continue;
    const groupKey = `${stageKey(stage)}\x1f${key}`;
    mofAmountByGroup.set(groupKey, (mofAmountByGroup.get(groupKey) ?? 0) + amount);
  }

  // RS側: 実際にlinkが成立する（primary keyがMOF groupに存在する）行を、stage+primary keyでグループ化
  // → 「altKeyが既存link groupと一致するか」を判定するのに使う（existingRsAmountYen）
  const rsLinkedAmountByGroup = new Map<string, number>();
  for (const r of rsRowsForYear) {
    const stage = rsPhase(r);
    if (!stage) continue;
    const key = rsKeyFrom(r);
    if (!key) continue;
    const groupKey = `${stageKey(stage)}\x1f${key}`;
    if (!mofAmountByGroup.has(groupKey)) continue; // 未接続なのでこの合算には含めない
    rsLinkedAmountByGroup.set(groupKey, (rsLinkedAmountByGroup.get(groupKey) ?? 0) + (r.budgetAmountYen ?? 0));
  }

  const candidates: JointMinistryFallbackCandidate[] = [];
  for (const r of rsRowsForYear) {
    const stage = rsPhase(r);
    if (!stage) continue;
    const primaryKey = rsKeyFrom(r);
    if (primaryKey) {
      const primaryGroupKey = `${stageKey(stage)}\x1f${primaryKey}`;
      if (mofAmountByGroup.has(primaryGroupKey)) continue; // 既にprimaryでlink済み
    }
    // primaryがmissing-link-keyまたはvalid-key-no-matchの行のみ対象
    if (!r.ministry || r.ministry === r.budgetMinistry) continue; // 差し替える意味が無い
    const altKey = rsKeyWithMinistry(r, r.ministry);
    if (!altKey) continue;
    const altGroupKey = `${stageKey(stage)}\x1f${altKey}`;
    const mofAmountYen = mofAmountByGroup.get(altGroupKey);
    if (mofAmountYen === undefined) continue; // altでも一致するMOF targetが無い
    const existingRsAmountYen = rsLinkedAmountByGroup.get(altGroupKey) ?? 0;
    const candidateRsAmountYen = r.budgetAmountYen ?? 0;
    const reconstructedRsAmountYen = existingRsAmountYen + candidateRsAmountYen;
    candidates.push({
      rsRecordId: r.recordId, projectId: r.projectId,
      existingRsAmountYen, candidateRsAmountYen, reconstructedRsAmountYen, mofAmountYen,
      differenceBeforeYen: mofAmountYen - existingRsAmountYen,
      differenceAfterYen: mofAmountYen - reconstructedRsAmountYen,
      exactReconciliation: mofAmountYen - reconstructedRsAmountYen === 0,
    });
  }

  if (candidates.length > 0) {
    findings.push({
      severity: 'info', check: 'mof-rs-joint-ministry-fallback-candidate', category: 'semantic-diagnostic',
      scope: { reviewYear, fiscalYear },
      metrics: {
        candidateCount: candidates.length,
        candidateAmountYen: candidates.reduce((s, c) => s + c.candidateRsAmountYen, 0),
        exactReconciliationCount: candidates.filter(c => c.exactReconciliation).length,
      },
      sampleIds: candidates.map(c => c.rsRecordId).slice(0, 10),
      message: `review-${reviewYear}×fy${fiscalYear}: budgetMinistryではなくcommon ministryで一意にMOF targetへ接続できる候補が${candidates.length}件ある` +
        `（現行linkは変更せず候補のみ。安全と断定はしない）`,
    });
  }
  return { findings, candidates };
}

export interface LinkDifferenceTaxonomy {
  exactZeroGroupCount: number; nonZeroGroupCount: number; mofGreaterGroupCount: number; rsGreaterGroupCount: number;
  netDifferenceYen: number; absoluteDifferenceYen: number;
  top10AbsoluteDifferenceYen: number; top10Share: number; top100AbsoluteDifferenceYen: number; top100Share: number;
  ratioBuckets: { lt0_5: number; between0_5and0_9: number; between0_9and1_1: number; gt1_1: number; mofZero: number };
}
export interface MultiProjectGroupMetrics { groupCount: number; multiProjectGroupCount: number; multiProjectGroupShare: number; maxProjectCountPerGroup: number }

/**
 * D-3: linked group difference taxonomy + concentration。
 * 既存のcheckMofRsLinkIntegrity()が行うdifferenceYen===mofAmountYen-rsAmountYenの算術
 * invariantチェックはそのまま維持し（呼び出し元で別途実行）、ここでは分布・集中度だけを診断する。
 * 差額自体はerrorにしない（source-semantics/allocation差が実在するため）。
 */
export function analyzeLinkDifferenceTaxonomy(links: MofRsProjectLinkGroup[]): LinkDifferenceTaxonomy {
  let exactZeroGroupCount = 0, mofGreaterGroupCount = 0, rsGreaterGroupCount = 0;
  let netDifferenceYen = 0, absoluteDifferenceYen = 0;
  const ratioBuckets = { lt0_5: 0, between0_5and0_9: 0, between0_9and1_1: 0, gt1_1: 0, mofZero: 0 };

  for (const l of links) {
    netDifferenceYen += l.differenceYen;
    const abs = Math.abs(l.differenceYen);
    absoluteDifferenceYen += abs;
    if (l.differenceYen === 0) exactZeroGroupCount++;
    else if (l.differenceYen > 0) mofGreaterGroupCount++;
    else rsGreaterGroupCount++;

    if (l.mofAmountYen === 0) { ratioBuckets.mofZero++; continue; }
    const ratio = l.rsAmountYen / l.mofAmountYen;
    if (ratio < 0.5) ratioBuckets.lt0_5++;
    else if (ratio < 0.9) ratioBuckets.between0_5and0_9++;
    else if (ratio <= 1.1) ratioBuckets.between0_9and1_1++;
    else ratioBuckets.gt1_1++;
  }

  const sortedByAbs = [...links].sort((a, b) => Math.abs(b.differenceYen) - Math.abs(a.differenceYen));
  const top10AbsoluteDifferenceYen = sortedByAbs.slice(0, 10).reduce((s, l) => s + Math.abs(l.differenceYen), 0);
  const top100AbsoluteDifferenceYen = sortedByAbs.slice(0, 100).reduce((s, l) => s + Math.abs(l.differenceYen), 0);

  return {
    exactZeroGroupCount, nonZeroGroupCount: links.length - exactZeroGroupCount, mofGreaterGroupCount, rsGreaterGroupCount,
    netDifferenceYen, absoluteDifferenceYen,
    top10AbsoluteDifferenceYen, top10Share: absoluteDifferenceYen > 0 ? top10AbsoluteDifferenceYen / absoluteDifferenceYen : 0,
    top100AbsoluteDifferenceYen, top100Share: absoluteDifferenceYen > 0 ? top100AbsoluteDifferenceYen / absoluteDifferenceYen : 0,
    ratioBuckets,
  };
}

/**
 * multi-project group診断。1 MOF link groupに複数RS事業が紐づくことは正常（1:1を仮定しない
 * 設計原則そのもの）なのでerrorにはしない。「1:1対応ではない」ことをmetricsとして可視化する。
 */
export function analyzeMultiProjectGroups(links: MofRsProjectLinkGroup[]): MultiProjectGroupMetrics {
  const multiProjectGroups = links.filter(l => l.projectIds.length > 1);
  const maxProjectCountPerGroup = links.reduce((max, l) => Math.max(max, l.projectIds.length), 0);
  return {
    groupCount: links.length,
    multiProjectGroupCount: multiProjectGroups.length,
    multiProjectGroupShare: links.length > 0 ? multiProjectGroups.length / links.length : 0,
    maxProjectCountPerGroup,
  };
}
