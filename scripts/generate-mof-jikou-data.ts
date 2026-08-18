/**
 * 財務省 予算書「事項別内訳」スクレイピング＆JSON生成スクリプト
 *
 * 予算書 ZIP に同梱される CSV は科目別内訳（目レベル）のみで、事項名と説明文を含まない。
 * そのため予算書データベースの Web 帳票（XML）から事項を直接取得する。
 *
 * 使用法:
 *   tsx scripts/generate-mof-jikou-data.ts [FISCAL_YEAR]
 *   例: tsx scripts/generate-mof-jikou-data.ts 2026   （令和8年度）
 *   デフォルト: 2026
 *
 * 出力: public/data/mof-jikou-{FISCAL_YEAR}.json
 * XMLキャッシュ: data/download/mof_{FISCAL_YEAR}/xml/
 *
 * 取り込む帳票（DOCUMENTS 参照）:
 *   当初予算 一般会計(11001) / 特別会計(12001) / 政府関係機関(13001)
 *   暫定予算 一般会計(31001) / 特別会計(32001) / 政府関係機関(33001)
 *   補正予算 一般会計(21001) / 特別会計(22001)
 *
 * 帳票構造・コード表は docs/mof-budget-data-guide.md を参照。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  MOFAccountType,
  MOFBudgetType,
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
const CACHE_DIR = path.join(process.cwd(), 'data', 'download', `mof_${FISCAL_YEAR}`, 'xml');
const OUTPUT_FILE = path.join(process.cwd(), 'public', 'data', `mof-jikou-${FISCAL_YEAR}.json`);

/**
 * 表のレイアウト。
 *
 * - standard: 「事項」が独立した見出し列を持つ（当初予算・暫定予算）。
 *   列位置はヘッダから解決する（一般会計と特別会計で1列ずれるため）。
 * - revised: 補正予算。組織・項・事項が1列に畳まれ、金額欄が
 *   成立予算額／補正要求追加額／修正減少額／差引額／改予算額の5本になる。
 */
type TableLayout = 'standard' | 'revised';

interface DocumentSpec {
  /** 帳票ID下4桁を除いた識別子（例: 11001） */
  suffix: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /** 事項別内訳ページの title_for_list。帳票の判別に使う */
  listTitle: string;
  layout: TableLayout;
  title: string;
}

const DOCUMENTS: DocumentSpec[] = [
  { suffix: '11001', accountType: 'general', budgetType: '当初予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', title: '一般会計予算（当初予算）' },
  { suffix: '12001', accountType: 'special', budgetType: '当初予算', listTitle: '歳出 事項別内訳', layout: 'standard', title: '特別会計予算（当初予算）' },
  { suffix: '13001', accountType: 'agency', budgetType: '当初予算', listTitle: '支出 事項別内訳', layout: 'standard', title: '政府関係機関予算（当初予算）' },
  { suffix: '31001', accountType: 'general', budgetType: '暫定予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', title: '一般会計予算（暫定予算）' },
  { suffix: '32001', accountType: 'special', budgetType: '暫定予算', listTitle: '歳出 事項別内訳', layout: 'standard', title: '特別会計予算（暫定予算）' },
  { suffix: '33001', accountType: 'agency', budgetType: '暫定予算', listTitle: '支出 事項別内訳', layout: 'standard', title: '政府関係機関予算（暫定予算）' },
  { suffix: '21001', accountType: 'general', budgetType: '補正予算（第1号）', listTitle: '〔組織別事項別内訳〕', layout: 'revised', title: '一般会計予算（補正予算第1号）' },
  { suffix: '22001', accountType: 'special', budgetType: '補正予算（第1号）', listTitle: '歳出 事項別内訳', layout: 'revised', title: '特別会計予算（補正予算特第1号）' },
];

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
  '96': '中東情勢等対応予備費', // 令和8年度補正予算（第1号）で追加
  '97': '復興加速化・福島再生予備費',
  '98': '予備費',
};

/** 1リクエストの上限。応答が止まったまま生成コマンドが固まるのを防ぐ */
const FETCH_TIMEOUT_MS = 30_000;

/** HTTP エラー。ステータスで「帳票が無い(404)」と障害を区別するために持つ */
class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

/** 指定エンコーディングでテキストを取得する（XMLはキャッシュする） */
async function fetchText(url: string, encoding: string, cacheName?: string): Promise<string> {
  if (cacheName) {
    const cached = path.join(CACHE_DIR, cacheName);
    if (fs.existsSync(cached)) {
      return new TextDecoder(encoding).decode(fs.readFileSync(cached));
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, url);
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
 * （一般会計では事項別内訳ページの目次表題が組織名になっており、表題では絞れない）。
 */
function extractXmlNames(menuHtml: string): string[] {
  const names = new Set<string>();
  const re = /LineOut\(\d+,\d+,"(?:.*?)","(.*?)","(?:.*?)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(menuHtml)) !== null) {
    const link = m[1].split('#')[0];
    // リンクはリモートの HTML 由来。そのままキャッシュのファイル名にすると
    // "../../outside.xml" のような値で CACHE_DIR の外を読み書きできてしまうため、
    // ディレクトリ要素を含まない予算書のファイル名だけを通す。
    if (/^\d{9}[0-9a-z]*\.xml$/.test(link)) names.add(link);
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
function textAt(row: ParsedRow, col: number | undefined): string {
  if (col === undefined) return '';
  return (row.cols.get(col) ?? []).join('').trim();
}

/**
 * 金額として読む（先頭の候補のみ。連結すると桁が壊れる）。
 *
 * 予算書の印字は千円単位だが、リポジトリ全体の金額規約が1円単位なので
 * ここで1000倍して返す。RS 側のデータと混ぜたときの1000倍ずれを防ぐため。
 */
function numberAt(row: ParsedRow, col: number | undefined): number | null {
  if (col === undefined) return null;
  const first = (row.cols.get(col) ?? [])[0]?.trim() ?? '';
  const negative = first.includes('△');
  const digits = first.replace(/[△\s,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10) * 1000;
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

/** running_title から所管・組織・特会・勘定・機関を割り当てる */
function resolveScope(accountType: MOFAccountType, parts: string[]) {
  // running_title は「内閣府所管  内閣本府」の形。末尾の「所管」を落とすと
  // CSV（DL...b.csv）の 所管 列と同じ表記になり、科目データと突き合わせやすい。
  const first = (parts[0] ?? '').replace(/所管$/, '');
  const second = parts[1] ?? '';
  const third = parts[2] ?? '';
  if (accountType === 'general') {
    // 皇室費のように組織が印字されない帳票は、所管をそのまま組織名とする（CSV も同じ扱い）
    return { ministry: first, organization: second || first, specialAccount: '', subAccount: '', agency: '' };
  }
  if (accountType === 'special') {
    return { ministry: first, organization: '', specialAccount: second, subAccount: third, agency: '' };
  }
  // 政府関係機関は running_title が「沖縄振興開発金融公庫」または「機関名  業務名」
  return { ministry: '', organization: '', specialAccount: '', subAccount: second, agency: parts[0] ?? '' };
}

/** 内容ベースの合成キー（MOF は事項に公式なIDを振っていない） */
function buildKey(item: Omit<MOFJikouItem, 'key'>): string {
  return [
    item.accountType,
    item.budgetType,
    item.ministry,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.name,
  ].join('|');
}

/** standard レイアウト（当初予算・暫定予算）の1ページを抽出する */
function extractStandard(
  rows: ParsedRow[],
  headerCols: Map<string, number>,
  spec: DocumentSpec,
  scope: ReturnType<typeof resolveScope>,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const jikouHeaderCol = headerCols.get('事項');
  if (jikouHeaderCol === undefined) return [];
  // 一般会計・特別会計は「事項」見出しが主要経費コード列にかかっており、事項名は1つ右。
  // 政府関係機関には主要経費の列が無く、事項名が見出しの列にそのまま入る。
  // 見出し列に2桁コードが並んでいるかで判別する。
  const hasMajorExpense = rows.some((r) => /^\d{2}$/.test(textAt(r, jikouHeaderCol)));
  const colName = hasMajorExpense ? jikouHeaderCol + 1 : jikouHeaderCol;
  const colMajorExpense = hasMajorExpense ? jikouHeaderCol : undefined;
  const colSectionName = jikouHeaderCol - 1;
  const colSectionCode = jikouHeaderCol - 2;
  // 当初は「令和8年度」、暫定は「令和8年度暫定予算」。前方一致で拾う
  const colAmount = [...headerCols.entries()].find(([k]) => /^令和\d+年度/.test(k))?.[1];
  const colPrev = headerCols.get('前年度予算額') ?? headerCols.get('前年度');
  const colDiff = [...headerCols.entries()].find(([k]) => k.startsWith('比較増'))?.[1];
  const colDescription = headerCols.get('説明');
  if (colAmount === undefined) return [];

  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    // 項は最初の行にだけ印字され、以降の事項行は空欄で継続する。
    // ただし「説明」欄には数量の内訳表（種別／千トン等）が埋め込まれることがあり、
    // その行も同じ列番号を使うため、項コードが数字であることを条件に取り違えを防ぐ
    // （例: 食料安定供給特別会計 食糧管理勘定 p.348 の「大麦等 172」）。
    // 項コードと項名は必ずセットで印字されるので、両方揃った行でだけ更新する。
    const code = textAt(row, colSectionCode);
    const section = textAt(row, colSectionName);
    if (/^\d+$/.test(code) && section) {
      currentSectionCode = code;
      currentSectionName = section;
    }

    const name = textAt(row, colName);
    const amount = numberAt(row, colAmount);
    if (!name || amount === null) continue;

    const majorExpenseCode = textAt(row, colMajorExpense);
    items.push({
      id: `${spec.accountType}-${FISCAL_YEAR}${spec.suffix}-${row.page}-${row.row}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      documentId: `${FISCAL_YEAR}${spec.suffix}`,
      ...scope,
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      previousAmount: numberAt(row, colPrev),
      difference: numberAt(row, colDiff),
      description: textAt(row, colDescription),
      page: row.page,
      sourceUrl: `${BASE}/xml/${fileName}`,
    });
  }
  return items;
}

/**
 * revised レイアウト（補正予算）の1ページを抽出する。
 *
 * 組織・項・事項が1列（col 1〜2）に畳まれており、行の種類はコードの桁数で判別する。
 * 項コードは3桁ゼロ埋め、主要経費コードは2桁。金額は
 * 3=成立予算額 / 4=補正要求追加額 / 5=修正減少額 / 6=差引額 / 7=改予算額。
 * 当初予算と揃えるため amount=改予算額、previousAmount=成立予算額、difference=差引額 とする。
 */
function extractRevised(
  rows: ParsedRow[],
  spec: DocumentSpec,
  scope: ReturnType<typeof resolveScope>,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    const code = textAt(row, 1);
    const label = textAt(row, 2);
    if (/^\d{3}$/.test(code)) {
      currentSectionCode = code;
      currentSectionName = label;
      continue;
    }
    if (!/^\d{2}$/.test(code) || !label) continue;

    const amount = numberAt(row, 7);
    if (amount === null) continue;
    items.push({
      id: `${spec.accountType}-${FISCAL_YEAR}${spec.suffix}-${row.page}-${row.row}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      documentId: `${FISCAL_YEAR}${spec.suffix}`,
      ...scope,
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode: code,
      majorExpenseName: MAJOR_EXPENSE[code] ?? '',
      name: label,
      amount,
      previousAmount: numberAt(row, 3),
      difference: numberAt(row, 6),
      description: textAt(row, 8),
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

const ACCOUNT_LABEL: Record<MOFAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

async function collect(spec: DocumentSpec): Promise<{ items: MOFJikouItem[]; pages: number }> {
  const documentId = `${FISCAL_YEAR}${spec.suffix}`;
  const menuUrl = `${BASE}/html/${documentId}menu.html`;
  const menu = await fetchText(menuUrl, 'euc-jp');
  const names = extractXmlNames(menu);

  const items: MOFJikouItem[] = [];
  let pages = 0;
  for (const name of names) {
    const xml = await fetchText(`${BASE}/xml/${name}`, 'shift_jis', name);
    if (listTitle(xml) !== spec.listTitle) continue;
    pages += 1;
    const { rows, headerCols } = parseTable(xml);
    const scope = resolveScope(spec.accountType, splitRunningTitle(xml));
    const raw =
      spec.layout === 'revised'
        ? extractRevised(rows, spec, scope, name)
        : extractStandard(rows, headerCols, spec, scope, name);
    items.push(...raw.map((i) => ({ ...i, key: buildKey(i) })));
  }
  console.log(
    `[${documentId}] ${spec.title}: ${pages} ページ / 事項 ${items.length} 件 ` +
      `/ ${(items.reduce((s, i) => s + i.amount, 0) / 1e12).toFixed(1)} 兆円`
  );
  return { items, pages };
}

async function main() {
  console.log(`=== MOF 事項別内訳データ生成（${FISCAL_YEAR}年度） ===`);
  const items: MOFJikouItem[] = [];
  const documents: MOFJikouData['metadata']['documents'] = [];

  for (const spec of DOCUMENTS) {
    const documentId = `${FISCAL_YEAR}${spec.suffix}`;
    try {
      const { items: docItems, pages } = await collect(spec);
      items.push(...docItems);
      documents.push({
        documentId,
        accountType: spec.accountType,
        budgetType: spec.budgetType,
        title: `${spec.title}`,
        url: `${BASE}/html/${documentId}Main.html`,
        pages,
        count: docItems.length,
      });
    } catch (error) {
      // 年度によっては暫定予算・補正予算が存在しない。その 404 だけを欠番として飛ばし、
      // 通信障害・サーバエラー・パーサの退行は握り潰さずに失敗させる
      // （部分的な JSON が正常終了で出力されるのを防ぐ）。
      if (error instanceof HttpError && error.status === 404) {
        console.warn(`[${documentId}] 帳票なし（404）としてスキップ`);
        continue;
      }
      throw error;
    }
  }

  if (items.length === 0) {
    console.error('事項が1件も取得できませんでした。年度または帳票構造を確認してください。');
    process.exit(1);
  }

  const duplicates = items.length - new Set(items.map((i) => i.key)).size;
  if (duplicates > 0) console.warn(`⚠️  合成キーの重複が ${duplicates} 件あります`);

  const eraYear = FISCAL_YEAR - 2018; // 2019年 = 令和元年
  const data: MOFJikouData = {
    metadata: {
      fiscalYear: FISCAL_YEAR,
      eraLabel: `令和${eraYear}年度`,
      budgetTypes: [...new Set(documents.filter((d) => d.count > 0).map((d) => d.budgetType))],
      documents,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位ですが、生成時に1000倍しています。CSVと突き合わせるときは1000で割ってください）',
        '事項は「項の下に置かれた経費のまとまり」で、行政事業レビューの事業とは1対1に対応しません（1事項あたり平均4事業）',
        '当初予算・暫定予算・補正予算は別々の帳票です。予算種別をまたいで合算しないでください',
        '一般会計・特別会計・政府関係機関の金額を単純合算すると会計間の繰入が二重計上されます',
        '補正予算の金額は amount=改予算額 / previousAmount=補正前の成立予算額 / difference=差引額 です',
        '暫定予算には比較欄が無いため previousAmount と difference は null です',
        '出典は財務省 予算書・決算書データベースの Web 帳票です（予算書ZIP同梱のCSVには事項名・説明文が含まれないため）',
      ],
    },
    summary: {
      count: items.length,
      // 予算種別・会計区分をまたいだ総額は出さない。当初/暫定/補正は同じ予算の別断面で、
      // 会計間の繰入も重複するため、単一の合計値は意味を持たない（内訳だけを出す）。
      byAccountType: groupBy(items, (i) => ACCOUNT_LABEL[i.accountType]),
      byBudgetType: groupBy(items, (i) => i.budgetType),
      byMinistry: groupBy(items, (i) => i.ministry || i.agency),
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
  console.log(`事項 ${data.summary.count} 件`);
  for (const g of data.summary.byBudgetType) {
    console.log(`  ${g.key}: ${g.count} 件 / ${(g.amount / 1e12).toFixed(1)} 兆円`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
