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

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025, 2026];
  const outputRoot = 'data';
  const publicRoot = 'public';

  console.log('=== publish-v2: RS ===');
  let totalBytes = 0;
  for (const year of targetYears) {
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
  }
  console.log(`\n合計gzipサイズ: ${totalBytes.toLocaleString()} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);

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
