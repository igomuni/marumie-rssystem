/**
 * Pipeline V2 Validator Hardening Stage E: Publish validation。
 * Normalized/Derivedと`public/data/v2`の間で、artifactの存在・件数保存・
 * compact化での0/false保持・金額とID参照のsemantic一致を検証する。
 *
 * 原則: `publish-v2.ts`を再実行してexpected outputを作り比較する方式にしない。
 * `compactRsBudgetSummary()`/`compactRsBudgetItem()`/`buildMofSectionDetails()`/
 * `publishLinkProduct()`等のPublish生成関数もそのまま呼ばない（Publish側のbugを
 * Validatorが継承するため）。Normalized/Derived/public/data/v2をそれぞれ独立に
 * 読み、semantic invariantとして再検算する。gzipはValidatorから直接展開して読む。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import type {
  RsBudgetItemRecordV2, RsBudgetSummaryRecord, MofDerivedSection, MofBudgetItemRecord,
  MofDerivedBudgetEvent, MofRsProjectLinkGroup,
} from '../../types';
import type { RsProject } from '../rs-projects';
import type { Finding } from '../validate-checks';

export function readGzipJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf-8')) as T;
}
export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

/** rsShard()をimportせず独立に計算する（review指摘・Stage E方針） */
export function independentRsShard(projectId: string): string {
  return crypto.createHash('sha256').update(`rs-project:${projectId}`).digest('hex').slice(0, 2);
}
/** mofSectionShard()をimportせず独立に計算する。'mofsec_'は7文字なので直後2文字を取る */
export function independentMofSectionShard(sectionId: string): string {
  return sectionId.slice(7, 9);
}

/** artifactが存在しなければ1件のinvariant errorにする（Stage B/Cのcheck DerivedArtifactPresenceと同じ思想） */
export function checkArtifactExists(check: string, filePath: string, scope: Record<string, unknown>): Finding[] {
  if (fs.existsSync(filePath)) return [];
  return [{
    severity: 'error', check, category: 'invariant', scope,
    metrics: { path: filePath },
    message: `期待されるPublish artifactが存在しない: ${filePath}`,
  }];
}

function pushError(findings: Finding[], check: string, scope: Record<string, unknown>, message: string, metrics?: Record<string, string | number | boolean | null>): void {
  findings.push({ severity: 'error', check, category: 'invariant', scope, metrics, message });
}

// ============================================================
// E-1: RS Publish
// ============================================================

export interface RsPublishIndexRow {
  projectId: string; shard: string; profiles: string[];
  budgetSummary?: { initial?: number; supplements?: number; total?: number };
  hasFundingGraph?: boolean; hasMofLink?: boolean;
  hasCycle?: boolean; hasOrphanBlocks?: boolean; hasDuplicateRelations?: boolean;
}
export interface RsPublishIndex { projectCount: number; projects: RsPublishIndexRow[] }
export interface RsPublishManifest { projectCount: number; completeness: string; normalizedRecordCounts?: Record<string, number> }

/** projects.jsonl件数・projectId集合とindex/manifestの一致を検査する */
export function checkRsProjectCounts(
  reviewYear: number, normProjects: RsProject[], index: RsPublishIndex | null, manifest: RsPublishManifest | null
): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  if (!index || !manifest) return findings; // artifact不在は別途checkArtifactExistsで検出済み

  if (normProjects.length !== index.projectCount) {
    pushError(findings, 'rs-publish-project-count', scope, `Normalized projects.jsonl(${normProjects.length})とindex.projectCount(${index.projectCount})が不一致`,
      { normalizedCount: normProjects.length, indexCount: index.projectCount });
  }
  if (index.projectCount !== manifest.projectCount) {
    pushError(findings, 'rs-publish-project-count', scope, `index.projectCount(${index.projectCount})とmanifest.projectCount(${manifest.projectCount})が不一致`,
      { indexCount: index.projectCount, manifestCount: manifest.projectCount });
  }

  const normIds = new Set(normProjects.map(p => p.projectId));
  const indexIds = new Set(index.projects.map(p => p.projectId));
  const missing = [...normIds].filter(id => !indexIds.has(id));
  const unexpected = [...indexIds].filter(id => !normIds.has(id));
  const duplicates = index.projects.map(p => p.projectId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (missing.length > 0) pushError(findings, 'rs-publish-project-set', scope, `Normalizedにあるがindexに無いprojectIdが${missing.length}件ある`, { count: missing.length });
  if (unexpected.length > 0) pushError(findings, 'rs-publish-project-set', scope, `indexにあるがNormalizedに無いprojectIdが${unexpected.length}件ある`, { count: unexpected.length });
  if (duplicates.length > 0) pushError(findings, 'rs-publish-project-set', scope, `indexに重複したprojectIdが${duplicates.length}件ある`, { count: duplicates.length });

  return findings;
}

/** index.shardの独立検算と、対応するcore shardにprojectのbundleが実在するかを検査する */
export function checkRsShardReferentialIntegrity(
  reviewYear: number, index: RsPublishIndex | null, readCoreShard: (shard: string) => Record<string, unknown> | null
): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  if (!index) return findings;

  const shardCache = new Map<string, Record<string, unknown> | null>();
  for (const row of index.projects) {
    const expectedShard = independentRsShard(row.projectId);
    if (row.shard !== expectedShard) {
      pushError(findings, 'rs-publish-shard-integrity', { ...scope, projectId: row.projectId },
        `projectId=${row.projectId}: index.shard(${row.shard})と独立計算したshard(${expectedShard})が不一致`);
      continue;
    }
    if (!row.profiles.includes('core')) continue; // core無しはcheckRsProjectCounts側の対象外だが個別にも守る
    if (!shardCache.has(row.shard)) shardCache.set(row.shard, readCoreShard(row.shard));
    const shardData = shardCache.get(row.shard);
    if (!shardData || !(row.projectId in shardData)) {
      pushError(findings, 'rs-publish-shard-integrity', { ...scope, projectId: row.projectId },
        `projectId=${row.projectId}: core/${row.shard}.json.gzにbundleが存在しない`);
    }
  }
  return findings;
}

/**
 * Normalized budget-summaries.jsonl（project_total/account）とPublish core shardの
 * budgetSummaries[]をrecordId無しで（Publish側にrecordIdが無いため）
 * (fiscalYear, scopeLevel, account系, amounts)の内容一致で全件対応づけて検査する。
 * compactRsBudgetSummary()は呼ばず、Validator独自にamountsのnull省略・0保持を確認する。
 */
export function checkRsBudgetSummaryPreservation(
  reviewYear: number, normSummaries: RsBudgetSummaryRecord[], projectIds: Set<string>,
  readCoreShard: (shard: string) => Record<string, unknown> | null, shardOf: (projectId: string) => string
): { findings: Finding[]; sourceCount: number; publishedCount: number } {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  const relevant = normSummaries.filter(r => projectIds.has(r.projectId));

  const byProject = new Map<string, RsBudgetSummaryRecord[]>();
  for (const r of relevant) { const l = byProject.get(r.projectId) ?? []; l.push(r); byProject.set(r.projectId, l); }

  const shardCache = new Map<string, Record<string, unknown> | null>();
  let publishedCount = 0;
  for (const [projectId, rows] of byProject) {
    const shard = shardOf(projectId);
    if (!shardCache.has(shard)) shardCache.set(shard, readCoreShard(shard));
    const bundle = shardCache.get(shard)?.[projectId] as { budgetSummaries?: Record<string, unknown>[] } | undefined;
    const published = bundle?.budgetSummaries ?? [];
    publishedCount += published.length;

    if (published.length !== rows.length) {
      pushError(findings, 'rs-publish-budget-summary-count', { ...scope, projectId },
        `projectId=${projectId}: Normalized budget-summaries行数(${rows.length})とPublish件数(${published.length})が不一致`);
      continue;
    }
    // 内容ベースでNormalized行とPublished行を1:1対応づける（順序に依存しない）。
    // pick()は空文字列を「無い」として省略するため、Normalized側が''のフィールドは
    // Publish側でkey自体が無い（undefined）のが正しい。空文字列とundefinedを同値とみなす
    const blankEq = (normalizedValue: string, publishedValue: unknown) => (normalizedValue || undefined) === (publishedValue || undefined);
    const remaining = [...published];
    for (const row of rows) {
      const expectedAmounts = Object.fromEntries(Object.entries(row.amounts).filter(([, v]) => v !== null));
      const idx = remaining.findIndex(p => p.fiscalYear === row.fiscalYear && p.scopeLevel === row.scopeLevel
        && blankEq(row.account, p.account) && blankEq(row.accountClass, p.accountClass) && blankEq(row.accountType, p.accountType) && blankEq(row.subAccount, p.subAccount)
        && blankEq(row.changeReason, p.changeReason) && blankEq(row.note, p.note) && blankEq(row.specialNotes, p.specialNotes) && blankEq(row.executionRateRaw, p.executionRateRaw)
        && JSON.stringify(p.amounts) === JSON.stringify(expectedAmounts));
      if (idx === -1) {
        pushError(findings, 'rs-publish-budget-summary-value', { ...scope, projectId },
          `projectId=${projectId} fiscalYear=${row.fiscalYear} scopeLevel=${row.scopeLevel}: Publishに対応するbudgetSummary行が見つからない（0/blank保持または他フィールドの不整合の可能性）`);
        continue;
      }
      remaining.splice(idx, 1);
    }
  }
  return { findings, sourceCount: relevant.length, publishedCount };
}

const BUDGET_ITEM_FIELDS = [
  'recordId', 'fiscalYear', 'requestFiscalYear', 'budgetType', 'accountType', 'accountClass', 'account', 'subAccount',
  'budgetMinistry', 'organizationOrAccount', 'sectionName', 'subItemName', 'budgetAmountYen', 'nextYearRequestYen', 'note', 'supplementalInfo',
] as const;

/** recordIdをkeyにNormalized budget-items.jsonlとPublish context shardのbudgetItems[]を全件突合する */
export function checkRsBudgetItemPreservation(
  reviewYear: number, normItems: RsBudgetItemRecordV2[], projectIds: Set<string>,
  readContextShard: (shard: string) => Record<string, unknown> | null, shardOf: (projectId: string) => string
): { findings: Finding[]; sourceCount: number; publishedCount: number } {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  const relevant = normItems.filter(r => projectIds.has(r.projectId));

  const shardCache = new Map<string, Record<string, unknown> | null>();
  const publishedByRecordId = new Map<string, Record<string, unknown>>();
  for (const projectId of new Set(relevant.map(r => r.projectId))) {
    const shard = shardOf(projectId);
    if (!shardCache.has(shard)) shardCache.set(shard, readContextShard(shard));
    const bundle = shardCache.get(shard)?.[projectId] as { budgetItems?: Record<string, unknown>[] } | undefined;
    for (const item of bundle?.budgetItems ?? []) publishedByRecordId.set(item.recordId as string, item);
  }

  for (const row of relevant) {
    const published = publishedByRecordId.get(row.recordId);
    if (!published) {
      pushError(findings, 'rs-publish-budget-item-missing', { ...scope, projectId: row.projectId, recordId: row.recordId },
        `recordId=${row.recordId}: Normalizedに存在するがPublish context shardに見つからない`);
      continue;
    }
    for (const field of BUDGET_ITEM_FIELDS) {
      const expected = row[field as keyof RsBudgetItemRecordV2];
      // pick()はnull/undefined/''を省略するため、Normalized側がblankならPublish側にkeyが無いのが正しい
      if (expected === null || expected === undefined || expected === '') {
        if (field in published) {
          pushError(findings, 'rs-publish-budget-item-value', { ...scope, projectId: row.projectId, recordId: row.recordId },
            `recordId=${row.recordId}: ${field}はblankのはずだがPublishにkeyが存在する（値=${JSON.stringify(published[field])}）`);
        }
        continue;
      }
      if (published[field] !== expected) {
        pushError(findings, 'rs-publish-budget-item-value', { ...scope, projectId: row.projectId, recordId: row.recordId },
          `recordId=${row.recordId}: ${field}がNormalized(${expected})とPublish(${published[field]})で不一致`,
          { field, expected: expected as string | number, actual: published[field] as string | number | null });
      }
    }
  }
  return { findings, sourceCount: relevant.length, publishedCount: publishedByRecordId.size };
}

/**
 * false/0のsilent drop preservationを検査する。project.noPlannedEnd（boolean|null）と
 * index.hasFundingGraph/hasMofLink（Funding Graph/link有無に関わらず必ず生成されるフィールド）
 * を対象に、期待値がfalseの場合にPublish側でもfalseとしてkeyが残る（省略されない）ことを
 * 確認する。hasCycle/hasOrphanBlocks/hasDuplicateRelationsはpublish-v2.tsの設計上
 * `hasFundingGraph===true`の場合のみ生成される条件付きフィールドのため、
 * hasFundingGraph===trueの行でのみkey存在を確認する（false-positiveを避ける）。
 */
export function checkRsFalsePreservation(
  reviewYear: number, normProjects: RsProject[], index: RsPublishIndex | null,
  readCoreShard: (shard: string) => Record<string, unknown> | null, shardOf: (projectId: string) => string
): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  let checked = 0;
  if (!index) return { findings, checked };

  const shardCache = new Map<string, Record<string, unknown> | null>();
  for (const project of normProjects) {
    if (project.noPlannedEnd !== false) continue; // false preservation検査はfalseの場合のみ意味がある
    checked++;
    const shard = shardOf(project.projectId);
    if (!shardCache.has(shard)) shardCache.set(shard, readCoreShard(shard));
    const bundle = shardCache.get(shard)?.[project.projectId] as { project?: Record<string, unknown> } | undefined;
    const publishedProject = bundle?.project;
    if (!publishedProject || publishedProject.noPlannedEnd !== false) {
      pushError(findings, 'rs-publish-false-preservation', { ...scope, projectId: project.projectId },
        `projectId=${project.projectId}: noPlannedEnd=falseがPublishでkey自体消えている、またはfalseとして残っていない`);
    }
  }

  // hasFundingGraph/hasMofLinkは常に生成される設計（Funding Graph/link無しでもfalseとして残る）
  for (const row of index.projects) {
    for (const field of ['hasFundingGraph', 'hasMofLink'] as const) {
      checked++;
      if (!(field in row)) {
        pushError(findings, 'rs-publish-false-preservation', { ...scope, projectId: row.projectId },
          `projectId=${row.projectId}: index.${field}のkey自体が存在しない（falseが省略されている疑い）`);
      }
    }
    // hasCycle等はFunding Graphが実在する場合のみ生成される設計上の条件付きフィールド
    if (row.hasFundingGraph) {
      for (const field of ['hasCycle', 'hasOrphanBlocks', 'hasDuplicateRelations'] as const) {
        checked++;
        if (!(field in row)) {
          pushError(findings, 'rs-publish-false-preservation', { ...scope, projectId: row.projectId },
            `projectId=${row.projectId}: hasFundingGraph=trueなのにindex.${field}のkeyが存在しない（falseが省略されている疑い）`);
        }
      }
    }
  }
  return { findings, checked };
}

/**
 * index.projects[].budgetSummaryを、Normalized budget-summaries.jsonlから独立に再構成する。
 * publish-v2.tsのindexBudgetByProjectと同じ選択規則（対象3列が1つでも非blankな行が
 * 「勝つ」。全blankの後続行で上書きしない）を独立に再実装する（project 18717の
 * false positiveを再発させない。02_rs-money-preservation.md 11節参照）。
 * total!=initial+supplementsはerrorにしない（current budgetの定義であり正常）。
 */
export function checkRsIndexBudgetSummaryReconstruction(
  reviewYear: number, normSummaries: RsBudgetSummaryRecord[], index: RsPublishIndex | null
): { findings: Finding[]; checkedProjects: number } {
  const findings: Finding[] = [];
  const scope = { reviewYear };
  if (!index) return { findings, checkedProjects: 0 };

  const COLUMN_TO_KEY: Record<string, 'initial' | 'supplements' | 'total'> = {
    '当初予算（合計）': 'initial', '補正予算（合計）': 'supplements', '計（歳出予算現額合計）': 'total',
  };
  const expectedByProject = new Map<string, { initial?: number; supplements?: number; total?: number }>();
  for (const row of normSummaries) {
    if (row.scopeLevel !== 'project_total' || row.fiscalYear !== reviewYear) continue;
    const out: Partial<Record<'initial' | 'supplements' | 'total', number>> = {};
    for (const [col, key] of Object.entries(COLUMN_TO_KEY)) {
      const v = row.amounts[col];
      if (v !== null && v !== undefined) out[key] = v;
    }
    if (Object.keys(out).length > 0) expectedByProject.set(row.projectId, out); // 全blank行では上書きしない
  }

  let checkedProjects = 0;
  for (const row of index.projects) {
    const expected = expectedByProject.get(row.projectId);
    const actual = row.budgetSummary;
    if (!expected && !actual) continue; // 両方無し（sheets-onlyプロジェクト等）は正常
    checkedProjects++;
    if (!expected || !actual || expected.initial !== actual.initial || expected.supplements !== actual.supplements || expected.total !== actual.total) {
      pushError(findings, 'rs-publish-index-budget-summary', { ...scope, projectId: row.projectId },
        `projectId=${row.projectId}: 独立再構成した期待値(${JSON.stringify(expected)})とindex.budgetSummary(${JSON.stringify(actual)})が不一致`);
    }
  }
  return { findings, checkedProjects };
}

// ============================================================
// E-2: MOF Publish
// ============================================================

export interface MofPublishIndexRow extends MofDerivedSection { shard: string; relationCount: number }
export interface MofPublishIndex { sectionCount: number; recordCount: number; eventCount: number; sections: MofPublishIndexRow[] }
export interface MofPublishManifest { sectionCount: number }

export function checkMofSectionCounts(
  fiscalYear: number, normItems: MofBudgetItemRecord[], derivedSections: MofDerivedSection[], derivedEvents: MofDerivedBudgetEvent[],
  index: MofPublishIndex | null, manifest: MofPublishManifest | null
): Finding[] {
  const findings: Finding[] = [];
  const scope = { fiscalYear };
  if (!index || !manifest) return findings;

  if (derivedSections.length !== index.sectionCount) pushError(findings, 'mof-publish-section-count', scope,
    `Derived sections.jsonl(${derivedSections.length})とindex.sectionCount(${index.sectionCount})が不一致`);
  if (index.sectionCount !== manifest.sectionCount) pushError(findings, 'mof-publish-section-count', scope,
    `index.sectionCount(${index.sectionCount})とmanifest.sectionCount(${manifest.sectionCount})が不一致`);
  if (normItems.length !== index.recordCount) pushError(findings, 'mof-publish-record-count', scope,
    `Normalized budget-items.jsonl(${normItems.length})とindex.recordCount(${index.recordCount})が不一致`);
  if (derivedEvents.length !== index.eventCount) pushError(findings, 'mof-publish-event-count', scope,
    `Derived budget-events.jsonl(${derivedEvents.length})とindex.eventCount(${index.eventCount})が不一致`);

  const derivedIds = new Set(derivedSections.map(s => s.id));
  const indexIds = new Set(index.sections.map(s => s.id));
  const missing = [...derivedIds].filter(id => !indexIds.has(id));
  const unexpected = [...indexIds].filter(id => !derivedIds.has(id));
  if (missing.length > 0) pushError(findings, 'mof-publish-section-set', scope, `Derivedにあるがindexに無いsection idが${missing.length}件ある`);
  if (unexpected.length > 0) pushError(findings, 'mof-publish-section-set', scope, `indexにあるがDerivedに無いsection idが${unexpected.length}件ある`);

  return findings;
}

const SECTION_SEMANTIC_FIELDS = [
  'fiscalYear', 'accountType', 'ministry', 'organization', 'specialAccount', 'subAccount', 'agency',
  'sectionCode', 'sectionName', 'itemCount', 'eventCount', 'initialSubmittedYen', 'initialEnactedYen', 'initialYen',
  'supplementDeltaYen', 'settlementBudgetYen', 'currentBudgetYen', 'spentYen', 'carryoverOutYen', 'unusedYen',
  'unresolvedPreSettlementDeltaYen',
] as const;

/** index.sections[]のshard独立検算と、Derived section metadataとのsemantic一致を検査する */
export function checkMofSectionSemantics(fiscalYear: number, derivedSections: MofDerivedSection[], index: MofPublishIndex | null): Finding[] {
  const findings: Finding[] = [];
  const scope = { fiscalYear };
  if (!index) return findings;
  const derivedById = new Map(derivedSections.map(s => [s.id, s]));

  for (const row of index.sections) {
    const expectedShard = independentMofSectionShard(row.id);
    if (row.shard !== expectedShard) {
      pushError(findings, 'mof-publish-section-shard', { ...scope, recordId: row.id },
        `sectionId=${row.id}: index.shard(${row.shard})と独立計算したshard(${expectedShard})が不一致`);
    }
    const derived = derivedById.get(row.id);
    if (!derived) continue; // 集合不一致は既にcheckMofSectionCountsで検出済み
    for (const field of SECTION_SEMANTIC_FIELDS) {
      const expected = derived[field as keyof MofDerivedSection];
      const actual = row[field as keyof MofPublishIndexRow];
      if ((expected ?? null) !== (actual ?? null)) {
        pushError(findings, 'mof-publish-section-value', { ...scope, recordId: row.id },
          `sectionId=${row.id}: ${field}がDerived(${expected})とPublish(${actual})で不一致`);
      }
    }
  }
  return findings;
}

/**
 * MOF recordId→section idの対応を、sectionIdOf()をimportせず独立に構築する。
 * Derived sectionsが既に保持しているidentity field（accountType/ministry/organization/
 * specialAccount/subAccount/agency/sectionCode/sectionName）をkeyにしてNormalized itemを
 * 引き当てる（stableIdのハッシュアルゴリズムには依存しない）。
 */
function buildIndependentSectionIndex(derivedSections: MofDerivedSection[]): Map<string, string> {
  const keyOf = (row: Pick<MofDerivedSection, 'accountType' | 'ministry' | 'organization' | 'specialAccount' | 'subAccount' | 'agency' | 'sectionCode' | 'sectionName'>) =>
    [row.accountType, row.ministry, row.organization, row.specialAccount, row.subAccount, row.agency, row.sectionCode, row.sectionName].join('\x1f');
  const map = new Map<string, string>();
  for (const s of derivedSections) map.set(keyOf(s), s.id);
  return map;
}
function independentRecordToSection(item: MofBudgetItemRecord, sectionKeyToId: Map<string, string>): string | undefined {
  const key = [item.accountType, item.ministry, item.organization, item.specialAccount, item.subAccount, item.agency, item.sectionCode, item.sectionName].join('\x1f');
  return sectionKeyToId.get(key);
}

/** Normalized recordがsection detail.recordsに存在し、sourceRefが有効範囲を指すことを検査する */
export function checkMofDetailRecords(
  fiscalYear: number, normItems: MofBudgetItemRecord[], derivedSections: MofDerivedSection[],
  readSectionDetail: (sectionId: string) => { records: Record<string, unknown>[]; sources: Record<string, unknown>[] } | null,
  shardOf: (sectionId: string) => string
): { findings: Finding[]; checkedRecords: number } {
  const findings: Finding[] = [];
  const scope = { fiscalYear };
  const sectionKeyToId = buildIndependentSectionIndex(derivedSections);
  const detailCache = new Map<string, { records: Record<string, unknown>[]; sources: Record<string, unknown>[] } | null>();
  let checkedRecords = 0;

  for (const item of normItems) {
    const sectionId = independentRecordToSection(item, sectionKeyToId);
    if (!sectionId) continue; // section集合不一致は別checkで検出済み
    if (!detailCache.has(sectionId)) detailCache.set(sectionId, readSectionDetail(sectionId));
    const detail = detailCache.get(sectionId);
    if (!detail) continue; // section detail欠落は別途artifact/section countで検出
    checkedRecords++;
    const record = detail.records.find(r => r.id === item.recordId);
    if (!record) {
      pushError(findings, 'mof-publish-detail-record-missing', { ...scope, recordId: item.recordId },
        `recordId=${item.recordId}: section detail(${sectionId})のrecordsに見つからない`);
      continue;
    }
    if (record.phase !== item.phase || record.budgetStatus !== item.budgetStatus) {
      pushError(findings, 'mof-publish-detail-record-value', { ...scope, recordId: item.recordId },
        `recordId=${item.recordId}: phase/budgetStatusがNormalizedと不一致`);
    }
    const sourceRef = record.sourceRef;
    if (sourceRef !== undefined && (typeof sourceRef !== 'number' || sourceRef < 0 || sourceRef >= detail.sources.length)) {
      pushError(findings, 'mof-publish-detail-source-ref', { ...scope, recordId: item.recordId },
        `recordId=${item.recordId}: sourceRef(${sourceRef})がsources配列の範囲外`);
    }
  }
  return { findings, checkedRecords };
}

/**
 * Derived eventを独立にsection×(eventType,budgetStatus,revision)でgroup化した期待amountYen合計と、
 * section detail.eventsの各groupのamountYenが一致することを検査する。
 */
export function checkMofDetailEventAggregation(
  fiscalYear: number, derivedEvents: MofDerivedBudgetEvent[], derivedSections: MofDerivedSection[],
  normItems: MofBudgetItemRecord[],
  readSectionDetail: (sectionId: string) => { events: { eventType: string; budgetStatus?: string; revision?: number | null; amountYen: number }[] } | null
): { findings: Finding[]; checkedGroups: number } {
  const findings: Finding[] = [];
  const scope = { fiscalYear };
  const sectionKeyToId = buildIndependentSectionIndex(derivedSections);
  const recordToSection = new Map<string, string>();
  for (const item of normItems) {
    const sid = independentRecordToSection(item, sectionKeyToId);
    if (sid) recordToSection.set(item.recordId, sid);
  }

  // 期待: section -> groupKey -> amount合計
  const expected = new Map<string, Map<string, number>>();
  for (const e of derivedEvents) {
    const sourceIds = (e.sourceRecordIds ?? []).filter(id => recordToSection.has(id));
    const sids = sourceIds.length > 0 ? [...new Set(sourceIds.map(id => recordToSection.get(id)!))] : [];
    const groupKey = `${e.eventType}\x1f${e.budgetStatus ?? ''}\x1f${e.revision ?? ''}`;
    for (const sid of sids) {
      const bySection = expected.get(sid) ?? new Map<string, number>();
      bySection.set(groupKey, (bySection.get(groupKey) ?? 0) + (e.amountYen ?? 0));
      expected.set(sid, bySection);
    }
  }

  let checkedGroups = 0;
  const detailCache = new Map<string, { events: { eventType: string; budgetStatus?: string; revision?: number | null; amountYen: number }[] } | null>();
  for (const [sectionId, groups] of expected) {
    if (!detailCache.has(sectionId)) detailCache.set(sectionId, readSectionDetail(sectionId));
    const detail = detailCache.get(sectionId);
    if (!detail) continue;
    for (const [groupKey, expectedAmount] of groups) {
      checkedGroups++;
      const [eventType, budgetStatus, revisionRaw] = groupKey.split('\x1f');
      const published = detail.events.find(g => g.eventType === eventType && (g.budgetStatus ?? '') === budgetStatus && String(g.revision ?? '') === revisionRaw);
      if (!published) {
        pushError(findings, 'mof-publish-detail-event-missing', { ...scope, recordId: sectionId },
          `sectionId=${sectionId} group=${groupKey}: section detailのeventsに見つからない`);
        continue;
      }
      if (published.amountYen !== expectedAmount) {
        pushError(findings, 'mof-publish-detail-event-amount', { ...scope, recordId: sectionId },
          `sectionId=${sectionId} group=${groupKey}: 独立再構成した合計(${expectedAmount})とPublish(${published.amountYen})が不一致`);
      }
    }
  }
  return { findings, checkedGroups };
}

// ============================================================
// E-3: Standalone Links Publish
// ============================================================

export interface PublishedLink { linkId: string; phase: string; revision: number | null; sectionIds: string[]; projectIds: string[]; mofAmountYen: number; rsAmountYen: number; differenceYen: number }
export interface LinksPublishManifest { linkGroupCount: number; projectCount: number; sectionCount: number }

export function checkLinksPublishCounts(
  reviewYear: number, fiscalYear: number, derivedLinks: MofRsProjectLinkGroup[],
  published: { links: PublishedLink[] } | null, manifest: LinksPublishManifest | null
): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear, fiscalYear };
  if (!published || !manifest) return findings;

  if (derivedLinks.length !== published.links.length) pushError(findings, 'links-publish-count', scope,
    `Derived link group(${derivedLinks.length})とpublished links.length(${published.links.length})が不一致`);
  if (published.links.length !== manifest.linkGroupCount) pushError(findings, 'links-publish-count', scope,
    `published links.length(${published.links.length})とmanifest.linkGroupCount(${manifest.linkGroupCount})が不一致`);
  return findings;
}

/** linkIdをkeyにDerivedとPublishedを全件突合し、semantic equalityとdifferenceYenの算術を再検算する */
export function checkLinksSemanticEquality(reviewYear: number, fiscalYear: number, derivedLinks: MofRsProjectLinkGroup[], published: { links: PublishedLink[] } | null): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear, fiscalYear };
  if (!published) return findings;
  const publishedById = new Map(published.links.map(l => [l.linkId, l]));

  for (const d of derivedLinks) {
    const p = publishedById.get(d.linkId);
    if (!p) { pushError(findings, 'links-publish-semantic', { ...scope, linkId: d.linkId }, `linkId=${d.linkId}: publishedに見つからない`); continue; }
    if (p.phase !== d.phase || p.revision !== d.revision
      || JSON.stringify([...p.projectIds].sort()) !== JSON.stringify([...d.projectIds].sort())
      || p.mofAmountYen !== d.mofAmountYen || p.rsAmountYen !== d.rsAmountYen || p.differenceYen !== d.differenceYen) {
      pushError(findings, 'links-publish-semantic', { ...scope, linkId: d.linkId }, `linkId=${d.linkId}: DerivedとPublishedのsemantic valueが不一致`);
    }
    if (p.differenceYen !== p.mofAmountYen - p.rsAmountYen) {
      pushError(findings, 'links-publish-semantic', { ...scope, linkId: d.linkId }, `linkId=${d.linkId}: published differenceYen(${p.differenceYen})がmofAmountYen-rsAmountYen(${p.mofAmountYen - p.rsAmountYen})と不一致`);
    }
  }
  return findings;
}

/** published sectionIdsを、Normalized/Derivedから独立に再構成したrecordId→sectionId対応で検算する */
export function checkLinksSectionIdsReconstruction(
  reviewYear: number, fiscalYear: number, derivedLinks: MofRsProjectLinkGroup[], normMofItems: MofBudgetItemRecord[],
  derivedSections: MofDerivedSection[], published: { links: PublishedLink[] } | null
): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear, fiscalYear };
  if (!published) return findings;
  const sectionKeyToId = buildIndependentSectionIndex(derivedSections);
  const recordToSection = new Map<string, string>();
  for (const item of normMofItems) {
    const sid = independentRecordToSection(item, sectionKeyToId);
    if (sid) recordToSection.set(item.recordId, sid);
  }
  const publishedById = new Map(published.links.map(l => [l.linkId, l]));

  for (const d of derivedLinks) {
    const p = publishedById.get(d.linkId);
    if (!p) continue;
    const expectedSectionIds = [...new Set(d.mofRecordIds.map(id => recordToSection.get(id)).filter((x): x is string => Boolean(x)))].sort();
    if (JSON.stringify(expectedSectionIds) !== JSON.stringify([...p.sectionIds].sort())) {
      pushError(findings, 'links-publish-section-ids', { ...scope, linkId: d.linkId },
        `linkId=${d.linkId}: 独立再構成したsectionIds(${expectedSectionIds.join(',')})とpublished(${p.sectionIds.join(',')})が不一致`);
    }
  }
  return findings;
}

/** manifestのprojectCount/sectionCountを、published linksから独立に再構成して検算する */
export function checkLinksManifestSetCounts(reviewYear: number, fiscalYear: number, published: { links: PublishedLink[] } | null, manifest: LinksPublishManifest | null): Finding[] {
  const findings: Finding[] = [];
  const scope = { reviewYear, fiscalYear };
  if (!published || !manifest) return findings;
  const projectIds = new Set(published.links.flatMap(l => l.projectIds));
  const sectionIds = new Set(published.links.flatMap(l => l.sectionIds));
  if (projectIds.size !== manifest.projectCount) pushError(findings, 'links-publish-manifest-counts', scope, `独立再構成したprojectCount(${projectIds.size})とmanifest.projectCount(${manifest.projectCount})が不一致`);
  if (sectionIds.size !== manifest.sectionCount) pushError(findings, 'links-publish-manifest-counts', scope, `独立再構成したsectionCount(${sectionIds.size})とmanifest.sectionCount(${manifest.sectionCount})が不一致`);
  return findings;
}

// ============================================================
// Root manifest
// ============================================================

export interface RootManifest {
  rs: { reviewYear: number; projectCount: number }[];
  mof: { fiscalYear: number; sectionCount: number }[];
  links: { reviewYear: number; fiscalYear: number; linkGroupCount: number; projectCount: number; sectionCount: number }[];
}

export function checkRootManifestConsistency(
  root: RootManifest | null,
  rsIndexes: { reviewYear: number; projectCount: number }[],
  mofIndexes: { fiscalYear: number; sectionCount: number }[],
  linkManifests: { reviewYear: number; fiscalYear: number; linkGroupCount: number; projectCount: number; sectionCount: number }[]
): { findings: Finding[]; checkedProducts: number } {
  const findings: Finding[] = [];
  let checkedProducts = 0;
  if (!root) return { findings, checkedProducts };

  for (const rs of rsIndexes) {
    checkedProducts++;
    const entry = root.rs.find(r => r.reviewYear === rs.reviewYear);
    if (!entry || entry.projectCount !== rs.projectCount) {
      pushError(findings, 'root-manifest-consistency', { reviewYear: rs.reviewYear },
        `root manifest.rs[reviewYear=${rs.reviewYear}]のprojectCount(${entry?.projectCount})がsub-product(${rs.projectCount})と不一致`);
    }
  }
  for (const mof of mofIndexes) {
    checkedProducts++;
    const entry = root.mof.find(m => m.fiscalYear === mof.fiscalYear);
    if (!entry || entry.sectionCount !== mof.sectionCount) {
      pushError(findings, 'root-manifest-consistency', { fiscalYear: mof.fiscalYear },
        `root manifest.mof[fiscalYear=${mof.fiscalYear}]のsectionCount(${entry?.sectionCount})がsub-product(${mof.sectionCount})と不一致`);
    }
  }
  for (const link of linkManifests) {
    checkedProducts++;
    const entry = root.links.find(l => l.reviewYear === link.reviewYear && l.fiscalYear === link.fiscalYear);
    if (!entry || entry.linkGroupCount !== link.linkGroupCount || entry.projectCount !== link.projectCount || entry.sectionCount !== link.sectionCount) {
      pushError(findings, 'root-manifest-consistency', { reviewYear: link.reviewYear, fiscalYear: link.fiscalYear },
        `root manifest.links[review-${link.reviewYear}×fy${link.fiscalYear}]がsub-product manifestと不一致`);
    }
  }
  return { findings, checkedProducts };
}
