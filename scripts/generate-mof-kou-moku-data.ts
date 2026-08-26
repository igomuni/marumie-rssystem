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
 * `/mof-jikou` と同じ予算種別（当初・暫定・補正・決算）を収録する。帳票の suffix 体系は
 * `/mof-jikou` のスクレイパ（generate-mof-jikou-data.ts）と共通。ローカルにZIPが無い
 * 組み合わせ（例: ほとんどの年度の暫定予算）は静かにスキップする。
 *
 * 列構成は予算種別ごとに異なる:
 *   - 当初・暫定（standard）: 本年度額が年度入り見出し列（例: 令和6年度要求額）
 *   - 補正（revised）: 成立予算額／改予算額／差引額の3本。amount=改予算額
 *   - 決算（settlement）: 円単位（他は千円単位）。歳出予算額／歳出予算現額／支出済／
 *     繰越／不用額を持つ
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
  MOFBudgetType,
  MOFKouMokuAccountType,
  MOFKouMokuData,
  MOFKouMokuGroupSummary,
  MOFKouMokuItem,
} from '@/types/mof-kou-moku';
import { MOF_REVISION_NUMBERS, revisedBudgetType } from '@/types/mof-jikou';
import { amountColumn, readBudgetTables, toEraLabel, yen, zipPath, type CsvRow } from '@/scripts/mof-budget-csv';
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

type Layout = 'standard' | 'revised' | 'settlement';

interface DocumentSpec {
  suffix: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  layout: Layout;
  title: string;
}

/** 年度ごとの帳票一覧。ZIPが無い組み合わせは呼び出し側で存在チェックして除く */
function buildDocuments(fiscalYear: number): DocumentSpec[] {
  const specs: DocumentSpec[] = [
    { suffix: '11001', accountType: 'general', budgetType: '当初予算', layout: 'standard', title: '一般会計予算（当初予算）' },
    { suffix: '12001', accountType: 'special', budgetType: '当初予算', layout: 'standard', title: '特別会計予算（当初予算）' },
    { suffix: '13001', accountType: 'agency', budgetType: '当初予算', layout: 'standard', title: '政府関係機関予算（当初予算）' },
    { suffix: '31001', accountType: 'general', budgetType: '暫定予算', layout: 'standard', title: '一般会計予算（暫定予算）' },
    { suffix: '32001', accountType: 'special', budgetType: '暫定予算', layout: 'standard', title: '特別会計予算（暫定予算）' },
    { suffix: '33001', accountType: 'agency', budgetType: '暫定予算', layout: 'standard', title: '政府関係機関予算（暫定予算）' },
    { suffix: '77001', accountType: 'general', budgetType: '決算', layout: 'settlement', title: '一般会計 歳出決算' },
    { suffix: '78001', accountType: 'special', budgetType: '決算', layout: 'settlement', title: '特別会計 歳出決算' },
    { suffix: '76001', accountType: 'agency', budgetType: '決算', layout: 'settlement', title: '政府関係機関 支出決算' },
  ];
  // 補正予算は号数ぶんだけ動的に追加（政府関係機関の補正ZIPは存在しない）
  for (const revision of MOF_REVISION_NUMBERS) {
    const seq = String(revision).padStart(3, '0');
    specs.push({
      suffix: `21${seq}`,
      accountType: 'general',
      budgetType: revisedBudgetType(revision),
      layout: 'revised',
      title: `一般会計予算（補正予算第${revision}号）`,
    });
    specs.push({
      suffix: `22${seq}`,
      accountType: 'special',
      budgetType: revisedBudgetType(revision),
      layout: 'revised',
      title: `特別会計予算（補正予算特第${revision}号）`,
    });
  }
  return specs.filter(s => fs.existsSync(zipPath(fiscalYear, s.suffix)));
}

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

/** 決算（settlement）は円単位で印字されるため、他と違い1000倍しない */
function yenAsIs(row: CsvRow, column: string | undefined): number {
  if (!column) return 0;
  const raw = row[column];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 見出し文字列から列名を解決する（列位置が帳票により動くため） */
function findColumn(headers: string[], match: (h: string) => boolean): string | undefined {
  return headers.find(match);
}

/** 会計区分ごとの列名の違いを吸収する */
function rowFields(row: CsvRow, accountType: MOFKouMokuAccountType, layout: Layout) {
  const subItemCodeCol = layout === 'settlement' ? '目番号' : accountType === 'agency' ? '目コード' : '目別分類コード';
  return {
    ministry: accountType === 'agency' ? '' : row['所管'] ?? '',
    organization: accountType === 'general' ? row['組織'] ?? '' : '',
    specialAccount: accountType === 'special' ? row['特別会計'] ?? '' : '',
    subAccount: accountType === 'special' ? row['勘定'] ?? '' : accountType === 'agency' ? row['業務'] ?? '' : '',
    agency: accountType === 'agency' ? row['政府関係機関'] ?? '' : '',
    sectionCode: row['項コード'] ?? '',
    sectionName: row['項名'] ?? '',
    majorExpenseCode: row['主要経費別分類コード'] ?? '',
    subItemCode: row[subItemCodeCol] ?? '',
    subItemName: row['目名'] ?? '',
    purposeCode: row['使途別分類コード'] ?? '',
  };
}

function extractStandard(
  rows: CsvRow[],
  spec: DocumentSpec
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'purposeName'>> {
  const col = amountColumn(rows);
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yen(row, col),
      previousAmount: yen(row, '前年度予算額(千円)'),
      difference: yen(row, '比較増△減額(千円)'),
      currentAmount: null,
      spent: null,
      carriedOver: null,
      unused: null,
    };
  });
}

function extractRevised(
  rows: CsvRow[],
  spec: DocumentSpec
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'purposeName'>> {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const colRevised = findColumn(headers, h => /^改(令和|平成)(元|\d+)年度/.test(h));
  const colSettled = findColumn(headers, h => h.includes('成立予算額'));
  const colDiff = findColumn(headers, h => h.includes('差引額'));
  if (!colRevised) return [];
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yen(row, colRevised),
      previousAmount: colSettled ? yen(row, colSettled) : null,
      difference: colDiff ? yen(row, colDiff) : null,
      currentAmount: null,
      spent: null,
      carriedOver: null,
      unused: null,
    };
  });
}

function extractSettlement(
  rows: CsvRow[],
  spec: DocumentSpec
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'purposeName'>> {
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    // 決算の「歳出予算額」列は会計区分により語尾が違う（歳出/支出）
    const amountCol = findColumn(Object.keys(row), h => /^(歳出|支出)予算額\(円\)$/.test(h));
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yenAsIs(row, amountCol),
      previousAmount: null,
      difference: null,
      currentAmount: yenAsIs(row, findColumn(Object.keys(row), h => /^(歳出|支出)予算現額\(円\)$/.test(h))),
      spent: yenAsIs(row, findColumn(Object.keys(row), h => /^(支出済歳出額|支出済額)\(円\)$/.test(h))),
      carriedOver: yenAsIs(row, '翌年度繰越額(円)'),
      unused: yenAsIs(row, '不用額(円)'),
    };
  });
}

function generateYear(fiscalYear: number): void {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） 科目別内訳 ===`);

  const documents = buildDocuments(fiscalYear);
  const items: Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'purposeName'>> = [];
  const documentSummaries: MOFKouMokuData['metadata']['documents'] = [];

  for (const spec of documents) {
    const { expenditure } = readBudgetTables(fiscalYear, spec.suffix);
    const extracted =
      spec.layout === 'standard'
        ? extractStandard(expenditure, spec)
        : spec.layout === 'revised'
          ? extractRevised(expenditure, spec)
          : extractSettlement(expenditure, spec);
    items.push(...extracted);
    documentSummaries.push({
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      title: spec.title,
      count: extracted.length,
    });
    console.log(`  ${spec.title}: ${extracted.length.toLocaleString()} 件`);
  }

  const fullItems: MOFKouMokuItem[] = items.map(item => ({
    ...item,
    key: [
      item.accountType,
      item.budgetType,
      item.ministry,
      item.organization,
      item.specialAccount,
      item.subAccount,
      item.agency,
      item.sectionCode,
      item.subItemCode,
      item.subItemName,
    ].join('|'),
    majorExpenseName: item.majorExpenseCode ? MAJOR_EXPENSE[item.majorExpenseCode] ?? '' : '',
    purposeName: PURPOSE_NAMES[item.purposeCode] ?? '',
  }));

  const budgetTypes = [...new Set(fullItems.map(i => i.budgetType))];

  const data: MOFKouMokuData = {
    metadata: {
      fiscalYear,
      eraLabel,
      budgetTypes,
      documents: documentSummaries,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位・決算は円単位。生成時に千円分は1000倍しています）',
        '目は支出の性質による分類です（事項は目的による分類で、`/mof-jikou` が扱います）',
        '目と事項は項の下に並列にぶら下がる別系統の内訳で、対応表はありません',
        '政府関係機関の帳票には主要経費別分類の列がありません',
        '補正予算は amount=改予算額（その号の成立後の姿）／previousAmount=補正前の成立予算額／difference=差引額です',
        '決算の帳票には比較対象額・増減額が無いため previousAmount/difference は null です',
        '暫定予算・補正予算はローカルにZIPがある年度のみ収録しています（暫定は令和8年度のみ）',
      ],
    },
    summary: {
      count: fullItems.length,
      byAccountType: group(fullItems, i => i.accountType),
      byBudgetType: group(fullItems, i => i.budgetType),
      byMinistry: group(fullItems, i => i.ministry || i.agency),
      byMajorExpense: group(fullItems, i => i.majorExpenseName),
      byPurpose: group(fullItems, i => i.purposeName),
    },
    items: fullItems,
  };

  const outputFile = path.join(process.cwd(), 'public', 'data', `mof-kou-moku-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  const t = (v: number) => (v / 1e12).toFixed(2);
  const initialTotal = fullItems.filter(i => i.budgetType === '当初予算').reduce((s, i) => s + i.amount, 0);
  console.log(`  合計 ${fullItems.length.toLocaleString()}件（うち当初予算 ${t(initialTotal)}兆円）`);
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
