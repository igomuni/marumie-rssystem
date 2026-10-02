/**
 * 概算要求PDFの指定ページについて、ページ全体の行配置・反復・階層・列構造・構造切替を観測するPoC（PageTemplateObservation）。
 * semantic classification とは独立で、RecordAnchorのclassificationはtemplateのfeatureに使わない（参照のみ）。
 * 主要ロジックは文字内容を使わない（罫線tokenの文字クラスのみ）。全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page-template.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page-template.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page-template.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/page-template-poc/{id}.json（data/downloadには書かない）。
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
import { observePageTemplate, PAGE_TEMPLATE_SCHEMA } from './lib/budget-request-page-template';
import { assessRecordAnchors } from './lib/budget-request-record-anchor';
import { detectSemanticRecords } from './lib/budget-request-semantic-record';
import { detectSpatialRegions } from './lib/budget-request-spatial-region';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-page-template.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/page-template-poc/{id}.json`;

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
  const anchor = assessRecordAnchors(extraction.page, geometry.parameters.rowClustering.referenceFontSize, sem);
  const tpl = observePageTemplate(extraction.tokens, extraction.page, geometry, logical, spatial, sem, anchor);
  const out = {
    schema: PAGE_TEMPLATE_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    parameters: tpl.parameters,
    sourceTokenCount: geometry.sourceTokenCount,
    physicalRowCount: geometry.physicalRows.length,
    logicalRowCount: logical.logicalRowCandidates.length,
    semanticRecordCandidateCount: sem.semanticRecordCandidates.length,
    rowObservations: tpl.rowObservations,
    indentationClusters: tpl.indentationClusters,
    amountColumnPatterns: tpl.amountColumnPatterns,
    rowFamilies: tpl.rowFamilies,
    sequenceObservations: tpl.sequenceObservations,
    boundaryCandidates: tpl.boundaryCandidates,
    hierarchyRelationCandidates: tpl.hierarchyRelationCandidates,
    diagnostics: tpl.diagnostics,
    note: 'rows reference LogicalRowCandidate.logicalRowIndex / PhysicalRowCandidate.rowIndex / SemanticRecordCandidate.candidateIndex of this page; no semantic type is assigned; RecordAnchor assessment indexes are references only',
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'page-template-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const d = tpl.diagnostics;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} rows=${d.rowCount} indentClusters=${d.indentationClusterCount} amountPatterns=${d.amountPatternCount} ` +
      `rowFamilies=${d.rowFamilyCount} (isolated ${d.isolatedFamilyCount}) boundaries=${d.boundaryCandidateCount} hierarchy=${d.hierarchyRelationCount} (rows with multiple parents ${d.hierarchyRowsWithMultiplePlausibleParents})\n` +
      `  unstable=${JSON.stringify(d.unstableObservations)} indentJumps=${d.indentJumpsNotTreatedAsHierarchy}\n` +
      `  sensitivity: ${d.sensitivity.map(s => `x${s.scale}: clusters=${s.indentationClusterCount} families=${s.rowFamilyCount} boundaries=${s.boundaryCandidateCount} hierarchy=${s.hierarchyRelationCount} patterns=${s.amountPatternCount} changed=${JSON.stringify(s.changed)}`).join('\n               ')}\n  → ${file}`,
  );
  for (const r of tpl.rowObservations.filter(x => x.semanticCandidateIndexes.length > 0)) {
    const c = sem.semanticRecordCandidates[r.semanticCandidateIndexes[0]];
    const x = r.context;
    if (r.context.descendantRowCount >= 0 && (x.boundaryBefore.length > 0 || x.descendantRowCount > 0 || x.familySize === 1)) {
      console.log(`    row ${r.rowIndex} ${c.observations.code.rawTexts[0]}: cluster ${r.signature.indentationClusterIndex}(size ${x.indentClusterSize}) family ${tpl.rowFamilies[tpl.rowObservations[r.rowIndex].signature.indentationClusterIndex] ? '' : ''}size ${x.familySize} descendants=${x.descendantRowCount} (withAmount ${x.descendantRowsWithAmountPattern}, sameFamily ${x.sameFamilyAmongDescendants}) boundaryBefore=[${x.boundaryBefore}] boundaryAfter=[${x.boundaryAfter}] stable(indent/family)=${x.indentStableUnderSensitivity}/${x.familyStableUnderSensitivity}`);
    }
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

  console.log(`=== PageTemplate PoC: year=${year} jobs=${jobs.length} ===`);
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
