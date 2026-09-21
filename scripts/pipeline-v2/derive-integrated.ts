/**
 * MOF正規化済みbudget-items（fy{fiscalYear}）とRS正規化済みbudget-items
 * （review-{reviewYear}）を突合し、MOF↔RSリンクを作る。
 * 参照実装: Python版 pipeline_v2/derive.py の build_mof_rs_links。
 *
 * レビュー年度のスナップショットには当該年度以前の複数fiscalYearの行が混在しうるため
 * （例: review-2025には2024年度決算・2025年度当初・2026年度要求が含まれる）、
 * fiscalYear <= reviewYearの組み合わせだけを対象にする（将来年度の予算とは比較できない）。
 *
 * 入力: data/normalized/mof/fy{fiscalYear}/budget-items.jsonl
 *       data/normalized/rs/review-{reviewYear}/budget-items.jsonl
 * 出力: data/derived/links/mof-rs-review-{reviewYear}-fy{fiscalYear}.jsonl
 *       data/derived/links/mof-rs-review-{reviewYear}-fy{fiscalYear}-summary.json
 *
 * 使い方: npx tsx scripts/pipeline-v2/derive-integrated.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJsonl, writeJson } from './lib/jsonl';
import { buildMofRsLinks } from './lib/mof-rs-links';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2 } from './types';

const FISCAL_YEARS = [2023, 2024, 2025];
const REVIEW_YEARS = [2024, 2025, 2026];

function main(): void {
  const outputRoot = 'data';
  const summaries: Record<string, unknown> = {};

  for (const reviewYear of REVIEW_YEARS) {
    const rsPath = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`, 'budget-items.jsonl');
    if (!fs.existsSync(rsPath)) continue;
    const rsRows = readJsonl<RsBudgetItemRecordV2>(rsPath);
    if (rsRows.length === 0) continue;

    for (const fiscalYear of FISCAL_YEARS) {
      if (fiscalYear > reviewYear) continue;
      const mofPath = path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl');
      if (!fs.existsSync(mofPath)) continue;
      const mofRows = readJsonl<MofBudgetItemRecord>(mofPath);

      const result = buildMofRsLinks(reviewYear, fiscalYear, mofRows, rsRows);
      const outDir = path.join(outputRoot, 'derived', 'links');
      writeJsonl(path.join(outDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`), result.links);
      const summary = {
        schemaVersion: 2,
        reviewYear,
        fiscalYear,
        linkGroupCount: result.linkGroupCount,
        linkedRsRecordCount: result.linkedRsRecordCount,
        unlinkedRsRecordCount: result.unlinkedRsRecordCount,
        unsupportedBudgetTypeRecordCount: result.unsupportedBudgetTypeRecordCount,
        linkedProjectCount: result.linkedProjectCount,
        mofAmountAcrossGroupsYen: result.mofAmountAcrossGroupsYen,
        rsAmountAcrossGroupsYen: result.rsAmountAcrossGroupsYen,
      };
      writeJson(path.join(outDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}-summary.json`), summary);
      console.log(`review-${reviewYear} × fy${fiscalYear}: linkGroups=${result.linkGroupCount} ` +
        `linkedProjects=${result.linkedProjectCount} linkedRs=${result.linkedRsRecordCount} ` +
        `unlinkedRs=${result.unlinkedRsRecordCount} unsupported=${result.unsupportedBudgetTypeRecordCount} ` +
        `mofYen=${result.mofAmountAcrossGroupsYen.toLocaleString()} rsYen=${result.rsAmountAcrossGroupsYen.toLocaleString()}`);
      summaries[`${reviewYear}:${fiscalYear}`] = summary;
    }
  }

  writeJson(path.join(outputRoot, 'derived', 'links', 'manifest.json'), { schemaVersion: 2, links: summaries });
}

main();
