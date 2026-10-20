/**
 * 概算要求の年度推移 CSV（項の粒度）。仕様: docs/budget-request-trend-csv.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-trend-csv.ts [out-dir]
 *   入力: tests/fixtures/mof-budget-request-match/{ver}/request-kou.csv（概算要求の木だけから決めた項の所属・金額）、同 m1-kou.csv（MOF 突合の状態。参考）、
 *         tests/fixtures/budget-request-csv/{year}/cover/sources/*.csv（表紙の所管コード）
 *         tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json（元の PDF の URL）
 *   出力: <out-dir>/kou.csv summary.json（既定 tests/fixtures/budget-request-trend）、public/data/v2/ui/budget-request-trend/kou.json.gz（/budget-request-trend 用。キー単位に束ねる）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { BudgetRequestTrendData, BudgetRequestTrendRow } from '../../types/budget-request-trend';
import { ns, readCsv, type Rec } from './lib/mof-budget-request-match';

// 概算要求の年度 → MOF の版（MOF の版が無い年度は null。突合の状態は空にする）
const YEARS: [number, string | null][] = [[2023, '2023'], [2024, '2024'], [2025, '2025'], [2026, '2026'], [2027, null]];
const outDir = process.argv[2] ?? path.join('tests', 'fixtures', 'budget-request-trend');
const MATCH = path.join('tests', 'fixtures', 'mof-budget-request-match');
const rd = (p: string): Rec[] => readCsv(fs.readFileSync(p, 'utf8'));
const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// キーの所管部分: 一般会計は所管名、特別会計は空（特別会計名・勘定がキーに入る）。所管コード（表紙）はキーにしない（年金特会 9207 → 2507 のようにコードだけ変わる）
const scopeOf = (r: Rec): string => (r['acct'] === 'general' ? r['ministry'] : '');
const header = ['年度', '会計区分', '所管コード', '所管', '特別会計', '勘定', '組織', '組織の出所', '項名', '項コード', '前年度予算額_千円', '要求額_千円', '増減_千円', '要求書', '頁', 'PDF頁', 'PDFの要求書', 'PDF頁の根拠', '画像頁', '階層', '複数書', '金額不一致', '繰入先', 'MOF突合(参考)'];
const rows: unknown[][] = [];
const uiRows = new Map<string, BudgetRequestTrendRow>(); // キー（年度をまたぐ）→ 行
const uiUrls: string[] = []; const uiUrlIdx = new Map<string, number>();
const urlIndex = (u: string): number => { let i = uiUrlIdx.get(u); if (i === undefined) { i = uiUrls.length; uiUrls.push(u); uiUrlIdx.set(u, i); } return i; };
const summary: Record<string, unknown> = {};
type Row = { r: Rec; code: string; org: string; orgSrc: string; key: string };
const stages: { year: number; ver: string | null; kou: Rec[]; status: Map<string, string>; recs: Row[]; urlOf: Map<string, string>; pdfOf: (r: Rec, org: string) => { slug: string; pdfPage: string; basis: string; image: boolean } | null; xferOf: (src: string, code: string, name: string) => string[] }[] = [];
for (const [year, ver] of YEARS) {
  const dir = path.join(MATCH, ver ?? String(year));
  const kou = rd(path.join(dir, 'request-kou.csv'));
  const status = new Map<string, string>();
  if (ver) for (const r of rd(path.join(dir, 'm1-kou.csv'))) status.set(`${r['request_source']}#${r['toc_kou_idx']}`, r['status']);
  // 表紙の見出し（所管コードと、括弧内の組織）。source ごとに 1 つ
  const cover = new Map<string, { code: string; org: string; name: string }>();
  const coverDir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'cover', 'sources');
  for (const f of fs.readdirSync(coverDir).filter(x => x.endsWith('.csv')).sort()) {
    const h = rd(path.join(coverDir, f)).find(r => r['kind'] === 'HEADER'); if (!h) continue;
    cover.set(f.slice(0, -4), { code: h['code'], org: /[（(](.*)[）)]$/.exec(ns(h['name']))?.[1] ?? '', name: ns(h['name']) });
  }
  // 表紙の頁が無い書（総表・明細表から始まる抜粋版。例: 環境省 FY2026 のエネルギー対策・復興、金融庁 FY2023）は、明細表の先頭の CONTEXT 行の見出し
  // （`9905 エネルギー対策特別会計(…)`、`19 内閣府所管(金融庁…)`）から、表紙と同じ形で補う
  for (const slug of new Set(kou.map(r => r['request_source']))) {
    if (cover.has(slug)) continue;
    const f = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'detail-table', 'sources', `${slug}.csv`);
    if (!fs.existsSync(f)) continue;
    const ctx = rd(f).find(r => r['row_type'] === 'CONTEXT'); const m = ctx && /^(\d+)(.*)$/.exec(ns(ctx['事項'])); if (!m) continue;
    const org = /[（(](.*)[）)]$/.exec(m[2])?.[1] ?? '';
    cover.set(slug, { code: m[1], org: org.replace(/^(.+)[（(]\1[）)]$/, '$1'), name: m[2] }); // `金融庁（金融庁）` は 1 つに
  }
  // 明細表に CONTEXT 行が無く、会計・所管・特別会計名が決まらなかった行は、表紙の見出しで補う
  // （コードが 2 桁なら一般会計の所管、4 桁なら特別会計。例: `19 内閣府所管（金融庁）`、`9101 東日本大震災復興特別会計（総務本省等）`）
  for (const r of kou) {
    const cv = cover.get(r['request_source']); if (!cv) continue;
    if (!r['acct']) r['acct'] = cv.code.length === 2 ? 'general' : 'special';
    if (r['acct'] === 'general' && !r['ministry']) r['ministry'] = cv.name.replace(/所管.*$/, '');
    if (r['acct'] === 'special' && !r['account']) r['account'] = cv.name.replace(/特別会計.*$/, '');
  }
  // 要求書の slug（data/download 以下のパスの `/` を `__` にしたもの）→ 元の PDF の URL
  const urlOf = new Map<string, string>();
  const freeze = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-pdf-corpus', String(year), 'pdf-corpus-freeze.json'), 'utf8')) as { documents: { localPdfPath: string; sourceUrl: string }[] };
  for (const d of freeze.documents) { const slug = d.localPdfPath.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__'); urlOf.set(slug, d.sourceUrl); urlOf.set(slug.replace(/\$/g, '%24'), d.sourceUrl); }
  // 目次の頁は紙面に印字された頁（`4復興特` `エ1` のような接頭辞・接尾辞つきもある）。PDF の通し頁は、明細表の各行の 頁 と source_page（PDF の頁）の対応から引く。
  // 明細表が無い要求書は引けず、空にする
  const detailKou = new Map<string, { code: string; name: string; org: string; pg: number }[]>();
  const labelPage = new Map<string, Map<string, number>>(); const digitPage = new Map<string, Map<string, Set<number>>>();
  const detailDir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'detail-table', 'sources');
  if (fs.existsSync(detailDir)) for (const f of fs.readdirSync(detailDir).filter(x => x.endsWith('.csv'))) {
    const slug = f.slice(0, -4); const lm = new Map<string, number>(); const dm = new Map<string, Set<number>>();
    const rowsOf = rd(path.join(detailDir, f)); let orgNow = '';
    rowsOf.forEach((r, i) => {
      // 明細表の項（CODE3）の行: 組織の見出しは、CODE3 の直後に CODE3 が続く行（総表と同じ規則。CONTEXT で区切る）
      if (r['row_type'] === 'CONTEXT') orgNow = '';
      if (r['row_type'] !== 'CODE3') return;
      const m = /^(\d+)(.*)$/.exec(ns(r['事項'] ?? '')); if (!m || !Number(r['source_page'])) return;
      if (rowsOf[i + 1]?.['row_type'] === 'CODE3' && orgNow === '') { orgNow = m[2]; return; }
      (detailKou.get(slug) ?? detailKou.set(slug, []).get(slug)!).push({ code: m[1], name: m[2], org: orgNow, pg: Number(r['source_page']) });
    });
    for (const r of rowsOf) {
      const lab = ns(r['頁'] ?? ''); const pg = Number(r['source_page']); if (!lab || !pg) continue;
      if (!lm.has(lab)) lm.set(lab, pg);
      for (const d of lab.match(/\d+/g) ?? []) (dm.get(d) ?? dm.set(d, new Set()).get(d)!).add(pg);
    }
    labelPage.set(slug, lm); digitPage.set(slug, dm);
  }
  // 繰入: 項の下の目の名前に「繰入」を含むもの（例: `交付税及び譲与税配付金特別会計へ繰入`）の繰入先。明細表の CODE3（項）の行に続く CODE_ 行（目）から引く。
  // 同じ要求書の中で項コードと項名が同じ項が複数あれば、まとめて扱う
  const xfers = new Map<string, Map<string, Set<string>>>();
  if (fs.existsSync(detailDir)) for (const f of fs.readdirSync(detailDir).filter(x => x.endsWith('.csv'))) {
    const slug = f.slice(0, -4); const m = new Map<string, Set<string>>(); let cur = '';
    for (const r of rd(path.join(detailDir, f))) {
      const t = r['row_type'], nm = ns(r['事項'] ?? '');
      if (t === 'CODE3') { const k = /^(\d+)(.*)$/.exec(nm); cur = k ? `${k[1]}\t${k[2]}` : ''; }
      else if (cur && t.startsWith('CODE_') && nm.includes('繰入')) (m.get(cur) ?? m.set(cur, new Set()).get(cur)!).add(nm.replace(/^[\d\-‑]+/u, ''));
    }
    xfers.set(slug, m);
  }
  const xferOf = (src: string, code: string, name: string): string[] => [...(xfers.get(src)?.get(`${code}\t${ns(name)}`) ?? [])];
  // 分冊の書（文科省など。表紙・目次・総表だけの PDF と、明細表を持つ複数の PDF に分かれる）は、目次の頁を、同じ書の分冊の頁ラベルから探す。
  // 書の同定は slug から日付と末尾の連番を除いたもの。分冊のうちちょうど 1 つの PDF の 1 頁に当たるときだけ採る
  const bookOf = (slug: string): string => slug.replace(/\d{8}[-_]/, '').replace(/_+\d+$/, '');
  const slugsOfBook = new Map<string, string[]>(); for (const slug of labelPage.keys()) (slugsOfBook.get(bookOf(slug)) ?? slugsOfBook.set(bookOf(slug), []).get(bookOf(slug))!).push(slug);
  // 項コード + 項名で、同じ書（分冊を含む）の明細表の項の行を探し、その行の PDF の頁（source_page）をそのまま使う。複数に当たるときは組織で絞る。
  // 決まらない行は、目次の印字頁を明細表の頁ラベルに引き当てる（上のラベル方式）
  const kouIndex = new Map<string, { slug: string; org: string; pg: number }[]>();
  for (const [slug, list] of detailKou) for (const k of list) { const key = `${bookOf(slug)}\t${k.code}\t${k.name}`; (kouIndex.get(key) ?? kouIndex.set(key, []).get(key)!).push({ slug, org: k.org, pg: k.pg }); }
  // 文字層のない頁（画像の頁。plain text で空の頁）。明細表の行が取り込めず、項の見出しも引けない
  const textless = new Map<string, Set<number>>();
  const textlessPages = (slug: string): Set<number> => {
    let set = textless.get(slug); if (set) return set;
    set = new Set<number>(); const file = path.join('data', 'work', 'budget-request-plain-text', String(year), `${slug}.txt`);
    if (fs.existsSync(file)) { const t = fs.readFileSync(file, 'utf8').split('\f'); if (t[t.length - 1] === '') t.pop(); t.forEach((x, i) => { if (!x.trim()) set!.add(i + 1); }); }
    textless.set(slug, set); return set;
  };
  type Located = { slug: string; pdfPage: string; basis: '項' | '頁ラベル' | '推定'; image: boolean };
  // 引けない行は、同じ PDF の印字頁と PDF の頁の差から推定する（前後の頁ラベルで差が同じとき。例: 目次の頁 764 は、763 → 767、765 → 769 の差 4 から 768）
  const estimate = (src: string, page: string): Located | null => {
    if (!/^\d+$/.test(page)) return null; const n = Number(page);
    const pairs: [number, number][] = [];
    for (const [lab, pg] of labelPage.get(src) ?? []) { const m = lab.match(/\d+/g); if (m && m.length === 1) pairs.push([Number(m[0]), pg]); }
    const lo = pairs.filter(x => x[0] < n).sort((x, y) => y[0] - x[0])[0], hi = pairs.filter(x => x[0] > n).sort((x, y) => x[0] - y[0])[0];
    if (!lo || !hi || lo[1] - lo[0] !== hi[1] - hi[0] || n - lo[0] > 8 || hi[0] - n > 8) return null;
    const pg = n + (lo[1] - lo[0]);
    return { slug: src, pdfPage: String(pg), basis: '推定', image: textlessPages(src).has(pg) };
  };
  const locate = (r: Rec, org: string): Located | null => {
    const src = r['request_source'], page = r['request_page'];
    const cands = kouIndex.get(`${bookOf(src)}\t${r['request_code3']}\t${ns(r['request_name'])}`) ?? [];
    const pick = cands.length === 1 ? cands : cands.filter(c => org && c.org === ns(org));
    if (pick.length === 1) return { slug: pick[0].slug, pdfPage: String(pick[0].pg), basis: '項', image: false };
    const find = (slug: string): number[] => {
      const hit = labelPage.get(slug)?.get(ns(page)); if (hit) return [hit];
      const set = /^\d+$/.test(page) ? digitPage.get(slug)?.get(page) : undefined;
      return set ? [...set] : [];
    };
    const own = find(src); if (own.length === 1) return { slug: src, pdfPage: String(own[0]), basis: '頁ラベル', image: false };
    if (own.length > 1) return null;
    const hits = (slugsOfBook.get(bookOf(src)) ?? []).filter(x => x !== src).flatMap(x => find(x).map(pg => ({ slug: x, pdfPage: String(pg), basis: '頁ラベル' as const, image: false })));
    return hits.length === 1 ? hits[0] : estimate(src, page);
  };
  const pdfOf = (r: Rec, org: string): Located | null => locate(r, org);
  const recs: Row[] = kou.map(r => {
    const cv = cover.get(r['request_source']); let org = r['org']; let orgSrc = org ? (r['hierarchy'] === 'toc' ? '目次' : '総表') : '';
    if (!org && r['acct'] === 'general') { if (cv?.org) { org = cv.org; orgSrc = '表紙括弧'; } else orgSrc = 'なし'; }
    return { r, code: cv?.code ?? '', org, orgSrc, key: [r['acct'], scopeOf(r), r['account'], r['sub'], org, r['request_name']].join('\t') };
  });
  // 組織が引けなかった特別会計の行（目次の無い抜粋版など）は、同じ年度・所管コード・特別会計・勘定・項名で他の書が示す組織が 1 つに決まるときに、それで補う
  const orgsOfItem = new Map<string, Set<string>>(); const itemKey = (x: Row): string => [x.r['acct'], scopeOf(x.r), x.r['account'], x.r['sub'], x.r['request_name']].join('\t');
  for (const x of recs) if (x.r['acct'] === 'special' && x.org) (orgsOfItem.get(itemKey(x)) ?? orgsOfItem.set(itemKey(x), new Set()).get(itemKey(x))!).add(x.org);
  for (const x of recs) {
    if (x.r['acct'] !== 'special' || x.org) continue;
    const set = orgsOfItem.get(itemKey(x)); if (!set || set.size !== 1) continue;
    x.org = [...set][0]; x.orgSrc = '他の書'; x.key = [x.r['acct'], scopeOf(x.r), x.r['account'], x.r['sub'], x.org, x.r['request_name']].join('\t');
  }
  stages.push({ year, ver, kou, status, recs, urlOf, pdfOf, xferOf });
}
// 同じ要求書の中で、同名の別の項（項コードが違う）が同じキーになるもの（例: 厚生労働調査研究等推進費 087 / 405）は、項コードをキーに足して別の行にする。
// どの年度かで衝突したキーは全年度で足す（年度をまたぐ紐づけを保つため）
const codesIn = new Map<string, Set<string>>();
for (const { year, recs } of stages) for (const x of recs) { const k = `${year}\t${x.r['request_source']}\t${x.key}`; (codesIn.get(k) ?? codesIn.set(k, new Set()).get(k)!).add(x.r['request_code3']); }
const splitKeys = new Set<string>();
for (const { year, recs } of stages) for (const x of recs) if (codesIn.get(`${year}\t${x.r['request_source']}\t${x.key}`)!.size > 1) splitKeys.add(x.key);
for (const { recs } of stages) for (const x of recs) if (splitKeys.has(x.key)) x.key += `\t${x.r['request_code3']}`;
for (const { year, ver, kou, status, recs, urlOf, pdfOf, xferOf } of stages) {
  const group = new Map<string, Row[]>(); for (const x of recs) (group.get(x.key) ?? group.set(x.key, []).get(x.key)!).push(x);
  for (const g of group.values()) {
    // 要求書によって額が違うとき（復興特会は各省の書が自分の取り分だけを載せ、復興庁の書が合計を載せる）は、最も大きい額の行（合計書）を採る。各書の額は srcAmt に残す
    const big = (x: Row): number[] => [Number(x.r['request_amount'] || 0), Number(x.r['previous_amount'] || 0)];
    const x0 = g.reduce((m, x) => { const a = big(x), b = big(m); return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? x : m; }, g[0]); const r0 = x0.r; const acct = r0['acct'] === 'general' ? 0 : 1;
    let u = uiRows.get(x0.key);
    if (!u) { u = { acct, code: x0.code, min: acct === 0 ? r0['ministry'] : r0['account'], sub: r0['sub'], org: x0.org, orgSrc: x0.orgSrc, name: r0['request_name'], ...(splitKeys.has(x0.key.split('\t').slice(0, 6).join('\t')) ? { kou: r0['request_code3'] } : {}), y: {} }; uiRows.set(x0.key, u); }
    const num = (v: string): number | null => (v === '' ? null : Number(v));
    const src: [number, string, string][] = []; const srcAmt: [number | null, number | null][] = [];
    for (const x of g) { const loc = pdfOf(x.r, x.org); const pdfSlug = loc?.slug ?? x.r['request_source']; const url = urlOf.get(pdfSlug); if (!url) throw new Error(`no URL for ${year} ${pdfSlug}`); const e: [number, string, string] = [urlIndex(url), x.r['request_page'], loc?.pdfPage ?? '']; if (!src.some(y => y[0] === e[0] && y[1] === e[1])) { src.push(e); srcAmt.push([num(x.r['previous_amount']), num(x.r['request_amount'])]); } }
    const mismatch = new Set(g.map(y => `${y.r['request_amount']}|${y.r['previous_amount']}`)).size > 1;
    const locs = g.map(x => pdfOf(x.r, x.org));
    const xfer = [...new Set(g.flatMap(x => xferOf(x.r['request_source'], x.r['request_code3'], x.r['request_name'])))].sort();
    u.code = x0.code;
    u.y[String(year)] = { code: x0.code, prev: num(r0['previous_amount']), req: num(r0['request_amount']), src, ...(mismatch ? { srcAmt } : {}), ...(xfer.length > 0 ? { xfer } : {}), ...(locs.some(l => l?.basis === '推定') ? { pdfEst: true } : {}), ...(locs.some(l => l?.image) ? { imagePage: true } : {}), mismatch, mof: ver ? status.get(`${r0['request_source']}#${r0['toc_kou_idx']}`) ?? '' : '' };
  }
  for (const x of recs) {
    const g = group.get(x.key)!; const r = x.r;
    const a = r['request_amount'] === '' ? null : Number(r['request_amount']); const p = r['previous_amount'] === '' ? null : Number(r['previous_amount']);
    const mismatch = new Set(g.map(y => `${y.r['request_amount']}|${y.r['previous_amount']}`)).size > 1;
    rows.push([year, r['acct'] === 'general' ? '一般' : r['acct'] === 'special' ? '特別' : '', x.code, r['ministry'], r['account'], r['sub'], x.org, x.orgSrc, r['request_name'], r['request_code3'], p ?? '', a ?? '', a !== null && p !== null ? a - p : '', r['request_source'], r['request_page'], pdfOf(r, x.org)?.pdfPage ?? '', pdfOf(r, x.org)?.slug ?? r['request_source'], pdfOf(r, x.org)?.basis ?? '', pdfOf(r, x.org)?.image ? 1 : 0, r['hierarchy'], g.length > 1 ? 1 : 0, mismatch ? 1 : 0, xferOf(r['request_source'], r['request_code3'], r['request_name']).join('、'), ver ? status.get(`${r['request_source']}#${r['toc_kou_idx']}`) ?? '' : '']);
  }
  summary[String(year)] = { rows: recs.length, distinct_keys: group.size, duplicated_keys: [...group.values()].filter(g => g.length > 1).length, general_without_org: recs.filter(x => x.r['acct'] === 'general' && !x.org).length, without_amount: kou.filter(r => r['request_amount'] === '').length };
}
fs.mkdirSync(outDir, { recursive: true });
const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'kou.csv'), csv);
// 紐づけ: 前年度に無い項（新規）と、その年度に無い項（消滅）で、次をすべて満たすものを対応づける。
//   会計区分が同じ、項名が同じかほぼ同じ（編集距離 2 以内、6 文字以上。例: 児童手当等交付金 / 児童手当交付金）、
//   新規側の前年度予算額が消滅側の要求額の ±30% 以内（どちらも 0 超）、同名に近い候補が 1 対 1 に決まる。
// そのうち、移管元が特定できるもの（次のどちらか）は 1 つの行につなぐ（`moved`）。それ以外は候補のまま（`from` / `to`）。
//   改称: 所管（特別会計は特別会計名）と勘定が同じで、組織か項名だけが変わった（例: 地方環境事務所 → 地方環境局）
//   移管: 移管先の会計・勘定（特別会計 + 勘定）がその年度に新設された（前年度に無い）。移管元は消滅側の項（例: 年金特会 → 子ども・子育て支援特会）
const editDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const nameNear = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 6 && editDistance(a, b) <= 2);
const placeOf = (r: BudgetRequestTrendRow): string => `${r.acct}\t${r.min}\t${r.sub}`; // 所管（特別会計名）+ 勘定
const describe = (r: BudgetRequestTrendRow): string => [r.min, r.sub, r.org].filter(Boolean).join(' › ') + (r.name ? `「${r.name}」` : '');
let live = [...uiRows.values()];
const placeFirstYear = new Map<string, number>(); // つなぐ前の、特別会計 + 勘定が最初に現れた年度
for (const r of live) for (const y of Object.keys(r.y)) placeFirstYear.set(placeOf(r), Math.min(placeFirstYear.get(placeOf(r)) ?? 9999, Number(y)));
const linkCount = { moved: 0, renamed: 0, candidates: 0 };
const candidatePairs: { g: BudgetRequestTrendRow; n: BudgetRequestTrendRow; a: string; b: string }[] = [];
for (let i = 0; i + 1 < YEARS.length; i++) {
  const a = String(YEARS[i][0]), b = String(YEARS[i + 1][0]);
  const placesA = new Set(live.filter(r => r.y[a]).map(placeOf));
  const gone = live.filter(r => r.y[a] && !r.y[b]);
  const added = live.filter(r => r.y[b] && !r.y[a]);
  const near = (g: BudgetRequestTrendRow, n: BudgetRequestTrendRow): boolean => {
    const req = g.y[a].req, prev = n.y[b].prev;
    return g.acct === n.acct && nameNear(g.name, n.name) && !!req && !!prev && req > 0 && prev > 0 && Math.abs(prev - req) / req <= 0.3;
  };
  const removed = new Set<BudgetRequestTrendRow>();
  for (const g of gone) {
    const ns_ = added.filter(n => near(g, n));
    if (ns_.length !== 1 || gone.filter(g2 => near(g2, ns_[0])).length !== 1) continue;
    const n = ns_[0];
    const kind = placeOf(g) === placeOf(n) ? '改称' : !placesA.has(placeOf(n)) ? '移管' : null;
    if (!kind || Object.keys(g.y).some(y => y in n.y)) { candidatePairs.push({ g, n, a, b }); continue; }
    n.y = { ...g.y, ...n.y }; n.y[b].moved = { kind, from: describe(g) }; removed.add(g);
    linkCount[kind === '移管' ? 'moved' : 'renamed']++;
  }
  live = live.filter(r => !removed.has(r));
}
// データの状態: 所管コードの変更（前の年度から）、会計・勘定の新設（前年度にその特別会計 + 勘定が無い）
for (const r of live) {
  let prevCode = '';
  for (const [y] of YEARS.slice().map(([v]) => [String(v)] as [string])) {
    const e = r.y[y]; if (!e) continue;
    if (prevCode && e.code && e.code !== prevCode && !e.moved) e.codeChanged = true;
    if (e.code) prevCode = e.code;
    if (r.acct === 1 && placeFirstYear.get(placeOf(r)) === Number(y) && Number(y) > YEARS[0][0]) e.newAcct = true;
  }
}
const uiList = live;
const indexOf = new Map(uiList.map((r, i) => [r, i]));
for (const { g, n, a, b } of candidatePairs) { if (indexOf.has(g) && indexOf.has(n)) { g.y[a].to = indexOf.get(n); n.y[b].from = indexOf.get(g); linkCount.candidates++; } }
summary['links'] = linkCount;
const ui: BudgetRequestTrendData = { years: YEARS.map(([y]) => y), urls: uiUrls, rows: uiList };
const uiDir = path.join('public', 'data', 'v2', 'ui', 'budget-request-trend');
fs.mkdirSync(uiDir, { recursive: true });
fs.writeFileSync(path.join(uiDir, 'kou.json.gz'), zlib.gzipSync(JSON.stringify(ui), { level: 9, mtime: 0 } as zlib.ZlibOptions));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(csv).digest('hex'), years: summary }, null, 1) + '\n');
console.log(JSON.stringify(summary));
