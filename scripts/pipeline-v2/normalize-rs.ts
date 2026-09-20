/**
 * RS公開CSV（download-rs-csv.tsが取得したraw ZIP）をsource-preservingな
 * 正規化JSONLへ変換する。仕様: 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md 6節。
 * 参照実装: Python版 pipeline_v2/normalize_rs.py。
 *
 * 今回のスコープ（優先度の高い4系統を実装、残りは今後）:
 *   実装済み: 1-1(organizations) 1-2(projects, sheetマージ無し) 2-1(budget-summaries/
 *             budget-events) 2-2(budget-items) 5-1(spending-blocks/recipients/contracts)
 *             5-2(funding-relations/indirect-expenses)
 *   未実装:   1-3/1-4/1-5(policies-laws/subsidy-rules/project-relations) 3-1/3-2(logic-model)
 *             4-1(evaluations) 5-3(expense-uses) 5-4(multi-year-contracts) 6-1(notes)
 *             review-sheetsとのproject merge
 *
 * 重要な意味論（参照実装と同じ）:
 *   - blank（空欄）と明示的な0円を区別する（parseNumberはblankでnullを返す。0に潰さない）
 *   - RS `予備費等`はneutralな'adjustment'として扱い、決算のreserve_useと混同しない
 *   - 5-1は支出先ブロック集計行・支出先行・契約行が同じCSVに混在するため、
 *     block/recipient/contractの3種類へ明示的に分離する
 *   - 5-2は一般有向グラフとして扱う。重複辺・循環・多始点・孤立ブロックを削除・統合しない
 *
 * 入力: data/download/rssystem.go.jp/download-csv/{year}/*.zip
 * 出力: data/normalized/rs/review-{year}/*.jsonl + manifest.json
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-rs.ts [year...]
 *   （年度省略時はdata/download/rssystem.go.jp/download-csvから検出した全年度）
 */
import * as path from 'path';
import { discoverRsYears, findRsZip, readSingleCsv } from './lib/rs-zip';
import { normalizeOrganizations } from './lib/rs-organizations';
import { normalizeProjectRows, mergeProjects } from './lib/rs-projects';
import { normalizeBudgetSummary, normalizeBudgetItems } from './lib/rs-budget';
import { normalizeSpending, toExpenditureCompat } from './lib/rs-spending';
import { normalizeFundingRelations } from './lib/rs-funding';
import { writeJsonl, writeJson } from './lib/jsonl';

function processYear(rawRoot: string, outputRoot: string, year: number): Record<string, number> {
  console.log(`\n=== RS normalize: reviewYear=${year} ===`);
  const yearDir = path.join(rawRoot, 'rssystem.go.jp', 'download-csv', String(year));
  const outDir = path.join(outputRoot, 'normalized', 'rs', `review-${year}`);
  const counts: Record<string, number> = {};

  const emit = (name: string, rows: unknown[]) => {
    const n = writeJsonl(path.join(outDir, `${name}.jsonl`), rows);
    counts[name] = n;
    console.log(`  ${name}.jsonl: ${n}件`);
  };

  const zip11 = findRsZip(yearDir, '1-1', year);
  emit('organizations', zip11 ? (() => { const { entry, rows } = readSingleCsv(zip11); return normalizeOrganizations(rawRoot, zip11, entry, rows, year); })() : []);

  const zip12 = findRsZip(yearDir, '1-2', year);
  const projectSourceRows = zip12 ? (() => { const { entry, rows } = readSingleCsv(zip12); return normalizeProjectRows(rawRoot, zip12, entry, rows, year); })() : [];
  emit('project-source-rows', projectSourceRows);
  emit('projects', mergeProjects(projectSourceRows, year));

  const zip21 = findRsZip(yearDir, '2-1', year);
  if (zip21) {
    const { entry, rows } = readSingleCsv(zip21);
    const { summaries, events } = normalizeBudgetSummary(rawRoot, zip21, entry, rows, year);
    emit('budget-summaries', summaries);
    emit('budget-events', events);
  } else {
    emit('budget-summaries', []);
    emit('budget-events', []);
  }

  const zip22 = findRsZip(yearDir, '2-2', year);
  emit('budget-items', zip22 ? (() => { const { entry, rows } = readSingleCsv(zip22); return normalizeBudgetItems(rawRoot, zip22, entry, rows, year); })() : []);

  const zip51 = findRsZip(yearDir, '5-1', year);
  if (zip51) {
    const { entry, rows } = readSingleCsv(zip51);
    const { blocks, recipients, contracts } = normalizeSpending(rawRoot, zip51, entry, rows, year);
    emit('spending-blocks', blocks);
    emit('recipients', recipients);
    emit('contracts', contracts);
    emit('expenditures', toExpenditureCompat(contracts, year));
  } else {
    emit('spending-blocks', []);
    emit('recipients', []);
    emit('contracts', []);
    emit('expenditures', []);
  }

  const zip52 = findRsZip(yearDir, '5-2', year);
  if (zip52) {
    const { entry, rows } = readSingleCsv(zip52);
    const { relations, indirect } = normalizeFundingRelations(rawRoot, zip52, entry, rows, year);
    emit('funding-relations', relations);
    emit('indirect-expenses', indirect);
  } else {
    emit('funding-relations', []);
    emit('indirect-expenses', []);
  }

  writeJson(path.join(outDir, 'manifest.json'), {
    schemaVersion: 2,
    sourceYear: year,
    reviewYear: year,
    recordCounts: counts,
    implementedDatasets: ['1-1', '1-2', '2-1', '2-2', '5-1', '5-2'],
    pendingDatasets: ['1-3', '1-4', '1-5', '3-1', '3-2', '4-1', '5-3', '5-4', '6-1', 'review-sheets-merge'],
  });

  return counts;
}

function main(): void {
  const rawRoot = path.join('data', 'download');
  const outputRoot = 'data';
  const explicitYears = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const { downloadCsvYears, sheetsOnlyYears } = discoverRsYears(rawRoot, explicitYears.length > 0 ? new Set(explicitYears) : undefined);

  if (sheetsOnlyYears.length > 0) {
    console.log(`\n※ sheets-onlyの年度（CSVバルク未公開、レビューシートのみ）はスキップ: ${sheetsOnlyYears.join(', ')}`);
    console.log('  review-sheetsとのマージ（事業マスタの取り込み）が未実装のため、対象にすると「0件」という誤解を招く出力になる');
  }

  const allCounts: Record<string, Record<string, number>> = {};
  for (const year of downloadCsvYears) {
    allCounts[String(year)] = processYear(rawRoot, outputRoot, year);
  }
  writeJson(path.join(outputRoot, 'normalized', 'rs', 'manifest.json'), {
    schemaVersion: 2,
    sourceYears: allCounts,
    sheetsOnlyYearsSkipped: sheetsOnlyYears,
  });
}

main();
