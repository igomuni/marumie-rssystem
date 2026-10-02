/**
 * 概算要求PDFの指定ページについて、geometry/observation層（SourceToken〜RegionRelation）の上に SemanticRecordCandidate
 * （主要明細行候補）を観測するPoC。最終的なLogicalDetailRecordではない。この層ではrawTextの内容を候補判定に使うが、
 * canonical valueは作らず（金額はtoken列のまま）、符号の推測・差額の計算・空欄の0化・nearest winnerの選択はしない。
 * 全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-semantic-record.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-semantic-record.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-semantic-record.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/semantic-record-poc/{id}.json（data/downloadには書かない）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { EXTRACTION_WORK_DIR, inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { resolvePageJobs, type PageJob } from './lib/budget-request-page-jobs';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { COORDINATE_SYSTEM } from './lib/budget-request-source-token';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { resolveRegionRelations } from './lib/budget-request-region-relation';
import { detectSemanticRecords, SEMANTIC_RECORD_SCHEMA } from './lib/budget-request-semantic-record';
import { detectSpatialRegions } from './lib/budget-request-spatial-region';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-semantic-record.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/semantic-record-poc/{id}.json`;

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
  const rel = resolveRegionRelations(extraction.page, logical, spatial);
  const sem = detectSemanticRecords(extraction.tokens, geometry, logical, spatial, rel);
  const out = {
    schema: SEMANTIC_RECORD_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    coordinateSystem: COORDINATE_SYSTEM,
    parameters: { tableGeometry: geometry.parameters, logicalRow: logical.parameters, spatialRegion: spatial.parameters, regionRelation: rel.parameters, semanticRecord: sem.parameters },
    sourceTokenCount: geometry.sourceTokenCount,
    physicalRowCount: geometry.physicalRows.length,
    logicalRowCount: logical.logicalRowCandidates.length,
    spatialRegionCount: spatial.regions.length,
    regionRelationCount: rel.relations.length,
    semanticRecordCandidates: sem.semanticRecordCandidates,
    unassignedSemanticObservations: sem.unassignedSemanticObservations,
    diagnostics: sem.diagnostics,
    note: 'candidates reference SourceToken.index / LogicalRowCandidate.logicalRowIndex / SpatialRegionCandidate.regionIndex / RegionRelationCandidate.relationIndex of this page; SemanticRecordCandidate is not a final LogicalDetailRecord; previewText is non-authoritative',
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'semantic-record-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const d = sem.diagnostics;
  const c = d.counts;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} logicalRows=${logical.logicalRowCandidates.length} regions=${spatial.regions.length} relations=${rel.relations.length}\n` +
      `  candidates=${c.candidates} (ambiguous=${c.ambiguousCandidates}) code=${c.codeObservations} matter=${c.matterObservations} amountGroups=${c.amountGroupObservations} signs=${c.signObservations} unassigned=${c.unassignedSemanticObservations}\n` +
      `  related structures: membership=${c.membershipEvidence} proximity=${c.proximityEvidence} stableRefs=${c.stableRelationRefs} unstableRefs=${c.unstableRelationRefs}\n` +
      `  codeShapes=${JSON.stringify(d.codeShapes)} amountGroupCounts=${JSON.stringify(d.amountGroupCountDistribution)} ambiguityKinds=${JSON.stringify(d.ambiguityKinds)}\n` +
      `  regexOnlyCodeMatches=${d.regexOnlyCodeMatches.length} ambiguousLogicalRowsAffecting=${d.ambiguousLogicalRowsAffectingCandidates} amountColumnReuse=${JSON.stringify(d.amountColumnReuse)}\n  → ${file}`,
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

  console.log(`=== SemanticRecord PoC: year=${year} jobs=${jobs.length} ===`);
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
