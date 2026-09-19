/**
 * MOF予算書・決算書CSV（download-mof-archive.tsが取得したraw ZIP）を、
 * 正規化されたBudgetEvent列へ変換する。
 *
 * Pipeline V2 normalized層。RSとの結合・項コードの同一性判定はここでは行わない
 * （derived層の責務）。項・目コードは原典表記のまま保持する。
 *
 * 入力: data/download/mof.go.jp/archive/{year}/{yearDir}/csv/DL*.zip
 * 出力: data/normalized/mof/{year}/budget-events.json
 *
 * 帳票ID→イベント種別の対応（docs/mof-budget-data-guide.md準拠）:
 *   11001=一般会計当初 12001=特別会計当初 13001=政府関係機関当初 → initial
 *   21001=一般会計補正第1号 22001=特別会計補正第1号            → supplementary
 *   76001=政府関係機関決算 77001=一般会計決算 78001=特別会計決算  → settlement系
 *     （支出済/予備費使用/前年度繰越/翌年度繰越/不用/移替の複数イベントに分解）
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-mof.ts [year...]
 *   （年度省略時は 2024 2025。2025年度は補正・決算未成立のため当初分のみ生成される）
 */
import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import type { MofBudgetEvent, Provenance } from './types';

type CsvRow = Record<string, string>;

const REPORT_KIND: Record<string, 'initial' | 'supplementary' | 'settlement'> = {
  '11001': 'initial', '12001': 'initial', '13001': 'initial',
  '21001': 'supplementary', '22001': 'supplementary',
  '76001': 'settlement', '77001': 'settlement', '78001': 'settlement',
};

/** 予算書CSVは値にカンマを含まないため単純split で足りる（scripts/mof-budget-csv.tsと同じ前提） */
function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: CsvRow = {};
    headers.forEach((h, i) => { if (h) row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function yen(row: CsvRow, column: string | undefined): number {
  if (!column) return 0;
  const raw = row[column];
  if (!raw) return 0;
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 帳票が千円単位か円単位かを、列名の"(円)"有無で判定する */
function isYenUnit(headers: string[]): boolean {
  return headers.some(h => h.includes('(円)'));
}

function findColumn(headers: string[], test: (h: string) => boolean): string | undefined {
  return headers.find(test);
}

/** 歳出側の表かどうか。分類コードの有無で判定する（V1のisExpenditureTableと同じ考え方） */
function isExpenditureTable(headers: string[]): boolean {
  return headers.some(h => h.includes('主要経費別分類')) || headers.some(h => h.includes('使途別分類コード')) && headers.some(h => h.includes('項名'));
}

function accountColumns(headers: string[]): { account?: string; organization?: string } {
  const account = findColumn(headers, h => ['所管', '特別会計', '政府関係機関'].includes(h));
  const organization = findColumn(headers, h => ['組織', '勘定', '業務'].includes(h));
  return { account, organization };
}

function eventsFromInitialOrSupplementary(
  rows: CsvRow[],
  kind: 'initial' | 'supplementary',
  fiscalYear: number,
  provenance: Provenance
): MofBudgetEvent[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const { account, organization } = accountColumns(headers);
  const sectionCode = findColumn(headers, h => h === '項コード');
  const sectionName = findColumn(headers, h => h === '項名');
  const itemName = findColumn(headers, h => h === '目名');
  const amountCol = kind === 'initial'
    ? findColumn(headers, h => /^(令和|平成)(元|\d+)年度/.test(h))
    : findColumn(headers, h => h.endsWith('差引額(千円)'));
  if (!sectionCode || !sectionName || !itemName || !amountCol) return [];

  const events: MofBudgetEvent[] = [];
  for (const row of rows) {
    const amount = yen(row, amountCol) * 1000; // 予算書CSVは千円単位
    if (amount === 0) continue;
    events.push({
      fiscalYear,
      eventType: kind,
      account: account ? row[account] : '',
      organization: organization ? row[organization] : '',
      sectionCode: row[sectionCode],
      sectionName: row[sectionName],
      itemName: row[itemName],
      amount,
      provenance,
    });
  }
  return events;
}

const SETTLEMENT_COLUMNS: { eventType: MofBudgetEvent['eventType']; candidates: string[] }[] = [
  { eventType: 'execution', candidates: ['支出済歳出額(円)', '支出済額(円)'] },
  { eventType: 'reserve', candidates: ['予備費使用額(円)'] },
  { eventType: 'carryover_in', candidates: ['前年度繰越額(円)'] },
  { eventType: 'carryover_out', candidates: ['翌年度繰越額(円)'] },
  { eventType: 'unused', candidates: ['不用額(円)'] },
  { eventType: 'transfer', candidates: ['予算決定後移替増△減額(円)'] },
];

function eventsFromSettlement(rows: CsvRow[], fiscalYear: number, provenance: Provenance): MofBudgetEvent[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  if (!isYenUnit(headers)) return [];
  const { account, organization } = accountColumns(headers);
  const sectionCode = findColumn(headers, h => h === '項コード');
  const sectionName = findColumn(headers, h => h === '項名');
  const itemName = findColumn(headers, h => h === '目名');
  if (!sectionCode || !sectionName || !itemName) return [];

  const resolved = SETTLEMENT_COLUMNS.map(({ eventType, candidates }) => ({
    eventType,
    column: findColumn(headers, h => candidates.includes(h)),
  })).filter(r => r.column);

  const events: MofBudgetEvent[] = [];
  for (const row of rows) {
    for (const { eventType, column } of resolved) {
      const amount = yen(row, column);
      if (amount === 0) continue;
      events.push({
        fiscalYear,
        eventType,
        account: account ? row[account] : '',
        organization: organization ? row[organization] : '',
        sectionCode: row[sectionCode],
        sectionName: row[sectionName],
        itemName: row[itemName],
        amount,
        provenance,
      });
    }
  }
  return events;
}

function findYearDirs(year: number): string[] {
  const root = path.join('data', 'download', 'mof.go.jp', 'archive', String(year));
  if (!fs.existsSync(root)) return [];
  // 2025年度は "2025"(成立版) と "2025_teishutsu"(概算要求時点) が両方ありうる。
  // V2で使うのは成立版のみ（20260919_1523...で判断済み）なので "_teishutsu" は除外
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.endsWith('_teishutsu'))
    .map(e => path.join(root, e.name));
}

function processYear(year: number): MofBudgetEvent[] {
  const events: MofBudgetEvent[] = [];
  for (const yearDir of findYearDirs(year)) {
    const csvDir = path.join(yearDir, 'csv');
    if (!fs.existsSync(csvDir)) continue;
    for (const zipName of fs.readdirSync(csvDir).filter(f => f.endsWith('.zip'))) {
      const idMatch = zipName.match(/^DL\d{4}(\d{5})\.zip$/);
      const kind = idMatch ? REPORT_KIND[idMatch[1]] : undefined;
      if (!kind) continue;

      const zipPath = path.join(csvDir, zipName);
      const provenance: Provenance = { domain: 'mof.go.jp', dataset: 'archive', year, file: zipName };
      for (const entryName of listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv'))) {
        const rows = parseCsv(readZipEntryText(zipPath, entryName));
        if (rows.length === 0) continue;
        if (!isExpenditureTable(Object.keys(rows[0]))) continue; // 歳入側はスキップ（当面は歳出のみ）
        const newEvents = kind === 'settlement'
          ? eventsFromSettlement(rows, year, provenance)
          : eventsFromInitialOrSupplementary(rows, kind, year, provenance);
        events.push(...newEvents);
        console.log(`  [${zipName}/${entryName}] ${kind} ${newEvents.length}件`);
      }
    }
  }
  return events;
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];

  for (const year of targetYears) {
    console.log(`\n=== MOF normalize: year=${year} ===`);
    const events = processYear(year);
    const outPath = path.join('data', 'normalized', 'mof', String(year), 'budget-events.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(events, null, 2));
    console.log(`合計 budget-events.json: ${events.length}件`);
  }
}

main();
