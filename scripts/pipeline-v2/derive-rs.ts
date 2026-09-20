/**
 * normalized/rs/review-{year}から、RSの金額イベント（budget-events.jsonl）と
 * 事業単位の資金フローグラフ（funding-graphs.jsonl）を作る。
 * 参照実装: Python版 pipeline_v2/derive.py の build_rs_events、
 * pipeline_v2/funding_graph.py の build_funding_graphs_for_year。
 *
 * 入力: data/normalized/rs/review-{year}/{budget-items,budget-summaries,
 *       spending-blocks,funding-relations,indirect-expenses,projects}.jsonl
 * 出力: data/derived/rs/review-{year}/{budget-events.jsonl,budget-events-summary.json,
 *       funding-graphs.jsonl,funding-graph-summary.json}
 *
 * 使い方: npx tsx scripts/pipeline-v2/derive-rs.ts [year...]
 *   （年度省略時は2024 2025 2026）
 */
import * as path from 'path';
import { readJsonl, writeJsonl, writeJson } from './lib/jsonl';
import { buildRsEvents } from './lib/rs-derive-events';
import { buildFundingGraphsForYear } from './lib/rs-funding-graph';
import type {
  RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsSpendingBlockRecord,
  RsFundingRelationRecord, RsIndirectExpenseRecord,
} from './types';
import type { RsProject } from './lib/rs-projects';

function deriveEventsForYear(outputRoot: string, reviewYear: number): { eventCount: number; eventTypeCounts: Record<string, number> } | null {
  const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
  const itemsPath = path.join(normDir, 'budget-items.jsonl');
  const itemRows = readJsonl<RsBudgetItemRecordV2>(itemsPath);
  if (itemRows.length === 0) return null;
  const summaryRows = readJsonl<RsBudgetSummaryRecord>(path.join(normDir, 'budget-summaries.jsonl'));

  const { events, eventTypeCounts, fiscalYears } = buildRsEvents(reviewYear, itemRows, summaryRows);

  const outDir = path.join(outputRoot, 'derived', 'rs', `review-${reviewYear}`);
  writeJsonl(path.join(outDir, 'budget-events.jsonl'), events);
  const summary = { schemaVersion: 2, reviewYear, eventCount: events.length, eventTypeCounts, fiscalYears };
  writeJson(path.join(outDir, 'budget-events-summary.json'), summary);
  return { eventCount: events.length, eventTypeCounts };
}

function deriveFundingGraphForYear(outputRoot: string, reviewYear: number): ReturnType<typeof buildFundingGraphsForYear>['totals'] | null {
  const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
  const blocksPath = path.join(normDir, 'spending-blocks.jsonl');
  const blocks = readJsonl<RsSpendingBlockRecord>(blocksPath);
  const relations = readJsonl<RsFundingRelationRecord>(path.join(normDir, 'funding-relations.jsonl'));
  const indirect = readJsonl<RsIndirectExpenseRecord>(path.join(normDir, 'indirect-expenses.jsonl'));
  const projects = readJsonl<RsProject>(path.join(normDir, 'projects.jsonl'));
  if (blocks.length === 0 && relations.length === 0 && indirect.length === 0) return null;

  const { graphs, totals } = buildFundingGraphsForYear(reviewYear, blocks, relations, indirect, projects);

  const outDir = path.join(outputRoot, 'derived', 'rs', `review-${reviewYear}`);
  writeJsonl(path.join(outDir, 'funding-graphs.jsonl'), graphs);
  writeJson(path.join(outDir, 'funding-graph-summary.json'), { schemaVersion: 2, reviewYear, ...totals });
  return totals;
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025, 2026];
  const outputRoot = 'data';
  const manifest: Record<string, unknown> = {};

  for (const year of targetYears) {
    console.log(`\n=== RS derive: reviewYear=${year} ===`);
    const events = deriveEventsForYear(outputRoot, year);
    if (events) {
      console.log(`  budget-events.jsonl: ${events.eventCount}件`, JSON.stringify(events.eventTypeCounts));
    } else {
      console.log('  budget-events: スキップ（normalized budget-items.jsonlが空）');
    }
    const graph = deriveFundingGraphForYear(outputRoot, year);
    if (graph) {
      console.log(`  funding-graphs.jsonl: ${graph.projectCount}事業, block=${graph.blockNodeCount} edge=${graph.semanticEdgeCount} ` +
        `cycle=${graph.projectsWithCycles} orphan保持=${graph.projectsWithOrphanBlocks} duplicate保持=${graph.projectsWithDuplicateRelationPairs}`);
    } else {
      console.log('  funding-graphs: スキップ（normalized spending/funding-relations/indirect-expensesが全て空）');
    }
    manifest[String(year)] = { events, funding: graph };
  }

  writeJson(path.join(outputRoot, 'derived', 'rs', 'manifest.json'), { schemaVersion: 2, reviewYears: manifest });
}

main();
