/**
 * 財務省 予算書「事項別内訳」スクレイピング＆JSON生成スクリプト
 *
 * 予算書 ZIP に同梱される CSV は科目別内訳（目レベル）のみで、事項名と説明文を含まない。
 * そのため予算書データベースの Web 帳票（XML）から事項を直接取得する。
 *
 * 使用法:
 *   tsx scripts/generate-mof-jikou-data.ts [FISCAL_YEAR]
 *   例: tsx scripts/generate-mof-jikou-data.ts 2026   （令和8年度当初予算）
 *   デフォルト: 2026
 *
 * 出力: public/data/mof-jikou-{FISCAL_YEAR}.json
 * XMLキャッシュ: data/download/mof-{FISCAL_YEAR}/xml/
 *
 * 取得元:
 *   一般会計 https://www.bb.mof.go.jp/server/{YEAR}/html/{YEAR}11001menu.html
 *   特別会計 https://www.bb.mof.go.jp/server/{YEAR}/html/{YEAR}12001menu.html
 *
 * 帳票構造・コード表は docs/mof-budget-data-guide.md を参照。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  MOFAccountType,
  MOFJikouData,
  MOFJikouGroupSummary,
  MOFJikouItem,
} from '@/types/mof-jikou';

// 年度設定
const FISCAL_YEAR = parseInt(process.argv[2] || '2026', 10);
if (isNaN(FISCAL_YEAR) || FISCAL_YEAR < 2000 || FISCAL_YEAR > 2100) {
  console.error(`Invalid fiscal year: ${process.argv[2]}`);
  process.exit(1);
}

const BASE = `https://www.bb.mof.go.jp/server/${FISCAL_YEAR}`;
const CACHE_DIR = path.join(process.cwd(), 'data', 'download', `mof-${FISCAL_YEAR}`, 'xml');
const OUTPUT_FILE = path.join(process.cwd(), 'public', 'data', `mof-jikou-${FISCAL_YEAR}.json`);

/** 事項別内訳ページの title_for_list（これで帳票を判別する） */
const LIST_TITLE: Record<MOFAccountType, string> = {
  general: '〔組織別事項別内訳〕',
  special: '歳出 事項別内訳',
};

/** 帳票ID（一般会計=11001 / 特別会計=12001） */
const DOC_ID: Record<MOFAccountType, string> = {
  general: `${FISCAL_YEAR}11001`,
  special: `${FISCAL_YEAR}12001`,
};

/** 主要経費別分類コード表（docs/mof-budget-data-guide.md 4-2節） */
const MAJOR_EXPENSE: Record<string, string> = {
  '01': '社会保障関係費',
  '02': '年金給付費',
  '03': '医療給付費',
  '04': '介護給付費',
  '05': '少子化対策費',
  '06': '生活扶助等社会福祉費',
  '07': '保健衛生対策費',
  '08': '雇用労災対策費',
  '10': '文教及び科学振興費',
  '11': '義務教育費国庫負担金',
  '13': '科学技術振興費',
  '14': '文教施設費',
  '15': '教育振興助成費',
  '16': '育英事業費',
  '20': '国債費',
  '25': '恩給関係費',
  '31': '地方交付税交付金',
  '32': '地方特例交付金',
  '33': '地方譲与税譲与金',
  '35': '防衛関係費',
  '40': '公共事業関係費',
  '41': '治山治水対策事業費',
  '42': '道路整備事業費',
  '43': '港湾空港鉄道等整備事業費',
  '44': '住宅都市環境整備事業費',
  '45': '公園水道廃棄物処理等施設整備費',
  '46': '農林水産基盤整備事業費',
  '47': '社会資本総合整備事業費',
  '48': '推進費等',
  '49': '災害復旧等事業費',
  '50': '経済協力費',
  '60': '中小企業対策費',
  '63': 'エネルギー対策費',
  '65': '食料安定供給関係費',
  '95': 'その他の事項経費',
  '97': '復興加速化・福島再生予備費',
  '98': '予備費',
};

/** 指定エンコーディングでテキストを取得する（XMLはキャッシュする） */
async function fetchText(url: string, encoding: string, cacheName?: string): Promise<string> {
  if (cacheName) {
    const cached = path.join(CACHE_DIR, cacheName);
    if (fs.existsSync(cached)) {
      return new TextDecoder(encoding).decode(fs.readFileSync(cached));
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (cacheName) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, cacheName), buf);
  }
  return new TextDecoder(encoding).decode(buf);
}

/**
 * 目次 HTML（EUC-JP）から XML ファイル名を抽出する。
 * 目次は LineOut(階層, 子有無, 表題, リンク, 頁) を並べた JavaScript。
 * ここでは絞り込まず全リンクを返し、帳票の判別は XML の title_for_list で行う
 * （目次の表題は年度により揺れるため）。
 */
function extractXmlNames(menuHtml: string): string[] {
  const names = new Set<string>();
  const re = /LineOut\(\d+,\d+,"(?:.*?)","(.*?)","(?:.*?)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(menuHtml)) !== null) {
    const link = m[1].split('#')[0];
    if (link.endsWith('.xml')) names.add(link);
  }
  return [...names];
}

/** 表の1行。同じ列に複数のセルが現れうるため値は配列で持つ */
interface ParsedRow {
  page: number;
  row: number;
  cols: Map<number, string[]>;
}

/** CDATA を連結してセルのテキストを得る（原文の折り返しごとに l 要素が分かれる） */
function cellText(body: string): string {
  return [...body.matchAll(/CDATA\[([\s\S]*?)\]\]/g)].map((m) => m[1]).join('');
}

/**
 * 本文 XML を表として復元する。
 *
 * セルは clm 要素の id="p{頁}-{行}.{行内連番}-{列}.{列内連番}" から位置が復元でき、
 * XSL を適用しなくても表を組み立てられる。
 *
 * 同じ (頁,行,列) に複数のセルが現れることがある（折り返し・「うち」書き）。
 * テキスト列は連結しないと名前が途中で切れるが、金額列を連結すると別の金額と
 * 繋がって桁が壊れる。そのため値は配列のまま保持し、textAt()（連結）と
 * numberAt()（先頭のみ）で使い分ける。
 */
function parseTable(xml: string): { rows: ParsedRow[]; headerCols: Map<string, number> } {
  const rowMap = new Map<string, ParsedRow>();
  const re = /<clm id="p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)">([\s\S]*?)<\/clm>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const page = parseInt(m[1], 10);
    const row = parseInt(m[2], 10);
    const col = parseInt(m[4], 10);
    const key = `${page}:${row}`;
    let entry = rowMap.get(key);
    if (!entry) {
      entry = { page, row, cols: new Map() };
      rowMap.set(key, entry);
    }
    const values = entry.cols.get(col);
    if (values) values.push(cellText(m[6]));
    else entry.cols.set(col, [cellText(m[6])]);
  }
  const rows = [...rowMap.values()].sort((a, b) => a.page - b.page || a.row - b.row);

  // ヘッダ行の列位置（見出し文字列 -> 列番号）
  const headerCols = new Map<string, number>();
  const headerMatch = xml.match(/<header>([\s\S]*?)<\/header>/);
  if (headerMatch) {
    const hre = /<clm id="p\d+-\d+\.\d+-(\d+)\.\d+">([\s\S]*?)<\/clm>/g;
    let h: RegExpExecArray | null;
    while ((h = hre.exec(headerMatch[1])) !== null) {
      const label = cellText(h[2]).trim();
      if (label && !headerCols.has(label)) headerCols.set(label, parseInt(h[1], 10));
    }
  }
  return { rows, headerCols };
}

/** テキストとして読む（同一セルの複数候補を連結） */
function textAt(row: ParsedRow, col: number): string {
  return (row.cols.get(col) ?? []).join('').trim();
}

/** 金額として読む（先頭の候補のみ。連結すると桁が壊れる） */
function numberAt(row: ParsedRow, col: number): number | null {
  const first = (row.cols.get(col) ?? [])[0]?.trim() ?? '';
  const negative = first.includes('△');
  const digits = first.replace(/[△\s,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10);
  return negative ? -value : value;
}

/** running_title「内閣府所管  内閣本府」を階層に分解する */
function splitRunningTitle(xml: string): string[] {
  const m = xml.match(/<running_title>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/[ \t　]{2,}|　/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** title_for_list を取り出す（帳票の判別に使う） */
function listTitle(xml: string): string {
  const m = xml.match(/<title_for_list>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : '';
}

/** 1ページ分の事項を抽出する */
function extractItems(
  xml: string,
  accountType: MOFAccountType,
  fileName: string
): MOFJikouItem[] {
  const { rows, headerCols } = parseTable(xml);

  // 列位置はヘッダから決める。一般会計と特別会計で1列ずれるため固定値にしない。
  // 事項名は「事項」見出しの1つ右の列（見出しは主要経費コード列にかかっている）。
  const jikouHeaderCol = headerCols.get('事項');
  if (jikouHeaderCol === undefined) return [];
  const colName = jikouHeaderCol + 1;
  const colMajorExpense = jikouHeaderCol;
  const colSectionName = jikouHeaderCol - 1;
  const colSectionCode = jikouHeaderCol - 2;
  const colAmount = [...headerCols.entries()].find(([k]) => /^令和\d+年度$/.test(k))?.[1];
  const colPrev = headerCols.get('前年度予算額') ?? headerCols.get('前年度');
  const colDiff = [...headerCols.entries()].find(([k]) => k.startsWith('比較増'))?.[1];
  const colDescription = headerCols.get('説明');
  if (colAmount === undefined) return [];

  // running_title は「内閣府所管  内閣本府」の形。末尾の「所管」を落とすと
  // CSV（DL...b.csv）の 所管 列と同じ表記になり、後から科目データと突き合わせやすい。
  const titleParts = splitRunningTitle(xml);
  const ministry = (titleParts[0] ?? '').replace(/所管$/, '');
  // 皇室費のように組織が印字されない帳票は、所管をそのまま組織名とする（CSV も同じ扱い）
  const secondary = titleParts[1] ?? ministry;
  const tertiary = titleParts[2] ?? '';

  const items: MOFJikouItem[] = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    // 項は最初の行にだけ印字され、以降の事項行は空欄で継続する
    const code = textAt(row, colSectionCode);
    const section = textAt(row, colSectionName);
    if (code) currentSectionCode = code;
    if (section) currentSectionName = section;

    const name = textAt(row, colName);
    const amount = numberAt(row, colAmount);
    if (!name || amount === null) continue;

    const majorExpenseCode = textAt(row, colMajorExpense);
    items.push({
      id: `${accountType}-${row.page}-${row.row}`,
      accountType,
      ministry,
      organization: accountType === 'general' ? secondary : '',
      specialAccount: accountType === 'special' ? secondary : '',
      subAccount: accountType === 'special' ? tertiary : '',
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      previousAmount: colPrev === undefined ? 0 : (numberAt(row, colPrev) ?? 0),
      difference: colDiff === undefined ? 0 : (numberAt(row, colDiff) ?? 0),
      description: colDescription === undefined ? '' : textAt(row, colDescription),
      page: row.page,
      sourceUrl: `${BASE}/xml/${fileName}`,
    });
  }
  return items;
}

function groupBy(
  items: MOFJikouItem[],
  key: (i: MOFJikouItem) => string
): MOFJikouGroupSummary[] {
  const map = new Map<string, MOFJikouGroupSummary>();
  for (const item of items) {
    const k = key(item);
    const cur = map.get(k) ?? { key: k, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += item.amount;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

async function collect(accountType: MOFAccountType): Promise<MOFJikouItem[]> {
  const doc = DOC_ID[accountType];
  const menuUrl = `${BASE}/html/${doc}menu.html`;
  console.log(`[${accountType}] 目次を取得: ${menuUrl}`);
  const menu = await fetchText(menuUrl, 'euc-jp');
  const names = extractXmlNames(menu);
  console.log(`[${accountType}] XMLリンク ${names.length} 件を走査`);

  const items: MOFJikouItem[] = [];
  let pages = 0;
  for (const name of names) {
    const xml = await fetchText(`${BASE}/xml/${name}`, 'shift_jis', name);
    if (listTitle(xml) !== LIST_TITLE[accountType]) continue;
    pages += 1;
    items.push(...extractItems(xml, accountType, name));
  }
  console.log(`[${accountType}] 事項別内訳 ${pages} ページ / 事項 ${items.length} 件`);
  return items;
}

async function main() {
  console.log(`=== MOF 事項別内訳データ生成（${FISCAL_YEAR}年度） ===`);
  const general = await collect('general');
  const special = await collect('special');
  const items = [...general, ...special];
  if (items.length === 0) {
    console.error('事項が1件も取得できませんでした。年度または帳票構造を確認してください。');
    process.exit(1);
  }

  const eraYear = FISCAL_YEAR - 2018; // 2019年 = 令和元年
  const data: MOFJikouData = {
    metadata: {
      fiscalYear: FISCAL_YEAR,
      eraLabel: `令和${eraYear}年度`,
      budgetType: '当初予算',
      unit: 'thousand_yen',
      generatedAt: new Date().toISOString(),
      source: {
        generalAccount: `${BASE}/html/${DOC_ID.general}Main.html`,
        specialAccount: `${BASE}/html/${DOC_ID.special}Main.html`,
      },
      notes: [
        '全金額は千円単位です（行政事業レビュー側のデータは円単位なので混同しないこと）',
        '事項は「項の下に置かれた経費のまとまり」で、行政事業レビューの事業とは1対1に対応しません（1事項あたり平均4事業）',
        '一般会計と特別会計の金額を単純合算すると会計間の繰入が二重計上されます',
        '出典は財務省 予算書・決算書データベースの Web 帳票です（予算書ZIP同梱のCSVには事項名・説明文が含まれないため）',
      ],
    },
    summary: {
      count: items.length,
      amount: items.reduce((sum, i) => sum + i.amount, 0),
      byAccountType: groupBy(items, (i) =>
        i.accountType === 'general' ? '一般会計' : '特別会計'
      ),
      byMinistry: groupBy(items, (i) => i.ministry),
      byMajorExpense: groupBy(
        items,
        (i) => i.majorExpenseName || `(未定義:${i.majorExpenseCode})`
      ),
    },
    items,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data), 'utf-8');
  const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`\n出力: ${OUTPUT_FILE} (${sizeKB} KB)`);
  console.log(
    `事項 ${data.summary.count} 件 / 合計 ${(data.summary.amount / 1e9).toFixed(1)} 兆円`
  );
  for (const g of data.summary.byAccountType) {
    console.log(`  ${g.key}: ${g.count} 件 / ${(g.amount / 1e9).toFixed(1)} 兆円`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
