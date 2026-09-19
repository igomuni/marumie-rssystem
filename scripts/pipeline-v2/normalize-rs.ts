/**
 * RS公開CSV（download-rs-csv.tsが取得したraw ZIP）を、原典ごとの正規化JSONへ変換する。
 *
 * Pipeline V2 normalized層。MOFとの結合・名寄せ・項コード同一性判定はここでは行わない
 * （derived層の責務）。sourceYear（RS提出年度）とfiscalYear（各行が指す予算年度）は
 * 必ず区別する（2-1 CSVの1事業は複数の予算年度行を持ちうるため）。
 *
 * 入力: data/download/rssystem.go.jp/download-csv/{year}/*.zip
 * 出力: data/normalized/rs/{year}/{projects,budget-events,expenditures}.json
 *   （仕様書の例示ではbudgets.json/requests.jsonを分けているが、どちらも
 *   「1事業・1予算年度あたりのBudgetEvent」という同じ形なので
 *   budget-events.json 1本に統合している。requestイベントは
 *   eventType==='request'で区別できる）
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-rs.ts [year...]
 *   （年度省略時は 2024 2025）
 */
import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { parseCsv, parseAmount } from './lib/csv';
import type { RsProject, RsBudgetEvent, RsBudgetItem, RsExpenditure, Provenance } from './types';

function readCsvZip(zipPath: string): Record<string, string>[] {
  const entries = listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv'));
  if (entries.length !== 1) {
    throw new Error(`CSVエントリが1件ではありません: ${zipPath} (${entries.join(', ')})`);
  }
  return parseCsv(readZipEntryText(zipPath, entries[0]));
}

function zipPathFor(year: number, no: string, label: string): string {
  return path.join('data', 'download', 'rssystem.go.jp', 'download-csv', String(year), `${no}_RS_${year}_${label}.zip`);
}

function provenanceFor(year: number, fileName: string): Provenance {
  return { domain: 'rssystem.go.jp', dataset: 'download-csv', year, file: fileName };
}

function normalizeProjects(year: number): RsProject[] {
  const label = '基本情報_事業概要等';
  const zip = zipPathFor(year, '1-2', label);
  const rows = readCsvZip(zip);
  const provenance = provenanceFor(year, path.basename(zip));
  return rows.map(r => ({
    projectId: r['予算事業ID'],
    projectName: r['事業名'],
    sourceYear: Number(r['事業年度']),
    ministry: r['府省庁'],
    bureau: r['局・庁'],
    purpose: r['事業の目的'],
    provenance,
  }));
}

/** 2-1 CSVの1行から、当初/補正/執行/翌年度要求のBudgetEventを起こす */
function eventsFromBudgetRow(row: Record<string, string>, sourceYear: number, provenance: Provenance): RsBudgetEvent[] {
  const projectId = row['予算事業ID'];
  const fiscalYear = Number(row['予算年度']);
  if (!projectId || Number.isNaN(fiscalYear)) return [];

  const events: RsBudgetEvent[] = [];
  const push = (eventType: RsBudgetEvent['eventType'], amount: number, eventFiscalYear = fiscalYear) => {
    if (amount !== 0) events.push({ projectId, sourceYear, fiscalYear: eventFiscalYear, eventType, amount, provenance });
  };

  push('initial', parseAmount(row['当初予算']));
  push('supplementary', parseAmount(row['第1次補正予算']) + parseAmount(row['第2次補正予算']) + parseAmount(row['第3次補正予算']) + parseAmount(row['第4次補正予算']) + parseAmount(row['第5次補正予算']));
  push('carryover_in', parseAmount(row['前年度から繰越し']));
  push('reserve', parseAmount(row['予備費等1']) + parseAmount(row['予備費等2']) + parseAmount(row['予備費等3']) + parseAmount(row['予備費等4']));
  push('execution', parseAmount(row['執行額']));
  push('carryover_out', parseAmount(row['翌年度への繰越し(合計）']));
  // 翌年度要求額は「次の年度」への要求なので、イベント自体のfiscalYearは+1にする
  push('request', parseAmount(row['翌年度要求額（合計）']), fiscalYear + 1);

  return events;
}

function normalizeBudgetEvents(year: number): RsBudgetEvent[] {
  const label = '予算・執行_サマリ';
  const zip = zipPathFor(year, '2-1', label);
  const rows = readCsvZip(zip);
  const provenance = provenanceFor(year, path.basename(zip));
  const events: RsBudgetEvent[] = [];
  for (const row of rows) events.push(...eventsFromBudgetRow(row, year, provenance));
  return events;
}

/**
 * 2-2 CSV（予算種別・歳出予算項目）。MOFの科目別内訳と同じ語彙で
 * 所管/組織・勘定（一般会計）または所管/会計/勘定（特別会計）/項/目を持つ列。
 * 列名の丸括弧は原本では全角（例:「予算額（歳出予算項目ごと）」）。
 * V1の`data/year_*`側は正規化時に半角へ変換しているが、rawのZIPは全角のまま。
 */
function normalizeBudgetItems(year: number): RsBudgetItem[] {
  const label = '予算・執行_予算種別・歳出予算項目';
  const zip = zipPathFor(year, '2-2', label);
  const rows = readCsvZip(zip);
  const provenance = provenanceFor(year, path.basename(zip));
  return rows
    .map(r => {
      const accountCategory = r['会計区分'] ?? '';
      return {
        projectId: r['予算事業ID'],
        sourceYear: Number(r['事業年度']),
        fiscalYear: Number(r['予算年度']),
        accountCategory,
        budgetTypeRaw: r['予算種別'] ?? '',
        ministry: r['所管'] ?? '',
        organization: accountCategory === '特別会計' ? (r['会計'] ?? '') : (r['組織・勘定'] ?? ''),
        subAccount: accountCategory === '特別会計' ? (r['勘定'] ?? '') : '',
        sectionName: r['項'] ?? '',
        itemName: r['目'] ?? '',
        amount: parseAmount(r['予算額（歳出予算項目ごと）']),
        provenance,
      };
    })
    // amount===0でも行自体（事業がその科目に計上されている事実）は残す。
    // MOF側と同じ理由（0円計上除外による過少カウント、2026-09-19修正）でここも除外しない
    .filter(e => e.projectId && !Number.isNaN(e.fiscalYear));
}

function normalizeExpenditures(year: number): RsExpenditure[] {
  const label = '支出先_支出情報';
  const zip = zipPathFor(year, '5-1', label);
  const rows = readCsvZip(zip);
  const provenance = provenanceFor(year, path.basename(zip));
  return rows
    .map(r => ({
      projectId: r['予算事業ID'],
      sourceYear: Number(r['事業年度']),
      blockId: r['支出先ブロック番号'],
      blockName: r['支出先ブロック名'],
      recipientName: r['支出先名'],
      corporateNumber: r['法人番号'],
      amount: parseAmount(r['金額']),
      provenance,
    }))
    .filter(e => e.amount !== 0);
}

function writeJson(outPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
}

function processYear(year: number): void {
  console.log(`\n=== RS normalize: year=${year} ===`);
  const outDir = path.join('data', 'normalized', 'rs', String(year));

  const projects = normalizeProjects(year);
  writeJson(path.join(outDir, 'projects.json'), projects);
  console.log(`  projects.json: ${projects.length}件`);

  const budgetEvents = normalizeBudgetEvents(year);
  writeJson(path.join(outDir, 'budget-events.json'), budgetEvents);
  console.log(`  budget-events.json: ${budgetEvents.length}件`);

  const budgetItems = normalizeBudgetItems(year);
  writeJson(path.join(outDir, 'budget-items.json'), budgetItems);
  console.log(`  budget-items.json: ${budgetItems.length}件`);

  const expenditures = normalizeExpenditures(year);
  writeJson(path.join(outDir, 'expenditures.json'), expenditures);
  console.log(`  expenditures.json: ${expenditures.length}件`);
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];
  for (const year of targetYears) processYear(year);
}

main();
