/**
 * normalized/derivedのRS成果物から public/data/v2/rs/review-{year} を生成する。
 * 参照実装: Python版 pipeline_v2/publish.pyのpublish_rs_yearを土台に、
 * ユーザー指示（2026-09-20フィールドレビュー）で拡張したフィールド選択を使う。
 *
 * 構造:
 *   public/data/v2/rs/review-{year}/
 *     manifest.json          … completeness/sourceAvailability/shard統計
 *     index.json.gz          … 一覧・検索・filter・sortを単体で完結させる軽量index
 *     core/{00..ff}.json.gz  … project本体・budget-summaries・funding graph・review-sheet・MOF link
 *     context/{00..ff}.json.gz … policy/law/subsidy/related-project/logic-model/evaluation/notes/budget-items
 *     spending/{00..ff}.json.gz … recipients/contracts/expense-uses/multi-year-contracts/indirect-expenses
 *
 * 使い方: npx tsx scripts/pipeline-v2/publish-v2.ts [year...]
 */
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl } from './lib/jsonl';
import { rsShard, writeJson, writeGzipJson, meaningful, pick, PUBLISH_SCHEMA_VERSION } from './lib/publish-common';
import {
  compactRsProject, compactReviewSheetSnapshot, compactRsBudgetSummary, compactRsBudgetItem,
  compactRsFundingGraph, compactPolicy, compactSubsidy, compactProjectRelation, compactLogicNode,
  compactLogicObservation, compactLogicRelation, compactEvaluation, compactNote, compactRecipient,
  compactContract, compactExpenseUse, compactMultiYearContract, compactIndirectExpense, compactMofRsLink,
  computeDroppedFieldsReport,
} from './lib/rs-publish';
import type {
  RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsFundingGraph, RsPolicyLawRelation, RsSubsidyRule,
  RsProjectRelation, RsLogicNode, RsLogicObservation, RsLogicRelation, RsEvaluation, RsProjectNote,
  RsRecipientRecord, RsContractRecord, RsExpenseUse, RsMultiYearContract, RsIndirectExpenseRecord,
  RsReviewSheetRecord, MofRsProjectLinkGroup,
} from './types';
import type { RsProject } from './lib/rs-projects';
import { buildMofSectionDetails, buildMofIndexRow, sectionIdOf, mofSectionShard } from './lib/mof-publish';
import { compactSettlementIdentity, compactSettlementDiagnostics } from './lib/settlement-publish';
import { SETTLEMENT_IDENTITY_SCHEMA_VERSION, type MofRsSettlementDiagnostics, type MofRsSettlementIdentityRelation } from './lib/mof-rs-settlement-identity';
import type { SettlementItemRecord } from './lib/mof-settlement-items';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent, MofIdentityRelation, MofStageGap, MofDerivedSection } from './types';

type Profile = 'core' | 'context' | 'spending';
type Bundle = Record<string, unknown>;

const PROJECT_TOTAL_INDEX_COLUMNS = ['当初予算（合計）', '補正予算（合計）', '計（歳出予算現額合計）'] as const;

function addToBundle(bundles: Map<string, Bundle>, pid: string, category: string, value: unknown, multi: boolean): void {
  const bundle = bundles.get(pid) ?? {};
  if (multi) {
    const list = (bundle[category] as unknown[] | undefined) ?? [];
    list.push(value);
    bundle[category] = list;
  } else {
    bundle[category] = value;
  }
  bundles.set(pid, bundle);
}

function groupByProjectId<T extends { projectId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.projectId) ?? [];
    list.push(row);
    map.set(row.projectId, list);
  }
  return map;
}

// MOF recordId → 項（section）idの対応。publishMofYearと同じ定義をRS側（項→事業数の逆算）でも使う。
function loadRecordToSection(outputRoot: string, fiscalYear: number): Map<string, string> {
  const itemsPath = path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl');
  if (!fs.existsSync(itemsPath)) return new Map();
  const items = readJsonl<MofBudgetItemRecord>(itemsPath);
  return new Map(items.map(r => [r.recordId, sectionIdOf(r)] as const));
}

function publishRsYear(outputRoot: string, publicRoot: string, reviewYear: number): {
  reviewYear: number; projectCount: number; indexGzipBytes: number; profiles: Record<Profile, { shardCount: number; gzipBytes: number; maxShardBytes: number }>;
  completeness: 'full' | 'partial'; referentialIntegrityErrors: string[];
} | null {
  const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
  const manifestPath = path.join(normDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const normManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { downloadCsvAvailable?: boolean; reviewSheets?: { available: boolean } };
  const droot = path.join(outputRoot, 'derived', 'rs', `review-${reviewYear}`);
  const outDir = path.join(publicRoot, 'data', 'v2', 'rs', `review-${reviewYear}`);
  fs.rmSync(outDir, { recursive: true, force: true });

  const projects = readJsonl<RsProject>(path.join(normDir, 'projects.jsonl'));
  if (projects.length === 0) return null;
  const projectById = new Map(projects.map(p => [p.projectId, p]));

  const sheetsByProject = groupByProjectId(readJsonl<RsReviewSheetRecord>(path.join(normDir, 'review-sheets.jsonl')));
  const graphs = readJsonl<RsFundingGraph>(path.join(droot, 'funding-graphs.jsonl'));
  const graphByProject = new Map(graphs.map(g => [g.projectId, g]));

  const linksByProject = new Map<string, { fiscalYear: number; link: MofRsProjectLinkGroup }[]>();
  const recordToSectionCache = new Map<number, Map<string, string>>();
  const linkProducts: { fiscalYear: number; linkGroupCount: number; projectCount: number }[] = [];
  const linksDir = path.join(outputRoot, 'derived', 'links');
  if (fs.existsSync(linksDir)) {
    for (const file of fs.readdirSync(linksDir)) {
      const m = new RegExp(`^mof-rs-review-${reviewYear}-fy(\\d+)\\.jsonl$`).exec(file);
      if (!m) continue;
      const fiscalYear = Number(m[1]);
      const links = readJsonl<MofRsProjectLinkGroup>(path.join(linksDir, file));
      const projectsWithLink = new Set<string>();
      for (const link of links) {
        for (const pid of link.projectIds) {
          const list = linksByProject.get(pid) ?? [];
          list.push({ fiscalYear, link });
          linksByProject.set(pid, list);
          projectsWithLink.add(pid);
        }
      }
      linkProducts.push({ fiscalYear, linkGroupCount: links.length, projectCount: projectsWithLink.size });
    }
  }

  // project_totalの当初/補正/現額をindex用に集計する（reviewYearに一致する行を優先する）
  const indexBudgetByProject = new Map<string, Record<string, number>>();
  for (const row of readJsonl<RsBudgetSummaryRecord>(path.join(normDir, 'budget-summaries.jsonl'))) {
    if (row.scopeLevel !== 'project_total' || row.fiscalYear !== reviewYear) continue;
    const out: Record<string, number> = {};
    for (const col of PROJECT_TOTAL_INDEX_COLUMNS) {
      const v = row.amounts[col];
      if (v !== null && v !== undefined) out[col] = v;
    }
    if (Object.keys(out).length > 0) indexBudgetByProject.set(row.projectId, out);
  }

  const bundlesByProfile: Record<Profile, Map<string, Bundle>> = { core: new Map(), context: new Map(), spending: new Map() };
  const recordCounts: Record<string, number> = {};

  // core: project本体・review-sheet snapshot・funding graph・MOF link・budget-summaries
  for (const [pid, project] of projectById) {
    addToBundle(bundlesByProfile.core, pid, 'project', compactRsProject(project), false);
    const sheetSnapshot = compactReviewSheetSnapshot(sheetsByProject.get(pid) ?? []);
    if (sheetSnapshot) addToBundle(bundlesByProfile.core, pid, 'reviewSheet', sheetSnapshot, false);
    const graph = graphByProject.get(pid);
    if (graph) addToBundle(bundlesByProfile.core, pid, 'fundingGraph', compactRsFundingGraph(graph), false);
    for (const { fiscalYear, link } of linksByProject.get(pid) ?? []) {
      addToBundle(bundlesByProfile.core, pid, 'mofLinks', { ...compactMofRsLink(link), fiscalYear }, true);
    }
  }
  recordCounts.budgetSummaries = 0;
  for (const row of readJsonl<RsBudgetSummaryRecord>(path.join(normDir, 'budget-summaries.jsonl'))) {
    if (!projectById.has(row.projectId)) continue;
    addToBundle(bundlesByProfile.core, row.projectId, 'budgetSummaries', compactRsBudgetSummary(row), true);
    recordCounts.budgetSummaries++;
  }

  // context: budget-items + policy/subsidy/relation/logic/evaluation/note
  function shardContext<T extends { projectId: string }>(fileName: string, category: string, compact: (row: T) => Record<string, unknown> | null): void {
    let count = 0;
    for (const row of readJsonl<T>(path.join(normDir, fileName))) {
      if (!projectById.has(row.projectId)) continue;
      const value = compact(row);
      if (value === null) continue;
      addToBundle(bundlesByProfile.context, row.projectId, category, value, true);
      count++;
    }
    recordCounts[category] = count;
  }
  shardContext<RsBudgetItemRecordV2>('budget-items.jsonl', 'budgetItems', compactRsBudgetItem);
  shardContext<RsPolicyLawRelation>('policies-laws.jsonl', 'policies', compactPolicy);
  shardContext<RsSubsidyRule>('subsidy-rules.jsonl', 'subsidyRules', compactSubsidy);
  shardContext<RsProjectRelation>('project-relations.jsonl', 'projectRelations', compactProjectRelation);
  shardContext<RsLogicNode>('logic-model-nodes.jsonl', 'logicNodes', compactLogicNode);
  shardContext<RsLogicObservation>('logic-model-observations.jsonl', 'logicObservations', compactLogicObservation);
  shardContext<RsLogicRelation>('logic-model-relations.jsonl', 'logicRelations', compactLogicRelation);
  shardContext<RsEvaluation>('evaluations.jsonl', 'evaluations', compactEvaluation);
  shardContext<RsProjectNote>('notes.jsonl', 'notes', compactNote);

  // spending: recipients/contracts/expense-uses/multi-year-contracts/indirect-expenses
  function shardSpending<T extends { projectId: string }>(fileName: string, category: string, compact: (row: T) => Record<string, unknown> | null): void {
    let count = 0;
    for (const row of readJsonl<T>(path.join(normDir, fileName))) {
      if (!projectById.has(row.projectId)) continue;
      const value = compact(row);
      if (value === null) continue;
      addToBundle(bundlesByProfile.spending, row.projectId, category, value, true);
      count++;
    }
    recordCounts[category] = count;
  }
  shardSpending<RsRecipientRecord>('recipients.jsonl', 'recipients', compactRecipient);
  shardSpending<RsContractRecord>('contracts.jsonl', 'contracts', compactContract);
  shardSpending<RsExpenseUse>('expense-uses.jsonl', 'expenseUses', compactExpenseUse);
  shardSpending<RsMultiYearContract>('multi-year-contracts.jsonl', 'multiYearContracts', compactMultiYearContract);
  shardSpending<RsIndirectExpenseRecord>('indirect-expenses.jsonl', 'indirectExpenses', compactIndirectExpense);

  // shardへ書き出し
  const profileStats: Record<Profile, { shardCount: number; gzipBytes: number; maxShardBytes: number }> = {
    core: { shardCount: 0, gzipBytes: 0, maxShardBytes: 0 },
    context: { shardCount: 0, gzipBytes: 0, maxShardBytes: 0 },
    spending: { shardCount: 0, gzipBytes: 0, maxShardBytes: 0 },
  };
  const projectProfiles = new Map<string, Set<Profile>>();
  for (const profile of ['core', 'context', 'spending'] as Profile[]) {
    const byShard = new Map<string, Record<string, Bundle>>();
    for (const [pid, bundle] of bundlesByProfile[profile]) {
      const shard = rsShard(pid);
      const shardMap = byShard.get(shard) ?? {};
      shardMap[pid] = bundle;
      byShard.set(shard, shardMap);
      const profiles = projectProfiles.get(pid) ?? new Set();
      profiles.add(profile);
      projectProfiles.set(pid, profiles);
    }
    for (const [shard, shardMap] of byShard) {
      const bytes = writeGzipJson(path.join(outDir, profile, `${shard}.json.gz`), shardMap);
      profileStats[profile].shardCount++;
      profileStats[profile].gzipBytes += bytes;
      profileStats[profile].maxShardBytes = Math.max(profileStats[profile].maxShardBytes, bytes);
    }
  }

  // referential integrity: index/coreに現れる全projectIdがshard参照どおり読めるかを検算する
  const referentialIntegrityErrors: string[] = [];
  for (const pid of projectById.keys()) {
    if (!projectProfiles.get(pid)?.has('core')) referentialIntegrityErrors.push(`projectId=${pid}: coreプロファイルにbundleが無い`);
  }

  // index: 一覧・検索・filter・sortをindex単体で完結させる
  const graphMetricsForIndex = ['blockCount', 'semanticEdgeCount', 'hasCycle', 'weakComponentCount', 'maxOutDegree', 'orphanBlockIds', 'externalRootBlockIds', 'duplicateRelationPairCount', 'indirectExpenseCount'] as const;
  const indexRows = [...projectById.keys()].sort((a, b) => {
    const na = Number(a); const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }).map(pid => {
    const project = projectById.get(pid)!;
    const row: Record<string, unknown> = pick(project as unknown as Record<string, unknown>, ['projectId', 'projectName', 'ministry', 'bureau', 'startYear', 'officialProjectUrl']);
    row.reviewYear = reviewYear;
    row.shard = rsShard(pid);
    row.profiles = [...(projectProfiles.get(pid) ?? [])].sort();

    const budget = indexBudgetByProject.get(pid);
    if (budget) {
      row.budgetSummary = pick({
        initial: budget['当初予算（合計）'], supplements: budget['補正予算（合計）'], total: budget['計（歳出予算現額合計）'],
      }, ['initial', 'supplements', 'total']);
    }

    const graph = graphByProject.get(pid);
    row.hasFundingGraph = Boolean(graph);
    if (graph) {
      row.graph = pick(graph.metrics as unknown as Record<string, unknown>, graphMetricsForIndex as readonly string[]);
      row.hasCycle = graph.metrics.hasCycle;
      row.hasOrphanBlocks = graph.metrics.orphanBlockIds.length > 0;
      row.hasDuplicateRelations = graph.metrics.duplicateRelationPairCount > 0;
    }

    const links = linksByProject.get(pid) ?? [];
    row.hasMofLink = links.length > 0;
    row.mofLinkCount = links.length;
    const mofSectionIds = new Set<string>();
    for (const { fiscalYear, link } of links) {
      const recordToSection = recordToSectionCache.get(fiscalYear) ?? loadRecordToSection(outputRoot, fiscalYear);
      recordToSectionCache.set(fiscalYear, recordToSection);
      for (const rid of link.mofRecordIds) {
        const sid = recordToSection.get(rid);
        if (sid) mofSectionIds.add(sid);
      }
    }
    row.mofSectionCount = mofSectionIds.size;

    const contextBundle = bundlesByProfile.context.get(pid);
    row.contextCounts = pick({
      policies: (contextBundle?.policies as unknown[] | undefined)?.length ?? 0,
      subsidyRules: (contextBundle?.subsidyRules as unknown[] | undefined)?.length ?? 0,
      projectRelations: (contextBundle?.projectRelations as unknown[] | undefined)?.length ?? 0,
      logicModel: (contextBundle?.logicNodes as unknown[] | undefined)?.length ?? 0,
      evaluations: (contextBundle?.evaluations as unknown[] | undefined)?.length ?? 0,
    }, ['policies', 'subsidyRules', 'projectRelations', 'logicModel', 'evaluations'], { keepZero: false });

    return row;
  });

  const indexObj = { schemaVersion: 2, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, reviewYear, projectCount: indexRows.length, projects: indexRows };
  const indexGzipBytes = writeGzipJson(path.join(outDir, 'index.json.gz'), indexObj);

  const completeness: 'full' | 'partial' = normManifest.downloadCsvAvailable ? 'full' : 'partial';
  const manifestObj = {
    schemaVersion: 2,
    publishSchemaVersion: PUBLISH_SCHEMA_VERSION,
    reviewYear,
    completeness,
    sourceAvailability: {
      downloadCsv: Boolean(normManifest.downloadCsvAvailable),
      reviewSheets: Boolean(normManifest.reviewSheets?.available),
      spending: bundlesByProfile.spending.size > 0,
      fundingGraph: graphs.length > 0,
    },
    projectCount: indexRows.length,
    shardAlgorithm: "sha256('rs-project:' + projectId) 先頭2桁",
    index: 'index.json.gz',
    profiles: Object.fromEntries((['core', 'context', 'spending'] as Profile[]).map(p => [p, {
      pathTemplate: `${p}/{shard}.json.gz`, shardCount: profileStats[p].shardCount, compressedBytes: profileStats[p].gzipBytes, maxShardBytes: profileStats[p].maxShardBytes,
    }])),
    normalizedRecordCounts: recordCounts,
    linkProducts,
  };
  writeJson(path.join(outDir, 'manifest.json'), manifestObj);

  return { reviewYear, projectCount: indexRows.length, indexGzipBytes, profiles: profileStats, completeness, referentialIntegrityErrors };
}

/**
 * public/data/v2/mof/fy{year} を生成する。参照実装 publish_mof_year を土台に、
 * 項単位の集約はderive-mof.tsのsections.jsonl/stage-gaps.jsonlをそのまま使う
 * （同じ計算をpublish層で再度行わない）。detail shard（records/items/events/
 * relations/rsLinks）はlib/mof-publish.tsで組み立てる。
 * 戻り値のrecordToSectionは、standalone links product構築で再利用する。
 */
function publishMofYear(outputRoot: string, publicRoot: string, fiscalYear: number, reviewYears: number[]): {
  result: { fiscalYear: number; sectionCount: number; indexGzipBytes: number; shardCount: number; gzipBytes: number; maxShardBytes: number } | null;
  recordToSection: Map<string, string>;
} {
  const normDir = path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`);
  const droot = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
  const itemsPath = path.join(normDir, 'budget-items.jsonl');
  const eventsPath = path.join(droot, 'budget-events.jsonl');
  if (!fs.existsSync(itemsPath) || !fs.existsSync(eventsPath)) return { result: null, recordToSection: new Map() };

  const items = readJsonl<MofBudgetItemRecord>(itemsPath);
  const events = readJsonl<MofDerivedBudgetEvent>(eventsPath);
  const relations = readJsonl<MofIdentityRelation>(path.join(droot, 'identity-relations.jsonl'));
  const stageGaps = readJsonl<MofStageGap>(path.join(droot, 'stage-gaps.jsonl'));
  const sections = readJsonl<MofDerivedSection>(path.join(droot, 'sections.jsonl'));

  const recordToSection = loadRecordToSection(outputRoot, fiscalYear);

  const linksByReviewYear: { reviewYear: number; links: import('./types').MofRsProjectLinkGroup[] }[] = [];
  const linkProducts: { reviewYear: number; fiscalYear: number; linkGroupCount: number; linkedProjectCount: number }[] = [];
  const linksDir = path.join(outputRoot, 'derived', 'links');
  for (const reviewYear of reviewYears) {
    const linkPath = path.join(linksDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`);
    if (!fs.existsSync(linkPath)) continue;
    const links = readJsonl<import('./types').MofRsProjectLinkGroup>(linkPath);
    linksByReviewYear.push({ reviewYear, links });
    linkProducts.push({ reviewYear, fiscalYear, linkGroupCount: links.length, linkedProjectCount: new Set(links.flatMap(l => l.projectIds)).size });
  }

  const details = buildMofSectionDetails(fiscalYear, items, events, relations, stageGaps, linksByReviewYear);

  // section単位のRS link件数（index用）。reviewYear別の件数と、事業数（重複除去）を出す
  const rsLinkCountsBySection = new Map<string, Record<string, number>>();
  const rsProjectsBySection = new Map<string, Set<string>>();
  for (const { reviewYear, links } of linksByReviewYear) {
    for (const link of links) {
      const sids = new Set(link.mofRecordIds.filter(id => recordToSection.has(id)).map(id => recordToSection.get(id)!));
      for (const sid of sids) {
        const counts = rsLinkCountsBySection.get(sid) ?? {};
        counts[String(reviewYear)] = (counts[String(reviewYear)] ?? 0) + 1;
        rsLinkCountsBySection.set(sid, counts);
        const projects = rsProjectsBySection.get(sid) ?? new Set<string>();
        for (const pid of link.projectIds) projects.add(pid);
        rsProjectsBySection.set(sid, projects);
      }
    }
  }

  const outDir = path.join(publicRoot, 'data', 'v2', 'mof', `fy${fiscalYear}`);
  fs.rmSync(outDir, { recursive: true, force: true });

  const detailsByShard = new Map<string, Record<string, unknown>>();
  for (const [sid, detail] of details) {
    const shard = mofSectionShard(sid);
    const shardMap = detailsByShard.get(shard) ?? {};
    shardMap[sid] = detail;
    detailsByShard.set(shard, shardMap);
  }
  let gzipBytes = 0;
  let maxShardBytes = 0;
  for (const [shard, values] of detailsByShard) {
    const bytes = writeGzipJson(path.join(outDir, 'sections', `${shard}.json.gz`), values);
    gzipBytes += bytes;
    maxShardBytes = Math.max(maxShardBytes, bytes);
  }

  const indexRows = sections.map(s => buildMofIndexRow(s, rsLinkCountsBySection.get(s.id) ?? {}, rsProjectsBySection.get(s.id)?.size ?? 0, details.get(s.id)?.relations?.length ?? 0));
  const settlementPath = path.join(droot, 'settlement-equation.json');
  const settlementChecks = fs.existsSync(settlementPath) ? (JSON.parse(fs.readFileSync(settlementPath, 'utf-8')).checkedRows ?? 0) : 0;
  const indexObj = {
    schemaVersion: 2, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, fiscalYear, sectionCount: indexRows.length,
    recordCount: items.length, eventCount: events.length, settlementChecks, sections: indexRows,
  };
  const indexGzipBytes = writeGzipJson(path.join(outDir, 'index.json.gz'), indexObj);

  const manifestObj = {
    schemaVersion: 2, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, fiscalYear, sectionCount: indexRows.length,
    shardAlgorithm: 'sectionId 先頭2桁', index: 'index.json.gz',
    sections: { pathTemplate: 'sections/{shard}.json.gz', shardCount: detailsByShard.size, compressedBytes: gzipBytes, maxShardBytes },
    linkProducts,
  };
  writeJson(path.join(outDir, 'manifest.json'), manifestObj);

  return {
    result: { fiscalYear, sectionCount: indexRows.length, indexGzipBytes, shardCount: detailsByShard.size, gzipBytes, maxShardBytes },
    recordToSection,
  };
}

/**
 * public/data/v2/links/review-{ry}-fy{fy} を生成する。project coreへの埋め込みは
 * 「この事業からMOFを見る」用途、standalone linksは「このMOF項から複数事業を見る」
 * 用途として別に持つ（2026-09-20指摘）。
 */
function publishLinkProduct(outputRoot: string, publicRoot: string, reviewYear: number, fiscalYear: number, recordToSection: Map<string, string>): {
  reviewYear: number; fiscalYear: number; linkGroupCount: number; projectCount: number; sectionCount: number; gzipBytes: number;
} | null {
  const linkPath = path.join(outputRoot, 'derived', 'links', `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`);
  if (!fs.existsSync(linkPath)) return null;
  const rows = readJsonl<import('./types').MofRsProjectLinkGroup>(linkPath);
  const projectIds = new Set<string>();
  const sectionIds = new Set<string>();
  const links = rows.map(row => {
    const sids = [...new Set(row.mofRecordIds.filter(id => recordToSection.has(id)).map(id => recordToSection.get(id)!))].sort();
    for (const pid of row.projectIds) projectIds.add(pid);
    for (const sid of sids) sectionIds.add(sid);
    return {
      linkId: row.linkId, phase: row.phase, revision: row.revision, matchMethod: row.matchMethod,
      sectionIds: sids, projectIds: row.projectIds,
      mofAmountYen: row.mofAmountYen, rsAmountYen: row.rsAmountYen, differenceYen: row.differenceYen,
    };
  });
  const outDir = path.join(publicRoot, 'data', 'v2', 'links', `review-${reviewYear}-fy${fiscalYear}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const gzipBytes = writeGzipJson(path.join(outDir, 'links.json.gz'), { schemaVersion: 2, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, reviewYear, fiscalYear, links });
  const manifestObj = { schemaVersion: 2, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, reviewYear, fiscalYear, linkGroupCount: links.length, projectCount: projectIds.size, sectionCount: sectionIds.size, compressedBytes: gzipBytes, file: 'links.json.gz' };
  writeJson(path.join(outDir, 'manifest.json'), manifestObj);
  return { reviewYear, fiscalYear, linkGroupCount: links.length, projectCount: projectIds.size, sectionCount: sectionIds.size, gzipBytes };
}

/**
 * public/data/v2/links/review-{ry}-fy{fy}/settlement.json.gz を生成する（Phase B3a）。
 * publishLinkProduct()が同ディレクトリへlinks.json.gz/manifest.jsonを書き終えた後に
 * 呼び出す前提（rmSyncせず、既存manifest.jsonへsettlementサマリを追記する）。
 *
 * derivedのmof-rs-settlement-review-*-diagnostics.jsonが無い（=derive-integrated.tsが
 * この年度組み合わせで決算identityを一度も生成していない）場合はnullを返しスキップする。
 * artifact_missing/no_settlement_rowsの場合もこの関数自体は実行され、
 * identities=[]のsettlement.json.gzを生成する（dataStatusで区別可能にする）。
 */
function publishSettlementProduct(
  outputRoot: string, publicRoot: string, reviewYear: number, fiscalYear: number, settlementItems: SettlementItemRecord[]
): { reviewYear: number; fiscalYear: number; dataStatus: string; relationCount: number; linkedProjectCount: number; gzipBytes: number } | null {
  const diagnosticsPath = path.join(outputRoot, 'derived', 'links', `mof-rs-settlement-review-${reviewYear}-fy${fiscalYear}-diagnostics.json`);
  const relationsPath = path.join(outputRoot, 'derived', 'links', `mof-rs-settlement-review-${reviewYear}-fy${fiscalYear}.jsonl`);
  if (!fs.existsSync(diagnosticsPath)) return null;

  const diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf-8')) as MofRsSettlementDiagnostics;
  if (diagnostics.schemaVersion !== SETTLEMENT_IDENTITY_SCHEMA_VERSION) {
    throw new Error(
      `mof-rs-settlement-review-${reviewYear}-fy${fiscalYear}-diagnostics.json has unexpected schemaVersion=${diagnostics.schemaVersion} ` +
      `(expected ${SETTLEMENT_IDENTITY_SCHEMA_VERSION}). Re-run derive-integrated.ts before publishing.`
    );
  }

  const relations = readJsonl<MofRsSettlementIdentityRelation>(relationsPath);
  const settlementItemsByKey = new Map(settlementItems.map(s => [s.itemNaturalKey, s]));
  const identities = relations.map(r => compactSettlementIdentity(r, settlementItemsByKey));
  const diagnosticsSummary = compactSettlementDiagnostics(diagnostics);

  const outDir = path.join(publicRoot, 'data', 'v2', 'links', `review-${reviewYear}-fy${fiscalYear}`);
  const settlementObj = {
    schemaVersion: 1, publishSchemaVersion: PUBLISH_SCHEMA_VERSION, reviewYear, fiscalYear,
    dataStatus: diagnostics.settlementDataStatus, identities, diagnostics: diagnosticsSummary,
  };
  const gzipBytes = writeGzipJson(path.join(outDir, 'settlement.json.gz'), settlementObj);

  const manifestPath = path.join(outDir, 'manifest.json');
  const existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  const manifestObj = {
    ...existingManifest,
    settlement: {
      dataStatus: diagnostics.settlementDataStatus, relationCount: diagnostics.relationCount,
      linkedProjectCount: diagnostics.linkedProjectCount, compressedBytes: gzipBytes, file: 'settlement.json.gz',
    },
  };
  writeJson(manifestPath, manifestObj);

  return {
    reviewYear, fiscalYear, dataStatus: diagnostics.settlementDataStatus,
    relationCount: diagnostics.relationCount, linkedProjectCount: diagnostics.linkedProjectCount, gzipBytes,
  };
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    total += stat.isDirectory() ? dirSizeBytes(p) : stat.size;
  }
  return total;
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const reviewYears = years.length > 0 ? years : [2024, 2025, 2026];
  const fiscalYears = [2023, 2024, 2025];
  const outputRoot = 'data';
  const publicRoot = 'public';
  fs.rmSync(path.join(publicRoot, 'data', 'v2'), { recursive: true, force: true });

  console.log('=== publish-v2: RS ===');
  const rsProducts: Record<string, unknown>[] = [];
  let totalBytes = 0;
  for (const year of reviewYears) {
    const result = publishRsYear(outputRoot, publicRoot, year);
    if (!result) { console.log(`review-${year}: スキップ（projects.jsonlが無い）`); continue; }
    const profileTotal = Object.values(result.profiles).reduce((s, p) => s + p.gzipBytes, 0);
    totalBytes += result.indexGzipBytes + profileTotal;
    console.log(`review-${year}: projects=${result.projectCount} completeness=${result.completeness} ` +
      `index=${result.indexGzipBytes}B core=${result.profiles.core.gzipBytes}B(${result.profiles.core.shardCount}shard,max${result.profiles.core.maxShardBytes}B) ` +
      `context=${result.profiles.context.gzipBytes}B(${result.profiles.context.shardCount}shard) spending=${result.profiles.spending.gzipBytes}B(${result.profiles.spending.shardCount}shard)`);
    if (result.referentialIntegrityErrors.length > 0) {
      console.log(`  ※ referential integrity errors: ${result.referentialIntegrityErrors.length}件`);
      for (const err of result.referentialIntegrityErrors.slice(0, 5)) console.log(`    - ${err}`);
    }
    rsProducts.push({ reviewYear: year, projectCount: result.projectCount, completeness: result.completeness, indexGzipBytes: result.indexGzipBytes });
  }

  console.log('\n=== publish-v2: MOF ===');
  const mofProducts: Record<string, unknown>[] = [];
  const recordToSectionByFy = new Map<number, Map<string, string>>();
  const settlementItemsByFy = new Map<number, SettlementItemRecord[]>();
  for (const fy of fiscalYears) {
    const { result, recordToSection } = publishMofYear(outputRoot, publicRoot, fy, reviewYears);
    recordToSectionByFy.set(fy, recordToSection);
    const settlementItemsPath = path.join(outputRoot, 'derived', 'mof', `fy${fy}`, 'settlement-items.jsonl');
    settlementItemsByFy.set(fy, fs.existsSync(settlementItemsPath) ? readJsonl<SettlementItemRecord>(settlementItemsPath) : []);
    if (!result) { console.log(`fy${fy}: スキップ（normalized/derivedのbudget-items.jsonlが無い）`); continue; }
    totalBytes += result.indexGzipBytes + result.gzipBytes;
    console.log(`fy${fy}: sections=${result.sectionCount} index=${result.indexGzipBytes}B sections=${result.gzipBytes}B(${result.shardCount}shard,max${result.maxShardBytes}B)`);
    mofProducts.push({ fiscalYear: fy, sectionCount: result.sectionCount, indexGzipBytes: result.indexGzipBytes });
  }

  console.log('\n=== publish-v2: links (standalone) ===');
  const linkProducts: Record<string, unknown>[] = [];
  for (const reviewYear of reviewYears) {
    for (const fiscalYear of fiscalYears) {
      if (fiscalYear > reviewYear) continue;
      const recordToSection = recordToSectionByFy.get(fiscalYear);
      if (!recordToSection || recordToSection.size === 0) continue;
      const result = publishLinkProduct(outputRoot, publicRoot, reviewYear, fiscalYear, recordToSection);
      if (!result) continue;
      totalBytes += result.gzipBytes;
      console.log(`review-${reviewYear}×fy${fiscalYear}: linkGroups=${result.linkGroupCount} projects=${result.projectCount} sections=${result.sectionCount} ${result.gzipBytes}B`);
      const linkEntry: Record<string, unknown> = { ...result };

      const settlementResult = publishSettlementProduct(outputRoot, publicRoot, reviewYear, fiscalYear, settlementItemsByFy.get(fiscalYear) ?? []);
      if (settlementResult) {
        totalBytes += settlementResult.gzipBytes;
        console.log(`  settlement[${settlementResult.dataStatus}]: relations=${settlementResult.relationCount} linkedProjects=${settlementResult.linkedProjectCount} ${settlementResult.gzipBytes}B`);
        linkEntry.settlement = {
          dataStatus: settlementResult.dataStatus, relationCount: settlementResult.relationCount,
          linkedProjectCount: settlementResult.linkedProjectCount, gzipBytes: settlementResult.gzipBytes,
        };
      }
      linkProducts.push(linkEntry);
    }
  }

  console.log(`\n合計gzipサイズ: ${totalBytes.toLocaleString()} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);

  const v2Root = path.join(publicRoot, 'data', 'v2');
  const rootManifest = {
    schemaVersion: 2,
    publishSchemaVersion: PUBLISH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    compression: 'gzip-json',
    sharding: { hexBuckets: 256 },
    mof: mofProducts,
    rs: rsProducts,
    links: linkProducts,
  };
  writeJson(path.join(v2Root, 'manifest.json'), { ...rootManifest, totalPublicBytes: dirSizeBytes(v2Root) });

  console.log('\n=== publish時に落としたフィールド一覧（no silent dropの可視化） ===');
  for (const report of computeDroppedFieldsReport()) {
    if (report.droppedFields.length === 0) {
      console.log(`${report.dataset}: 全フィールド保持`);
    } else {
      console.log(`${report.dataset}: dropped=[${report.droppedFields.join(', ')}]`);
    }
  }
}

main();
