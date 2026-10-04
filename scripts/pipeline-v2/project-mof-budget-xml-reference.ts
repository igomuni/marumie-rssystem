/**
 * MOF 予算書XML 事項 parser v0 — reference projection（実装前に固定する oracle）の research 生成 script。
 * production parser ではない。V1 の出力・生成物は入力にしない。raw XML（data/download）だけから、事前登録した規則で事項行を投影する。
 * 規則から外れる構造は throw する（fail-closed）。parser 実装後に再生成して期待値を変えてはならない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/project-mof-budget-xml-reference.ts [--check]
 *   --check: 生成物をコミット済み artifact と byte 比較し、一致しなければ失敗する（再現性の確認）
 * 出力: tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-{source-set,reference-projection}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { collectPathStats, deepText, isNode, parseXml, structureSignature, type XmlNode, type XmlText } from './lib/mof-budget-xml-inspect';

const ROOT = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024');
const XML_DIR = path.join(ROOT, 'xml');
const MENU = path.join(ROOT, 'html', '202411001menu.html');
const OUT_DIR = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024');
export const TARGET_TITLE = '〔組織別事項別内訳〕';
export const EXPECTED_DOCTYPE = 'DOCTYPE budget SYSTEM "../dtd/202401.dtd"';
/** 事項表のヘッダ（列開始番号 → 空白除去後の文字列）。ヘッダの行番号・頁番号は固定しない */
export const EXPECTED_HEADER: Record<string, string> = { '1': '組織', '2': '項', '4': '事項', '6': '令和6年度', '8': '前年度', '10': '比較増△減額(千円)', '11': '説明' };
export const EXPECTED_SUBHEADER: Record<string, string> = { '6': '要求額', '7': '(千円)', '8': '予算額', '9': '(千円)' };
const ID_RE = /^p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)$/;
/** 金額の文法: 0、または（△ 付きも可の）カンマ区切り正整数。`△ 0` は符号が曖昧なので許可しない */
const AMOUNT_RE = /^(0|(△ )?[1-9]\d{0,2}(,\d{3})*)$/;

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const kids = (n: XmlNode, name: string) => n.children.filter(isNode).filter(c => c.name === name);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (file: string, msg: string): never => { throw new Error(`${file}: ${msg}`); };

/** <l> 内の文字を文書順に集める。CDATA と gaiji の子文字だけが文字を持つ。qt は空要素として数える。それ以外の子要素・非CDATAの非空白文字は失敗 */
function lineText(l: XmlNode, file: string, acc: { qt: number; gaiji: { code: string; text: string }[] }): string {
  let out = '';
  for (const c of l.children) {
    if (!isNode(c)) { const t = c as XmlText; if (t.cdata) out += t.text; else if (t.text.trim() !== '') fail(file, `<l> に CDATA 以外の文字: ${JSON.stringify(t.text)}`); continue; }
    if (c.name === 'qt') { if (c.children.length > 0 || Object.keys(c.attrs).length > 0) fail(file, 'qt が空要素でない'); acc.qt++; continue; }
    if (c.name === 'gaiji') {
      const t = c.children.filter((x): x is XmlText => !isNode(x)).map(x => x.text).join('');
      if (c.children.some(isNode) || t === '' || Object.keys(c.attrs).join() !== 'code') fail(file, 'gaiji の形が想定外');
      acc.gaiji.push({ code: c.attrs.code, text: t });
      out += t; continue;
    }
    fail(file, `<l> に想定外の子要素 <${c.name}>`);
  }
  return out;
}

export interface CellText { lines: string[]; text: string; qtCount: number; gaiji: { code: string; text: string }[] }
function cellText(c: XmlNode, file: string): CellText {
  const acc = { qt: 0, gaiji: [] as { code: string; text: string }[] };
  const ps = c.children.filter(isNode);
  if (c.children.some(x => !isNode(x) && (x as XmlText).text.trim() !== '') || ps.length !== 1 || ps[0].name !== 'p') fail(file, 'clm の子が単一の <p> でない');
  const lines = ps[0].children.map(l => {
    if (!isNode(l)) { if ((l as XmlText).text.trim() !== '') fail(file, '<p> 直下に文字'); return null; }
    if (l.name !== 'l') fail(file, `<p> に想定外の子 <${l.name}>`);
    return lineText(l, file, acc);
  }).filter((x): x is string => x !== null);
  return { lines, text: lines.join(''), qtCount: acc.qt, gaiji: acc.gaiji };
}

interface Row { page: number; row: number; key: string; cells: Map<string, CellText> }

function tableRows(table: XmlNode, file: string): Row[] {
  const rows = new Map<string, Row>();
  const order: string[] = [];
  for (const d of kids(table, 'data')) for (const c of kids(d, 'clm')) {
    const m = ID_RE.exec(c.attrs.id ?? '');
    if (!m) fail(file, `clm id 形式外: ${c.attrs.id}`);
    const key = `p${m![1]}-${m![2]}.${m![3]}`;
    let r = rows.get(key);
    if (!r) { r = { page: Number(m![1]), row: Number(m![2]), key, cells: new Map() }; rows.set(key, r); order.push(key); }
    const col = `${m![4]}.${m![5]}`;
    if (r.cells.has(col)) fail(file, `同一行・同一列に複数セル ${key} ${col}`);
    // 説明（col11）は v0 の対象外。構造上の存在（非空）だけを見て、中身は解釈しない。col1〜10 は単一 <p> の厳密な形を要求する
    r.cells.set(col, m![4] === '11' ? { lines: [], text: deepText(c).trim() === '' ? '' : '(description)', qtCount: 0, gaiji: [] } : cellText(c, file));
  }
  const out = order.map(k => rows.get(k)!);
  out.forEach((r, i) => { if (i > 0 && !(r.page > out[i - 1].page || (r.page === out[i - 1].page && r.row > out[i - 1].row))) fail(file, '文書順が (頁,行) の昇順でない'); });
  return out;
}

function checkHeader(table: XmlNode, file: string) {
  const head = kids(table, 'header');
  if (head.length !== 1) fail(file, 'header が 1 つでない');
  const got = { main: {} as Record<string, string>, sub: {} as Record<string, string> };
  const rowNums = new Set<string>();
  for (const c of kids(head[0], 'clm')) {
    const m = ID_RE.exec(c.attrs.id ?? '');
    if (!m) fail(file, `header の id 形式外 ${c.attrs.id}`);
    rowNums.add(m![2]);
    const txt = cellText(c, file).text.replace(/\s+/g, '');
    (m![5] === '2' ? got.main : got.sub)[m![4]] = txt; // 注: 実データでは見出し行(.2)と下位見出し(.3/.1)で末尾の数字が異なる。下で厳密に照合する
  }
  return { got, rowNums };
}

function parseAmount(raw: string, col: string, file: string): number {
  if (!AMOUNT_RE.test(raw)) fail(file, `金額が想定の形式でない col${col}: ${JSON.stringify(raw)}`);
  if (raw.startsWith('△') && col !== '10') fail(file, `△ は col10 のみ許可: col${col} ${raw}`);
  const n = Number(raw.replace(/[△ ,]/g, ''));
  return raw.startsWith('△') ? -n : n;
}

export interface MenuInfo { chainByFile: Map<string, string[]> }
export function readMenuChains(): MenuInfo {
  const text = new TextDecoder('euc-jp', { fatal: true }).decode(fs.readFileSync(MENU));
  const chain: string[] = [];
  const out = new Map<string, string[]>();
  for (const m of text.matchAll(/LineOut\((\d+),(\d+),"([^"]*)","([^"]*)","[^"]*"\)/g)) {
    const lv = Number(m[1]);
    chain.length = lv - 1; chain[lv - 1] = m[3];
    const f = m[4].replace(/#.*/, '');
    if (/\.xml$/.test(f) && !out.has(f)) out.set(f, [...chain]);
  }
  return { chainByFile: out };
}

async function main() {
  const check = process.argv.includes('--check');
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml')).sort(cmp);
  if (files.length !== 328) throw new Error(`XML が 328 件でない: ${files.length}`);
  const menu = readMenuChains();
  const targets: { file: string; sha256: string; bytes: number; fingerprint: string; runningTitle: string; menuChain: string[]; itemStartRows: number; requestRows: number; subtotalRows: number; descriptionOnlyRows: number }[] = [];
  const nonTargets: { file: string; sha256: string; titleForList: string }[] = [];
  const records: Record<string, unknown>[] = [];
  const stats = { nonCdataText: 0, nameLeadingTrailingSpace: 0, orgLeadingTrailingSpace: 0, amountRawForms: new Set<string>() };

  for (const f of files) {
    const buf = fs.readFileSync(path.join(XML_DIR, f));
    const x = parseXml(new TextDecoder('shift_jis', { fatal: true }).decode(buf));
    if (x.root.name !== 'budget') fail(f, `root が budget でない: ${x.root.name}`);
    if (x.declaration?.encoding !== 'Shift_JIS') fail(f, 'encoding 宣言が Shift_JIS でない');
    if (x.doctype !== EXPECTED_DOCTYPE) fail(f, `DOCTYPE 不一致: ${x.doctype}`);
    const t = kids(x.root, 'title_for_list');
    if (t.length !== 1) fail(f, 'title_for_list が 1 つでない');
    const titleCdata = t[0].children.filter((c): c is XmlText => !isNode(c) && c.cdata).map(c => c.text).join('');
    if (titleCdata !== TARGET_TITLE) { nonTargets.push({ file: f, sha256: sha256(buf), titleForList: titleCdata }); continue; }

    // ---- 対象ファイル（事項表） ----
    const rt = kids(x.root, 'running_title');
    if (rt.length !== 1) fail(f, 'running_title が 1 つでない');
    const runningTitle = rt[0].children.filter((c): c is XmlText => !isNode(c) && c.cdata).map(c => c.text).join('');
    const tables = kids(x.root, 'body').flatMap(b => kids(b, 'table'));
    if (tables.length !== 1) fail(f, `table が 1 つでない: ${tables.length}`);
    // header（実測: 見出し行の id 末尾が列 span、下位見出しは別行）。列開始番号と文字列を照合する
    const { got } = checkHeader(tables[0], f);
    for (const [col, txt] of Object.entries(EXPECTED_HEADER)) if (got.main[col] !== txt) fail(f, `header 列${col}: 想定 '${txt}' 実際 '${got.main[col]}'`);
    for (const [col, txt] of Object.entries(EXPECTED_SUBHEADER)) if (got.main[col] !== txt && got.sub[col] !== txt) fail(f, `下位 header 列${col}: 想定 '${txt}'`);
    const rows = tableRows(tables[0], f);

    const menuChain = menu.chainByFile.get(f);
    if (!menuChain) throw new Error(`${f}: 目次に無い`);
    const state: { currentItem: { code: string; name: CellText; row: string } | null } = { currentItem: null };
    let organization: string | null = null;
    const seenItemCodes = new Set<string>();
    let itemStarts = 0, reqRows = 0, subtotal = 0, descOnly = 0;
    rows.forEach((r, idx) => {
      const has = (c: string) => (r.cells.get(c)?.text ?? '') !== '';
      const empties = [...r.cells.entries()].filter(([, v]) => v.text === '').map(([k]) => k);
      if (empties.length > 0) fail(f, `空セルを持つ行 ${r.key}: ${empties.join(',')}`);
      const colSet = [...r.cells.keys()].sort(cmp).join(',');
      const isSub = has('4.2') && !has('5.1');
      const isDesc = r.cells.size === 1 && has('11.1');
      if (isSub) { if (colSet !== '10.1,4.2,6.1,8.1') fail(f, `組織計行の列集合が想定外 ${r.key}: ${colSet}`); subtotal++; return; }
      if (isDesc) { descOnly++; return; }
      if (!has('5.1')) fail(f, `未分類の行 ${r.key}: ${colSet}`);
      // 事項行
      if (has('1.1')) {
        if (idx !== 0) fail(f, `組織セルが先頭行以外 ${r.key}`);
        organization = r.cells.get('1.1')!.text;
        if (organization !== organization.trim()) stats.orgLeadingTrailingSpace++;
      }
      if (idx === 0 && !has('1.1')) fail(f, '先頭行に組織セルが無い');
      if (has('2.1') !== has('3.1')) fail(f, `項コードと項名の片方だけ ${r.key}`);
      if (has('2.1')) {
        const code = r.cells.get('2.1')!.text;
        if (!/^\d{3}$/.test(code)) fail(f, `項コードが 3 桁数字でない ${r.key}: ${code}`);
        if (seenItemCodes.has(code)) fail(f, `項コードがファイル内で重複 ${code}`);
        seenItemCodes.add(code);
        state.currentItem = { code, name: r.cells.get('3.1')!, row: r.key };
        itemStarts++;
      }
      const currentItem = state.currentItem;
      if (!currentItem) return fail(f, `事項行に項が無い（孤児） ${r.key}`);
      const expectCols = ['4.1', '5.1', '6.1', '8.1', '10.1', '11.1', ...(has('2.1') ? ['2.1', '3.1'] : []), ...(has('1.1') ? ['1.1'] : [])].sort(cmp).join(',');
      if (colSet !== expectCols) fail(f, `事項行の列集合が想定外 ${r.key}: ${colSet}`);
      const col4 = r.cells.get('4.1')!.text;
      if (!/^\d{2}$/.test(col4)) fail(f, `col4 が 2 桁数字でない ${r.key}: ${col4}`);
      const req = r.cells.get('5.1')!;
      if (req.text !== req.text.trim()) stats.nameLeadingTrailingSpace++;
      const am = { col6: r.cells.get('6.1')!.text, col8: r.cells.get('8.1')!.text, col10: r.cells.get('10.1')!.text };
      stats.amountRawForms.add(`6:${am.col6.replace(/\d/g, '9').replace(/9+(,9{3})*/g, 'N')}`);
      reqRows++;
      records.push({
        file: f, row: r.key, page: r.page, rowNo: r.row,
        organization,
        itemCode: currentItem.code, itemName: currentItem.name.text, itemNameLines: currentItem.name.lines,
        itemQtCount: currentItem.name.qtCount, itemGaiji: currentItem.name.gaiji, itemStartsInThisRow: has('2.1'),
        requestName: req.text, requestNameLines: req.lines, requestQtCount: req.qtCount, requestGaiji: req.gaiji,
        col4Raw: col4,
        amountsRaw: { col6: am.col6, col8: am.col8, col10: am.col10 },
        amountsThousandYen: { col6: parseAmount(am.col6, '6', f), col8: parseAmount(am.col8, '8', f), col10: parseAmount(am.col10, '10', f) },
      });
    });
    // 組織の一致（primary = 先頭行の col1。secondary = running_title の組織部分・目次の末尾要素。不一致は失敗）
    const m = /^(.+?所管)\s{2}(.+)$/.exec(runningTitle);
    const rtOrg = m ? m[2] : runningTitle;
    if (organization !== rtOrg) fail(f, `組織の不一致 col1='${organization}' running_title='${runningTitle}'`);
    if (menuChain[menuChain.length - 1] !== rtOrg && menuChain[menuChain.length - 3] !== rtOrg && !menuChain.includes(rtOrg)) fail(f, `目次の祖先に組織が無い: ${menuChain.join(' > ')}`);
    const st = collectPathStats(x.root);
    targets.push({ file: f, sha256: sha256(buf), bytes: buf.length, fingerprint: sha256(structureSignature(st)).slice(0, 8), runningTitle, menuChain, itemStartRows: itemStarts, requestRows: reqRows, subtotalRows: subtotal, descriptionOnlyRows: descOnly });
    void got;
  }

  const sourceSet = {
    schema: 'mof-budget-xml-parser-v0-source-set/v0',
    scope: 'FY2024 一般会計 当初予算 202411001（frozen）',
    generator: 'scripts/pipeline-v2/project-mof-budget-xml-reference.ts',
    xmlFiles: files.length, targetTableFiles: targets.length, nonTargetFiles: nonTargets.length,
    expected: { itemStartRows: targets.reduce((n, t) => n + t.itemStartRows, 0), requestRows: records.length, subtotalRows: targets.reduce((n, t) => n + t.subtotalRows, 0), descriptionOnlyRows: targets.reduce((n, t) => n + t.descriptionOnlyRows, 0) },
    targets,
    nonTargets,
  };
  const projection = {
    schema: 'mof-budget-xml-parser-v0-reference-projection/v0',
    note: 'reference projection は production parser とは独立に、実装前に raw XML から research script で生成した frozen oracle。human GT でも、未知 population での正解保証でもない。V1 の出力は使っていない。',
    generator: 'scripts/pipeline-v2/project-mof-budget-xml-reference.ts',
    sourceSetSha256: sha256(`${JSON.stringify(sourceSet, null, 2)}\n`),
    recordCount: records.length,
    records,
  };
  const outs: [string, string][] = [
    [path.join(OUT_DIR, '202411001-source-set.json'), `${JSON.stringify(sourceSet, null, 2)}\n`],
    [path.join(OUT_DIR, '202411001-reference-projection.json'), `${JSON.stringify(projection, null, 2)}\n`],
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [p, s] of outs) {
    if (check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== s) throw new Error(`再生成が commit 済み artifact と一致しない: ${p}`); } else fs.writeFileSync(p, s);
  }
  console.log(JSON.stringify({ targets: targets.length, nonTargets: nonTargets.length, records: records.length, expected: sourceSet.expected, stats: { ...stats, amountRawForms: [...stats.amountRawForms] }, check }));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
