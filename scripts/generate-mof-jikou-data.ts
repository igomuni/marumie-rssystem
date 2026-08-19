/**
 * 財務省 予算書・決算書「事項別内訳」スクレイピング＆JSON生成スクリプト
 *
 * 予算書 ZIP に同梱される CSV は科目別内訳（目レベル）のみで、事項名と説明文を含まない。
 * そのため予算書データベースの Web 帳票（XML）から事項を直接取得する。
 *
 * 使用法:
 *   tsx scripts/generate-mof-jikou-data.ts [FISCAL_YEAR...]
 *   例: tsx scripts/generate-mof-jikou-data.ts 2026
 *       tsx scripts/generate-mof-jikou-data.ts 2023 2024 2025 2026
 *   デフォルト: 2023 2024 2025 2026
 *
 * 出力: public/data/mof-jikou-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 * XMLキャッシュ: data/download/mof_{FISCAL_YEAR}/xml/
 *
 * 取り込む帳票（DOCUMENTS 参照）。年度により存在しないものは 404 でスキップする:
 *   当初予算 一般会計(11001) / 特別会計(12001) / 政府関係機関(13001)
 *   暫定予算 一般会計(31001) / 特別会計(32001) / 政府関係機関(33001)
 *   補正予算 一般会計(21001) / 特別会計(22001)
 *   決算     一般会計(77001)  ※特別会計(78001)・政府関係機関(76001)に事項別内訳は無い
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

/** 対象年度。引数が無ければ収録済みの全年度 */
const DEFAULT_YEARS = [2023, 2024, 2025, 2026];
const FISCAL_YEARS = (
  process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS
).sort((a, b) => a - b);
if (FISCAL_YEARS.some(y => isNaN(y) || y < 2000 || y > 2100)) {
  console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
  process.exit(1);
}

/** 年度ごとに変わる置き場をまとめたもの（年度をまたいで生成するため引き回す） */
interface YearContext {
  fiscalYear: number;
  base: string;
  cacheDir: string;
  outputFile: string;
}

function createContext(fiscalYear: number): YearContext {
  return {
    fiscalYear,
    base: `https://www.bb.mof.go.jp/server/${fiscalYear}`,
    cacheDir: path.join(process.cwd(), 'data', 'download', `mof_${fiscalYear}`, 'xml'),
    outputFile: path.join(process.cwd(), 'public', 'data', `mof-jikou-${fiscalYear}.json`),
  };
}

/**
 * 表のレイアウト。
 *
 * - standard: 「事項」が独立した見出し列を持つ（当初予算・暫定予算）。
 *   列位置は <header> から解決する（一般会計と特別会計で1列ずれるため）。
 * - revised: 補正予算。組織・項・事項が1列に畳まれ、金額欄が
 *   成立予算額／補正要求追加額／修正減少額／差引額／改予算額の5本になる。
 * - settlement: 決算。事項表のヘッダ行が <header> ではなく本文中にあり、
 *   ページごとに再出現する。金額は円単位で、予算額から不用額までの9本を持つ。
 */
type TableLayout = 'standard' | 'revised' | 'settlement';

interface DocumentSpec {
  /** 帳票IDの年度に続く部分（例: 11001） */
  suffix: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /**
   * 事項別内訳ページの title_for_list。帳票の判別に使う。
   * 決算は title_for_list が組織名になるため空にし、running_title で判別する。
   */
  listTitle: string;
  layout: TableLayout;
  /** 帳票の金額を円に直す倍率。予算書は千円単位、決算書は円単位 */
  unitScale: number;
  title: string;
}

const DOCUMENTS: DocumentSpec[] = [
  { suffix: '11001', accountType: 'general', budgetType: '当初予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', unitScale: 1000, title: '一般会計予算（当初予算）' },
  { suffix: '12001', accountType: 'special', budgetType: '当初予算', listTitle: '歳出 事項別内訳', layout: 'standard', unitScale: 1000, title: '特別会計予算（当初予算）' },
  { suffix: '13001', accountType: 'agency', budgetType: '当初予算', listTitle: '支出 事項別内訳', layout: 'standard', unitScale: 1000, title: '政府関係機関予算（当初予算）' },
  { suffix: '31001', accountType: 'general', budgetType: '暫定予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', unitScale: 1000, title: '一般会計予算（暫定予算）' },
  { suffix: '32001', accountType: 'special', budgetType: '暫定予算', listTitle: '歳出 事項別内訳', layout: 'standard', unitScale: 1000, title: '特別会計予算（暫定予算）' },
  { suffix: '33001', accountType: 'agency', budgetType: '暫定予算', listTitle: '支出 事項別内訳', layout: 'standard', unitScale: 1000, title: '政府関係機関予算（暫定予算）' },
  { suffix: '21001', accountType: 'general', budgetType: '補正予算（第1号）', listTitle: '〔組織別事項別内訳〕', layout: 'revised', unitScale: 1000, title: '一般会計予算（補正予算第1号）' },
  { suffix: '22001', accountType: 'special', budgetType: '補正予算（第1号）', listTitle: '歳出 事項別内訳', layout: 'revised', unitScale: 1000, title: '特別会計予算（補正予算特第1号）' },
  { suffix: '77001', accountType: 'general', budgetType: '決算', listTitle: '', layout: 'settlement', unitScale: 1, title: '一般会計 歳出決算報告書' },
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

/**
 * 連続取得の間隔。1年度あたり250ページ超を取りに行くので、
 * 間を空けないと配信側に一時的に弾かれる（実測で 404 が返るようになった）。
 * キャッシュが効いている場合は待たない。
 */
const FETCH_INTERVAL_MS = 300;
let lastFetchAt = 0;

async function throttle(): Promise<void> {
  const wait = lastFetchAt + FETCH_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastFetchAt = Date.now();
}

/** HTTP エラー。ステータスで「帳票が無い(404)」と障害を区別するために持つ */
class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

/** 指定エンコーディングでテキストを取得する（XMLはキャッシュする） */
async function fetchText(
  ctx: YearContext,
  url: string,
  encoding: string,
  cacheName?: string
): Promise<string> {
  if (cacheName) {
    const cached = path.join(ctx.cacheDir, cacheName);
    if (fs.existsSync(cached)) {
      return new TextDecoder(encoding).decode(fs.readFileSync(cached));
    }
  }
  await throttle();
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (cacheName) {
    fs.mkdirSync(ctx.cacheDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.cacheDir, cacheName), buf);
  }
  return new TextDecoder(encoding).decode(buf);
}

/**
 * 目次 HTML（EUC-JP）から XML ファイル名を抽出する。
 * 目次は LineOut(階層, 子有無, 表題, リンク, 頁) を並べた JavaScript。
 * ここでは絞り込まず全リンクを返し、帳票の判別は XML の中身で行う
 * （一般会計では事項別内訳ページの目次表題が組織名になっており、表題では絞れない）。
 */
function extractXmlNames(menuHtml: string): string[] {
  const names = new Set<string>();
  const re = /LineOut\(\d+,\d+,"(?:.*?)","(.*?)","(?:.*?)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(menuHtml)) !== null) {
    const link = m[1].split('#')[0];
    // リンクはリモートの HTML 由来。そのままキャッシュのファイル名にすると
    // "../../outside.xml" のような値で cacheDir の外を読み書きできてしまうため、
    // ディレクトリ要素を含まない予算書のファイル名だけを通す。
    if (/^\d{9}[0-9a-z]*\.xml$/.test(link)) names.add(link);
  }
  return [...names];
}

/**
 * 表の1行。同じ列に複数のセルが現れうるため配列で持つ。
 * sub は clm の id 末尾の列内連番で、補正予算では階層（項=1 / 事項=2）を表す。
 */
interface Cell {
  sub: number;
  text: string;
}

interface ParsedRow {
  page: number;
  row: number;
  cols: Map<number, Cell[]>;
}

/** CDATA を連結してセルのテキストを得る（原文の折り返しごとに l 要素が分かれる） */
function cellText(body: string): string {
  return [...body.matchAll(/CDATA\[([\s\S]*?)\]\]/g)].map(m => m[1]).join('');
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
    const cell: Cell = { sub: parseInt(m[5], 10), text: cellText(m[6]) };
    const values = entry.cols.get(col);
    if (values) values.push(cell);
    else entry.cols.set(col, [cell]);
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
  return (row.cols.get(col) ?? []).map(c => c.text).join('').trim();
}

/** そのセルの列内連番。補正予算では階層（項=1 / 事項=2）を表す */
function subAt(row: ParsedRow, col: number): number | null {
  return (row.cols.get(col) ?? [])[0]?.sub ?? null;
}

/**
 * 金額として読む（先頭の候補のみ。連結すると桁が壊れる）。
 * scale は帳票の単位を円に直す倍率（予算書は千円単位なので 1000、決算書は 1）。
 */
function numberAt(row: ParsedRow, col: number | undefined, scale: number): number | null {
  if (col === undefined) return null;
  const first = (row.cols.get(col) ?? [])[0]?.text.trim() ?? '';
  const negative = first.includes('△');
  const digits = first.replace(/[△\s,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10) * scale;
  return negative ? -value : value;
}

/** running_title「内閣府所管  内閣本府」を階層に分解する */
function splitRunningTitle(xml: string): string[] {
  const m = xml.match(/<running_title>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/[ \t　]{2,}|　/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** title_for_list を取り出す（帳票の判別に使う） */
function listTitle(xml: string): string {
  const m = xml.match(/<title_for_list>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : '';
}

interface Scope {
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
}

/** running_title から所管・組織・特会・勘定・機関を割り当てる */
function resolveScope(spec: DocumentSpec, parts: string[]): Scope {
  // running_title は「内閣府所管  内閣本府」の形。末尾の「所管」を落とすと
  // CSV（DL...b.csv）の 所管 列と同じ表記になり、科目データと突き合わせやすい。
  // 決算は「内閣府所管  歳出決算報告書  内閣本府」と帳票名が挟まる。
  const cleaned = parts.filter(p => p !== '歳出決算報告書');
  const first = (cleaned[0] ?? '').replace(/所管$/, '');
  const second = cleaned[1] ?? '';
  const third = cleaned[2] ?? '';
  if (spec.accountType === 'general') {
    // 皇室費のように組織が印字されない帳票は、所管をそのまま組織名とする（CSV も同じ扱い）
    return { ministry: first, organization: second || first, specialAccount: '', subAccount: '', agency: '' };
  }
  if (spec.accountType === 'special') {
    return { ministry: first, organization: '', specialAccount: second, subAccount: third, agency: '' };
  }
  // 政府関係機関は running_title が「沖縄振興開発金融公庫」または「機関名  業務名」
  return { ministry: '', organization: '', specialAccount: '', subAccount: second, agency: cleaned[0] ?? '' };
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

/** 実績側のフィールドを持たない（予算の帳票用）空の値 */
const NO_EXECUTION = {
  currentAmount: null,
  spent: null,
  carriedOver: null,
  unused: null,
} as const;

/** 1件分の共通フィールドを組み立てる */
function baseItem(
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  row: ParsedRow,
  fileName: string
) {
  return {
    id: `${spec.accountType}-${ctx.fiscalYear}${spec.suffix}-${row.page}-${row.row}`,
    accountType: spec.accountType,
    budgetType: spec.budgetType,
    documentId: `${ctx.fiscalYear}${spec.suffix}`,
    ...scope,
    page: row.page,
    sourceUrl: `${ctx.base}/xml/${fileName}`,
  };
}

/** standard レイアウト（当初予算・暫定予算）の1ページを抽出する */
function extractStandard(
  rows: ParsedRow[],
  headerCols: Map<string, number>,
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const jikouHeaderCol = headerCols.get('事項');
  if (jikouHeaderCol === undefined) return [];
  // 一般会計・特別会計は「事項」見出しが主要経費コード列にかかっており、事項名は1つ右。
  // 政府関係機関には主要経費の列が無く、事項名が見出しの列にそのまま入る。
  // 見出し列に2桁コードが並んでいるかで判別する。
  const hasMajorExpense = rows.some(r => /^\d{2}$/.test(textAt(r, jikouHeaderCol)));
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
    const amount = numberAt(row, colAmount, spec.unitScale);
    if (!name || amount === null) continue;

    const majorExpenseCode = textAt(row, colMajorExpense);
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      previousAmount: numberAt(row, colPrev, spec.unitScale),
      difference: numberAt(row, colDiff, spec.unitScale),
      description: textAt(row, colDescription),
      ...NO_EXECUTION,
    });
  }
  return items;
}

/**
 * revised レイアウト（補正予算）の1ページを抽出する。
 *
 * 組織・項・事項が1列に畳まれており、階層は clm の id 末尾の列内連番で表される。
 * 名前列（col 2）の連番が 1 なら項、2 なら事項。一般会計では組織が col 1 だけの行になる。
 * コードの桁数では判別できない（特別会計は項コードも主要経費コードも2桁）。
 *
 * 金額の列位置は帳票により異なる（一般会計は 3〜7、特別会計は 3・4・6・7・9）ため、
 * 見出し行の文字列から解決する。当初予算と揃えるため
 * amount=改予算額、previousAmount=補正前の成立予算額、difference=差引額 とする。
 */
function extractRevised(
  rows: ParsedRow[],
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  // 見出し行（col 1 に「事項」を含む行）から金額列を解決する
  const header = rows.find(r => textAt(r, 1).includes('事項'));
  if (!header) return [];
  const label = (col: number) => textAt(header, col);
  const findCol = (match: (s: string) => boolean) =>
    [...header.cols.keys()].sort((a, b) => a - b).find(c => match(label(c)));
  const colSettled = findCol(s => s.includes('成立予算額'));
  const colDiff = findCol(s => s.includes('差引額'));
  const colRevised = findCol(s => s.includes('改令和'));
  const colDescription = findCol(s => s === '説明');
  if (colRevised === undefined) return [];

  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    if (row === header) continue;
    const name = textAt(row, 2);
    if (!name) continue; // 組織だけの行
    const level = subAt(row, 2);
    const code = textAt(row, 1);
    if (level === 1) {
      currentSectionCode = code;
      currentSectionName = name;
      continue;
    }
    if (level !== 2) continue;

    const amount = numberAt(row, colRevised, spec.unitScale);
    if (amount === null) continue;
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode: code,
      majorExpenseName: MAJOR_EXPENSE[code] ?? '',
      name,
      amount,
      previousAmount: numberAt(row, colSettled, spec.unitScale),
      difference: numberAt(row, colDiff, spec.unitScale),
      description: textAt(row, colDescription),
      ...NO_EXECUTION,
    });
  }
  return items;
}

/**
 * settlement レイアウト（決算）の1ページを抽出する。
 *
 * 決算では事項表のヘッダ行が <header> に入っていない。<header> にあるのは組織単位の
 * 総括表の見出しだけで、事項表の見出しは本文の行として現れ、しかもページごとに
 * 再出現する。そのため本文を走査してヘッダ行を見つけるたびに列位置を取り直す。
 * これをやらないと総括表や小計の行まで拾って総額が2倍以上に膨れる。
 */
function extractSettlement(
  rows: ParsedRow[],
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let cols: Map<string, number> | null = null;
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    // ヘッダ行の判定: 「事項」と「支出済歳出額(円)」の両方を持つ行
    const labels = new Map<string, number>();
    for (const col of row.cols.keys()) {
      const label = textAt(row, col);
      if (label && !labels.has(label)) labels.set(label, col);
    }
    if (labels.has('事項') && labels.has('支出済歳出額(円)')) {
      cols = labels;
      currentSectionCode = '';
      currentSectionName = '';
      continue;
    }
    if (!cols) continue;

    const jikouCol = cols.get('事項')!;
    const code = textAt(row, jikouCol - 2);
    const section = textAt(row, jikouCol - 1);
    if (/^\d+$/.test(code) && section) {
      currentSectionCode = code;
      currentSectionName = section;
    }

    const name = textAt(row, jikouCol + 1);
    // 事項名が空・数字のみの行は小計や見出しなので捨てる
    if (!name || /^[\d,]+$/.test(name)) continue;
    const amount = numberAt(row, cols.get('歳出予算額(円)'), spec.unitScale);
    if (amount === null) continue;

    const majorExpenseCode = textAt(row, jikouCol);
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      // 決算に前年度比の欄は無い
      previousAmount: null,
      difference: null,
      // 決算の説明欄は組織単位の備考しかなく、事項には付かない
      description: '',
      currentAmount: numberAt(row, cols.get('歳出予算現額(円)'), spec.unitScale),
      spent: numberAt(row, cols.get('支出済歳出額(円)'), spec.unitScale),
      carriedOver: numberAt(row, cols.get('翌年度繰越額(円)'), spec.unitScale),
      unused: numberAt(row, cols.get('差引額(円)'), spec.unitScale),
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

/** そのページが対象の帳票かを判定する */
function matchesDocument(spec: DocumentSpec, xml: string): boolean {
  if (spec.layout === 'settlement') {
    // 決算は title_for_list が組織名になるため running_title で判別する
    return splitRunningTitle(xml).includes('歳出決算報告書');
  }
  return listTitle(xml) === spec.listTitle;
}

async function collect(
  ctx: YearContext,
  spec: DocumentSpec
): Promise<{ items: MOFJikouItem[]; pages: number }> {
  const documentId = `${ctx.fiscalYear}${spec.suffix}`;
  const menu = await fetchText(
    ctx,
    `${ctx.base}/html/${documentId}menu.html`,
    'euc-jp',
    `${documentId}menu.html`
  );
  const names = extractXmlNames(menu);

  const items: MOFJikouItem[] = [];
  let pages = 0;
  for (const name of names) {
    const xml = await fetchText(ctx, `${ctx.base}/xml/${name}`, 'shift_jis', name);
    if (!matchesDocument(spec, xml)) continue;
    pages += 1;
    const { rows, headerCols } = parseTable(xml);
    const scope = resolveScope(spec, splitRunningTitle(xml));
    const raw =
      spec.layout === 'revised'
        ? extractRevised(rows, spec, ctx, scope, name)
        : spec.layout === 'settlement'
          ? extractSettlement(rows, spec, ctx, scope, name)
          : extractStandard(rows, headerCols, spec, ctx, scope, name);
    items.push(...raw.map(i => ({ ...i, key: buildKey(i) })));
  }
  console.log(
    `  [${documentId}] ${spec.title}: ${pages} ページ / 事項 ${items.length} 件 ` +
      `/ ${(items.reduce((s, i) => s + i.amount, 0) / 1e12).toFixed(1)} 兆円`
  );
  return { items, pages };
}

async function generateYear(fiscalYear: number): Promise<boolean> {
  const ctx = createContext(fiscalYear);
  const eraYear = fiscalYear - 2018; // 2019年 = 令和元年
  console.log(`\n=== 令和${eraYear}年度（${fiscalYear}） ===`);

  const items: MOFJikouItem[] = [];
  const documents: MOFJikouData['metadata']['documents'] = [];

  for (const spec of DOCUMENTS) {
    const documentId = `${fiscalYear}${spec.suffix}`;
    try {
      const { items: docItems, pages } = await collect(ctx, spec);
      items.push(...docItems);
      documents.push({
        documentId,
        accountType: spec.accountType,
        budgetType: spec.budgetType,
        title: spec.title,
        url: `${ctx.base}/html/${documentId}Main.html`,
        pages,
        count: docItems.length,
      });
    } catch (error) {
      // 年度によっては暫定予算・補正予算・決算が存在しない。その 404 だけを欠番として飛ばし、
      // 通信障害・サーバエラー・パーサの退行は握り潰さずに失敗させる
      // （部分的な JSON が正常終了で出力されるのを防ぐ）。
      if (error instanceof HttpError && error.status === 404) {
        console.log(`  [${documentId}] 帳票なし（404）`);
        continue;
      }
      throw error;
    }
  }

  if (items.length === 0) {
    console.warn(`  ⚠️  ${fiscalYear}年度は事項が1件も取得できませんでした。スキップします。`);
    return false;
  }

  const duplicates = items.length - new Set(items.map(i => i.key)).size;
  if (duplicates > 0) console.warn(`  ⚠️  合成キーの重複が ${duplicates} 件あります`);

  const data: MOFJikouData = {
    metadata: {
      fiscalYear,
      eraLabel: `令和${eraYear}年度`,
      budgetTypes: [...new Set(documents.filter(d => d.count > 0).map(d => d.budgetType))],
      documents,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位、決算書は円単位。生成時に円へ揃えています）',
        '事項は「項の下に置かれた経費のまとまり」で、行政事業レビューの事業とは1対1に対応しません（1事項あたり平均4事業）',
        '当初予算・暫定予算・補正予算・決算は別々の帳票です。予算種別をまたいで合算しないでください',
        '一般会計・特別会計・政府関係機関の金額を単純合算すると会計間の繰入が二重計上されます',
        '補正予算の金額は amount=改予算額 / previousAmount=補正前の成立予算額 / difference=差引額 です',
        '決算の amount は歳出予算額です。現額・支出済・翌年度繰越・不用額は別フィールドに入ります',
        '決算の事項別内訳は一般会計にしかありません（特別会計・政府関係機関の決算は科目レベルまで）',
        '暫定予算には比較欄が無いため previousAmount と difference は null です',
        '出典は財務省 予算書・決算書データベースの Web 帳票です（ZIP同梱のCSVには事項名・説明文が含まれないため）',
      ],
    },
    summary: {
      count: items.length,
      byAccountType: groupBy(items, i => ACCOUNT_LABEL[i.accountType]),
      byBudgetType: groupBy(items, i => i.budgetType),
      byMinistry: groupBy(items, i => i.ministry || i.agency),
      byMajorExpense: groupBy(items, i => i.majorExpenseName || `(未定義:${i.majorExpenseCode})`),
    },
    items,
  };

  fs.mkdirSync(path.dirname(ctx.outputFile), { recursive: true });
  fs.writeFileSync(ctx.outputFile, JSON.stringify(data), 'utf-8');
  const sizeKB = (fs.statSync(ctx.outputFile).size / 1024).toFixed(0);
  console.log(`  出力: ${path.basename(ctx.outputFile)} (${sizeKB} KB) / 事項 ${items.length} 件`);
  for (const g of data.summary.byBudgetType) {
    console.log(`    ${g.key}: ${g.count} 件 / ${(g.amount / 1e12).toFixed(1)} 兆円`);
  }
  return true;
}

async function main() {
  console.log(`=== MOF 事項別内訳データ生成（対象: ${FISCAL_YEARS.join(', ')}） ===`);
  let generated = 0;
  for (const year of FISCAL_YEARS) {
    if (await generateYear(year)) generated += 1;
  }
  if (generated === 0) {
    console.error('\n事項を1件も取得できませんでした。年度または帳票構造を確認してください。');
    process.exit(1);
  }
  console.log(`\n完了: ${generated} 年度分を生成しました。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
