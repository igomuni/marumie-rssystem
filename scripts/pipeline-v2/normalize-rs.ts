/**
 * RS公開CSV（download-rs-csv.tsが取得したraw ZIP）をsource-preservingな
 * 正規化JSONLへ変換する。仕様: 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md 6節。
 * 参照実装: Python版 pipeline_v2/normalize_rs.py。
 *
 * 実装済み: 1-1(organizations) 1-2(projects, review-sheetsマージ込み) 1-3(policies-laws)
 *           1-4(subsidy-rules) 1-5(project-relations) 2-1(budget-summaries/budget-events)
 *           2-2(budget-items) 3-1(logic-model-nodes/observations) 3-2(logic-model-relations)
 *           4-1(evaluations) 5-1(spending-blocks/recipients/contracts) 5-2(funding-relations/
 *           indirect-expenses) 5-3(expense-uses) 5-4(multi-year-contracts) 6-1(notes)
 *           review-sheets（sheets/{year}/**.csvの様式1・様式2のみ。様式3・4は対象外）
 *
 * 重要な意味論（参照実装と同じ）:
 *   - blank（空欄）と明示的な0円を区別する（parseNumberはblankでnullを返す。0に潰さない）
 *   - RS `予備費等`はneutralな'adjustment'として扱い、決算のreserve_useと混同しない
 *   - 5-1は支出先ブロック集計行・支出先行・契約行が同じCSVに混在するため、
 *     block/recipient/contractの3種類へ明示的に分離する
 *   - 5-2は一般有向グラフとして扱う。重複辺・循環・多始点・孤立ブロックを削除・統合しない
 *   - 1-2とreview-sheetsで値が食い違う場合は断定せずproject-sheet-conflicts.jsonlへ記録し、
 *     1-2側の値を優先したまま残す（mergeProjects）
 *
 * streaming: 1行入力→1行出力の単純な変換（1-1/1-2/1-3/1-4/1-5/2-2/3-2/4-1/5-3/5-4/6-1）は
 * CSV row iterator（readSingleCsvIter）→normalize generator→writeJsonlの経路で、raw行配列・
 * 出力配列のどちらも全展開しない。2-1/3-1/5-1/5-2は同一行から複数output・Map集約を要するため、
 * 引き続き配列ベース（readSingleCsv）のまま。
 *
 * sheets-only年度（CSVバルク未公開・レビューシートのみ公開中、例: 2026）も対象に含める。
 * download-csv系のzipが無いためzipベースのデータセットは全て0件になるが、review-sheets.jsonl・
 * projects.jsonl（レビューシートのみから作られる事業）は生成される（Python参照実装と同じ挙動）。
 *
 * 入力: data/download/rssystem.go.jp/download-csv/{year}/*.zip
 *       data/download/rssystem.go.jp/sheets/{year}/**\/*.csv
 * 出力: data/normalized/rs/review-{year}/*.jsonl + manifest.json
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-rs.ts [year...]
 *   （年度省略時はdata/download/rssystem.go.jp/{download-csv,sheets}から検出した全年度）
 */
import * as path from 'path';
import { discoverRsYears, findRsZip, readSingleCsv, readSingleCsvIter } from './lib/rs-zip';
import { normalizeOrganizations } from './lib/rs-organizations';
import { normalizeProjectRows, mergeProjects } from './lib/rs-projects';
import { normalizePoliciesLaws } from './lib/rs-policies-laws';
import { normalizeSubsidyRules } from './lib/rs-subsidy-rules';
import { normalizeProjectRelations } from './lib/rs-project-relations';
import { normalizeBudgetSummary, normalizeBudgetItems } from './lib/rs-budget';
import { normalizeLogicModel, normalizeLogicRelations } from './lib/rs-logic-model';
import { normalizeEvaluations } from './lib/rs-evaluations';
import { normalizeSpending, toExpenditureCompat } from './lib/rs-spending';
import { normalizeFundingRelations } from './lib/rs-funding';
import { normalizeExpenseUses } from './lib/rs-expense-uses';
import { normalizeMultiYearContracts } from './lib/rs-multi-year-contracts';
import { normalizeNotes } from './lib/rs-notes';
import { normalizeReviewSheets } from './lib/rs-review-sheets';
import { writeJsonl, writeJson } from './lib/jsonl';
import type { RsProjectSourceRow, SourceInventory } from './types';

function processYear(rawRoot: string, outputRoot: string, year: number): Record<string, number> {
  console.log(`\n=== RS normalize: reviewYear=${year} ===`);
  const yearDir = path.join(rawRoot, 'rssystem.go.jp', 'download-csv', String(year));
  const outDir = path.join(outputRoot, 'normalized', 'rs', `review-${year}`);
  const counts: Record<string, number> = {};
  const sourceInventories: SourceInventory[] = [];

  const emit = (name: string, rows: Iterable<unknown>) => {
    const n = writeJsonl(path.join(outDir, `${name}.jsonl`), rows);
    counts[name] = n;
    console.log(`  ${name}.jsonl: ${n}件`);
  };

  const { rows: sheetRows, manifest: sheetManifest } = normalizeReviewSheets(rawRoot, year);
  emit('review-sheets', sheetRows);

  const zip11 = findRsZip(yearDir, '1-1', year);
  if (zip11) {
    const { entry, headers, rows } = readSingleCsvIter(zip11);
    const result = normalizeOrganizations(rawRoot, zip11, entry, rows, year, headers);
    emit('organizations', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('organizations', []);
  }

  const zip12 = findRsZip(yearDir, '1-2', year);
  // mergeProjects()とproject-source-rows.jsonlの両方が全行を必要とするため、
  // ここだけはgeneratorを配列へ確定させる（mergeProjectsのMap集約自体が
  // 参照実装と同じく全件走査を要するため、避けられない）
  let projectSourceRows: RsProjectSourceRow[] = [];
  if (zip12) {
    const { entry, headers, rows } = readSingleCsvIter(zip12);
    const result = normalizeProjectRows(rawRoot, zip12, entry, rows, year, headers);
    projectSourceRows = [...result.rows];
    sourceInventories.push(result.sourceInventory());
  }
  const { projects, conflicts: projectSheetConflicts } = mergeProjects(projectSourceRows, sheetRows, year);
  emit('project-source-rows', projectSourceRows);
  emit('projects', projects);
  emit('project-sheet-conflicts', projectSheetConflicts);

  const zip13 = findRsZip(yearDir, '1-3', year);
  if (zip13) {
    const { entry, headers, rows } = readSingleCsvIter(zip13);
    const result = normalizePoliciesLaws(rawRoot, zip13, entry, rows, year, headers);
    emit('policies-laws', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('policies-laws', []);
  }

  const zip14 = findRsZip(yearDir, '1-4', year);
  if (zip14) {
    const { entry, headers, rows } = readSingleCsvIter(zip14);
    const result = normalizeSubsidyRules(rawRoot, zip14, entry, rows, year, headers);
    emit('subsidy-rules', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('subsidy-rules', []);
  }

  const zip15 = findRsZip(yearDir, '1-5', year);
  if (zip15) {
    const { entry, headers, rows } = readSingleCsvIter(zip15);
    const result = normalizeProjectRelations(rawRoot, zip15, entry, rows, year, headers);
    emit('project-relations', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('project-relations', []);
  }

  const zip21 = findRsZip(yearDir, '2-1', year);
  if (zip21) {
    const { entry, rows } = readSingleCsv(zip21);
    const { summaries, events, sourceInventory } = normalizeBudgetSummary(rawRoot, zip21, entry, rows, year);
    emit('budget-summaries', summaries);
    emit('budget-events', events);
    sourceInventories.push(sourceInventory);
  } else {
    emit('budget-summaries', []);
    emit('budget-events', []);
  }

  const zip22 = findRsZip(yearDir, '2-2', year);
  if (zip22) {
    const { entry, headers, rows } = readSingleCsvIter(zip22);
    const result = normalizeBudgetItems(rawRoot, zip22, entry, rows, year, headers);
    emit('budget-items', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('budget-items', []);
  }

  const zip31 = findRsZip(yearDir, '3-1', year);
  if (zip31) {
    const { entry, rows } = readSingleCsv(zip31);
    const { nodes, observations, sourceInventory } = normalizeLogicModel(rawRoot, zip31, entry, rows, year);
    emit('logic-model-nodes', nodes);
    emit('logic-model-observations', observations);
    sourceInventories.push(sourceInventory);
  } else {
    emit('logic-model-nodes', []);
    emit('logic-model-observations', []);
  }

  const zip32 = findRsZip(yearDir, '3-2', year);
  if (zip32) {
    const { entry, headers, rows } = readSingleCsvIter(zip32);
    const result = normalizeLogicRelations(rawRoot, zip32, entry, rows, year, headers);
    emit('logic-model-relations', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('logic-model-relations', []);
  }

  const zip41 = findRsZip(yearDir, '4-1', year);
  if (zip41) {
    const { entry, headers, rows } = readSingleCsvIter(zip41);
    const result = normalizeEvaluations(rawRoot, zip41, entry, rows, year, headers);
    emit('evaluations', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('evaluations', []);
  }

  const zip51 = findRsZip(yearDir, '5-1', year);
  if (zip51) {
    const { entry, rows } = readSingleCsv(zip51);
    const { blocks, recipients, contracts, sourceInventory } = normalizeSpending(rawRoot, zip51, entry, rows, year);
    emit('spending-blocks', blocks);
    emit('recipients', recipients);
    emit('contracts', contracts);
    emit('expenditures', toExpenditureCompat(contracts, year));
    sourceInventories.push(sourceInventory);
  } else {
    emit('spending-blocks', []);
    emit('recipients', []);
    emit('contracts', []);
    emit('expenditures', []);
  }

  const zip52 = findRsZip(yearDir, '5-2', year);
  if (zip52) {
    const { entry, rows } = readSingleCsv(zip52);
    const { relations, indirect, sourceInventory } = normalizeFundingRelations(rawRoot, zip52, entry, rows, year);
    emit('funding-relations', relations);
    emit('indirect-expenses', indirect);
    sourceInventories.push(sourceInventory);
  } else {
    emit('funding-relations', []);
    emit('indirect-expenses', []);
  }

  const zip53 = findRsZip(yearDir, '5-3', year);
  if (zip53) {
    const { entry, headers, rows } = readSingleCsvIter(zip53);
    const result = normalizeExpenseUses(rawRoot, zip53, entry, rows, year, headers);
    emit('expense-uses', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('expense-uses', []);
  }

  const zip54 = findRsZip(yearDir, '5-4', year);
  if (zip54) {
    const { entry, headers, rows } = readSingleCsvIter(zip54);
    const result = normalizeMultiYearContracts(rawRoot, zip54, entry, rows, year, headers);
    emit('multi-year-contracts', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('multi-year-contracts', []);
  }

  const zip61 = findRsZip(yearDir, '6-1', year);
  if (zip61) {
    const { entry, headers, rows } = readSingleCsvIter(zip61);
    const result = normalizeNotes(rawRoot, zip61, entry, rows, year, headers);
    emit('notes', result.rows);
    sourceInventories.push(result.sourceInventory());
  } else {
    emit('notes', []);
  }

  const unknownNonEmptyColumns = sourceInventories
    .flatMap(inv => inv.columns.filter(c => c.status === 'extra_preserved').map(c => `${inv.datasetCode}:${c.column}`));
  if (unknownNonEmptyColumns.length > 0) {
    console.log(`  ※ 未マッピングだが非空の列（extraFieldsに保持済み）: ${unknownNonEmptyColumns.join(', ')}`);
  }

  writeJson(path.join(outDir, 'manifest.json'), {
    schemaVersion: 2,
    sourceYear: year,
    reviewYear: year,
    downloadCsvAvailable: sourceInventories.length > 0,
    recordCounts: counts,
    implementedDatasets: ['1-1', '1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '3-1', '3-2', '4-1', '5-1', '5-2', '5-3', '5-4', '6-1', 'review-sheets-merge'],
    pendingDatasets: [],
    reviewSheets: sheetManifest,
    sourceInventories,
  });

  return counts;
}

function main(): void {
  const rawRoot = path.join('data', 'download');
  const outputRoot = 'data';
  const explicitYears = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const { downloadCsvYears, sheetsOnlyYears } = discoverRsYears(rawRoot, explicitYears.length > 0 ? new Set(explicitYears) : undefined);

  if (sheetsOnlyYears.length > 0) {
    console.log(`\n※ sheets-onlyの年度（CSVバルク未公開、レビューシートのみ公開中）: ${sheetsOnlyYears.join(', ')}`);
    console.log('  review-sheets.jsonl・projects.jsonl（レビューシート由来）のみ生成し、zipベースのデータセットは0件になる');
  }

  const allYears = [...new Set([...downloadCsvYears, ...sheetsOnlyYears])].sort((a, b) => a - b);
  const allCounts: Record<string, Record<string, number>> = {};
  for (const year of allYears) {
    allCounts[String(year)] = processYear(rawRoot, outputRoot, year);
  }
  writeJson(path.join(outputRoot, 'normalized', 'rs', 'manifest.json'), {
    schemaVersion: 2,
    sourceYears: allCounts,
    downloadCsvYears,
    sheetsOnlyYears,
  });
}

main();
