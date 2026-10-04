import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { MOF_ITEM_PARSER_V0_DOCUMENT_ID, MOF_ITEM_TABLE_TITLE, MofXmlParseError, parseMofBudgetXmlItemFile, readMenuAncestorChains, type MofXmlItemRecord, type ParseOutcome } from './mof-budget-xml-items';

// ------------------------------------------------------------ synthetic XML builders（development tests。frozen reference projection 全件は使わない）
const cd = (s: string) => `<![CDATA[${s}]]>`;
const lines = (ls: string[]) => ls.map(l => `<l>${cd(l)}</l>`).join('');
const clm = (id: string, ls: string[] | string) => `<clm id="${id}"><p>${typeof ls === 'string' ? ls : lines(ls)}</p></clm>`;
const hdr = (rowMain: string, rowSub: string, main: Record<string, string> = { '1': '組織', '2': '項', '4': '事項', '6': '令和6年度', '8': '前年度', '10': '比較増△減額(千円)', '11': '説明' }) =>
  Object.entries(main).map(([c, t]) => clm(`p1-${rowMain}.1-${c}.2`, [t])).join('')
  + Object.entries({ '6': '要求額', '7': '(千円)', '8': '予算額', '9': '(千円)' }).map(([c, t]) => clm(`p1-${rowSub}.2-${c}.1`, [t])).join('');
const NAME = (n: number) => `p${n}`;
const row = (page: number, r: number, cells: Record<string, string[] | string>) => Object.entries(cells).map(([col, v]) => clm(`${NAME(page)}-${r}.1-${col}`, v)).join('');
const std = (o: { org?: string; code?: string; name?: string; req?: string; c4?: string; a6?: string; a8?: string; a10?: string; withOrg?: boolean; withItem?: boolean }) => ({
  ...(o.withOrg ? { '1.1': [o.org ?? '皇室費'] } : {}),
  ...(o.withItem === false ? {} : { '2.1': [o.code ?? '001'], '3.1': [o.name ?? '内廷費'] }),
  '4.1': [o.c4 ?? '95'], '5.1': [o.req ?? '内廷に必要な経費'], '6.1': [o.a6 ?? '324,000'], '8.1': [o.a8 ?? '324,000'], '10.1': [o.a10 ?? '0'], '11.1': ['説明'],
} as Record<string, string[]>);

function fileXml(o: { title?: string; running?: string; rows: string; root?: string; doctype?: string; encoding?: string; header?: string; tables?: number; noRunning?: boolean }): string {
  const header = o.header ?? hdr('3', '3');
  const table = `<table><header>${header}</header><data>${o.rows}</data></table>`;
  return `<?xml version="1.0" encoding="${o.encoding ?? 'Shift_JIS'}" ?>\n<!DOCTYPE budget SYSTEM "${o.doctype ?? '../dtd/202401.dtd'}">\n<${o.root ?? 'budget'}>`
    + `<title_for_list>${cd(o.title ?? MOF_ITEM_TABLE_TITLE)}</title_for_list>${o.noRunning ? '' : `<running_title>${cd(o.running ?? '皇室費')}</running_title>`}`
    + `<body layer="1">${table.repeat(o.tables ?? 1)}</body></${o.root ?? 'budget'}>`;
}
const enc = (s: string) => new Uint8Array(iconv.encode(s, 'Shift_JIS'));
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
function parse(xmlOrBytes: string | Uint8Array, over: Partial<{ documentId: string; menuChain: string[] | undefined; known: boolean; filename: string; hash: string }> = {}): ParseOutcome {
  const bytes = typeof xmlOrBytes === 'string' ? enc(xmlOrBytes) : xmlOrBytes;
  const filename = over.filename ?? 'f.xml';
  const set = new Map<string, string>(over.known === false ? [] : [[filename, over.hash ?? sha(bytes)]]);
  return parseMofBudgetXmlItemFile({ filename, bytes, documentId: over.documentId ?? MOF_ITEM_PARSER_V0_DOCUMENT_ID, menuChain: 'menuChain' in over ? over.menuChain : ['令和6年度一般会計予算参照書', '皇室費', MOF_ITEM_TABLE_TITLE], sourceSet: set });
}
const fails = (xmlOrBytes: string | Uint8Array, code: string, over?: Parameters<typeof parse>[1]) => {
  let err: unknown;
  try { parse(xmlOrBytes, over); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(MofXmlParseError);
  expect((err as MofXmlParseError).code).toBe(code);
};
const good = () => fileXml({ rows: row(2, 1, std({ withOrg: true })) + row(2, 2, std({ code: '002', name: '宮廷費', req: '宮廷に必要な経費' })) + row(2, 3, std({ withItem: false, req: '続きの事項' })) });
const recs = (o: ParseOutcome) => { if (o.status !== 'recognized') throw new Error(`status=${o.status}`); return o.records; };

describe('MOF XML item parser v0 — 基本', () => {
  it('組織・項の carry-forward・事項名・金額・col4 を事前登録どおりに出す', () => {
    const r = recs(parse(good()));
    expect(r).toHaveLength(3);
    expect(r.map(x => [x.itemCode, x.itemStartsInThisRow, x.requestName])).toEqual([['001', true, '内廷に必要な経費'], ['002', true, '宮廷に必要な経費'], ['002', false, '続きの事項']]);
    expect(r[2]).toMatchObject({ organization: '皇室費', itemName: '宮廷費', col4Raw: '95', amountsRaw: { col6: '324,000', col8: '324,000', col10: '0' }, amountsThousandYen: { col6: 324000, col8: 324000, col10: 0 } });
  });
  it('組織計行・説明のみ行は出力せず数える', () => {
    const rows = row(2, 1, std({ withOrg: true })) + clm('p2-2.1-4.2', ['皇室費計']) + clm('p2-2.1-6.1', ['1']) + clm('p2-2.1-8.1', ['1']) + clm('p2-2.1-10.1', ['0']) + row(2, 3, { '11.1': ['説明の続き'] });
    const o = parse(fileXml({ rows }));
    expect(o).toMatchObject({ status: 'recognized', counts: { itemStartRows: 1, requestRows: 1, subtotalRows: 1, descriptionOnlyRows: 1 } });
  });
  it('名称は <l> を区切りなしで連結し、trim・空白追加をしない（col11 は複数 <p> でも解釈しない）', () => {
    const rows = row(2, 1, { ...std({ withOrg: true }), '5.1': ['国際観光旅客税財', '源宮廷に必要な経', '費'], '11.1': '</p><p><l><![CDATA[二つ目]]></l>' });
    const o = recs(parse(fileXml({ rows })))[0];
    expect(o.requestName).toBe('国際観光旅客税財源宮廷に必要な経費');
    expect(o.requestNameLines).toEqual(['国際観光旅客税財', '源宮廷に必要な経', '費']);
  });
  it('gaiji（1508/填）は子文字を採用して保持、qt は文字に寄与せず数だけ保持する', () => {
    const rows = row(2, 1, { ...std({ withOrg: true }), '5.1': `<l>${cd('貨幣交換差減補')}<gaiji code="1508">${cd('填')}</gaiji>${cd('金')}</l>`, '3.1': `<l>${cd('令和')}<qt></qt>${cd('2')}<qt></qt>${cd('年度')}</l>` });
    const o = recs(parse(fileXml({ rows })))[0];
    expect(o.requestName).toBe('貨幣交換差減補填金');
    expect(o.requestGaiji).toEqual([{ code: '1508', text: '填' }]);
    expect(o).toMatchObject({ itemName: '令和2年度', itemQtCount: 2 });
  });
  it('目次から祖先 chain を作る', () => {
    const chains = readMenuAncestorChains('LineOut(01,1,"参照書","","");\nLineOut(02,1,"皇室費","","");\nLineOut(03,0,"〔組織別事項別内訳〕","a.xml#p1","p.1");');
    expect(chains.get('a.xml')).toEqual(['参照書', '皇室費', '〔組織別事項別内訳〕']);
  });
});

describe('MOF XML item parser v0 — not_target / unsupported（silent skip しない）', () => {
  it('title が異なるファイルは not_target（失敗ではない。部分一致で事項表にしない）', () => {
    expect(parse(fileXml({ title: '丙号 繰越明許費要求書（事項）', rows: row(2, 1, std({ withOrg: true })) }))).toMatchObject({ status: 'not_target', titleForList: '丙号 繰越明許費要求書（事項）' });
    expect(parse(fileXml({ title: ` ${MOF_ITEM_TABLE_TITLE}`, rows: '' }))).toMatchObject({ status: 'not_target' });
  });
  it('document id が違う・source set に無い・hash 不一致は unsupported', () => {
    expect(parse(good(), { documentId: '202412001' })).toMatchObject({ status: 'unsupported', reason: 'document_id' });
    expect(parse(good(), { known: false })).toMatchObject({ status: 'unsupported', reason: 'not_in_source_set' });
    expect(parse(good(), { hash: 'x' })).toMatchObject({ status: 'unsupported', reason: 'source_hash_mismatch' });
  });
});

describe('MOF XML item parser v0 — hard failure', () => {
  it('decode 不能・malformed XML・root / encoding / DOCTYPE 不一致', () => {
    fails(new Uint8Array([0x3c, 0x81, 0xff, 0xff]), 'decode');
    fails(good().replace('</budget>', ''), 'malformed');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), root: 'other' }), 'input_contract');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), encoding: 'UTF-8' }), 'input_contract');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), doctype: '../dtd/other.dtd' }), 'input_contract');
  });
  it('table が 1 つでない・header 不一致（必要列欠落・語の相違）', () => {
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), tables: 2 }), 'table_structure');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), header: hdr('3', '3', { '1': '組織', '2': '項', '4': '事項', '6': '令和6年度', '8': '前年度', '10': '比較増△減額(千円)' }) }), 'table_structure');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), header: hdr('3', '3', { '1': '組織', '2': '項', '4': '事業', '6': '令和6年度', '8': '前年度', '10': '比較増△減額(千円)', '11': '説明' }) }), 'table_structure');
  });
  it('未知の行・先頭行が項を持たない・空セル', () => {
    fails(fileXml({ rows: row(2, 1, { '1.1': ['皇室費'], '5.1': ['x'] }) }), 'unknown_row');
    fails(fileXml({ rows: row(2, 1, std({ withItem: false })) }), 'unknown_row');
    fails(fileXml({ rows: row(2, 1, { ...std({ withOrg: true }), '5.1': [''] }) }), 'cell_content');
  });
  it('項コード: 3 桁数字でない・重複・片方だけ', () => {
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true, code: '01' })) }), 'item_code');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })) + row(2, 2, std({ code: '001', name: '別' })) }), 'item_code');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })) + row(2, 2, { ...std({ withItem: false }), '2.1': ['002'] }) }), 'unknown_row');
  });
  it('col4・金額: 2 桁数字でない／blank／非数値／△0／△ を col6 に置く／カンマ形式違い', () => {
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true, c4: '9' })) }), 'col4');
    for (const a10 of ['△ 0', '△0', '12,34', '1,2345', '1.5', 'abc']) fails(fileXml({ rows: row(2, 1, std({ withOrg: true, a10 })) }), 'amount');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true, a6: '△ 5' })) }), 'amount');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true, a8: '１２' })) }), 'amount');
  });
  it('組織: primary と running_title の不一致、目次の祖先に無い、目次 chain なし', () => {
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })), running: '内閣府所管  内閣本府' }), 'organization');
    fails(good(), 'organization', { menuChain: ['別の組織'] });
    fails(good(), 'organization', { menuChain: undefined });
    expect(parse(fileXml({ rows: row(2, 1, std({ withOrg: true, org: '内閣本府' })), running: '内閣府所管  内閣本府' }), { menuChain: ['内閣府所管', '内閣本府'] })).toMatchObject({ status: 'recognized', organization: '内閣本府' });
  });
  it('セル内容: 未知 gaiji・空でない qt・想定外の子要素・非 CDATA の文字・複数 <p>', () => {
    const base = (v: string) => fileXml({ rows: row(2, 1, { ...std({ withOrg: true }), '5.1': v }) });
    fails(base(`<l>${cd('a')}<gaiji code="9999">${cd('x')}</gaiji></l>`), 'cell_content');
    fails(base(`<l>${cd('a')}<gaiji code="1508"></gaiji></l>`), 'cell_content');
    fails(base(`<l>${cd('a')}<qt>x</qt></l>`), 'cell_content');
    fails(base(`<l>${cd('a')}<b>x</b></l>`), 'cell_content');
    fails(base(`<l>${cd('a')}生の文字</l>`), 'cell_content');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })).replace('<clm id="p2-1.1-5.1"><p>', '<clm id="p2-1.1-5.1"><p><l>x</l></p><p>') }), 'cell_content');
  });
  it('文書順の逆転・同一セルの重複', () => {
    fails(fileXml({ rows: row(2, 2, std({ withOrg: true })) + row(2, 1, std({ code: '002' })) }), 'order');
    fails(fileXml({ rows: row(2, 1, std({ withOrg: true })) + clm('p2-1.1-5.1', ['重複']) }), 'table_structure');
  });
});

// ------------------------------------------------------------ frozen hand-checked fixture（29 行）
interface HandRow { file: string; row: string; reasons: string[]; rawClmFragments: string[]; expected: MofXmlItemRecord }
const hand = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-hand-checked-fixture.json'), 'utf8')) as { rows: HandRow[] };

describe('MOF XML item parser v0 — frozen hand-checked fixture（29 行）', () => {
  it.each(hand.rows.map(h => [`${h.file} ${h.row} ${h.reasons[0]}`, h] as const))('%s', (_n, h) => {
    const e = h.expected;
    const frag = h.rawClmFragments.join('');
    const startsOrg = h.rawClmFragments.some(f => /-1\.\d+">/.test(f));
    // 先頭行が組織＋項＋事項行でなければ、足場として同じ項・組織の先頭行を前置する（期待値の項コード・項名・組織だけを使う）
    const scaffold = startsOrg ? '' : row(1, 1, std({ withOrg: true, org: e.organization, code: e.itemStartsInThisRow ? '000' : e.itemCode, name: e.itemStartsInThisRow ? '足場' : e.itemName, req: '足場の事項' }));
    const xml = fileXml({ running: e.organization, rows: scaffold + frag, header: hdr('3', '3') });
    const out = recs(parse(xml, { menuChain: [e.organization] })).find(r => r.row === e.row);
    expect(out).toBeDefined();
    if (e.itemStartsInThisRow) expect({ ...out, file: e.file }).toEqual(e);
    else expect({ ...out, file: e.file }).toMatchObject({ ...e, itemNameLines: expect.anything(), itemQtCount: expect.anything(), itemGaiji: expect.anything() });
  });
});
