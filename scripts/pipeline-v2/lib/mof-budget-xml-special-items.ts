/**
 * MOF 予算書【XML版】特別会計 歳出事項別内訳 の事項 parser。
 * 文法は docs/tasks/20261015_1800_MOF_Special_Account_Row_Grammar_Contract.md（事前登録済み）のとおり。
 * 読み取りの部品（XML tokenizer・セル読み）は一般会計用の mof-budget-xml-items-general.ts のものを使う。説明欄（11.1）は読まない（入れ子の表は無視）。
 * 想定外の構造は MofXmlParseError にし、silent skip しない。
 */
import * as crypto from 'crypto';
import { children, deepText, isEl, MofXmlParseError, readCell, readXml, CELL_ID, type El, type Tx } from './mof-budget-xml-items-general';

export const MOF_SPECIAL_TABLE_TITLE = '歳出事項別内訳';
export interface MofSpecialParserSpec { documentId: string; doctype: string; yearLabel: string }
const AMOUNT_GRAMMAR = /^(0|(△ )?[1-9]\d{0,2}(,\d{3})*)$/;
const CHAIN_MARKER = '甲号歳入歳出予定計算書';
const CHAIN_LAST = '歳出 事項別内訳';

/** header の列開始番号→文字列（空白除去後）。キーは `行.列開始` */
const HEADER_BASE = { '1.3': '事項', '1.5': '', '1.7': '前年度予算額', '1.9': '比較増△減額', '1.11': '説明', '2.5': '予定額', '2.6': '(千円)', '2.8': '(千円)', '2.10': '(千円)' };
const headerFor = (layout: Layout, year: string): Record<string, string> => {
  if (layout === 'noprev') return { '1.1': '項', '1.3': '事項', '1.5': year, '1.7': '説明', '2.5': '予定額', '2.6': '(千円)' };
  return { ...HEADER_BASE, '1.1': layout === 'org' ? '所管・組織・項' : '項', '1.5': year };
};
type Layout = 'plain' | 'org' | 'noprev';

/** 行の種類（列の集合の完全一致。変種 1.4 / 3.2 は 1.1 / 3.1 と同じ意味として受ける） */
const norm = (cols: string[]) => cols.map(c => (c === '1.4' ? '1.1' : c === '3.2' ? '3.1' : c)).sort((a, b) => { const [x, y] = [a, b].map(s => s.split('.').map(Number)); return x[0] - y[0] || x[1] - y[1]; }).join(',');
const CLASSES: Record<string, string> = {
  '1.1,2.1,3.1,4.1,5.1,7.1,9.1,11.1': 'item-start',
  '3.1,4.1,5.1,7.1,9.1,11.1': 'continuation',
  '11.1': 'description-only',
  '1.1': 'ministry',
  '1.3': 'organization',
  '1.3,5.1,7.1,9.1': 'organization-total',
  '1.1,2.1,3.1,4.1,5.1,7.1': 'item-start-noprev',
};

export interface MofSpecialItemRecord {
  file: string; row: string; page: number; rowNo: number;
  ministry: string; specialAccount: string; subAccount: string; organization: string;
  itemCode: string; itemName: string; matterName: string; classCode: string;
  amountRaw: { planned: string; prev: string | null; diff: string | null };
  amountsThousandYen: { planned: number; prev: number | null; diff: number | null };
  variant: { itemCol: string | null; classCol: string };
}
export type MofSpecialOutcome =
  | { status: 'not_target'; file: string; titleForList: string }
  | { status: 'unsupported'; file: string; reason: 'document_id' | 'not_in_source_set' | 'source_hash_mismatch' }
  | { status: 'recognized'; file: string; sourceSha256: string; layout: Layout; records: MofSpecialItemRecord[]; counts: Record<string, number> };
export interface MofSpecialInput { filename: string; bytes: Uint8Array; menuChain: string[] | undefined; sourceSet: ReadonlyMap<string, string>; spec: MofSpecialParserSpec }

/** 目次の祖先 chain から（所管・特別会計・勘定）を取る */
export function specialScopeFromChain(chain: readonly string[], file: string): { ministry: string; specialAccount: string; subAccount: string } {
  const idx = chain.map((c, i) => (c === CHAIN_MARKER ? i : -1)).filter(i => i >= 0);
  if (idx.length !== 1) throw new MofXmlParseError('organization', file, `chain に「${CHAIN_MARKER}」が 1 つでない: ${chain.join(' > ')}`);
  const i = idx[0];
  if (chain[chain.length - 1] !== CHAIN_LAST) throw new MofXmlParseError('organization', file, `chain の末尾が「${CHAIN_LAST}」でない: ${chain.join(' > ')}`);
  if (i < 2 || !chain[i - 2].endsWith('所管')) throw new MofXmlParseError('organization', file, `chain に所管が無い: ${chain.join(' > ')}`);
  const sub = i + 1 < chain.length - 1 ? chain[i + 1] : '';
  if (i + 2 < chain.length - 1) throw new MofXmlParseError('organization', file, `chain の勘定の後に余分な要素: ${chain.join(' > ')}`);
  return { ministry: chain[i - 2].replace(/所管$/, ''), specialAccount: chain[i - 1], subAccount: sub };
}

const amountOf = (raw: string, allowNegative: boolean, what: string, file: string): number => {
  if (!AMOUNT_GRAMMAR.test(raw)) throw new MofXmlParseError('amount', file, `金額が文法外 ${what}: ${JSON.stringify(raw)}`);
  const neg = raw.startsWith('△');
  if (neg && !allowNegative) throw new MofXmlParseError('amount', file, `△ は比較増△減額のみ許可 ${what}: ${raw}`);
  const n = Number(raw.replace(/[△ ,]/g, ''));
  return neg ? -n : n;
};

export function parseMofSpecialXmlFile(input: MofSpecialInput): MofSpecialOutcome {
  const file = input.filename; const spec = input.spec;
  const sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const known = input.sourceSet.get(file);
  if (known === undefined) return { status: 'unsupported', file, reason: 'not_in_source_set' };
  if (known !== sha) return { status: 'unsupported', file, reason: 'source_hash_mismatch' };
  let text: string;
  try { text = new TextDecoder('shift_jis', { fatal: true }).decode(input.bytes); } catch { throw new MofXmlParseError('decode', file, 'Shift_JIS として decode できない'); }
  const doc = readXml(text, file);
  if (doc.root.name !== 'budget') throw new MofXmlParseError('input_contract', file, `root が budget でない: ${doc.root.name}`);
  if (doc.encoding !== 'Shift_JIS') throw new MofXmlParseError('input_contract', file, `encoding 宣言が Shift_JIS でない: ${doc.encoding}`);
  if (doc.doctype !== spec.doctype) throw new MofXmlParseError('input_contract', file, `DOCTYPE 不一致: ${doc.doctype}`);
  const titles = children(doc.root, 'title_for_list');
  if (titles.length !== 1) throw new MofXmlParseError('input_contract', file, 'title_for_list が 1 つでない');
  const title = titles[0].kids.filter((k): k is Tx => !isEl(k) && k.cdata).map(k => k.text).join('').replace(/\s+/g, ''); // source set（inventory）と同じく空白を除いて比べる
  if (title !== MOF_SPECIAL_TABLE_TITLE) return { status: 'not_target', file, titleForList: title };

  if (!input.menuChain) throw new MofXmlParseError('organization', file, '目次の祖先 chain が無い');
  const scope = specialScopeFromChain(input.menuChain, file);
  const tables = children(doc.root, 'body').flatMap(b => children(b, 'table'));
  if (tables.length !== 1) throw new MofXmlParseError('table_structure', file, `最上位の table が 1 つでない: ${tables.length}`);
  const table = tables[0];

  // header: 3 つの型のどれかと完全一致（見出しから layout が決まる）
  const headers = children(table, 'header');
  if (headers.length !== 1) throw new MofXmlParseError('table_structure', file, 'header が 1 つでない');
  const hs: Record<string, string> = {};
  for (const c of children(headers[0], 'clm')) {
    const m = CELL_ID.exec(c.attrs.id ?? '');
    if (!m) throw new MofXmlParseError('table_structure', file, `header の id 形式外: ${c.attrs.id}`);
    hs[`${m[3]}.${m[4]}`] = readCell(c, file).text.replace(/\s+/g, '');
  }
  const sortedJson = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => { const [x, y] = [a, b].map(s => s.split('.').map(Number)); return x[0] - y[0] || x[1] - y[1]; }));
  const layout = (['plain', 'org', 'noprev'] as Layout[]).find(l => sortedJson(headerFor(l, spec.yearLabel)) === sortedJson(hs));
  if (!layout) throw new MofXmlParseError('table_structure', file, `header が事前登録のどの型とも一致しない: ${JSON.stringify(hs)}`);

  interface Row { key: string; page: number; rowNo: number; cells: Map<string, El> }
  const rows: Row[] = []; const byKey = new Map<string, Row>();
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

  const counts: Record<string, number> = { 'item-start': 0, continuation: 0, 'description-only': 0, ministry: 0, organization: 0, 'organization-total': 0, 'item-start-noprev': 0, nestedTableCells: 0 };
  const records: MofSpecialItemRecord[] = [];
  const seen = new Set<string>();
  let ministry = scope.ministry; let organization = '';
  let current: { code: string; name: string; itemCol: string | null } | null = null;
  let sawMinistry = false; let sawOrg = false;
  const hasTable = (e: El): boolean => e.kids.some(k => isEl(k) && (k.name === 'table' || hasTable(k)));

  for (const r of rows) {
    const colSet = norm([...r.cells.keys()]);
    const cls = CLASSES[colSet];
    if (!cls) throw new MofXmlParseError('unknown_row', file, `未知の行 ${r.key}: ${[...r.cells.keys()].join(',')}`);
    // 11.1（説明）は解釈しない。入れ子の表は無視。それ以外の列は空でないこと
    for (const [col, el] of r.cells) {
      if (col.startsWith('11.')) {
        if (hasTable(el)) { counts.nestedTableCells++; continue; }
        if (deepText(el).trim() === '') throw new MofXmlParseError('cell_content', file, `空の説明 ${r.key}`);
      } else if (col === '7.1' && cls === 'item-start-noprev') continue; // 前年度の列がない型では 7.1 は説明
      else if (readCell(el, file).text === '') throw new MofXmlParseError('cell_content', file, `空セルを持つ行 ${r.key} 列${col}`);
    }
    counts[cls]++;
    const cell = (c: string) => readCell(r.cells.get(c)!, file).text;
    if (cls === 'description-only') continue;
    if (cls === 'ministry' || cls === 'organization' || cls === 'organization-total') {
      if (layout !== 'org') throw new MofXmlParseError('unknown_row', file, `所管・組織の行が org 型でないファイルにある ${r.key}`);
      if (cls === 'ministry') { ministry = cell('1.1'); sawMinistry = true; sawOrg = false; current = null; }
      else { if (!sawMinistry) throw new MofXmlParseError('organization', file, `組織の行が所管の行より前 ${r.key}`); organization = cell('1.3'); sawOrg = true; current = null; }
      continue;
    }
    if (cls === 'item-start-noprev' && layout !== 'noprev') throw new MofXmlParseError('unknown_row', file, `前年度の列がない行が noprev 型でないファイルにある ${r.key}`);
    if (layout === 'noprev' && cls !== 'item-start-noprev') throw new MofXmlParseError('unknown_row', file, `noprev 型のファイルに ${cls} の行 ${r.key}`);
    if (layout === 'org' && !sawOrg) throw new MofXmlParseError('organization', file, `組織の行より前に項・事項の行 ${r.key}`);
    const itemCol = r.cells.has('1.4') ? '1.4' : r.cells.has('1.1') ? '1.1' : null;
    const classCol = r.cells.has('3.2') ? '3.2' : '3.1';
    if (cls !== 'continuation') {
      const code = cell(itemCol!);
      if (!/^\d{2}$/.test(code)) throw new MofXmlParseError('item_code', file, `項コードが 2 桁数字でない ${r.key}: ${code}`);
      const k = `${ministry}|${organization}|${code}`;
      if (seen.has(k)) throw new MofXmlParseError('item_code', file, `項コードが重複 ${k}`);
      seen.add(k);
      current = { code, name: cell('2.1'), itemCol };
    }
    if (!current) throw new MofXmlParseError('orphan', file, `事項行に項が無い ${r.key}`);
    const classCode = cell(classCol);
    if (!/^\d{2}$/.test(classCode)) throw new MofXmlParseError('col4', file, `分類コードが 2 桁数字でない ${r.key}: ${classCode}`);
    const noprev = cls === 'item-start-noprev';
    const raw = { planned: cell('5.1'), prev: noprev ? null : cell('7.1'), diff: noprev ? null : cell('9.1') };
    records.push({
      file, row: r.key, page: r.page, rowNo: r.rowNo, ministry, specialAccount: scope.specialAccount, subAccount: scope.subAccount, organization,
      itemCode: current.code, itemName: current.name, matterName: cell('4.1'), classCode, amountRaw: raw,
      amountsThousandYen: { planned: amountOf(raw.planned, false, `予定額 ${r.key}`, file), prev: raw.prev === null ? null : amountOf(raw.prev, false, `前年度 ${r.key}`, file), diff: raw.diff === null ? null : amountOf(raw.diff, true, `比較増△減額 ${r.key}`, file) },
      variant: { itemCol: current.itemCol, classCol },
    });
  }
  if (records.length === 0) throw new MofXmlParseError('organization', file, '事項が得られない（データ行なし）');
  return { status: 'recognized', file, sourceSha256: sha, layout, records, counts };
}
