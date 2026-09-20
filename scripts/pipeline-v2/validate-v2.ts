/**
 * Pipeline V2のnormalize/derived成果物を横断検証する。
 * 仕様: 20260920_Pipeline_V2_RS全情報・資金フロー拡張_実装仕様.md 11節、
 * docs/tasks/20260920_MOF_RS_Linkage先行検証_Sonnet引継ぎ.mdのValidation節。
 *
 * 原則: 差異を検知して報告するだけで、自動補正はしない（食い違いは
 * project-sheet-conflicts.jsonlのように両方残った状態のまま検証対象にする）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/validate-v2.ts
 * 終了コード: errorレベルのfindingが1件でもあれば1、無ければ0
 */
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJson } from './lib/jsonl';
import {
  checkNoUnknownNonEmptyColumns, checkFundingRelationBlockReferences,
  checkExplicitZeroPreserved, checkMofRsLinkIntegrity, summarizeProjectSheetConflicts,
  type Finding,
} from './lib/validate-checks';
import type {
  SourceInventory, RsSpendingBlockRecord, RsFundingRelationRecord, RsBudgetItemRecordV2,
  RsProjectSheetConflict, MofBudgetItemRecord, MofRsProjectLinkGroup,
} from './types';

const REVIEW_YEARS = [2024, 2025, 2026];
const FISCAL_YEARS = [2024, 2025];

/** MOF_RS_Linkage先行検証doc記載のgolden acceptance（review-2025のみ固定）。回帰検知用 */
const LINK_GOLDEN_ACCEPTANCE: Record<string, {
  linkGroupCount: number; linkedProjectCount: number; linkedRsRecordCount: number;
  unlinkedRsRecordCount: number; unsupportedBudgetTypeRecordCount: number;
  mofAmountAcrossGroupsYen: number; rsAmountAcrossGroupsYen: number;
}> = {
  '2025:2024': {
    linkGroupCount: 4914, linkedProjectCount: 4537, linkedRsRecordCount: 13087,
    unlinkedRsRecordCount: 1093, unsupportedBudgetTypeRecordCount: 2466,
    mofAmountAcrossGroupsYen: 132_282_025_855_000, rsAmountAcrossGroupsYen: 131_634_536_373_813,
  },
  '2025:2025': {
    linkGroupCount: 5086, linkedProjectCount: 4851, linkedRsRecordCount: 14017,
    unlinkedRsRecordCount: 1034, unsupportedBudgetTypeRecordCount: 1992,
    mofAmountAcrossGroupsYen: 136_591_411_159_000, rsAmountAcrossGroupsYen: 135_391_998_467_250,
  },
};

function validateRsYear(outputRoot: string, reviewYear: number): Finding[] {
  const findings: Finding[] = [];
  const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
  const manifestPath = path.join(normDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return findings;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { sourceInventories?: SourceInventory[] };
  if (manifest.sourceInventories) {
    findings.push(...checkNoUnknownNonEmptyColumns(manifest.sourceInventories).map(f => ({ ...f, message: `review-${reviewYear} ${f.message}` })));
  }

  const blocks = readJsonl<RsSpendingBlockRecord>(path.join(normDir, 'spending-blocks.jsonl'));
  const relations = readJsonl<RsFundingRelationRecord>(path.join(normDir, 'funding-relations.jsonl'));
  if (blocks.length > 0 || relations.length > 0) {
    const { findings: refFindings, unresolvedCount } = checkFundingRelationBlockReferences(blocks, relations);
    findings.push(...refFindings.map(f => ({ ...f, message: `review-${reviewYear} ${f.message}` })));
    console.log(`  review-${reviewYear}: 5-2→5-1参照 unresolvedCount=${unresolvedCount}（rs-funding-graph.tsのunresolvedRelationIdsと一致するはず）`);
  }

  const items = readJsonl<RsBudgetItemRecordV2>(path.join(normDir, 'budget-items.jsonl'));
  if (items.length > 0) {
    findings.push(...checkExplicitZeroPreserved(items).map(f => ({ ...f, message: `review-${reviewYear} ${f.message}` })));
  }

  const conflicts = readJsonl<RsProjectSheetConflict>(path.join(normDir, 'project-sheet-conflicts.jsonl'));
  const conflictFindings = summarizeProjectSheetConflicts(conflicts);
  if (conflictFindings.length > 0) console.log(`  review-${reviewYear}: ${conflictFindings[0].message}`);
  findings.push(...conflictFindings.map(f => ({ ...f, message: `review-${reviewYear} ${f.message}` })));

  return findings;
}

function validateMofRsLinks(outputRoot: string): Finding[] {
  const findings: Finding[] = [];
  const linksDir = path.join(outputRoot, 'derived', 'links');
  if (!fs.existsSync(linksDir)) return findings;

  for (const reviewYear of REVIEW_YEARS) {
    for (const fiscalYear of FISCAL_YEARS) {
      if (fiscalYear > reviewYear) continue;
      const linksPath = path.join(linksDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`);
      const summaryPath = path.join(linksDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}-summary.json`);
      if (!fs.existsSync(linksPath) || !fs.existsSync(summaryPath)) continue;

      const links = readJsonl<MofRsProjectLinkGroup>(linksPath);
      const mofItems = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
      const rsItems = readJsonl<RsBudgetItemRecordV2>(path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`, 'budget-items.jsonl'));
      const integrityFindings = checkMofRsLinkIntegrity(links, mofItems, rsItems);
      findings.push(...integrityFindings.map(f => ({ ...f, message: `review-${reviewYear}×fy${fiscalYear}: ${f.message}` })));
      console.log(`  review-${reviewYear}×fy${fiscalYear}: link整合性チェック findings=${integrityFindings.length}`);

      const golden = LINK_GOLDEN_ACCEPTANCE[`${reviewYear}:${fiscalYear}`];
      if (golden) {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        for (const [key, expected] of Object.entries(golden)) {
          const actual = summary[key];
          if (actual !== expected) {
            findings.push({
              severity: 'error', check: 'mof-rs-link-golden-acceptance',
              message: `review-${reviewYear}×fy${fiscalYear}: ${key}が golden acceptance と不一致（期待${expected} 実際${actual}）`,
            });
          }
        }
        console.log(`  review-${reviewYear}×fy${fiscalYear}: golden acceptance ${links.length > 0 ? 'OK' : 'NG'}`);
      }
    }
  }
  return findings;
}

function main(): void {
  const outputRoot = 'data';
  const allFindings: Finding[] = [];

  console.log('=== Pipeline V2 validate-v2 ===');
  for (const year of REVIEW_YEARS) {
    allFindings.push(...validateRsYear(outputRoot, year));
  }
  allFindings.push(...validateMofRsLinks(outputRoot));

  const errorCount = allFindings.filter(f => f.severity === 'error').length;
  const warningCount = allFindings.filter(f => f.severity === 'warning').length;
  const infoCount = allFindings.filter(f => f.severity === 'info').length;

  console.log(`\n=== findings: error=${errorCount} warning=${warningCount} info=${infoCount} ===`);
  for (const f of allFindings) {
    console.log(`[${f.severity}] ${f.check}: ${f.message}`);
  }

  writeJson(path.join(outputRoot, 'derived', 'validate-report.json'), {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    errorCount, warningCount, infoCount,
    findings: allFindings,
  });

  if (errorCount > 0) {
    console.error(`\nvalidate-v2: ${errorCount}件のerrorがあります`);
    process.exitCode = 1;
  } else {
    console.log('\nvalidate-v2: errorなし');
  }
}

main();
