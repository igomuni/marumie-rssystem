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

const header = ['年度', '会計区分', '所管コード', '所管', '特別会計', '勘定', '組織', '組織の出所', '項名', '項コード', '前年度予算額_千円', '要求額_千円', '増減_千円', '要求書', '頁', '階層', '複数書', '金額不一致', 'MOF突合(参考)'];
const rows: unknown[][] = [];
const uiRows = new Map<string, BudgetRequestTrendRow>(); // キー（年度をまたぐ）→ 行
const uiUrls: string[] = []; const uiUrlIdx = new Map<string, number>();
const urlIndex = (u: string): number => { let i = uiUrlIdx.get(u); if (i === undefined) { i = uiUrls.length; uiUrls.push(u); uiUrlIdx.set(u, i); } return i; };
const summary: Record<string, unknown> = {};
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
  type Row = { r: Rec; code: string; org: string; orgSrc: string; key: string };
  const recs: Row[] = kou.map(r => {
    const cv = cover.get(r['request_source']); let org = r['org']; let orgSrc = org ? (r['hierarchy'] === 'toc' ? '目次' : '総表') : '';
    if (!org && r['acct'] === 'general') { if (cv?.org) { org = cv.org; orgSrc = '表紙括弧'; } else orgSrc = 'なし'; }
    return { r, code: cv?.code ?? '', org, orgSrc, key: [r['acct'], cv?.code ?? '', r['account'], r['sub'], org, r['request_name']].join('\t') };
  });
  const group = new Map<string, Row[]>(); for (const x of recs) (group.get(x.key) ?? group.set(x.key, []).get(x.key)!).push(x);
  for (const g of group.values()) {
    const x0 = g[0]; const r0 = x0.r; const acct = r0['acct'] === 'general' ? 0 : 1;
    let u = uiRows.get(x0.key);
    if (!u) { u = { acct, code: x0.code, min: acct === 0 ? r0['ministry'] : r0['account'], sub: r0['sub'], org: x0.org, orgSrc: x0.orgSrc, name: r0['request_name'], y: {} }; uiRows.set(x0.key, u); }
    const num = (v: string): number | null => (v === '' ? null : Number(v));
    const src: [number, string][] = [];
    for (const x of g) { const url = urlOf.get(x.r['request_source']); if (!url) throw new Error(`no URL for ${year} ${x.r['request_source']}`); const e: [number, string] = [urlIndex(url), x.r['request_page']]; if (!src.some(y => y[0] === e[0] && y[1] === e[1])) src.push(e); }
    u.y[String(year)] = { prev: num(r0['previous_amount']), req: num(r0['request_amount']), src, mismatch: new Set(g.map(y => `${y.r['request_amount']}|${y.r['previous_amount']}`)).size > 1, mof: ver ? status.get(`${r0['request_source']}#${r0['toc_kou_idx']}`) ?? '' : '' };
  }
  for (const x of recs) {
    const g = group.get(x.key)!; const r = x.r;
    const a = r['request_amount'] === '' ? null : Number(r['request_amount']); const p = r['previous_amount'] === '' ? null : Number(r['previous_amount']);
    const mismatch = new Set(g.map(y => `${y.r['request_amount']}|${y.r['previous_amount']}`)).size > 1;
    rows.push([year, r['acct'] === 'general' ? '一般' : r['acct'] === 'special' ? '特別' : '', x.code, r['ministry'], r['account'], r['sub'], x.org, x.orgSrc, r['request_name'], r['request_code3'], p ?? '', a ?? '', a !== null && p !== null ? a - p : '', r['request_source'], r['request_page'], r['hierarchy'], g.length > 1 ? 1 : 0, mismatch ? 1 : 0, ver ? status.get(`${r['request_source']}#${r['toc_kou_idx']}`) ?? '' : '']);
  }
  summary[String(year)] = { rows: recs.length, distinct_keys: group.size, duplicated_keys: [...group.values()].filter(g => g.length > 1).length, general_without_org: recs.filter(x => x.r['acct'] === 'general' && !x.org).length, without_amount: kou.filter(r => r['request_amount'] === '').length };
}
fs.mkdirSync(outDir, { recursive: true });
const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'kou.csv'), csv);
const ui: BudgetRequestTrendData = { years: YEARS.map(([y]) => y), urls: uiUrls, rows: [...uiRows.values()] };
const uiDir = path.join('public', 'data', 'v2', 'ui', 'budget-request-trend');
fs.mkdirSync(uiDir, { recursive: true });
fs.writeFileSync(path.join(uiDir, 'kou.json.gz'), zlib.gzipSync(JSON.stringify(ui), { level: 9, mtime: 0 } as zlib.ZlibOptions));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(csv).digest('hex'), years: summary }, null, 1) + '\n');
console.log(JSON.stringify(summary));
