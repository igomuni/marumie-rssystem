/**
 * MOF予算書・決算書CSV（download-mof-archive.tsが取得したraw ZIP）を、
 * source-preservingな行レベルレコードへ変換する（正規化のみ。集約・イベント化はderived層）。
 *
 * 仕様: 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md
 * 参照実装: Python版 pipeline_v2/normalize_mof.py に合わせている（帳票種別・列名解決・
 * 識別キーの作り方を含めて同じロジック）。
 *
 * 帳票ID→(accountType, phase)の対応:
 *   11=一般会計当初 12=特別会計当初 13=政府関係機関当初                 → initial
 *   21=一般会計補正 22=特別会計補正                                    → supplement
 *   31=一般会計概算 32=特別会計概算 33=政府関係機関概算（未使用/将来用） → provisional
 *   76=政府関係機関決算 77=一般会計決算 78=特別会計決算                 → settlement
 *
 * 提出版/成立版の区別はディレクトリ名（`{year}_teishutsu`か否か）で判定する
 * （bb.mof.go.jpのarchiveページのURL構造そのまま。download-mof-archive.ts参照）。
 *
 * 入力: data/download/mof.go.jp/archive/{year}/{yearDir}/csv/DL*.zip
 * 出力: data/normalized/mof/fy{year}/{budget-items.jsonl,manifest.json}
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-mof.ts [year...]
 *   （年度省略時は 2024 2025）
 */
import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { parseCsv as parseQuoteAwareCsv } from './lib/csv';
import { stableId, normalizeText } from './lib/stable-id';
import { parseIntValue, yenFromThousand } from './lib/parse';
import { writeJsonl, writeJson } from './lib/jsonl';
import { scopeOf, sectionNaturalKey, legacySectionKey, scopeNameItemKey, findHeader, standardAmountColumn, isExpenditureHeaders } from './lib/mof-keys';
import type { MofBudgetItemRecord, MofAccountType, MofPhase, MofBudgetStatus, SourceRef } from './types';

const ZIP_RE = /^DL(\d{4})(\d{2})(\d{3})\.zip$/;

const DOCUMENT_KINDS: Record<string, { accountType: MofAccountType; phase: MofPhase }> = {
  '11': { accountType: 'general', phase: 'initial' },
  '12': { accountType: 'special', phase: 'initial' },
  '13': { accountType: 'agency', phase: 'initial' },
  '21': { accountType: 'general', phase: 'supplement' },
  '22': { accountType: 'special', phase: 'supplement' },
  '31': { accountType: 'general', phase: 'provisional' },
  '32': { accountType: 'special', phase: 'provisional' },
  '33': { accountType: 'agency', phase: 'provisional' },
  '76': { accountType: 'agency', phase: 'settlement' },
  '77': { accountType: 'general', phase: 'settlement' },
  '78': { accountType: 'special', phase: 'settlement' },
};

interface MofDocument {
  fiscalYear: number;
  kind: string;
  sequence: number;
  revision: number | null;
  accountType: MofAccountType;
  phase: MofPhase;
  budgetStatus: MofBudgetStatus;
  releaseDir: string;
  zipPath: string;
}

/** raw_root相対パス（source refに使う。Python版のrelpathと同じ発想） */
function relFromRawRoot(rawRoot: string, absPath: string): string {
  return path.relative(rawRoot, absPath).split(path.sep).join('/');
}

function discoverMofDocuments(rawRoot: string, years?: Set<number>): MofDocument[] {
  const archiveRoot = path.join(rawRoot, 'mof.go.jp', 'archive');
  if (!fs.existsSync(archiveRoot)) return [];
  const docs: MofDocument[] = [];
  for (const yearDirName of fs.readdirSync(archiveRoot)) {
    const yearPath = path.join(archiveRoot, yearDirName);
    if (!fs.statSync(yearPath).isDirectory()) continue;
    for (const releaseDir of fs.readdirSync(yearPath)) {
      const csvDir = path.join(yearPath, releaseDir, 'csv');
      if (!fs.existsSync(csvDir)) continue;
      for (const zipName of fs.readdirSync(csvDir)) {
        const m = ZIP_RE.exec(zipName);
        if (!m) continue;
        const fiscalYear = Number(m[1]);
        if (years && !years.has(fiscalYear)) continue;
        const kind = m[2];
        const doc = DOCUMENT_KINDS[kind];
        if (!doc) continue;
        const sequence = Number(m[3]);
        const submitted = releaseDir.endsWith('_teishutsu');
        let budgetStatus: MofBudgetStatus;
        if (doc.phase === 'initial' || doc.phase === 'provisional') budgetStatus = submitted ? 'submitted' : 'enacted';
        else if (doc.phase === 'settlement') budgetStatus = 'settled';
        else budgetStatus = submitted ? 'submitted' : 'published';
        docs.push({
          fiscalYear,
          kind,
          sequence,
          revision: doc.phase === 'supplement' ? sequence : null,
          accountType: doc.accountType,
          phase: doc.phase,
          budgetStatus,
          releaseDir,
          zipPath: path.join(csvDir, zipName),
        });
      }
    }
  }
  return docs;
}

/** ZIP内の歳出表エントリを取得する */
function expenditureZipEntry(zipPath: string): { entry: string; rows: Record<string, string>[] } {
  for (const entry of listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv'))) {
    const rows = parseCsv(readZipEntryText(zipPath, entry));
    if (rows.length > 0 && isExpenditureHeaders(Object.keys(rows[0]))) return { entry, rows };
  }
  throw new Error(`歳出表CSVが見つかりません: ${zipPath}`);
}

/**
 * quote対応のlib/csv.tsを使う（従来の素朴なsplit(',')は、値がクォート付きカンマや
 * 改行を含む場合に列がずれる可能性があった。2026-09-20 CodeRabbit指摘）。
 * ヘッダー・値をtrimし、空ヘッダー列を除外する従来の挙動は維持する
 */
function parseCsv(content: string): Record<string, string>[] {
  return parseQuoteAwareCsv(content).map(row => {
    const trimmed: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const header = key.trim();
      if (header) trimmed[header] = value.trim();
    }
    return trimmed;
  });
}

function normalizeMofDocument(rawRoot: string, doc: MofDocument): MofBudgetItemRecord[] {
  const { entry, rows } = expenditureZipEntry(doc.zipPath);
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const { phase, accountType } = doc;

  const standardCol = phase === 'initial' || phase === 'provisional' ? standardAmountColumn(headers) : undefined;
  const previousCol = findHeader(headers, ['前年度予算額']);
  const compareCol = findHeader(headers, ['比較増△減額']);

  const baseCol = phase === 'supplement' ? findHeader(headers, ['成立予算額']) : undefined;
  const addCol = phase === 'supplement' ? findHeader(headers, ['補正', '追加額']) : undefined;
  const reductionCol = phase === 'supplement' ? findHeader(headers, ['補正', '修正減少額']) : undefined;
  const deltaCol = phase === 'supplement' ? findHeader(headers, ['補正', '差引額']) : undefined;
  const revisedCol = phase === 'supplement' ? headers.find(h => h.startsWith('改') && (h.includes('予算額') || h.includes('予定額'))) : undefined;

  const relZipPath = relFromRawRoot(rawRoot, doc.zipPath);
  const out: MofBudgetItemRecord[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + 2; // ヘッダー行の次から2行目起算（Python版に合わせる）
    const scope = scopeOf(row, accountType);
    const sectionCode = (row['項コード'] ?? '').trim();
    const sectionName = (row['項名'] ?? '').trim();
    const subItemName = (row['目名'] ?? '').trim();
    const subItemCode = (row['目番号'] ?? row['目コード'] ?? row['目別分類コード'] ?? '').trim();
    const sectionKey = sectionNaturalKey(accountType, scope, sectionCode, sectionName);
    const legacyKey = legacySectionKey(accountType, scope, sectionCode);
    const scopeNameKey = scopeNameItemKey(accountType, scope, sectionName, subItemName);
    const itemKey = [sectionKey, normalizeText(subItemCode), normalizeText(subItemName)].join('|');

    const source: SourceRef = {
      domain: 'mof.go.jp',
      path: relZipPath,
      file: path.basename(doc.zipPath),
      zipEntry: entry,
      rowNumber,
    };

    const rec: MofBudgetItemRecord = {
      schemaVersion: 2,
      recordType: 'mof_budget_item',
      recordId: stableId([relZipPath, entry, rowNumber], 'mofrow_'),
      fiscalYear: doc.fiscalYear,
      phase,
      budgetStatus: doc.budgetStatus,
      revision: doc.revision,
      accountType,
      ...scope,
      sectionCode,
      sectionName,
      subItemCode,
      subItemName,
      sectionNaturalKey: sectionKey,
      legacySectionKey: legacyKey,
      itemNaturalKey: itemKey,
      scopeNameItemKey: scopeNameKey,
      source,
    };

    if (phase === 'initial' || phase === 'provisional') {
      rec.amountYen = yenFromThousand(row[standardCol!]);
      rec.previousAmountYen = yenFromThousand(previousCol ? row[previousCol] : undefined);
      rec.differenceYen = yenFromThousand(compareCol ? row[compareCol] : undefined);
      rec.sourceAmountColumn = standardCol ?? null;
    } else if (phase === 'supplement') {
      rec.baseAmountYen = yenFromThousand(baseCol ? row[baseCol] : undefined);
      rec.supplementAdditionYen = yenFromThousand(addCol ? row[addCol] : undefined);
      rec.supplementReductionYen = yenFromThousand(reductionCol ? row[reductionCol] : undefined);
      rec.supplementDeltaYen = yenFromThousand(deltaCol ? row[deltaCol] : undefined);
      rec.revisedAmountYen = yenFromThousand(revisedCol ? row[revisedCol] : undefined);
      rec.sourceAmountColumns = {
        base: baseCol ?? null,
        addition: addCol ?? null,
        reduction: reductionCol ?? null,
        delta: deltaCol ?? null,
        revised: revisedCol ?? null,
      };
    } else if (phase === 'settlement') {
      if (accountType === 'agency') {
        rec.budgetAmountYen = parseIntValue(row['支出予算額(円)']);
        rec.carryoverInYen = parseIntValue(row['前年度繰越額(円)']);
        rec.reserveUseYen = parseIntValue(row['予備費使用額(円)']);
        rec.budgetRuleIncreaseYen = parseIntValue(row['予算総則の規定による経費増額(円)']);
        rec.reallocationYen = parseIntValue(row['流用等増△減額(円)']);
        rec.transferAdjustmentYen = 0;
        rec.currentBudgetYen = parseIntValue(row['支出予算現額(円)']);
        rec.spentYen = parseIntValue(row['支出済額(円)']);
        rec.carryoverOutYen = parseIntValue(row['翌年度繰越額(円)']);
        rec.unusedYen = parseIntValue(row['不用額(円)']);
      } else {
        rec.budgetAmountYen = parseIntValue(row['歳出予算額(円)']);
        rec.carryoverInYen = parseIntValue(row['前年度繰越額(円)']);
        rec.reserveUseYen = parseIntValue(row['予備費使用額(円)']);
        rec.budgetRuleIncreaseYen = parseIntValue(row['予算総則の規定による経費増額(円)']);
        rec.reallocationYen = parseIntValue(row['流用等増△減額(円)']);
        rec.transferAdjustmentYen = parseIntValue(row['予算決定後移替増△減額(円)']);
        rec.currentBudgetYen = parseIntValue(row['歳出予算現額(円)']);
        rec.spentYen = parseIntValue(row['支出済歳出額(円)']);
        rec.carryoverOutYen = parseIntValue(row['翌年度繰越額(円)']);
        rec.unusedYen = parseIntValue(row['不用額(円)']);
      }
    }
    out.push(rec);
  });
  return out;
}

function sortKey(r: MofBudgetItemRecord): string {
  return [r.phase, r.budgetStatus, r.revision ?? 0, r.accountType, r.sectionNaturalKey, r.subItemName, r.recordId].join('\x1f');
}

function processYear(rawRoot: string, outputRoot: string, year: number, docs: MofDocument[]): void {
  console.log(`\n=== MOF normalize: fiscalYear=${year} ===`);
  const rows: MofBudgetItemRecord[] = [];
  const inputSummaries: { phase: MofPhase; budgetStatus: MofBudgetStatus; revision: number | null; accountType: MofAccountType; path: string; rowCount: number }[] = [];
  for (const doc of docs) {
    const docRows = normalizeMofDocument(rawRoot, doc);
    rows.push(...docRows);
    inputSummaries.push({
      phase: doc.phase, budgetStatus: doc.budgetStatus, revision: doc.revision, accountType: doc.accountType,
      path: relFromRawRoot(rawRoot, doc.zipPath), rowCount: docRows.length,
    });
    console.log(`  [${path.basename(doc.zipPath)} / ${doc.releaseDir}] ${doc.phase}/${doc.budgetStatus} ${docRows.length}件`);
  }
  rows.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  const yearDir = path.join(outputRoot, 'normalized', 'mof', `fy${year}`);
  const rowCount = writeJsonl(path.join(yearDir, 'budget-items.jsonl'), rows);

  const phaseCounts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.phase}\x1f${r.budgetStatus}\x1f${r.accountType}`;
    phaseCounts.set(key, (phaseCounts.get(key) ?? 0) + 1);
  }
  const phaseCountList = [...phaseCounts.entries()].map(([key, count]) => {
    const [phase, budgetStatus, accountType] = key.split('\x1f');
    return { phase, budgetStatus, accountType, count };
  });

  writeJson(path.join(yearDir, 'manifest.json'), {
    schemaVersion: 2,
    fiscalYear: year,
    rowCount,
    phaseCounts: phaseCountList,
    inputs: inputSummaries,
  });
  console.log(`  budget-items.jsonl: ${rowCount}行`);
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? new Set(years) : new Set([2024, 2025]);

  const rawRoot = path.join('data', 'download');
  const outputRoot = 'data';
  const docs = discoverMofDocuments(rawRoot, targetYears);
  const byYear = new Map<number, MofDocument[]>();
  for (const doc of docs) {
    const list = byYear.get(doc.fiscalYear) ?? [];
    list.push(doc);
    byYear.set(doc.fiscalYear, list);
  }
  for (const year of [...targetYears].sort()) {
    processYear(rawRoot, outputRoot, year, byYear.get(year) ?? []);
  }
}

main();
