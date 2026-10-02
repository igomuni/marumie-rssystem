/**
 * 概算要求PDFの指定ページについて、SourceToken → TableGeometry → LogicalRowCandidate → SpatialRegionCandidate を観測するPoC。
 * SpatialRegionCandidateはsemantic regionではない（意味ラベル・Coreとの関連付け・数値parse・符号の解釈・文字列の結合はしない）。
 * 全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-spatial-region.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-spatial-region.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-spatial-region.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/spatial-region-poc/{id}.json（data/downloadには書かない）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { EXTRACTION_WORK_DIR, inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { resolvePageJobs, type PageJob } from './lib/budget-request-page-jobs';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { COORDINATE_SYSTEM } from './lib/budget-request-source-token';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { detectSpatialRegions, SPATIAL_REGION_SCHEMA } from './lib/budget-request-spatial-region';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-spatial-region.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/spatial-region-poc/{id}.json`;

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
  const spatial = detectSpatialRegions(extraction.tokens, geometry, logical);
  const out = {
    schema: SPATIAL_REGION_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    coordinateSystem: COORDINATE_SYSTEM,
    parameters: { tableGeometry: geometry.parameters, logicalRow: logical.parameters, spatialRegion: spatial.parameters },
    sourceTokenCount: geometry.sourceTokenCount,
    physicalRowCount: geometry.physicalRows.length,
    logicalRowCandidateCount: logical.logicalRowCandidates.length,
    spatialRegions: spatial.regions,
    unassignedTokenIndexes: spatial.unassignedTokenIndexes,
    unassignedPhysicalRowIndexes: spatial.unassignedPhysicalRowIndexes,
    nonRowTokenIndexes: spatial.nonRowTokenIndexes,
    gutters: spatial.gutters,
    ambiguousAssignments: spatial.ambiguousAssignments,
    diagnostics: spatial.diagnostics,
    note: 'regions reference SourceToken.index / PhysicalRowCandidate.rowIndex / LogicalRowCandidate.logicalRowIndex of this page; SpatialRegionCandidate is not a semantic region',
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'spatial-region-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const c = spatial.diagnostics.counts;
  const big = spatial.diagnostics.largestRegion;
  const cmp = spatial.diagnostics.algorithmComparison;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} sourceTokens=${c.sourceTokenCount} physicalRows=${geometry.physicalRows.length} logicalRowCandidates=${logical.logicalRowCandidates.length} ` +
      `regions=${spatial.regions.length} assigned=${c.assignedTokenCount} unassigned=${c.unassignedTokenCount} ambiguousAssignments=${c.ambiguousAssignmentCount} gutters=${spatial.gutters.length}\n` +
      `  largestRegion: ${big ? `#${big.regionIndex} tokens=${big.tokenCount} physicalRows=${big.physicalRowCount} bbox=(${big.bbox.xMin},${big.bbox.yMin})-(${big.bbox.xMax},${big.bbox.yMax})` : '-'}\n` +
      `  A(connected-components only): components=${cmp.connectedComponentsOnly.componentCount} regions=${cmp.connectedComponentsOnly.regionCount} largest=${cmp.connectedComponentsOnly.largestRegionTokenCount} tokens/${cmp.connectedComponentsOnly.largestRegionPhysicalRowCount} rows, edges suppressed by gutters=${cmp.connectedComponentsOnly.edgesSuppressedByGutters}\n` +
      `  → ${file}`,
  );
  for (const r of spatial.regions) {
    console.log(`    region ${r.regionIndex}: bbox=(${r.bbox.xMin},${r.bbox.yMin})-(${r.bbox.xMax},${r.bbox.yMax}) tokens=${r.geometry.tokenCount} rows=${r.geometry.physicalRowCount} [${r.physicalRowIndexes[0]}..${r.physicalRowIndexes[r.physicalRowIndexes.length - 1]}] band=${r.evidence.xBand}${r.ambiguity ? ` ambiguity: ${r.ambiguity.reason}` : ''}`);
  }
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

  console.log(`=== SpatialRegion PoC: year=${year} jobs=${jobs.length} ===`);
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
