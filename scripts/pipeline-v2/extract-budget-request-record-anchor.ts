/**
 * 概算要求PDFの指定ページについて、SemanticRecordCandidate（anchor候補）が主要明細行らしいか見出しらしいかを、
 * 分解されたevidence付きで観測するPoC（RecordAnchorAssessment）。候補を除外・変更せず、scoreも使わない。
 * このresolverは文字内容を読まず、幾何・金額group・ページ寸法だけを使う。全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-record-anchor.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-record-anchor.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-record-anchor.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/record-anchor-poc/{id}.json（data/downloadには書かない）。
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
import { assessRecordAnchors, RECORD_ANCHOR_SCHEMA } from './lib/budget-request-record-anchor';
import { detectSemanticRecords } from './lib/budget-request-semantic-record';
import { detectSpatialRegions } from './lib/budget-request-spatial-region';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-record-anchor.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/record-anchor-poc/{id}.json`;

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
  const out = {
    schema: RECORD_ANCHOR_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    parameters: anchor.parameters,
    semanticRecordCandidateCount: sem.semanticRecordCandidates.length,
    layoutFamilies: anchor.layoutFamilies,
    anchorAssessments: anchor.anchorAssessments,
    diagnostics: anchor.diagnostics,
    note: 'assessments reference SemanticRecordCandidate.candidateIndex of this page (rebuild with extract-budget-request-semantic-record); heading_candidate does not mean excluded; no score and no text is used',
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'record-anchor-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const d = anchor.diagnostics;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} semanticCandidates=${d.semanticRecordCandidateCount} classification=${JSON.stringify(d.classificationCounts)}\n` +
      `  stable=${d.stable} unstable=${d.unstable} layoutFamilies=${d.layoutFamilyCount} isolated=${d.isolatedCandidateCount} conflicts=${JSON.stringify(d.conflictCount)}\n` +
      `  sensitivity: ${d.sensitivity.map(s => `x${s.scale}: classificationChanged=${s.classificationChanged} familyChanged=${s.familyChanged} families=${s.layoutFamilyCount}`).join(' | ')}\n  → ${file}`,
  );
  for (const a of anchor.anchorAssessments) {
    const c = sem.semanticRecordCandidates[a.semanticCandidateIndex];
    if (a.classification !== 'detail_candidate' || !a.stability.stable) {
      console.log(`    #${a.semanticCandidateIndex} ${c.observations.code.rawTexts[0]} → ${a.classification}${a.stability.stable ? '' : ` (unstable: ${a.stability.reasons.join(',')})`} detail=[${a.detailEvidence.map(e => e.kind)}] heading=[${a.headingEvidence.map(e => e.kind)}]`);
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

  console.log(`=== RecordAnchor PoC: year=${year} jobs=${jobs.length} ===`);
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
