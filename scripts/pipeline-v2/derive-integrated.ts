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
 *       data/derived/mof/fy{fiscalYear}/settlement-items.jsonl（Phase A、無ければ空扱い）
 * 出力: data/derived/links/mof-rs-review-{reviewYear}-fy{fiscalYear}.jsonl
 *       data/derived/links/mof-rs-review-{reviewYear}-fy{fiscalYear}-summary.json
 *
 * Phase B1（決算接続）: 上記link groupを根拠に、既存MOF budget itemの itemNaturalKey
 * 経由でsettlement-items.jsonlへexact joinし、RS事業→MOF予算項目→決算項目のidentity
 * relationをderived層に追加する。新規のRS↔決算名称マッチ・金額マッチは行わない
 * （lib/mof-rs-settlement-identity.ts）。
 * 出力: data/derived/links/mof-rs-settlement-review-{reviewYear}-fy{fiscalYear}.jsonl
 *       data/derived/links/mof-rs-settlement-review-{reviewYear}-fy{fiscalYear}-diagnostics.json
 *
 * 使い方: npx tsx scripts/pipeline-v2/derive-integrated.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJsonl, writeJson } from './lib/jsonl';
import { buildMofRsLinks } from './lib/mof-rs-links';
import { buildSettlementIdentityRelations, type SettlementDataStatus } from './lib/mof-rs-settlement-identity';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2 } from './types';
import type { SettlementItemRecord } from './lib/mof-settlement-items';

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

      // Phase B1: 既存link group（result.links）をitemNaturalKey経由でsettlement-items.jsonl
      // （Phase A、derive-mof.tsが生成）へ接続する。「決算データがまだ無い
      // (artifact_missing/no_settlement_rows)」と「決算データはあるがexact joinに失敗した
      // (no_exact_settlement_item)」を区別する（両者を混同するとdiagnosticsの意味が壊れる）。
      const settlementItemsPath = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`, 'settlement-items.jsonl');
      const settlementArtifactExists = fs.existsSync(settlementItemsPath);
      const settlementItems = readJsonl<SettlementItemRecord>(settlementItemsPath);
      const settlementDataStatus: SettlementDataStatus = !settlementArtifactExists
        ? 'artifact_missing'
        : settlementItems.length === 0 ? 'no_settlement_rows' : 'available';
      const { relations, diagnostics } = buildSettlementIdentityRelations(mofRows, result.links, settlementItems, reviewYear, fiscalYear, settlementDataStatus);
      writeJsonl(path.join(outDir, `mof-rs-settlement-review-${reviewYear}-fy${fiscalYear}.jsonl`), relations);
      writeJson(path.join(outDir, `mof-rs-settlement-review-${reviewYear}-fy${fiscalYear}-diagnostics.json`), diagnostics);
      console.log(`  settlement identity[${settlementDataStatus}]: relations=${diagnostics.relationCount} ` +
        `exactJoin=${diagnostics.exactJoinLinkGroupCount}/${diagnostics.sourceLinkGroupCount} ` +
        `spansMultipleItems=${diagnostics.spansMultipleItemsLinkGroupCount} ` +
        `unmatched=${diagnostics.unmatchedSettlementLinkGroupCount} ` +
        `multiSourceItems=${diagnostics.multiSourceSettlementItemCount} ` +
        `linkedProjects=${diagnostics.linkedProjectCount} ` +
        `accountTypes=${JSON.stringify(diagnostics.accountTypeCounts)}`);
    }
  }

  writeJson(path.join(outputRoot, 'derived', 'links', 'manifest.json'), { schemaVersion: 2, links: summaries });
}

main();
