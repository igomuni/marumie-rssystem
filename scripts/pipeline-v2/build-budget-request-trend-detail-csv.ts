/**
 * 概算要求の事項・目の年度推移 CSV。仕様: docs/budget-request-trend-detail-csv.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-trend-detail-csv.ts [out-dir]
 *   入力: tests/fixtures/budget-request-trend/kou.csv（項。キーの列をここから取る）、
 *         tests/fixtures/mof-budget-request-match/{year}/request-kou.csv（項の一覧。kou.csv と同じ順）、
 *         tests/fixtures/budget-request-csv/{year}/{total-table,detail-table}/sources/*.csv（総表＝事項の額、明細表＝事項・目）
 *   出力: <out-dir>/jikou.csv moku/{year}.csv detail-summary.json（既定 tests/fixtures/budget-request-trend）。目は大きいので年度ごとに分ける。
 *         public/data/v2/ui/budget-request-trend/detail.json.gz（/budget-request-trend の詳細の事項・目のタブ用）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { BudgetRequestTrendDetailData, BudgetRequestTrendDetailKou } from '../../types/budget-request-trend';
import { groupMoku, mokuReq, walkRows, type Jikou, type KouRef, type Moku, type Owner, type Walk } from './lib/budget-request-detail-tree';
import { buildTocTree, ns, readCsv, type Rec } from './lib/mof-budget-request-match';

const YEARS = [2023, 2024, 2025, 2026, 2027];
const outDir = process.argv[2] ?? path.join('tests', 'fixtures', 'budget-request-trend');
const rd = (p: string): Rec[] => readCsv(fs.readFileSync(p, 'utf8'));
const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n';
// 同じ書（分冊を含む）: slug から日付と末尾の連番を除いたもの。build-budget-request-trend-csv.ts の bookOf と同じ規則
const bookOf = (slug: string): string => slug.replace(/\d{8}[-_]/, '').replace(/(_+[a-z]?)\d+$/, '$1');
const sum = (xs: (number | null)[]): number => xs.reduce<number>((n, x) => n + (x ?? 0), 0);

const KOU_COLS = ['年度', '会計区分', '所管', '特別会計', '勘定', '組織', '項名', '項コード'];
const jikouHeader = [...KOU_COLS, '要求番号', '事項コード', '事項名', '前年度予算額_千円', '要求額_千円', '目の要求額の合計_千円', '目の行数', '細分の合計を使った目', '目の額の空き', '検算', '要求書', 'PDF頁'];
const mokuHeader = [...KOU_COLS, '事項名', '主要経費目的別コード', '目別コード', '目名', '目コード(原文)', '前年度予算額_千円', '要求額_千円', '行数', '細分の合計を使った行', '額の空き', '要求書', 'PDF頁'];
const jikouRows: unknown[][] = [], mokuRows: unknown[][] = [];
// UI 用: 年度 → 行のキー（UI の jikouKeyOf と同じ並び: 会計区分 | 所管（特別会計は特別会計名）| 勘定 | 組織 | 項名）→ 内訳。同じキーが複数の書にあれば最初の書
const ui: BudgetRequestTrendDetailData = { years: {} };
const summary: Record<string, unknown> = {};
const trend = rd(path.join('tests', 'fixtures', 'budget-request-trend', 'kou.csv'));

for (const year of YEARS) {
  const reqKou = rd(path.join('tests', 'fixtures', 'mof-budget-request-match', String(year), 'request-kou.csv'));
  const kouRows = trend.filter(r => r['年度'] === String(year));
  if (kouRows.length !== reqKou.length) throw new Error(`${year}: kou.csv ${kouRows.length} rows vs request-kou ${reqKou.length}`);
  reqKou.forEach((r, i) => { if (kouRows[i]['要求書'] !== r['request_source'] || ns(kouRows[i]['項名']) !== ns(r['request_name'])) throw new Error(`${year}: row ${i} differs between kou.csv and request-kou.csv`); });
  // 書ごとの項の一覧（書の中の source の順、source の中は目次の順）。各要素は kou.csv の行の添字
  const books = new Map<string, number[]>();
  reqKou.forEach((r, i) => { const b = bookOf(r['request_source']); (books.get(b) ?? books.set(b, []).get(b)!).push(i); });
  for (const list of books.values()) list.sort((a, b) => (reqKou[a]['request_source'] < reqKou[b]['request_source'] ? -1 : reqKou[a]['request_source'] > reqKou[b]['request_source'] ? 1 : a - b));
  // 目次の事項（項ごと）。一覧に無い見出しが事項の下の見出しかどうかの判定に使う
  const tocJikou = new Map<string, Set<string>>();
  const tocDir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'toc', 'sources');
  for (const f of fs.readdirSync(tocDir).filter(x => x.endsWith('.csv'))) {
    const t = buildTocTree(f.slice(0, -4), rd(path.join(tocDir, f)));
    for (const j of t.jikous) if (j.kouIdx !== null) { const k = `${t.slug}#${j.kouIdx}`; (tocJikou.get(k) ?? tocJikou.set(k, new Set()).get(k)!).add(j.name); }
  }
  // request-kou の `toc_kou_idx` は、総表から補った項（hierarchy = toc_total）を含めた添字。目次そのものの添字は、source ごとに toc の行を順に数えて求める
  const rawTocIdx = new Map<number, number>(); const seenToc = new Map<string, number>();
  reqKou.forEach((r, i) => { if (r['hierarchy'] !== 'toc') return; const n = seenToc.get(r['request_source']) ?? 0; rawTocIdx.set(i, n); seenToc.set(r['request_source'], n + 1); });
  const refsOf = (b: string): KouRef[] => (books.get(b) ?? []).map(i => ({ code: reqKou[i]['request_code3'], name: reqKou[i]['request_name'], jikouNames: rawTocIdx.has(i) ? tocJikou.get(`${reqKou[i]['request_source']}#${rawTocIdx.get(i)}`) : undefined }));
  const sourcesOf = (kind: string): Map<string, Rec[]> => {
    const dir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), kind, 'sources'); const m = new Map<string, Rec[]>();
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.csv')).sort()) m.set(f.slice(0, -4), rd(path.join(dir, f)));
    return m;
  };
  const totals = sourcesOf('total-table'), details = sourcesOf('detail-table');
  // 不一致の分類の材料: 明細表の未解決の行（表頭の行を除く）の数、plain text はあるが明細表の CSV が無い PDF（同じ書）
  const unresolved = new Map<string, number>();
  for (const u of rd(path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'detail-table', 'unresolved.csv'))) {
    if (u['reason'] === 'UNKNOWN_HEADER_ZONE_LINE') continue;
    const slug = path.basename(u['source_file']).replace(/\.txt$/, ''); unresolved.set(slug, (unresolved.get(slug) ?? 0) + 1);
  }
  const textDir = path.join('data', 'work', 'budget-request-plain-text', String(year));
  const noDetailBooks = new Set((fs.existsSync(textDir) ? fs.readdirSync(textDir) : []).filter(f => f.endsWith('.txt') && !details.has(f.slice(0, -4))).map(f => bookOf(f.slice(0, -4))));
  // 文字層の無い頁（plain text で空の頁）。項の明細表の頁の範囲（最初の頁〜最後の頁の次の頁）にあれば、目が取り込めていない
  const textless = new Map<string, Set<number>>();
  const textlessOf = (slug: string): Set<number> => {
    let set = textless.get(slug); if (set) return set; set = new Set<number>();
    const f = path.join(textDir, `${slug}.txt`);
    if (fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8').split('\f'); if (t[t.length - 1] === '') t.pop(); t.forEach((x, n) => { if (!x.trim()) set!.add(n + 1); }); }
    textless.set(slug, set); return set;
  };
  const reasonOf = (i: number, pages: Map<string, number[]>): string => {
    if (reqKou[i]['hierarchy'].startsWith('position')) return '位置で決めた項（目次なし）';
    if (sameNameOrg.has(i)) return '組織と同名の項（項の額が組織計）';
    if ([...pages.keys()].some(x => (unresolved.get(x) ?? 0) > 0)) return '明細表の未解決の行あり';
    if ([...pages].some(([x, pg]) => { const lo = Math.min(...pg), hi = Math.max(...pg) + 1; return [...textlessOf(x)].some(n => n >= lo && n <= hi); })) return '画像の頁あり';
    return noDetailBooks.has(bookOf(reqKou[i]['request_source'])) ? '明細表の無い分冊あり' : '未分類';
  };
  const orphanMoku = { no_kou_in_book: 0, before_first_kou: 0, after_context: 0, in_unlisted_kou: 0 };
  const unlisted = new Map<string, { book: string; code: string; name: string; req: number | null }>();
  const sameNameOrg = new Set<number>(); // 組織の行の直後に同じコード・名前の項の行がある項（kou.csv の行の添字）
  type Found = { j: Jikou; slug: string };
  const totalOf = new Map<number, Found[]>(), detailOf = new Map<number, Found[]>(), noJikouMoku = new Map<number, { slug: string; m: Moku }[]>();
  const kouIndex = (b: string, o: Owner): number | null => ('kou' in o ? books.get(b)![o.kou] : null);
  const walkAll = (src: Map<string, Rec[]>, col: '事項' | '区分', into: Map<number, Found[]>, isDetail: boolean) => {
    for (const [slug, rows] of src) {
      const b = bookOf(slug); const refs = refsOf(b);
      if (refs.length === 0) { if (isDetail) orphanMoku.no_kou_in_book += rows.filter(r => r['row_type'] === 'CODE_5_4_2_4').length; continue; }
      const w: Walk = walkRows(rows, refs, col);
      for (const f of w.sameNameOrg) sameNameOrg.add(books.get(b)![f]);
      for (const u of w.unlisted) { const k = `${b}|${u.code}|${u.name}`; const prev = unlisted.get(k); if (!prev || (prev.req === null && u.req !== null)) unlisted.set(k, { book: b, code: u.code, name: u.name, req: u.req }); }
      for (const j of w.jikous) {
        const ki = kouIndex(b, j.owner);
        if (ki === null) { if (isDetail) orphanMoku.in_unlisted_kou += j.moku.length; continue; }
        (into.get(ki) ?? into.set(ki, []).get(ki)!).push({ j, slug });
      }
      if (!isDetail) continue;
      orphanMoku.before_first_kou += w.orphan.beforeKou; orphanMoku.after_context += w.orphan.afterContext;
      for (const x of w.mokuNoJikou) { const ki = kouIndex(b, x.owner); if (ki === null) { orphanMoku.in_unlisted_kou++; continue; } (noJikouMoku.get(ki) ?? noJikouMoku.set(ki, []).get(ki)!).push({ slug, m: x.moku }); }
    }
  };
  walkAll(totals, '区分', totalOf, false);
  walkAll(details, '事項', detailOf, true);

  const st = { kou: { total: reqKou.length, kou_eq_jikou: 0, kou_ne_jikou: 0, kou_no_jikou: 0, kou_no_amount: 0, kou_eq_moku: 0, kou_ne_moku: 0, kou_moku_blank: 0, kou_no_moku: 0, kou_no_moku_image: 0 }, jikou: { total: 0, from_detail_only: 0, eq: 0, ne: 0, blank: 0, no_moku: 0, no_moku_image: 0, no_amount: 0 }, moku_rows: 0, moku_groups: 0 };
  const kouNeMoku: unknown[][] = [], kouNeJikou: unknown[][] = [];
  const pagesOf = (dj: Found[], loose: { slug: string; m: Moku }[]): Map<string, number[]> => {
    const m = new Map<string, number[]>(); const add = (slug: string, pg: string) => { if (Number(pg)) (m.get(slug) ?? m.set(slug, []).get(slug)!).push(Number(pg)); };
    for (const { j, slug } of dj) { add(slug, j.page); for (const x of j.moku) add(slug, x.page); }
    for (const x of loose) add(x.slug, x.m.page);
    return m;
  };
  reqKou.forEach((r, i) => {
    const k = kouRows[i]; const kouReq = r['request_amount'] === '' ? null : Number(r['request_amount']); const image = k['画像頁'] === '1';
    const head = [year, k['会計区分'], k['所管'], k['特別会計'], k['勘定'], k['組織'], k['項名'], k['項コード']];
    const acct = k['会計区分'] === '一般' ? 0 : 1; const uiKey = [acct, acct === 0 ? k['所管'] : k['特別会計'], k['勘定'], k['組織'], k['項名']].join('|');
    const yUi = ui.years[String(year)] ??= {}; const kUi: BudgetRequestTrendDetailKou | null = yUi[uiKey] ? null : (yUi[uiKey] = { j: [], m: [] });
    // 事項: 総表の事項（額の正）に、明細表の事項（目の親）を、事項名で結ぶ。同じ項に同名の事項が複数あるときだけ要求番号で絞る
    // （内閣府の分冊は、明細表の要求番号が PDF ごとに 1 から振り直される）。明細表にだけある事項も出す
    const tj = totalOf.get(i) ?? [], dj = detailOf.get(i) ?? [];
    const keyJ = (j: Jikou) => `${j.reqNo}|${j.name}`;
    const totalKeyOf = (j: Jikou): string => { const c = tj.filter(x => x.j.name === j.name); const pick = c.length === 1 ? c : c.filter(x => x.j.reqNo === j.reqNo); return pick.length === 1 ? keyJ(pick[0].j) : `detail:${keyJ(j)}`; };
    const mokuOf = new Map<string, Moku[]>(); const pageOf = new Map<string, { slug: string; page: string }>();
    for (const { j, slug } of dj) { const k2 = totalKeyOf(j); (mokuOf.get(k2) ?? mokuOf.set(k2, []).get(k2)!).push(...j.moku); if (!pageOf.has(k2)) pageOf.set(k2, { slug, page: j.page }); }
    const order: { j: Jikou; key: string; fromTotal: boolean }[] = []; const seen = new Set<string>();
    for (const { j } of tj) if (!seen.has(keyJ(j))) { seen.add(keyJ(j)); order.push({ j, key: keyJ(j), fromTotal: true }); }
    for (const { j } of dj) { const k2 = totalKeyOf(j); if (!seen.has(k2)) { seen.add(k2); order.push({ j, key: k2, fromTotal: false }); } }
    const allMoku: Moku[] = [];
    for (const { j, key, fromTotal } of order) {
      const ms = mokuOf.get(key) ?? []; allMoku.push(...ms);
      const req = fromTotal ? j.req : null; const msum = sum(ms.map(mokuReq)); const blanks = ms.filter(m => mokuReq(m) === null).length; const fromSub = ms.filter(m => m.req === null && mokuReq(m) !== null).length;
      const status = req === null ? '事項の額なし' : ms.length === 0 ? (image ? '画像の頁' : '目なし') : blanks > 0 ? '額の空きあり' : msum === req ? '一致' : '不一致';
      st.jikou.total++; if (!fromTotal) st.jikou.from_detail_only++;
      st.jikou[({ 一致: 'eq', 不一致: 'ne', 額の空きあり: 'blank', 目なし: 'no_moku', 画像の頁: 'no_moku_image', 事項の額なし: 'no_amount' } as const)[status]]++;
      const pg = pageOf.get(key);
      jikouRows.push([...head, j.reqNo, j.code, j.name, fromTotal ? j.prev ?? '' : '', req ?? '', ms.length ? msum : '', ms.length, fromSub, blanks, status, pg?.slug ?? k['要求書'], pg?.page ?? '']);
      const ji = kUi ? kUi.j.push([j.reqNo, j.name, fromTotal ? j.prev : null, req, ms.length ? msum : null, status]) - 1 : -1;
      for (const g of groupMoku(ms)) { kUi?.m.push([ji, g.name, g.yy, g.prev, g.req, g.fromSub, g.blanks]); st.moku_groups++; mokuRows.push([...head, j.name, g.c1, g.yy, g.name, g.raws.join('、'), g.prev ?? '', g.req ?? '', g.rows, g.fromSub, g.blanks, pg?.slug ?? k['要求書'], g.page]); }
      st.moku_rows += ms.length;
    }
    const loose = (noJikouMoku.get(i) ?? []).map(x => x.m); allMoku.push(...loose);
    for (const g of groupMoku(loose)) { kUi?.m.push([-1, g.name, g.yy, g.prev, g.req, g.fromSub, g.blanks]); st.moku_groups++; mokuRows.push([...head, '', g.c1, g.yy, g.name, g.raws.join('、'), g.prev ?? '', g.req ?? '', g.rows, g.fromSub, g.blanks, (noJikouMoku.get(i) ?? [])[0]?.slug ?? k['要求書'], g.page]); }
    st.moku_rows += loose.length;
    // 項の検算
    if (kouReq === null) { st.kou.kou_no_amount++; return; }
    const tsum = sum(tj.map(x => x.j.req));
    if (tj.length === 0) st.kou.kou_no_jikou++; else if (tsum === kouReq) st.kou.kou_eq_jikou++; else { st.kou.kou_ne_jikou++; kouNeJikou.push([k['要求書'], k['項名'], kouReq, tsum, reqKou[i]['hierarchy'].startsWith('position') ? '位置で決めた項（目次なし）' : sameNameOrg.has(i) ? '組織と同名の項（項の額が組織計）' : '']); }
    if (allMoku.length === 0) { if (image) st.kou.kou_no_moku_image++; else st.kou.kou_no_moku++; }
    else if (allMoku.some(m => mokuReq(m) === null)) st.kou.kou_moku_blank++;
    else if (sum(allMoku.map(mokuReq)) === kouReq) st.kou.kou_eq_moku++;
    else { st.kou.kou_ne_moku++; kouNeMoku.push([k['要求書'], k['項名'], kouReq, sum(allMoku.map(mokuReq)), reasonOf(i, pagesOf(dj, noJikouMoku.get(i) ?? []))]); }
  });
  // 名前に残った PDF の外字（PDF_GAIJI に無い私用領域のコード。ブラウザでは表示されない）
  const gaiji = [...jikouRows, ...mokuRows].filter(r => r[0] === year).flatMap(r => [String(r[10] ?? ''), String(r[8] ?? ''), String(r[11] ?? '')]).join('').match(/[\uE000-\uF8FF]/g)?.length ?? 0;
  summary[String(year)] = { ...st, gaiji_left_in_names: gaiji, orphan_moku: orphanMoku, kou_ne_moku_by_reason: Object.fromEntries([...new Set(kouNeMoku.map(x => String(x[4])))].map(r => [r, kouNeMoku.filter(x => x[4] === r).length])), kou_ne_moku: kouNeMoku, kou_ne_jikou: kouNeJikou, unlisted_kou: [...unlisted.values()].map(u => [u.book, u.code, u.name, u.req]) };
}
fs.mkdirSync(outDir, { recursive: true });
const uiDir = path.join('public', 'data', 'v2', 'ui', 'budget-request-trend'); fs.mkdirSync(uiDir, { recursive: true });
fs.writeFileSync(path.join(uiDir, 'detail.json.gz'), zlib.gzipSync(JSON.stringify(ui), { level: 9, mtime: 0 } as zlib.ZlibOptions));
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const jcsv = toCsv(jikouHeader, jikouRows); const hashes: Record<string, string> = { 'jikou.csv': sha(jcsv) };
fs.writeFileSync(path.join(outDir, 'jikou.csv'), jcsv);
fs.mkdirSync(path.join(outDir, 'moku'), { recursive: true });
for (const year of YEARS) { const m = toCsv(mokuHeader, mokuRows.filter(r => r[0] === year)); fs.writeFileSync(path.join(outDir, 'moku', `${year}.csv`), m); hashes[`moku/${year}.csv`] = sha(m); }
fs.writeFileSync(path.join(outDir, 'detail-summary.json'), JSON.stringify({ sha256: hashes, years: summary }, null, 1) + '\n');
for (const [y, s] of Object.entries(summary)) { const { kou_ne_moku, kou_ne_jikou, unlisted_kou, ...rest } = s as Record<string, unknown>; void kou_ne_moku; void kou_ne_jikou; console.log(y, JSON.stringify(rest), 'unlisted', (unlisted_kou as unknown[]).length); }
