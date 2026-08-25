#!/usr/bin/env npx tsx
/**
 * 財務省 予算書「科目別内訳」（項・目）データ生成スクリプト。
 *
 * `/mof-jikou`（Web帳票の事項別内訳をスクレイピング）とは別系統で、こちらは
 * ZIP 同梱 CSV（既にローカル取得済み）をそのまま使う。目は事項と違って
 * 支出の性質（庁費・職員基本給…）による分類だが、RS システムの
 * `2-2_予算・執行_予算種別・歳出予算項目` が 所管/組織・勘定/項/目 を同じ語彙で
 * 持つため、目レベルはMOFとRSを名称の揺れなく直接突き合わせられる
 * （docs/tasks/20260826_0809_項の単独事項構造による紐づけ拡張の調査.md の発端）。
 *
 * ZIP はローカルに当初予算（11001/12001/13001）しか無いため、当初予算のみを収録する。
 *
 * 使用法:
 *   tsx scripts/generate-mof-kou-moku-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-kou-moku-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  MOFKouMokuAccountType,
  MOFKouMokuData,
  MOFKouMokuGroupSummary,
  MOFKouMokuItem,
} from '@/types/mof-kou-moku';
import {
  amountColumn,
  readBudgetTables,
  toEraLabel,
  yen,
  type CsvRow,
} from '@/scripts/mof-budget-csv';
import { MAJOR_EXPENSE } from '@/scripts/mof-major-expense';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/**
 * 使途別分類コード表（docs/mof-budget-data-guide.md 4-6節）。
 * 表に無いコードは「その他」に混ぜず空文字にする（黙って埋もれさせない）。
 */
const PURPOSE_NAMES: Record<string, string> = {
  '1': '人件費',
  '2': '旅費',
  '3': '物件費',
  '4': '施設費',
  '5': '補助費・委託費',
  '6': '他会計へ繰入',
  '9': 'その他',
};

function group(items: MOFKouMokuItem[], keyOf: (item: MOFKouMokuItem) => string): MOFKouMokuGroupSummary[] {
  const map = new Map<string, MOFKouMokuGroupSummary>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const existing = map.get(key) ?? { key, count: 0, amount: 0 };
    existing.count++;
    existing.amount += item.amount;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 一般会計（11001）の行を MOFKouMokuItem に変換 */
function fromGeneral(rows: CsvRow[], accountType: MOFKouMokuAccountType): MOFKouMokuItem[] {
  const col = amountColumn(rows);
  return rows.map((row, i) => ({
    id: `${accountType}-${i}`,
    key: [
      accountType,
      row['所管'] ?? '',
      row['組織'] ?? '',
      '',
      row['項コード'] ?? '',
      row['目別分類コード'] ?? '',
      row['目名'] ?? '',
    ].join('|'),
    accountType,
    ministry: row['所管'] ?? '',
    organization: row['組織'] ?? '',
    specialAccount: '',
    subAccount: '',
    agency: '',
    sectionCode: row['項コード'] ?? '',
    sectionName: row['項名'] ?? '',
    majorExpenseCode: row['主要経費別分類コード'] ?? '',
    majorExpenseName: '', // コード表解決は呼び出し側で行う
    subItemCode: row['目別分類コード'] ?? '',
    subItemName: row['目名'] ?? '',
    purposeCode: row['使途別分類コード'] ?? '',
    purposeName: PURPOSE_NAMES[row['使途別分類コード']] ?? '',
    amount: yen(row, col),
    previousAmount: yen(row, '前年度予算額(千円)'),
    difference: yen(row, '比較増△減額(千円)'),
  }));
}

/** 特別会計（12001）の行を MOFKouMokuItem に変換 */
function fromSpecial(rows: CsvRow[], accountType: MOFKouMokuAccountType): MOFKouMokuItem[] {
  const col = amountColumn(rows);
  return rows.map((row, i) => ({
    id: `${accountType}-${i}`,
    key: [
      accountType,
      row['所管'] ?? '',
      row['特別会計'] ?? '',
      row['勘定'] ?? '',
      row['項コード'] ?? '',
      row['目別分類コード'] ?? '',
      row['目名'] ?? '',
    ].join('|'),
    accountType,
    ministry: row['所管'] ?? '',
    organization: '',
    specialAccount: row['特別会計'] ?? '',
    subAccount: row['勘定'] ?? '',
    agency: '',
    sectionCode: row['項コード'] ?? '',
    sectionName: row['項名'] ?? '',
    majorExpenseCode: row['主要経費別分類コード'] ?? '',
    majorExpenseName: '',
    subItemCode: row['目別分類コード'] ?? '',
    subItemName: row['目名'] ?? '',
    purposeCode: row['使途別分類コード'] ?? '',
    purposeName: PURPOSE_NAMES[row['使途別分類コード']] ?? '',
    amount: yen(row, col),
    previousAmount: yen(row, '前年度予算額(千円)'),
    difference: yen(row, '比較増△減額(千円)'),
  }));
}

/** 政府関係機関（13001）の行を MOFKouMokuItem に変換。主要経費・目的別分類の列が無い */
function fromAgency(rows: CsvRow[], accountType: MOFKouMokuAccountType): MOFKouMokuItem[] {
  const col = amountColumn(rows);
  return rows.map((row, i) => ({
    id: `${accountType}-${i}`,
    key: [
      accountType,
      '',
      row['政府関係機関'] ?? '',
      row['業務'] ?? '',
      row['項コード'] ?? '',
      row['目コード'] ?? '',
      row['目名'] ?? '',
    ].join('|'),
    accountType,
    ministry: '',
    organization: '',
    specialAccount: '',
    subAccount: row['業務'] ?? '',
    agency: row['政府関係機関'] ?? '',
    sectionCode: row['項コード'] ?? '',
    sectionName: row['項名'] ?? '',
    majorExpenseCode: '',
    majorExpenseName: '',
    subItemCode: row['目コード'] ?? '',
    subItemName: row['目名'] ?? '',
    purposeCode: row['使途別分類コード'] ?? '',
    purposeName: PURPOSE_NAMES[row['使途別分類コード']] ?? '',
    amount: yen(row, col),
    previousAmount: yen(row, '前年度予算額(千円)'),
    difference: yen(row, '比較増△減額(千円)'),
  }));
}

function generateYear(fiscalYear: number): void {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） 科目別内訳 ===`);

  const general = readBudgetTables(fiscalYear, '11001');
  const special = readBudgetTables(fiscalYear, '12001');
  const agency = readBudgetTables(fiscalYear, '13001');

  const generalItems = fromGeneral(general.expenditure, 'general');
  const specialItems = fromSpecial(special.expenditure, 'special');
  const agencyItems = fromAgency(agency.expenditure, 'agency');
  const items = [...generalItems, ...specialItems, ...agencyItems];

  // 主要経費別分類コード表（docs/mof-budget-data-guide.md 4-2節）。政府関係機関の帳票には無い
  for (const item of items) {
    if (item.majorExpenseCode) item.majorExpenseName = MAJOR_EXPENSE[item.majorExpenseCode] ?? '';
  }

  const data: MOFKouMokuData = {
    metadata: {
      fiscalYear,
      eraLabel,
      budgetType: '当初予算',
      documents: [
        { accountType: 'general', title: '一般会計予算 科目別内訳（当初予算）', count: generalItems.length },
        { accountType: 'special', title: '特別会計予算 科目別内訳（当初予算）', count: specialItems.length },
        { accountType: 'agency', title: '政府関係機関予算 科目別内訳（当初予算）', count: agencyItems.length },
      ],
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位。生成時に1000倍しています）',
        'ZIPにローカル保有のデータが当初予算のみのため、当初予算のみを収録しています',
        '目は支出の性質による分類です（事項は目的による分類で、`/mof-jikou` が扱います）',
        '目と事項は項の下に並列にぶら下がる別系統の内訳で、対応表はありません',
        '政府関係機関の帳票には主要経費別分類・目的別分類の列がありません',
      ],
    },
    summary: {
      count: items.length,
      byAccountType: group(items, i => i.accountType),
      byMinistry: group(items, i => i.ministry || i.agency),
      byMajorExpense: group(items, i => i.majorExpenseName),
      byPurpose: group(items, i => i.purposeName),
    },
    items,
  };

  const outputFile = path.join(process.cwd(), 'public', 'data', `mof-kou-moku-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  const t = (v: number) => (v / 1e12).toFixed(2);
  const total = items.reduce((s, i) => s + i.amount, 0);
  console.log(`  一般会計 ${generalItems.length.toLocaleString()}件 / 特別会計 ${specialItems.length.toLocaleString()}件 / 政府関係機関 ${agencyItems.length.toLocaleString()}件`);
  console.log(`  合計 ${items.length.toLocaleString()}件 / ${t(total)}兆円`);
  console.log(`  出力: ${path.basename(outputFile)}`);
}

function main(): void {
  const years = process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF 科目別内訳（項・目）生成（対象: ${years.join(', ')}） ===`);
  for (const year of years) generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main();
