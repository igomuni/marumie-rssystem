/**
 * チームみらい政治資金CSV → 集計JSON生成スクリプト
 *
 * 入力: data/download/transactions_team-mirai_*.csv（最新ファイルを自動検出）
 * 出力: public/data/mirai-summary.json
 *
 * 実行: npm run generate-mirai
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { MiraiSummaryData } from '../types/mirai';

const ROOT = path.resolve(__dirname, '..');
const DOWNLOAD_DIR = path.join(ROOT, 'data', 'download');
const OUTPUT_PATH = path.join(ROOT, 'public', 'data', 'mirai-summary.json');

interface Row {
  date: string;
  orgName: string;
  type: '収入' | '支出';
  amount: number;
  category: string;
  subCategory: string;
  label: string;
}

async function parseCSV(filePath: string): Promise<Row[]> {
  const rows: Row[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isFirst = true;
  for await (const rawLine of rl) {
    // BOM 除去
    const line = rawLine.replace(/^\uFEFF/, '');
    if (isFirst) { isFirst = false; continue; } // ヘッダースキップ
    if (!line.trim()) continue;

    // CSV パース（引用符対応）
    const cols = splitCSVLine(line);
    if (cols.length < 6) continue;

    const amount = parseInt(cols[3].replace(/,/g, ''), 10);
    if (isNaN(amount)) continue;

    rows.push({
      date: cols[0],
      orgName: cols[1],
      type: cols[2] as '収入' | '支出',
      amount,
      category: cols[4],
      subCategory: cols[5],
      label: cols[6] ?? '',
    });
  }

  return rows;
}

function splitCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function findLatestCSV(): string {
  const files = fs.readdirSync(DOWNLOAD_DIR)
    .filter(f => f.startsWith('transactions_team-mirai_') && f.endsWith('.csv'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`CSVファイルが見つかりません: ${DOWNLOAD_DIR}/transactions_team-mirai_*.csv`);
  }
  return path.join(DOWNLOAD_DIR, files[0]);
}

async function main() {
  const csvPath = findLatestCSV();
  console.log(`読み込み中: ${path.relative(ROOT, csvPath)}`);

  const rows = await parseCSV(csvPath);
  console.log(`  ${rows.length.toLocaleString()} 件読み込み完了`);

  // --- summary ---
  const incomeRows = rows.filter(r => r.type === '収入');
  const expenseRows = rows.filter(r => r.type === '支出');
  const totalIncome = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);

  const dates = rows.map(r => r.date).sort();
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();

  // --- monthly ---
  const monthlyMap = new Map<string, { income: number; expense: number; incomeCount: number; expenseCount: number }>();
  for (const m of months) {
    monthlyMap.set(m, { income: 0, expense: 0, incomeCount: 0, expenseCount: 0 });
  }
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const entry = monthlyMap.get(m)!;
    if (r.type === '収入') { entry.income += r.amount; entry.incomeCount++; }
    else { entry.expense += r.amount; entry.expenseCount++; }
  }
  const monthly = months.map(m => ({ month: m, ...monthlyMap.get(m)! }));

  // --- incomeByCategory ---
  const incomeCatMap = new Map<string, { amount: number; count: number }>();
  for (const r of incomeRows) {
    const key = `${r.category}__${r.subCategory}`;
    const entry = incomeCatMap.get(key) ?? { amount: 0, count: 0 };
    entry.amount += r.amount;
    entry.count++;
    incomeCatMap.set(key, entry);
  }
  const incomeByCategory = [...incomeCatMap.entries()]
    .map(([key, v]) => {
      const [category, subCategory] = key.split('__');
      return { category, subCategory, ...v };
    })
    .sort((a, b) => b.amount - a.amount);

  // --- expenseByCategory ---
  const expenseCatMap = new Map<string, { amount: number; count: number }>();
  for (const r of expenseRows) {
    const entry = expenseCatMap.get(r.category) ?? { amount: 0, count: 0 };
    entry.amount += r.amount;
    entry.count++;
    expenseCatMap.set(r.category, entry);
  }
  const expenseByCategory = [...expenseCatMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);

  // --- partyFeeDistribution ---
  const partyFeeRows = rows.filter(r => r.subCategory === '党費');
  const feeCountMap = new Map<number, number>();
  for (const r of partyFeeRows) {
    feeCountMap.set(r.amount, (feeCountMap.get(r.amount) ?? 0) + 1);
  }
  const totalFeeCount = partyFeeRows.length;
  const partyFeeDistribution = [...feeCountMap.entries()]
    .sort((a, b) => b[1] - a[1]) // 件数降順
    .map(([amount, count]) => ({
      amount,
      count,
      percentage: Math.round((count / totalFeeCount) * 1000) / 10,
    }));

  // --- donationDistribution ---
  const donationRows = rows.filter(r => r.subCategory === '個人からの寄附');
  const bands = [
    { label: '〜999円', min: 0, max: 999 },
    { label: '1,000〜4,999円', min: 1000, max: 4999 },
    { label: '5,000〜9,999円', min: 5000, max: 9999 },
    { label: '10,000〜29,999円', min: 10000, max: 29999 },
    { label: '30,000円〜', min: 30000, max: Infinity },
  ];
  const donationDistribution = bands.map(({ label, min, max }) => {
    const filtered = donationRows.filter(r => r.amount >= min && r.amount <= max);
    return {
      label,
      count: filtered.length,
      totalAmount: filtered.reduce((s, r) => s + r.amount, 0),
    };
  });

  // --- partyFeeMonthly ---
  const partyFeeMonthly = months.map(m => {
    const mRows = partyFeeRows.filter(r => r.date.slice(0, 7) === m);
    const tierMap = new Map<number, number>();
    for (const r of mRows) {
      tierMap.set(r.amount, (tierMap.get(r.amount) ?? 0) + 1);
    }
    return {
      month: m,
      count: mRows.length,
      totalAmount: mRows.reduce((s, r) => s + r.amount, 0),
      byTier: [...tierMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([amount, count]) => ({ amount, count })),
    };
  }).filter(m => m.count > 0);

  // --- assemble ---
  const result: MiraiSummaryData = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(csvPath),
    summary: {
      totalIncome,
      totalExpense,
      totalTransactions: rows.length,
      dateRange: {
        from: months[0],
        to: months[months.length - 1],
      },
    },
    monthly,
    incomeByCategory,
    expenseByCategory,
    partyFeeDistribution,
    donationDistribution,
    partyFeeMonthly,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`出力完了: ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`  総収入: ${totalIncome.toLocaleString()}円`);
  console.log(`  総支出: ${totalExpense.toLocaleString()}円`);
  console.log(`  差引: ${(totalIncome - totalExpense).toLocaleString()}円`);
}

main().catch(err => { console.error(err); process.exit(1); });
