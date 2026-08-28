#!/usr/bin/env npx tsx
/**
 * 財務省 予算書「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・
 * 「収入支出予算」（政府関係機関）スクレイピング＆JSON生成スクリプト。
 *
 * これらは項単位（事項・目より1段粗い）の集計表で、歳入・歳出（収入・支出）を
 * 1〜数ページの表にまとめている。事項別内訳・科目別内訳とは完全に独立した別帳票
 * （同じdocumentId内の別ページだが、title_for_listで判別できる単独ファイル）。
 * 項コードを持たないため、事項・目のデータとは項名でしか突き合わせられない。
 *
 * 用途: `/mof-kou` の項（MOFSection）自体に出典ページを付ける（今まで事項・目の
 * 明細にしか出典が無かった）。あわせて歳出額を目側合計との一致確認に使える。
 *
 * v1は当初予算・歳出側のみを取得する。この表には歳入側の値も載っているが、
 * 対応する既存データ（事項・目とも歳出のみ）が無く単独では突合検証できないため見送った。
 * 暫定・補正・決算は帳票の存在未確認のため対象外（このスクリプトの対象年度・
 * 予算種別を増やす場合は先に対象帳票の存在とtitle_for_listを確認すること）。
 *
 * 使用法:
 *   tsx scripts/generate-mof-section-page-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-section-pages-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MOFAccountType } from '@/types/mof-jikou';
import type { MOFSectionPageData, MOFSectionPageEntry } from '@/types/mof-section-pages';
import { toEraLabel } from '@/scripts/mof-budget-csv';
import {
  createThrottle,
  extractXmlNames,
  fetchText,
  HttpError,
  listTitle,
  numberAt,
  parseTable,
  subAt,
  textAt,
  type ParsedRow,
} from '@/scripts/mof-budget-xml';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** 合計・小計行として除外する項名 */
const SUBTOTAL_LABELS = new Set(['計', '合計', '小計']);

type EntryDraft = Omit<MOFSectionPageEntry, 'budgetType' | 'documentId' | 'sourceUrl'>;

/** 一般会計「甲号歳入歳出予算 歳出」: 所管(1)｜組織(2)｜項(3)｜金額(4) */
function parseGeneralExpenditure(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let organization = '';
  for (const row of rows) {
    const newMinistry = textAt(row, 1);
    if (newMinistry) {
      ministry = newMinistry;
      organization = ''; // 所管が変わったら組織はリセット（皇室費のように組織欄が無い場合もある）
    }
    const newOrg = textAt(row, 2);
    if (newOrg) organization = newOrg;
    const sectionName = textAt(row, 3);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 4, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'general',
      ministry,
      // 皇室費のように組織欄が無い帳票は、所管をそのまま組織名とする（kou-moku側と同じ規約）
      organization: organization || ministry,
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 特別会計「歳入歳出予算」: 所管(1)｜特別会計/勘定(2)｜款歳入(3)｜項歳入(4)｜金額歳入(5)｜
 * 項歳出(7)｜金額歳出(8)。列2は特別会計名（列内連番1）と勘定名（列内連番2）を共有する
 * （勘定が無い特別会計は列内連番2が現れない）。
 *
 * 既知の制約: 東日本大震災復興特別会計は、1つの行番号（例: p41-420）の中に列内行連番
 * （420.1・420.2・420.3…）で複数の項をまとめて印字しており、`parseTable()` は
 * ページ・行番号だけで行をグルーピングするため（`mof-budget-xml.ts`参照）これらが
 * 1行に混ざってしまう。事項別内訳・科目別内訳の共通実装への影響を避けるため、
 * この機能ではこの会計だけ突合できないことを許容する（該当4件・データ全体の0.4%）。
 */
function parseSpecialSummary(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let specialAccount = '';
  let subAccount = '';
  for (const row of rows) {
    const newMinistry = textAt(row, 1);
    if (newMinistry) {
      ministry = newMinistry;
      specialAccount = '';
      subAccount = '';
    }
    const col2Text = textAt(row, 2);
    if (col2Text) {
      const col2Sub = subAt(row, 2);
      if (col2Sub === 1) {
        specialAccount = col2Text;
        subAccount = '';
      } else if (col2Sub === 2) {
        subAccount = col2Text;
      }
    }
    const sectionName = textAt(row, 7);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 8, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'special',
      ministry,
      organization: '',
      specialAccount,
      subAccount,
      agency: '',
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 政府関係機関「収入支出予算」: 機関名(1)｜款収入(2)｜項収入(3)｜金額収入(4)｜項支出(6)｜金額支出(7)。
 * 列1は機関名（列内連番1）と業務区分（列内連番3。複数の業務を持つ機関のみ）を共有する
 * （kou-moku側は業務区分を subAccount フィールドに持つのでそれに合わせる）。
 */
function parseAgencySummary(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let agency = '';
  let subAccount = '';
  for (const row of rows) {
    for (const cell of row.cols.get(1) ?? []) {
      const text = cell.text.trim();
      if (!text) continue;
      if (cell.sub === 1) {
        agency = text;
        subAccount = '';
      } else if (cell.sub === 3) {
        subAccount = text;
      }
    }
    const sectionName = textAt(row, 6);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 7, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'agency',
      ministry: '',
      organization: '',
      specialAccount: '',
      subAccount,
      agency,
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

interface DocumentSpec {
  suffix: string;
  accountType: MOFAccountType;
  /** 帳票判別に使う title_for_list */
  targetTitle: string;
  parse: (rows: ParsedRow[]) => EntryDraft[];
  title: string;
}

/** 令和8年度（2026）時点の当初予算の帳票suffix。年度をまたいでも共通（事項別内訳と同じ規約） */
const DOCUMENTS: DocumentSpec[] = [
  { suffix: '11001', accountType: 'general', targetTitle: '歳出', parse: parseGeneralExpenditure, title: '一般会計 甲号歳入歳出予算（歳出）' },
  { suffix: '12001', accountType: 'special', targetTitle: '歳入歳出予算', parse: parseSpecialSummary, title: '特別会計 歳入歳出予算' },
  { suffix: '13001', accountType: 'agency', targetTitle: '収入支出予算', parse: parseAgencySummary, title: '政府関係機関 収入支出予算' },
];

const throttle = createThrottle();
const scrapeCacheDir = (fiscalYear: number) => path.join(process.cwd(), 'data', 'download', `mof_${fiscalYear}`, 'xml');
const scrapeBase = (fiscalYear: number) => `https://www.bb.mof.go.jp/server/${fiscalYear}`;

async function collectEntries(fiscalYear: number, spec: DocumentSpec): Promise<MOFSectionPageEntry[]> {
  const cacheDir = scrapeCacheDir(fiscalYear);
  const base = scrapeBase(fiscalYear);
  const documentId = `${fiscalYear}${spec.suffix}`;
  let menu: string;
  try {
    menu = await fetchText(cacheDir, `${base}/html/${documentId}menu.html`, 'euc-jp', throttle, `${documentId}menu.html`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    console.warn(`  ⚠ [${documentId}] 目次の取得に失敗: ${(error as Error).message}`);
    return [];
  }

  const results: MOFSectionPageEntry[] = [];
  for (const name of extractXmlNames(menu)) {
    let xml: string;
    try {
      xml = await fetchText(cacheDir, `${base}/xml/${name}`, 'shift_jis', throttle, name);
    } catch (error) {
      if (error instanceof HttpError) continue;
      console.warn(`  ⚠ [${documentId}] ${name} の取得に失敗: ${(error as Error).message}`);
      continue;
    }
    if (listTitle(xml) !== spec.targetTitle) continue;

    const { rows } = parseTable(xml);
    const sourceUrl = `${base}/xml/${name}`;
    for (const draft of spec.parse(rows)) {
      results.push({ ...draft, budgetType: '当初予算', documentId, sourceUrl });
    }
  }
  return results;
}

async function generateYear(fiscalYear: number): Promise<void> {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） 項の出典ページ ===`);

  const entries: MOFSectionPageEntry[] = [];
  for (const spec of DOCUMENTS) {
    const found = await collectEntries(fiscalYear, spec);
    entries.push(...found);
    console.log(`  ${spec.title}: ${found.length.toLocaleString()} 件`);
  }

  if (entries.length === 0) {
    console.warn(`  ⚠️  ${fiscalYear}年度は1件も取得できませんでした。スキップします。`);
    return;
  }

  const data: MOFSectionPageData = {
    metadata: {
      fiscalYear,
      eraLabel,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '出典は「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・「収入支出予算」（政府関係機関）。' +
          '事項別内訳・科目別内訳とは独立した別帳票で、項コードを持たないため項名での一致でのみ突き合わせられる',
        '当初予算・歳出側のみ収録。歳入側の値もこの表にあるが対応する既存データが無いため未取得',
      ],
    },
    entries,
  };

  const outputFile = path.join(process.cwd(), 'public', 'data', `mof-section-pages-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  console.log(`  合計 ${entries.length.toLocaleString()}件`);
  console.log(`  出力: ${path.basename(outputFile)}`);
}

async function main(): Promise<void> {
  const years = process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF 項の出典ページ 生成（対象: ${years.join(', ')}） ===`);
  for (const year of years) await generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
