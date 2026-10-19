/**
 * 概算要求の年度推移 CSV（項の粒度）。仕様: docs/budget-request-trend-csv.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-trend-csv.ts [out-dir]
 *   入力: tests/fixtures/mof-budget-request-match/{ver}/request-kou.csv（概算要求の木だけから決めた項の所属・金額）、同 m1-kou.csv（MOF 突合の状態。参考）、
 *         tests/fixtures/budget-request-csv/{year}/cover/sources/*.csv（表紙の所管コード）
 *   出力: <out-dir>/kou.csv summary.json（既定 tests/fixtures/budget-request-trend）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ns, readCsv, type Rec } from './lib/mof-budget-request-match';

// 概算要求の年度 → MOF の版（MOF の版が無い年度は null。突合の状態は空にする）
const YEARS: [number, string | null][] = [[2023, '2023'], [2024, '2024'], [2025, '2025'], [2026, '2026'], [2027, null]];
const outDir = process.argv[2] ?? path.join('tests', 'fixtures', 'budget-request-trend');
const MATCH = path.join('tests', 'fixtures', 'mof-budget-request-match');
const rd = (p: string): Rec[] => readCsv(fs.readFileSync(p, 'utf8'));
const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const header = ['年度', '会計区分', '所管コード', '所管', '特別会計', '勘定', '組織', '組織の出所', '項名', '項コード', '前年度予算額_千円', '要求額_千円', '増減_千円', '要求書', '頁', '階層', '共管重複', '金額不一致', 'MOF突合(参考)'];
const rows: unknown[][] = [];
const summary: Record<string, unknown> = {};
for (const [year, ver] of YEARS) {
  const dir = path.join(MATCH, ver ?? String(year));
  const kou = rd(path.join(dir, 'request-kou.csv'));
  const status = new Map<string, string>();
  if (ver) for (const r of rd(path.join(dir, 'm1-kou.csv'))) status.set(`${r['request_source']}#${r['toc_kou_idx']}`, r['status']);
  // 表紙の見出し（所管コードと、括弧内の組織）。source ごとに 1 つ
  const cover = new Map<string, { code: string; org: string }>();
  const coverDir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'cover', 'sources');
  for (const f of fs.readdirSync(coverDir).filter(x => x.endsWith('.csv')).sort()) {
    const h = rd(path.join(coverDir, f)).find(r => r['kind'] === 'HEADER'); if (!h) continue;
    cover.set(f.slice(0, -4), { code: h['code'], org: /[（(](.*)[）)]$/.exec(ns(h['name']))?.[1] ?? '' });
  }
  type Row = { r: Rec; code: string; org: string; orgSrc: string; key: string };
  const recs: Row[] = kou.map(r => {
    const cv = cover.get(r['request_source']); let org = r['org']; let orgSrc = org ? (r['hierarchy'] === 'toc' ? '目次' : '総表') : '';
    if (!org && r['acct'] === 'general') { if (cv?.org) { org = cv.org; orgSrc = '表紙括弧'; } else orgSrc = 'なし'; }
    return { r, code: cv?.code ?? '', org, orgSrc, key: [r['acct'], cv?.code ?? '', r['account'], r['sub'], org, r['request_name']].join('\t') };
  });
  const group = new Map<string, Row[]>(); for (const x of recs) (group.get(x.key) ?? group.set(x.key, []).get(x.key)!).push(x);
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
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(csv).digest('hex'), years: summary }, null, 1) + '\n');
console.log(JSON.stringify(summary));
