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
 * そのため`mofKeyFrom`/`rsKeyFrom`/`rsPhase`/`stageKey`はlib/mof-rs-match-core.tsからimportして
 * 再利用する（Stage CでのsemanticItemKey非再利用とは性質が異なる。あちらは独立検算の
 * invariantチェック、こちらはproductionの実際の分類境界を説明する診断）。
 *
 * D-5（P2 Supplemental Exact Fallback）のparser/target解決/reconciliationロジック本体は
 * lib/mof-rs-match-core.tsのevaluateSupplementalExact()へ移動した（P2 production昇格準備。
 * 53_sonnet-p2-shared-core-extraction-instructions.md）。production（buildMofRsLinks）と
 * validationの両方が同一実装を参照するneutral coreとするための抽出であり、診断の意味・
 * 判定結果は変更していない。このファイルではevaluateSupplementalExact()の結果をFindingへ
 * 変換するだけの薄いwrapperとして残す。
 */
import {
  mofKeyFrom, rsKeyFrom, rsPhase, stageKey, type Stage,
  evaluateSupplementalExact, SAFE_TARGET_RESOLUTIONS,
  type SupplementalExactParseKind, type SupplementalExactTargetResolution, type SupplementalExactReconciliation,
  type SupplementalExactCandidate, type SupplementalExactSummary,
} from '../mof-rs-match-core';
import { normalizeText } from '../stable-id';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2, MofRsProjectLinkGroup } from '../../types';
import type { Finding } from '../validate-checks';

export type { SupplementalExactParseKind, SupplementalExactTargetResolution, SupplementalExactReconciliation, SupplementalExactCandidate, SupplementalExactSummary };

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

/**
 * D-1フォローアップ: taxonomy（診断側の再分類）とproduction summary（同一run内で
 * buildMofRsLinks()が実際に生成した集計）が一致することを検査する。これはgolden
 * acceptance（baseline drift）ではなく、「production出力」と「productionの境界を
 * 説明する診断」が同一run内で食い違っていないかというinvariant。
 */
export function checkLinkTaxonomyConsistency(
  taxonomy: ReturnType<typeof classifyUnlinkedReasons>,
  summary: { linkedRsRecordCount?: unknown; unlinkedRsRecordCount?: unknown; unsupportedBudgetTypeRecordCount?: unknown },
  totalRsRecordCount: number,
  scope: { reviewYear: number; fiscalYear: number }
): Finding[] {
  const findings: Finding[] = [];
  const push = (message: string, metrics: Record<string, string | number | boolean | null>) => {
    findings.push({ severity: 'error', check: 'mof-rs-link-taxonomy-consistency', category: 'invariant', scope, metrics, message });
  };

  const unlinkedSum = taxonomy.missingLinkKey.recordCount + taxonomy.validKeyNoMatch.recordCount;
  const partitionSum = taxonomy.linkedRecordCount + unlinkedSum + taxonomy.unsupportedBudgetType.recordCount;

  if (taxonomy.linkedRecordCount !== summary.linkedRsRecordCount) {
    push(`review-${scope.reviewYear}×fy${scope.fiscalYear}: taxonomy.linkedRecordCount(${taxonomy.linkedRecordCount})とsummary.linkedRsRecordCount(${summary.linkedRsRecordCount})が不一致`,
      { taxonomyValue: taxonomy.linkedRecordCount, summaryValue: summary.linkedRsRecordCount as number ?? null });
  }
  if (unlinkedSum !== summary.unlinkedRsRecordCount) {
    push(`review-${scope.reviewYear}×fy${scope.fiscalYear}: taxonomy(missingLinkKey+validKeyNoMatch=${unlinkedSum})とsummary.unlinkedRsRecordCount(${summary.unlinkedRsRecordCount})が不一致`,
      { taxonomyValue: unlinkedSum, summaryValue: summary.unlinkedRsRecordCount as number ?? null });
  }
  if (taxonomy.unsupportedBudgetType.recordCount !== summary.unsupportedBudgetTypeRecordCount) {
    push(`review-${scope.reviewYear}×fy${scope.fiscalYear}: taxonomy.unsupportedBudgetType.recordCount(${taxonomy.unsupportedBudgetType.recordCount})とsummary.unsupportedBudgetTypeRecordCount(${summary.unsupportedBudgetTypeRecordCount})が不一致`,
      { taxonomyValue: taxonomy.unsupportedBudgetType.recordCount, summaryValue: summary.unsupportedBudgetTypeRecordCount as number ?? null });
  }
  if (partitionSum !== totalRsRecordCount) {
    push(`review-${scope.reviewYear}×fy${scope.fiscalYear}: taxonomy各bucketの合計(${partitionSum})がRS対象年度の全レコード数(${totalRsRecordCount})と不一致`,
      { taxonomyValue: partitionSum, summaryValue: totalRsRecordCount });
  }
  return findings;
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
 *
 * 対象はstrictに「primary key（rsKeyFrom）は完成しているが、複合所管表記
 * （例:「内閣府及び厚生労働省」）のためbudgetMinistry exactでMOF groupに一致しない」
 * ケースのみに限定する（review指摘）。primary keyそのものが欠けている行
 * （missing-link-key）は対象外にする。これにより無関係なministryへの汎用fallback
 * ではなく、真に「joint-ministry（複合所管）」と呼べるケースだけを診断する:
 * - `rsKeyFrom(r)`が非null（primary keyは完成している）
 * - `normalizeText(budgetMinistry)`が`normalizeText(ministry)`を部分文字列として含む
 * - common `ministry`に差し替えた代替keyが一意なMOF targetへ一致する
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

  // review指摘: 同一altGroupKeyに複数の候補行が乗り得るため、候補は一旦altGroupKeyでまとめてから
  // reconstructedRsAmountYen/差額/exactReconciliationを「グループ単位で1回」算出する。
  // 各行を独立にexistingRsAmountYenと比較すると、合算すればMOF額を超える／ちょうど一致する
  // ケースを見落とす（過小評価・過大評価いずれも起こりうる）
  const groups = new Map<string, { mofAmountYen: number; existingRsAmountYen: number; records: RsBudgetItemRecordV2[] }>();
  for (const r of rsRowsForYear) {
    const stage = rsPhase(r);
    if (!stage) continue;

    // review指摘: strict valid-key-no-matchのみに限定する。primary keyそのものが
    // 完成していない行（missing-link-key）は対象外にする。「joint-ministry」診断は
    // 「複合所管のためexact matchしなかった」ケースに限定し、汎用fallbackへ拡大しない
    const primaryKey = rsKeyFrom(r);
    if (!primaryKey) continue;
    const primaryGroupKey = `${stageKey(stage)}\x1f${primaryKey}`;
    if (mofAmountByGroup.has(primaryGroupKey)) continue; // 既にprimaryでlink済み

    if (!r.ministry || r.ministry === r.budgetMinistry) continue; // 差し替える意味が無い
    // budgetMinistry（例:「内閣府及び厚生労働省」）にnormalizedしたministry（例:「厚生労働省」）が
    // 部分文字列として含まれる場合のみ「joint-ministry（複合所管）」表記とみなす。
    // 無関係なministryへの汎用fallbackを防ぐ
    if (!normalizeText(r.budgetMinistry).includes(normalizeText(r.ministry))) continue;

    const altKey = rsKeyWithMinistry(r, r.ministry);
    if (!altKey) continue;
    const altGroupKey = `${stageKey(stage)}\x1f${altKey}`;
    const mofAmountYen = mofAmountByGroup.get(altGroupKey);
    if (mofAmountYen === undefined) continue; // altでも一致するMOF targetが無い
    const group = groups.get(altGroupKey) ?? { mofAmountYen, existingRsAmountYen: rsLinkedAmountByGroup.get(altGroupKey) ?? 0, records: [] };
    group.records.push(r);
    groups.set(altGroupKey, group);
  }

  const candidates: JointMinistryFallbackCandidate[] = [];
  let exactReconciliationGroupCount = 0;
  for (const group of groups.values()) {
    const reconstructedRsAmountYen = group.existingRsAmountYen + group.records.reduce((s, r) => s + (r.budgetAmountYen ?? 0), 0);
    const exactReconciliation = group.mofAmountYen - reconstructedRsAmountYen === 0;
    if (exactReconciliation) exactReconciliationGroupCount++;
    for (const r of group.records) {
      candidates.push({
        rsRecordId: r.recordId, projectId: r.projectId,
        existingRsAmountYen: group.existingRsAmountYen, candidateRsAmountYen: r.budgetAmountYen ?? 0, reconstructedRsAmountYen,
        mofAmountYen: group.mofAmountYen,
        differenceBeforeYen: group.mofAmountYen - group.existingRsAmountYen,
        differenceAfterYen: group.mofAmountYen - reconstructedRsAmountYen,
        exactReconciliation,
      });
    }
  }

  if (candidates.length > 0) {
    findings.push({
      severity: 'info', check: 'mof-rs-joint-ministry-fallback-candidate', category: 'semantic-diagnostic',
      scope: { reviewYear, fiscalYear },
      metrics: {
        candidateCount: candidates.length,
        candidateAmountYen: candidates.reduce((s, c) => s + c.candidateRsAmountYen, 0),
        exactReconciliationCount: exactReconciliationGroupCount,
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
  mofGreaterAbsoluteDifferenceYen: number; rsGreaterAbsoluteDifferenceYen: number;
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
  let mofGreaterAbsoluteDifferenceYen = 0, rsGreaterAbsoluteDifferenceYen = 0;
  const ratioBuckets = { lt0_5: 0, between0_5and0_9: 0, between0_9and1_1: 0, gt1_1: 0, mofZero: 0 };

  for (const l of links) {
    netDifferenceYen += l.differenceYen;
    const abs = Math.abs(l.differenceYen);
    absoluteDifferenceYen += abs;
    if (l.differenceYen === 0) exactZeroGroupCount++;
    else if (l.differenceYen > 0) { mofGreaterGroupCount++; mofGreaterAbsoluteDifferenceYen += abs; }
    else { rsGreaterGroupCount++; rsGreaterAbsoluteDifferenceYen += abs; }

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
    netDifferenceYen, absoluteDifferenceYen, mofGreaterAbsoluteDifferenceYen, rsGreaterAbsoluteDifferenceYen,
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


// ============================================================
// D-5: P2 Supplemental Exact Fallback（shadow diagnostic）
//
// missing-link-key（rsKeyFrom()がnullになるRS行）のうち、`supplementalInfo`
// （歳出予算項目の補足情報）にMOFの項・目やfull pathが決定論的に残っているケースを
// 抽出・分類・金額検算するshadow diagnostic。production link（buildMofRsLinks）・
// Normalized/Derived/Publishは一切変更しない。
//
// parser/target解決/reconciliationのロジック本体は`evaluateSupplementalExact()`
// （lib/mof-rs-match-core.ts）へ移動済み。ここではその結果をFindingへ変換するだけ。
//
// 設計原則（41_p2-shadow-validator-spec.md）:
// - target選択に金額を使わない（金額はreconciliationにのみ使う）
// - substring/suffix/fuzzy matchingは禁止。normalizeText()後のtoken完全一致のみ
// - 明示scope（所管/会計/勘定等）がMOF targetと矛盾する場合は、項・目と金額が
//   一致しても安全候補へ昇格しない（explicit-scope-conflict）
// - review時点RS scopeと過年度MOF scopeの差は自動補正せずP2c（shadow/manual）に分離する
// ============================================================

/**
 * D-5: P2 Supplemental Exact Fallback shadow diagnostic。
 * 対象はStage D taxonomy上のmissing-link-keyのみ（`rsKeyFrom(r) === null`）。
 * production link（buildMofRsLinks）は一切変更せず、独立に抽出・分類・金額検算するのみ。
 */
export function diagnoseSupplementalExactFallback(
  reviewYear: number, fiscalYear: number, mofRows: MofBudgetItemRecord[], rsRowsForYear: RsBudgetItemRecordV2[]
): { findings: Finding[]; candidates: SupplementalExactCandidate[]; summary: SupplementalExactSummary } {
  const { candidates, summary } = evaluateSupplementalExact(mofRows, rsRowsForYear, fiscalYear);

  const findings: Finding[] = [];
  if (summary.safeExactRecordCount > 0) {
    findings.push({
      severity: 'info', check: 'mof-rs-supplemental-exact-fallback', category: 'semantic-diagnostic',
      scope: { reviewYear, fiscalYear },
      metrics: {
        parsedCandidateCount: summary.parsedCandidateCount, safeExactRecordCount: summary.safeExactRecordCount, safeExactGroupCount: summary.safeExactGroupCount,
        p2cHistoricalScopeMismatchCount: summary.p2cHistoricalScopeMismatchCount, explicitScopeConflictCount: summary.explicitScopeConflictCount,
      },
      sampleIds: candidates.filter(c => SAFE_TARGET_RESOLUTIONS.has(c.targetResolution) && c.reconciliation === 'exact').map(c => c.rsRecordId).slice(0, 10),
      message: `review-${reviewYear}×fy${fiscalYear}: supplementalInfoからMOF項・目を復元しexact reconciliationした安全候補が${summary.safeExactRecordCount}行（${summary.safeExactGroupCount} target group）ある` +
        `（現行linkは変更せず候補のみ。安全と断定はしない）`,
    });
  }

  return { findings, candidates, summary };
}
