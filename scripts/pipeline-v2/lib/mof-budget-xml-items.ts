/**
 * MOF 予算書【XML版】の事項 parser v0（FY2024 一般会計 当初予算 202411001 専用）。
 * 規則は docs/tasks/20261004_2104_MOF_PipelineV2_FY2024一般会計XML事項Parser_v0_Preregistration.md（凍結済み）のとおり。
 * 入力は raw XML の bytes と明示的な context だけ。V1 の出力・PDF・reference projection・source-set artifact を読まない。
 * scope 外を一般化して処理しない。想定外の構造は例外（MofXmlParseError）にし、silent skip しない。
 *
 * この module は research の reference 生成 script とは独立に実装している（tokenizer も別実装）。
 */
import * as crypto from 'crypto';

export const MOF_ITEM_PARSER_V0_DOCUMENT_ID = '202411001';
export const MOF_ITEM_TABLE_TITLE = '〔組織別事項別内訳〕';
const EXPECTED_DOCTYPE = 'DOCTYPE budget SYSTEM "../dtd/202401.dtd"';
/** 事項表の header（空白除去後）。main = 行番号の第2成分が 1 の見出し、sub = 2 の下位見出し。キーは列開始番号 */
const HEADER_MAIN: Record<string, string> = { '1': '組織', '2': '項', '4': '事項', '6': '令和6年度', '8': '前年度', '10': '比較増△減額(千円)', '11': '説明' };
const HEADER_SUB: Record<string, string> = { '6': '要求額', '7': '(千円)', '8': '予算額', '9': '(千円)' };
const KNOWN_GAIJI = new Set(['1508:填']);
const ROW_CLASSES: Record<string, string> = {
  'org+item+request': '1.1,10.1,11.1,2.1,3.1,4.1,5.1,6.1,8.1',
  'item+request': '10.1,11.1,2.1,3.1,4.1,5.1,6.1,8.1',
  'request': '10.1,11.1,4.1,5.1,6.1,8.1',
  'subtotal': '10.1,4.2,6.1,8.1',
  'description-only': '11.1',
};
const AMOUNT_GRAMMAR = /^(0|(△ )?[1-9]\d{0,2}(,\d{3})*)$/;
const CELL_ID = /^p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)$/;

export type MofXmlFailureCode =
  | 'decode' | 'malformed' | 'input_contract' | 'table_structure' | 'unknown_row' | 'orphan' | 'item_code' | 'col4' | 'amount' | 'organization' | 'cell_content' | 'order';

export class MofXmlParseError extends Error {
  constructor(readonly code: MofXmlFailureCode, readonly file: string, message: string) {
    super(`${file}: [${code}] ${message}`);
    this.name = 'MofXmlParseError';
  }
}

// ---------------------------------------------------------------- 最小の XML 読み取り（この帳票が使う範囲）
interface El { name: string; attrs: Record<string, string>; kids: (El | Tx)[] }
interface Tx { text: string; cdata: boolean }
const isEl = (n: El | Tx): n is El => (n as El).name !== undefined;

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?([\s\S]*?)\?>|<!DOCTYPE([^>]*)>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;
const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m));

interface Doc { encoding: string | null; doctype: string | null; root: El }
function readXml(src: string, file: string): Doc {
  TOKEN.lastIndex = 0;
  let encoding: string | null = null;
  let doctype: string | null = null;
  let root: El | null = null;
  const stack: El[] = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new MofXmlParseError('malformed', file, `解釈できない箇所 offset=${pos}`);
    pos = TOKEN.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { if (!top) throw new MofXmlParseError('malformed', file, 'root 外の CDATA'); top.kids.push({ text: m[1], cdata: true }); }
    else if (m[2] !== undefined) { const enc = /^xml\s[^]*?encoding\s*=\s*"([^"]*)"/.exec(m[2]); if (enc) encoding = enc[1]; }
    else if (m[3] !== undefined) doctype = `DOCTYPE ${m[3].trim()}`;
    else if (m[4] !== undefined) { const e = stack.pop(); if (!e || e.name !== m[4]) throw new MofXmlParseError('malformed', file, `終了 tag の不一致 </${m[4]}>`); }
    else if (m[5] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of m[6].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
      const el: El = { name: m[5], attrs, kids: [] };
      if (top) top.kids.push(el); else if (root) throw new MofXmlParseError('malformed', file, 'root が複数'); else root = el;
      if (m[7] !== '/') stack.push(el);
    } else if (m[8] !== undefined && /\S/.test(m[8])) {
      if (!top) throw new MofXmlParseError('malformed', file, 'root 外に文字'); top.kids.push({ text: unescapeXml(m[8]), cdata: false });
    }
  }
  if (stack.length > 0 || !root) throw new MofXmlParseError('malformed', file, '未閉の要素または root なし');
  return { encoding, doctype, root };
}

const children = (e: El, name: string) => e.kids.filter(isEl).filter(k => k.name === name);

// ---------------------------------------------------------------- 名称（セル）の復元
export interface GaijiRef { code: string; text: string }
export interface CellValue { lines: string[]; text: string; qtCount: number; gaiji: GaijiRef[] }

function readCell(clm: El, file: string): CellValue {
  const ps = clm.kids.filter(k => isEl(k) || (k as Tx).text.trim() !== '');
  if (ps.length !== 1 || !isEl(ps[0]) || ps[0].name !== 'p') throw new MofXmlParseError('cell_content', file, `clm の子が単一の <p> でない (${clm.attrs.id})`);
  let qtCount = 0;
  const gaiji: GaijiRef[] = [];
  const lines: string[] = [];
  for (const l of ps[0].kids) {
    if (!isEl(l)) { if (l.text.trim() !== '') throw new MofXmlParseError('cell_content', file, '<p> 直下に文字'); continue; }
    if (l.name !== 'l') throw new MofXmlParseError('cell_content', file, `<p> に想定外の子 <${l.name}>`);
    let line = '';
    for (const c of l.kids) {
      if (!isEl(c)) { if (c.cdata) line += c.text; else if (c.text.trim() !== '') throw new MofXmlParseError('cell_content', file, `<l> に CDATA 以外の文字 ${JSON.stringify(c.text)}`); continue; }
      if (c.name === 'qt') { if (c.kids.length > 0 || Object.keys(c.attrs).length > 0) throw new MofXmlParseError('cell_content', file, 'qt が空要素でない'); qtCount++; continue; }
      if (c.name === 'gaiji') {
        if (c.kids.some(isEl) || Object.keys(c.attrs).join() !== 'code') throw new MofXmlParseError('cell_content', file, 'gaiji の形が想定外');
        const text = c.kids.filter((k): k is Tx => !isEl(k)).filter(k => k.cdata || k.text.trim() !== '').map(k => k.text).join('');
        if (!KNOWN_GAIJI.has(`${c.attrs.code}:${text}`)) throw new MofXmlParseError('cell_content', file, `未知の gaiji code=${c.attrs.code} text='${text}'`);
        gaiji.push({ code: c.attrs.code, text });
        line += text;
        continue;
      }
      throw new MofXmlParseError('cell_content', file, `<l> に想定外の子要素 <${c.name}>`);
    }
    lines.push(line);
  }
  return { lines, text: lines.join(''), qtCount, gaiji };
}

const deepText = (e: El): string => e.kids.map(k => (isEl(k) ? deepText(k) : k.text)).join('');

// ---------------------------------------------------------------- 出力の型
export interface MofXmlItemRecord {
  file: string;
  /** 行キー `p{頁}-{行}.{n}` */
  row: string;
  page: number;
  rowNo: number;
  organization: string;
  itemCode: string;
  itemName: string;
  itemNameLines: string[];
  itemQtCount: number;
  itemGaiji: GaijiRef[];
  itemStartsInThisRow: boolean;
  requestName: string;
  requestNameLines: string[];
  requestQtCount: number;
  requestGaiji: GaijiRef[];
  /** 列 4 の raw 2 桁文字列。意味は XML に明示がなく、付けない */
  col4Raw: string;
  /** header「令和6年度 要求額(千円)」「前年度 予算額(千円)」「比較増△減額(千円)」の列（col6・col8・col10）の raw */
  amountsRaw: { col6: string; col8: string; col10: string };
  /** 千円のままの整数。blank→0・差額計算・符号補完はしない */
  amountsThousandYen: { col6: number; col8: number; col10: number };
}

export type ParseOutcome =
  | { status: 'not_target'; file: string; titleForList: string }
  | { status: 'unsupported'; file: string; reason: 'document_id' | 'not_in_source_set' | 'source_hash_mismatch' }
  | { status: 'recognized'; file: string; sourceSha256: string; organization: string; records: MofXmlItemRecord[]; counts: { itemStartRows: number; requestRows: number; subtotalRows: number; descriptionOnlyRows: number } };

export interface ParseInput {
  filename: string;
  bytes: Uint8Array;
  documentId: string;
  /** 目次（menu）での祖先 chain（組織の整合 check 用）。対象ファイルで必須 */
  menuChain: string[] | undefined;
  /** frozen source set（filename → SHA-256）。無い・不一致のファイルは unsupported */
  sourceSet: ReadonlyMap<string, string>;
}

/** menu（EUC-JP を decode 済みの文字列）から、XML ファイルごとの最初の出現位置の祖先 chain（見出し＝その階層の title の列）を作る */
export function readMenuAncestorChains(menuText: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const chain: string[] = [];
  for (const m of menuText.matchAll(/LineOut\((\d+),(\d+),"([^"]*)","([^"]*)","[^"]*"\)/g)) {
    const level = Number(m[1]);
    chain.length = level - 1;
    chain[level - 1] = m[3];
    const f = m[4].replace(/#.*/, '');
    if (/\.xml$/.test(f) && !out.has(f)) out.set(f, [...chain]);
  }
  return out;
}

/** 1 ファイルを解釈する。対象外・scope 外は明示的な結果を返し、対象で構造が想定外なら MofXmlParseError を投げる */
export function parseMofBudgetXmlItemFile(input: ParseInput): ParseOutcome {
  const file = input.filename;
  if (input.documentId !== MOF_ITEM_PARSER_V0_DOCUMENT_ID) return { status: 'unsupported', file, reason: 'document_id' };
  const sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const known = input.sourceSet.get(file);
  if (known === undefined) return { status: 'unsupported', file, reason: 'not_in_source_set' };
  if (known !== sha) return { status: 'unsupported', file, reason: 'source_hash_mismatch' };

  let text: string;
  try { text = new TextDecoder('shift_jis', { fatal: true }).decode(input.bytes); } catch { throw new MofXmlParseError('decode', file, 'Shift_JIS として decode できない'); }
  const doc = readXml(text, file);
  if (doc.root.name !== 'budget') throw new MofXmlParseError('input_contract', file, `root が budget でない: ${doc.root.name}`);
  if (doc.encoding !== 'Shift_JIS') throw new MofXmlParseError('input_contract', file, `encoding 宣言が Shift_JIS でない: ${doc.encoding}`);
  if (doc.doctype !== EXPECTED_DOCTYPE) throw new MofXmlParseError('input_contract', file, `DOCTYPE 不一致: ${doc.doctype}`);

  const titles = children(doc.root, 'title_for_list');
  if (titles.length !== 1) throw new MofXmlParseError('input_contract', file, 'title_for_list が 1 つでない');
  const title = titles[0].kids.filter((k): k is Tx => !isEl(k) && k.cdata).map(k => k.text).join('');
  if (title !== MOF_ITEM_TABLE_TITLE) return { status: 'not_target', file, titleForList: title };

  // ---- 対象ファイル（事項表） ----
  const runningTitles = children(doc.root, 'running_title');
  if (runningTitles.length !== 1) throw new MofXmlParseError('input_contract', file, 'running_title が 1 つでない');
  const runningTitle = runningTitles[0].kids.filter((k): k is Tx => !isEl(k) && k.cdata).map(k => k.text).join('');
  const tables = children(doc.root, 'body').flatMap(b => children(b, 'table'));
  if (tables.length !== 1) throw new MofXmlParseError('table_structure', file, `table が 1 つでない: ${tables.length}`);
  const table = tables[0];

  // header: 行番号の第2成分 1 = 見出し、2 = 下位見出し。列開始番号と文字列が事前登録と完全一致
  const headers = children(table, 'header');
  if (headers.length !== 1) throw new MofXmlParseError('table_structure', file, 'header が 1 つでない');
  const main: Record<string, string> = {};
  const sub: Record<string, string> = {};
  for (const c of children(headers[0], 'clm')) {
    const m = CELL_ID.exec(c.attrs.id ?? '');
    if (!m) throw new MofXmlParseError('table_structure', file, `header の id 形式外: ${c.attrs.id}`);
    const t = readCell(c, file).text.replace(/\s+/g, '');
    if (m[3] === '1') main[m[4]] = t; else if (m[3] === '2') sub[m[4]] = t; else throw new MofXmlParseError('table_structure', file, `header の行番号が想定外: ${c.attrs.id}`);
  }
  if (JSON.stringify(sortKeys(main)) !== JSON.stringify(sortKeys(HEADER_MAIN)) || JSON.stringify(sortKeys(sub)) !== JSON.stringify(sortKeys(HEADER_SUB))) {
    throw new MofXmlParseError('table_structure', file, `header が事前登録と一致しない: main=${JSON.stringify(main)} sub=${JSON.stringify(sub)}`);
  }

  // data: 行キーでまとめる（文書順）
  interface Row { key: string; page: number; rowNo: number; cells: Map<string, El> }
  const rows: Row[] = [];
  const byKey = new Map<string, Row>();
  for (const d of children(table, 'data')) for (const c of children(d, 'clm')) {
    const m = CELL_ID.exec(c.attrs.id ?? '');
    if (!m) throw new MofXmlParseError('table_structure', file, `clm id 形式外: ${c.attrs.id}`);
    const key = `p${m[1]}-${m[2]}.${m[3]}`;
    let r = byKey.get(key);
    if (!r) { r = { key, page: Number(m[1]), rowNo: Number(m[2]), cells: new Map() }; byKey.set(key, r); rows.push(r); }
    const col = `${m[4]}.${m[5]}`;
    if (r.cells.has(col)) throw new MofXmlParseError('table_structure', file, `同一行・同一列に複数セル ${key} ${col}`);
    r.cells.set(col, c);
  }
  rows.forEach((r, i) => { if (i > 0 && !(r.page > rows[i - 1].page || (r.page === rows[i - 1].page && r.rowNo > rows[i - 1].rowNo))) throw new MofXmlParseError('order', file, '文書順が (頁,行) の昇順でない'); });

  const records: MofXmlItemRecord[] = [];
  const counts = { itemStartRows: 0, requestRows: 0, subtotalRows: 0, descriptionOnlyRows: 0 };
  const seenCodes = new Set<string>();
  let organization: string | null = null;
  let current: { code: string; name: CellValue } | null = null;

  rows.forEach((r, idx) => {
    const colSet = [...r.cells.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',');
    const cls = Object.entries(ROW_CLASSES).find(([, set]) => set === colSet)?.[0];
    if (!cls) throw new MofXmlParseError('unknown_row', file, `未知の行 ${r.key}: ${colSet}`);
    // 列 11（説明）は解釈しない。非空であることだけ確認する。列 1〜10 は単一 <p> の厳密な形
    const cell = (col: string): CellValue => readCell(r.cells.get(col)!, file);
    for (const [col, el] of r.cells) {
      const empty = col.startsWith('11.') ? deepText(el).trim() === '' : readCell(el, file).text === '';
      if (empty) throw new MofXmlParseError('cell_content', file, `空セルを持つ行 ${r.key} 列${col}`);
    }
    if (cls === 'subtotal') { counts.subtotalRows++; return; }
    if (cls === 'description-only') { counts.descriptionOnlyRows++; return; }

    if (idx === 0 && cls !== 'org+item+request') throw new MofXmlParseError('unknown_row', file, `先頭行が組織＋項＋事項行でない ${r.key}`);
    if (cls === 'org+item+request') {
      if (idx !== 0) throw new MofXmlParseError('unknown_row', file, `組織セルが先頭行以外 ${r.key}`);
      organization = cell('1.1').text;
    }
    const startsItem = cls !== 'request';
    if (startsItem) {
      const code = cell('2.1').text;
      if (!/^\d{3}$/.test(code)) throw new MofXmlParseError('item_code', file, `項コードが 3 桁数字でない ${r.key}: ${code}`);
      if (seenCodes.has(code)) throw new MofXmlParseError('item_code', file, `項コードがファイル内で重複 ${code}`);
      seenCodes.add(code);
      current = { code, name: cell('3.1') };
      counts.itemStartRows++;
    }
    if (!current) throw new MofXmlParseError('orphan', file, `事項行に項が無い ${r.key}`);
    if (organization === null) throw new MofXmlParseError('organization', file, '組織が未定義');
    const col4 = cell('4.1').text;
    if (!/^\d{2}$/.test(col4)) throw new MofXmlParseError('col4', file, `col4 が 2 桁数字でない ${r.key}: ${col4}`);
    const request = cell('5.1');
    const raw = { col6: cell('6.1').text, col8: cell('8.1').text, col10: cell('10.1').text };
    const parsed = { col6: amount(raw.col6, '6', file), col8: amount(raw.col8, '8', file), col10: amount(raw.col10, '10', file) };
    counts.requestRows++;
    records.push({
      file, row: r.key, page: r.page, rowNo: r.rowNo, organization,
      itemCode: current.code, itemName: current.name.text, itemNameLines: current.name.lines, itemQtCount: current.name.qtCount, itemGaiji: current.name.gaiji, itemStartsInThisRow: startsItem,
      requestName: request.text, requestNameLines: request.lines, requestQtCount: request.qtCount, requestGaiji: request.gaiji,
      col4Raw: col4, amountsRaw: raw, amountsThousandYen: parsed,
    });
  });
  if (organization === null) throw new MofXmlParseError('organization', file, '組織が得られない（データ行なし）');

  // 組織の整合: primary（先頭行の列 1）と secondary（running_title の組織部分・目次の祖先 chain の要素）。不一致は失敗
  const m = /^(.+?所管) {2}(.+)$/.exec(runningTitle);
  const rtOrg = m ? m[2] : runningTitle;
  if (organization !== rtOrg) throw new MofXmlParseError('organization', file, `組織の不一致 col1='${organization}' running_title='${runningTitle}'`);
  if (!input.menuChain) throw new MofXmlParseError('organization', file, '目次の祖先 chain が無い');
  if (!input.menuChain.includes(organization)) throw new MofXmlParseError('organization', file, `目次の祖先に組織が無い: ${input.menuChain.join(' > ')}`);

  return { status: 'recognized', file, sourceSha256: sha, organization, records, counts };
}

function sortKeys(o: Record<string, string>) { return Object.entries(o).sort(([a], [b]) => Number(a) - Number(b)); }

function amount(raw: string, col: string, file: string): number {
  if (!AMOUNT_GRAMMAR.test(raw)) throw new MofXmlParseError('amount', file, `金額が文法外 col${col}: ${JSON.stringify(raw)}`);
  const negative = raw.startsWith('△');
  if (negative && col !== '10') throw new MofXmlParseError('amount', file, `△ は col10 のみ許可 col${col}: ${raw}`);
  const n = Number(raw.replace(/[△ ,]/g, ''));
  return negative ? -n : n;
}
