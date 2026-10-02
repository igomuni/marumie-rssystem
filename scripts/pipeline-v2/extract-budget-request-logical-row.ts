/**
 * 概算要求PDFの指定ページについて、SourceToken → PhysicalRowCandidate → LogicalRowCandidate（論理行「候補」）を観測するPoC。
 * LogicalRowCandidateは予算明細のsemantic recordではない（意味の分類・Coreとの関連付け・数値parse・符号の解釈・文字列の結合はしない）。
 * 全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-logical-row.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-logical-row.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-logical-row.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/logical-row-poc/{id}.json（data/downloadには書かない）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { EXTRACTION_WORK_DIR, inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { resolvePageJobs, type PageJob } from './lib/budget-request-page-jobs';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { COORDINATE_SYSTEM } from './lib/budget-request-source-token';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { LOGICAL_ROW_SCHEMA, resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-logical-row.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/logical-row-poc/{id}.json`;

function usageError(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

async function runJob(year: number, job: PageJob): Promise<void> {
  const state = inspectTarget(job.target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${job.target.localPath}`);
  const extraction = await extractPageTokens(job.target.localPath, job.page);
  const geometry = buildTableGeometry(extraction.tokens, extraction.page);
  const logical = resolveLogicalRows(extraction.tokens, extraction.page, geometry);
  const out = {
    schema: LOGICAL_ROW_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    coordinateSystem: COORDINATE_SYSTEM,
    parameters: { tableGeometry: geometry.parameters, ...logical.parameters },
    sourceTokenCount: geometry.sourceTokenCount,
    physicalRowCount: geometry.physicalRows.length,
    logicalRowCandidates: logical.logicalRowCandidates,
    diagnostics: logical.diagnostics,
    note: 'candidates reference SourceToken.index / PhysicalRowCandidate.rowIndex of this page (rebuild with extract-budget-request-geometry); LogicalRowCandidate is not a semantic record',
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'logical-row-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const cands = logical.logicalRowCandidates;
  const kinds = (k: string) => cands.filter(c => c.resolution.kind === k).length;
  const d = logical.diagnostics;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} sourceTokens=${geometry.sourceTokenCount} physicalRows=${geometry.physicalRows.length} ` +
      `logicalRowCandidates=${cands.length} (same_physical_row=${kinds('same_physical_row')} continuation_by_geometry=${kinds('continuation_by_geometry')} ambiguous=${kinds('ambiguous')}) ` +
      `segments=${d.segmentation.segmentCount} (rows with >1 segment: ${d.segmentation.rowsWithMultipleSegments}, max ${d.segmentation.maxSegmentsInRow}) ` +
      `chaining(baselineSpan>tolerance)=${d.tableGeometryChaining.rowsExceedingTolerance.length} (max span ${d.tableGeometryChaining.maxBaselineSpan}pt, tolerance ${d.tableGeometryChaining.tableGeometryTolerance}pt)\n  → ${file}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = args.filter(a => a.startsWith('--') && a !== '--golden' && !/^--(sample|document|page)=/.test(a));
  const positional = args.filter(a => !a.startsWith('--'));
  if (unknown.length > 0) return usageError(`unknown option: ${unknown.join(' ')}`);
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d{4}$/.test(positional[0]))) {
    return usageError(`year must be a 4-digit fiscal year: ${positional.join(' ')}`);
  }
  const year = positional[0] ? Number(positional[0]) : 2024;
  let manifest;
  try {
    manifest = getBudgetRequestManifest(year);
  } catch (e) {
    return usageError(e instanceof Error ? e.message : String(e));
  }
  const { jobs, error } = resolvePageJobs(year, listExtractionTargets(manifest), {
    sampleIds: opt('sample')?.split(','),
    golden: args.includes('--golden'),
    documentUrl: opt('document'),
    page: Number(opt('page')),
  });
  if (error) return usageError(error);

  console.log(`=== LogicalRowResolver PoC: year=${year} jobs=${jobs.length} ===`);
  for (const job of jobs) {
    try {
      await runJob(year, job);
    } catch (e) {
      console.error(`\n[${job.id}] failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main();
