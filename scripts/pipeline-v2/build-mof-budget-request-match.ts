/**
 * MOF（項・事項・目）× 概算要求（TOC・総表・明細表）の突合 M0〜M3。契約: docs/tasks/*_MOF_x_BudgetRequest_Matching_Contract.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-budget-request-match.ts <2024|2025> <mof-version> <out-dir>
 *   mof-version = 2024 | 2025 | 2025_teishutsu（概算要求の年度と対にする MOF の版）
 * 出力: <out-dir>/m0-entities.csv m1-kou.csv m2-jikou.csv m3-moku.csv unmatched-mof-{kou,jikou,moku}.csv summary.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { amount, buildPositionTree, buildPositionTreeFromDetail, buildTocTree, hy, mofAmountJikou, mofAmountKou, mofAmountMoku, ns, readCsv, type Rec, type TocTree } from './lib/mof-budget-request-match';

const [yearArg, ver, outDir] = process.argv.slice(2);
if (!/^20(24|25)$/.test(yearArg ?? '') || !['2024', '2025', '2025_teishutsu'].includes(ver ?? '') || !outDir) throw new Error('usage: build-mof-budget-request-match.ts <2024|2025> <2024|2025|2025_teishutsu> <out-dir>');
const REQ = path.join('tests', 'fixtures', 'budget-request-csv', yearArg);
const MOF = path.join('tests', 'fixtures', 'mof-archive-csv', ver);
fs.mkdirSync(outDir, { recursive: true });
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (name: string, header: string[], rows: unknown[][]) => fs.writeFileSync(path.join(outDir, name), [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n');
const rd = (p: string) => readCsv(fs.readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- 入力
const inputHashes: string[] = [];
const bySource = (kind: string): Map<string, Rec[]> => {
  const dir = path.join(REQ, kind, 'sources'); const m = new Map<string, Rec[]>();
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.csv')).sort()) { const b = fs.readFileSync(path.join(dir, f)); inputHashes.push(`${kind}/${f}\t${sha(b)}`); m.set(f.slice(0, -4), readCsv(b.toString('utf8'))); }
  return m;
};
const toc = bySource('toc'), detail = bySource('detail-table'), total = bySource('total-table');
const mofFiles = ['kou-general', 'kou-special', 'jikou-general', 'jikou-special', 'moku-general', 'moku-special'];
const mofRaw: Record<string, Rec[]> = {};
for (const f of mofFiles) { const p = path.join(MOF, `${f}.csv`); inputHashes.push(`mof/${f}.csv\t${sha(fs.readFileSync(p))}`); mofRaw[f] = rd(p); }
type Acct = 'general' | 'special';
const id = (table: string, i: number) => `${table}:${i + 1}`;

// MOF の索引。kou の行から jikou／moku の索引キーを作る
const kjKey = (r: Rec, a: Acct): string => (a === 'general' ? [ns(r['所管']), ns(r['組織']), r['項コード'], ns(r['項名'])] : [ns(r['特別会計']), ns(r['勘定']), r['項コード'], ns(r['項名'])]).join('|');
const mofIdx = (table: string, a: Acct) => { const m = new Map<string, number[]>(); mofRaw[`${table}-${a}`].forEach((r, i) => { const k = kjKey(r, a); (m.get(k) ?? m.set(k, []).get(k)!).push(i); }); return m; };
const jikouIdx = { general: mofIdx('jikou', 'general'), special: mofIdx('jikou', 'special') };
const mokuIdx = { general: mofIdx('moku', 'general'), special: mofIdx('moku', 'special') };
const kouByName = (a: Acct) => { const m = new Map<string, number[]>(); mofRaw[`kou-${a}`].forEach((r, i) => { const k = a === 'general' ? [ns(r['所管']), ns(r['組織']), ns(r['項名'])].join('|') : [ns(r['特別会計']), ns(r['勘定']), ns(r['項名'])].join('|'); (m.get(k) ?? m.set(k, []).get(k)!).push(i); }); return m; };
const kouIdx = { general: kouByName('general'), special: kouByName('special') };
const kouByMinName = new Map<string, number[]>(); mofRaw['kou-general'].forEach((r, i) => { const k = `${ns(r['所管'])}|${ns(r['項名'])}`; (kouByMinName.get(k) ?? kouByMinName.set(k, []).get(k)!).push(i); });
const ministries = new Set(mofRaw['kou-general'].map(r => ns(r['所管'])));
const orgsOf = new Map<string, Set<string>>(); for (const r of mofRaw['kou-general']) (orgsOf.get(ns(r['所管'])) ?? orgsOf.set(ns(r['所管']), new Set()).get(ns(r['所管']))!).add(ns(r['組織']));
const accounts = new Set(mofRaw['kou-special'].map(r => ns(r['特別会計'])));
const subsOf = new Map<string, Set<string>>(); for (const r of mofRaw['kou-special']) (subsOf.get(ns(r['特別会計'])) ?? subsOf.set(ns(r['特別会計']), new Set()).get(ns(r['特別会計']))!).add(ns(r['勘定']));

// ---------------------------------------------------------------- 概算要求の木と文脈
const trees = new Map<string, TocTree>(); for (const [s, rows] of toc) trees.set(s, buildTocTree(s, rows));
// 追補 A (a): 文書セット。TOC を持たない source S を、同じファミリーの TOC の source T に付ける（S の CODE3 が T の項と一致し、T がちょうど 1 つのとき）
const famOf = (s: string) => s.replace(/[_-]?\d+$/, '');
const code3Keys = (rows: Rec[], col: string): string[] => rows.filter(r => r['row_type'] === 'CODE3').map(r => { const m = /^(\d{3})\s*(.+)$/.exec(r[col]); return m ? `${m[1]}|${ns(m[2])}` : ''; }).filter(Boolean);
const attach = new Map<string, string>(); const setRows: unknown[][] = [];
const attachRound = (candidates: Set<string>) => {
  const tocKeys = new Map<string, Set<string>>(); for (const t of trees.values()) if (candidates.has(t.slug)) tocKeys.set(t.slug, new Set(t.kous.map(k => `${k.code}|${k.name}`)));
  for (const s of [...new Set([...detail.keys(), ...total.keys()])].sort()) {
    if (trees.has(s) || attach.has(s)) continue;
    const keys = new Set([...code3Keys(detail.get(s) ?? [], '事項'), ...code3Keys(total.get(s) ?? [], '区分')]);
    const cands = [...tocKeys].filter(([t, ks]) => famOf(t) === famOf(s) && [...keys].some(k => ks.has(k)));
    if (cands.length === 1) { attach.set(s, cands[0][0]); setRows.push([cands[0][0], s, [...keys].filter(k => cands[0][1].has(k)).length]); }
  }
};
attachRound(new Set(trees.keys())); // 追補 A (a): TOC の source に付ける
// 追補 D: TOC にも付かなかった source のうち総表を持つものは、総表の行の並びから木を作り、明細表だけの source をその木に付ける
const tocTreeSlugs = new Set(trees.keys());
for (const [s, rows] of total) if (!trees.has(s) && !attach.has(s)) { const t = buildPositionTree(s, rows, n => accounts.has(n)); if (t.kous.length > 0) trees.set(s, t); }
attachRound(new Set([...trees.keys()].filter(x => !tocTreeSlugs.has(x))));
// 追補 E: それでも木に付かなかった明細表だけの source は、自分の明細表の行の並びから木を作る
for (const [s, rows] of detail) if (!trees.has(s) && !attach.has(s)) { const t = buildPositionTreeFromDetail(s, rows, n => accounts.has(n)); if (t.kous.length > 0) trees.set(s, t); }
const suffixNo = (s: string) => Number(/(\d+)$/.exec(s)?.[1] ?? 0);
const extrasOf = (t: string) => [...attach].filter(([, to]) => to === t).map(([x]) => x).sort((a, b) => suffixNo(a) - suffixNo(b) || (a < b ? -1 : 1));
const concatV = (m: Map<string, Rec[]>) => { const v = new Map<string, Rec[]>(); for (const t of trees.keys()) { const rows = [...(m.get(t) ?? []), ...extrasOf(t).flatMap(x => m.get(x) ?? [])]; if (rows.length) v.set(t, rows); } for (const [s, rows] of m) if (!trees.has(s) && !attach.has(s)) v.set(s, rows); return v; };
const detailV = concatV(detail), totalV = concatV(total);
const ctxOf = new Map<string, { acct: Acct; key: string; raw: string }>();
for (const [s, rows] of detailV) {
  const r = rows.find(x => x['row_type'] === 'CONTEXT'); if (!r) continue;
  const m = /^(\d+)\s*(.+)$/.exec(r['事項']); if (!m) continue;
  const name = ns(m[2]); const acct: Acct = m[1].length === 2 ? 'general' : 'special';
  ctxOf.set(s, { acct, key: acct === 'general' ? name.split('所管')[0] : name.replace(/特別会計.*$/, ''), raw: r['事項'] });
}
for (const t of trees.values()) if (t.hierarchy === 'position' && !ctxOf.has(t.slug)) {
  const others = new Set<string>();
  for (const [x, rows] of detail) if (x !== t.slug && famOf(x) === famOf(t.slug)) { const r = rows.find(y => y['row_type'] === 'CONTEXT'); const m = r ? /^(\d+)\s*(.+)$/.exec(r['事項']) : null; if (m) { const nm = ns(m[2]); const acct: Acct = m[1].length === 2 ? 'general' : 'special'; others.add(JSON.stringify([acct, acct === 'general' ? nm.split('所管')[0] : nm.replace(/特別会計.*$/, '')])); } }
  if (others.size === 1) { const [acct, key] = JSON.parse([...others][0]) as [Acct, string]; ctxOf.set(t.slug, { acct, key, raw: '(family)' }); }
}
const sources = [...new Set([...trees.keys(), ...detailV.keys(), ...totalV.keys()])].sort();

// ---------------------------------------------------------------- M0
const m0: unknown[][] = [];
type Scope = { ok: boolean; reason: string; acct?: Acct; ministry?: string; org?: string; account?: string; sub?: string };
const scopeOfKou = new Map<string, Scope>(); // `${slug}#${idx}`
for (const s of sources) {
  const c = ctxOf.get(s); const t = trees.get(s);
  if (!c) { m0.push([s, 'context', '', '', '', 'OUT_OF_SCOPE', 'no_context']); }
  else {
    const mapped = c.acct === 'general' ? ministries.has(c.key) : accounts.has(c.key);
    m0.push([s, 'context', c.raw, c.key, mapped ? c.key : '', mapped ? 'MATCHED' : 'NO_CANDIDATE', c.acct]);
  }
  if (!t) continue;
  let ministry = c && c.acct === 'general' ? c.key : null, account: string | null = null, sub: string | null = null, org: string | null = null;
  const minOk = () => ministry !== null && ministries.has(ministry);
  for (const l of t.labels) {
    let st = 'MATCHED', reason = '';
    if (!c) { st = 'OUT_OF_SCOPE'; reason = 'no_context'; }
    if (l.kind === '所管') { ministry = l.name; account = sub = org = null; if (c && c.acct === 'general') { if (!ministries.has(l.name)) { st = 'NO_CANDIDATE'; } } else if (c) { st = 'OUT_OF_SCOPE'; reason = 'special_source_has_ministry_label'; } }
    else if (l.kind === '会計') { account = l.name; sub = org = null; if (c && c.acct === 'special') { if (!accounts.has(l.name)) st = 'NO_CANDIDATE'; } else if (c) { st = 'OUT_OF_SCOPE'; reason = 'general_source_has_account_label'; } }
    else if (l.kind === '勘定') { sub = l.name; org = null; if (c && c.acct === 'special') { if (account === null || !accounts.has(account)) { st = 'PARENT_UNMATCHED'; } else if (!subsOf.get(account)?.has(l.name)) st = 'NO_CANDIDATE'; } else if (c) { st = 'OUT_OF_SCOPE'; reason = 'general_source_has_sub_label'; } }
    else if (l.kind === '組織') { org = l.name; if (c && c.acct === 'general') { if (!minOk()) st = 'PARENT_UNMATCHED'; else if (!orgsOf.get(ministry!)?.has(l.name)) st = 'NO_CANDIDATE'; } else if (c) { st = 'OUT_OF_SCOPE'; reason = 'special_source_has_org_label'; } }
    if (l.kind !== '項') m0.push([s, `toc:${l.kind}`, `${l.code} ${l.name}`, l.name, st === 'MATCHED' ? l.name : '', st, reason]);
  }
  void org; void account; void sub;
  for (const k of t.kous) {
    if (!c) { scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: 'no_context' }); continue; }
    if (c.acct === 'general') {
      const min = k.ministry ?? c.key; const org2 = k.org;
      if (t.hierarchy !== 'toc') { if (!ministries.has(min)) scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: 'ministry_unmatched' }); else scopeOfKou.set(`${s}#${k.idx}`, { ok: true, reason: '', acct: 'general', ministry: min }); }
      else if (!ministries.has(min)) scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: 'ministry_unmatched' });
      else if (org2 === null || !orgsOf.get(min)?.has(org2)) scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: org2 === null ? 'no_org_label' : 'org_unmatched' });
      else scopeOfKou.set(`${s}#${k.idx}`, { ok: true, reason: '', acct: 'general', ministry: min, org: org2 });
    } else {
      const acc = k.account ?? c.key; const sb = k.sub ?? '';
      if (!accounts.has(acc)) scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: 'account_unmatched' });
      else if (!subsOf.get(acc)?.has(sb)) scopeOfKou.set(`${s}#${k.idx}`, { ok: false, reason: 'sub_unmatched' });
      else scopeOfKou.set(`${s}#${k.idx}`, { ok: true, reason: '', acct: 'special', account: acc, sub: sb });
    }
  }
}

// ---------------------------------------------------------------- 総表・明細表の線形な突き合わせ（診断と目の所属）
function seqLink<T, U>(items: T[], rows: U[], same: (a: T, b: U) => boolean): (U | null)[] {
  let p = 0; const out: (U | null)[] = [];
  for (const it of items) { let found = -1; for (let j = p; j < rows.length; j++) if (same(it, rows[j])) { found = j; break; } if (found >= 0) { out.push(rows[found]); p = found + 1; } else out.push(null); }
  return out;
}
const totAmt = (r: Rec) => amount(r[Object.keys(r).find(k => /概算要求額_計$/.test(k)) ?? '']);
const detAmt = (r: Rec) => amount(r[Object.keys(r).find(k => /概算要求額$/.test(k)) ?? '']);

const scopeText = (key: string): string => { const c = scopeOfKou.get(key); return c && c.ok ? (c.acct === 'general' ? `${c.ministry}|${c.org ?? ""}` : `${c.account}|${c.sub}`) : ''; };

// ---------------------------------------------------------------- M1
type Cand = number[];
const m1: unknown[][] = []; const m1Match = new Map<string, number>(); // `${slug}#${kouIdx}` → MOF kou 行（MATCHED のみ）
const refKou = new Set<string>();
const linkStats = { kou_total_table_linked: 0, kou_total: 0, jikou_total_table_linked: 0, jikou_detail_linked: 0, jikou_total: 0 };
const kouAcct = new Map<string, Acct>();
for (const s of sources) {
  const t = trees.get(s); if (!t) continue;
  const tcode3 = (totalV.get(s) ?? []).filter(r => r['row_type'] === 'CODE3').map(r => { const m = /^(\d{3})\s*(.+)$/.exec(r['区分']); return { code: m?.[1] ?? '', name: ns(m?.[2]), amt: totAmt(r) }; });
  const links = seqLink(t.kous, tcode3, (k, r) => k.code === r.code && k.name === r.name);
  t.kous.forEach((k, i) => {
    const sc = scopeOfKou.get(`${s}#${k.idx}`)!; linkStats.kou_total++; if (links[i]) linkStats.kou_total_table_linked++;
    const reqAmt = links[i]?.amt ?? '';
    const head = [s, k.idx, k.code, k.name, k.page];
    if (!sc.ok) { m1.push([...head, '', '', 0, sc.reason === 'no_context' ? 'OUT_OF_SCOPE' : 'PARENT_UNMATCHED', sc.reason, reqAmt, '', '', '']); return; }
    const a = sc.acct!; kouAcct.set(`${s}#${k.idx}`, a);
    const c: Cand = a === 'general' && sc.org === undefined ? (kouByMinName.get(`${sc.ministry}|${k.name}`) ?? []) : (kouIdx[a].get(a === 'general' ? [sc.ministry, sc.org, k.name].join('|') : [sc.account, sc.sub, k.name].join('|')) ?? []);
    const st = c.length === 0 ? 'NO_CANDIDATE' : c.length === 1 ? 'MATCHED' : 'AMBIGUOUS';
    if (c.length === 1) m1Match.set(`${s}#${k.idx}`, c[0]);
    if (c.length === 0) m1.push([...head, '', '', 0, st, 'name_no_match', reqAmt, '', '', scopeText(`${s}#${k.idx}`)]);
    for (const ci of c) {
      const r = mofRaw[`kou-${a}`][ci]; refKou.add(id(`kou-${a}`, ci));
      const ma = mofAmountKou(r);
      m1.push([...head, id(`kou-${a}`, ci), r['項名'], c.length, st, '', reqAmt, ma ?? '', typeof reqAmt === 'number' && ma !== null ? reqAmt - ma : '', scopeText(`${s}#${k.idx}`)]);
    }
  });
}
writeCsv('m1-kou.csv', ['request_source', 'toc_kou_idx', 'request_code3', 'request_name', 'request_page', 'mof_row', 'mof_name', 'candidate_count', 'status', 'reason', 'request_amount', 'mof_amount', 'amount_diff', 'request_scope', 'hierarchy'], m1.map(r => [...r, trees.get(String(r[0]))?.hierarchy ?? '']));

// ---------------------------------------------------------------- M2
const m2: unknown[][] = []; const refJikou = new Set<string>();
for (const s of sources) {
  const t = trees.get(s); if (!t) continue;
  const tdet = (totalV.get(s) ?? []).filter(r => r['row_type'] === 'DETAIL').map(r => { const m = /^(\d{2})[‐-―−－-](\d{2})\s*(.+)$/.exec(r['区分']); return { req: r['要求番号'], f: m?.[1], c: m?.[2], name: ns(m?.[3]), amt: totAmt(r) }; });
  const ddet = (detailV.get(s) ?? []).filter(r => r['row_type'] === 'DETAIL').map(r => { const m = /^(\d{2})[‐-―−－-](\d{2})\s*(.+)$/.exec(r['事項']); return { req: r['要求番号'], f: m?.[1], c: m?.[2], name: ns(m?.[3]) }; });
  const same = (j: { reqNo: string; first: string; class2: string; name: string }, r: { req: string; f?: string; c?: string; name: string }) => j.reqNo === r.req && j.first === r.f && j.class2 === r.c && j.name === r.name;
  const lt = seqLink(t.jikous, tdet, same), ld = seqLink(t.jikous, ddet, same);
  t.jikous.forEach((j, i) => {
    linkStats.jikou_total++; if (lt[i]) linkStats.jikou_total_table_linked++; if (ld[i]) linkStats.jikou_detail_linked++;
    const reqAmt = lt[i]?.amt ?? '';
    const head = [s, j.reqNo, `${j.first}-${j.class2}`, j.name, j.page, j.kouIdx ?? ''];
    const sc = j.kouIdx === null ? null : scopeOfKou.get(`${s}#${j.kouIdx}`);
    if (j.kouIdx === null || !sc) { m2.push([...head, '', '', 0, 'OUT_OF_SCOPE', 'no_kou_heading', '', reqAmt, '', '', '']); return; }
    const mk = m1Match.get(`${s}#${j.kouIdx}`);
    if (mk === undefined) { m2.push([...head, '', '', 0, sc.reason === 'no_context' ? 'OUT_OF_SCOPE' : 'PARENT_UNMATCHED', sc.ok ? 'kou_not_matched_uniquely' : sc.reason, '', reqAmt, '', '', scopeText(`${s}#${j.kouIdx}`)]); return; }
    const a = kouAcct.get(`${s}#${j.kouIdx}`)!; const kouRow = mofRaw[`kou-${a}`][mk];
    const cands = (jikouIdx[a].get(kjKey(kouRow, a)) ?? []).filter(ci => ns(mofRaw[`jikou-${a}`][ci][a === 'general' ? '事項名' : '事項名']) === j.name);
    const st = cands.length === 0 ? 'NO_CANDIDATE' : cands.length === 1 ? 'MATCHED' : 'AMBIGUOUS';
    if (!cands.length) m2.push([...head, id(`kou-${a}`, mk), '', 0, st, 'name_no_match', '', reqAmt, '', '', scopeText(`${s}#${j.kouIdx}`)]);
    for (const ci of cands) {
      const r = mofRaw[`jikou-${a}`][ci]; refJikou.add(id(`jikou-${a}`, ci));
      const cc = r[a === 'general' ? '主要経費別分類コード' : '分類コード']; const ma = mofAmountJikou(r);
      m2.push([...head, id(`kou-${a}`, mk), id(`jikou-${a}`, ci), cands.length, st, '', cc === j.class2, reqAmt, ma ?? '', typeof reqAmt === 'number' && ma !== null ? reqAmt - ma : '', scopeText(`${s}#${j.kouIdx}`)]);
    }
  });
}
writeCsv('m2-jikou.csv', ['request_source', 'request_no', 'request_code', 'request_name', 'request_page', 'toc_kou_idx', 'mof_kou_row', 'mof_jikou_row', 'candidate_count', 'status', 'reason', 'class_code_agrees', 'request_amount', 'mof_amount', 'amount_diff', 'request_scope', 'hierarchy'], m2.map(r => [...r, trees.get(String(r[0]))?.hierarchy ?? '']));

// ---------------------------------------------------------------- M3
const m3: unknown[][] = []; const refMoku = new Set<string>();
let orphanMoku = 0;
for (const s of sources) {
  const t = trees.get(s); if (!t) continue;
  const rows = detailV.get(s) ?? [];
  const bound = t.kous.map(k => `${k.code}|${k.name}`);
  let p = 0, cur: number | null = null;
  const groups = new Map<string, { kou: number; c1: string; x: string; yy: string; name: string; n: number; sum: number; nulls: number }>();
  for (const r of rows) {
    if (r['row_type'] === 'CODE3') {
      const m = /^(\d{3})\s*(.+)$/.exec(r['事項']); if (!m) continue;
      const key = `${m[1]}|${ns(m[2])}`; let f = -1;
      for (let j = p; j < bound.length; j++) if (bound[j] === key) { f = j; break; }
      if (f >= 0) { cur = f; p = f + 1; }
    } else if (r['row_type'] === 'CONTEXT') { cur = null; }
    else if (r['row_type'] === 'CODE_5_4_2_4') {
      const m = /^(\d{5})[‐-―−－-]\s*(\d+)[‐-―−－-]\s*(\d+)[‐-―−－-]\s*(\d+)\s*(.+)$/.exec(hy(r['事項']).replace(/-\s+/g, '-'));
      if (!m) continue;
      if (cur === null) { orphanMoku++; continue; }
      const key = [cur, m[1], m[2], m[3], ns(m[5])].join('|'); const g = groups.get(key) ?? { kou: cur, c1: m[1], x: m[2], yy: m[3], name: ns(m[5]), n: 0, sum: 0, nulls: 0 };
      const a = detAmt(r); g.n++; if (a === null) g.nulls++; else g.sum += a; groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    const head = [s, g.kou, g.c1, g.x, g.yy, g.name, g.n, g.sum];
    const sc = scopeOfKou.get(`${s}#${g.kou}`)!; const mk = m1Match.get(`${s}#${g.kou}`);
    if (mk === undefined) { m3.push([...head, '', '', 0, sc.reason === 'no_context' ? 'OUT_OF_SCOPE' : 'PARENT_UNMATCHED', sc.ok ? 'kou_not_matched_uniquely' : sc.reason, '', '']); continue; }
    const a = kouAcct.get(`${s}#${g.kou}`)!; const kouRow = mofRaw[`kou-${a}`][mk];
    const L = g.x.length;
    const cands = (mokuIdx[a].get(kjKey(kouRow, a)) ?? []).filter(ci => {
      const r = mofRaw[`moku-${a}`][ci];
      if (ns(r['目名']) !== g.name || r['主要経費別分類コード'] !== g.c1.slice(0, 2) || r['目的別分類コード'] !== g.c1.slice(2) || r['目別分類コード'] !== g.yy) return false;
      if (L === 1) return r['使途別分類コード'] === g.x;
      if (L === 3) return r['経済性質別分類コード'] + r['使途別分類コード'] === g.x;
      if (L === 4) return a === 'general' && r['財政法公債金対象非対象別分類コード'] + r['経済性質別分類コード'] + r['使途別分類コード'] === g.x;
      return false;
    });
    const st = cands.length === 0 ? 'NO_CANDIDATE' : cands.length === 1 ? 'MATCHED' : 'AMBIGUOUS';
    if (!cands.length) m3.push([...head, id(`kou-${a}`, mk), '', 0, st, L === 1 || L === 3 || L === 4 ? 'name_or_code_no_match' : 'code_form_unknown', '', '']);
    for (const ci of cands) {
      refMoku.add(id(`moku-${a}`, ci)); const ma = mofAmountMoku(mofRaw[`moku-${a}`][ci]);
      m3.push([...head, id(`kou-${a}`, mk), id(`moku-${a}`, ci), cands.length, st, '', ma ?? '', cands.length === 1 && ma !== null ? g.sum - ma : '']);
    }
  }
}
writeCsv('m3-moku.csv', ['request_source', 'toc_kou_idx', 'code_main_purpose', 'code_x', 'code_item', 'request_name', 'request_rows', 'request_sum', 'mof_kou_row', 'mof_moku_row', 'candidate_count', 'status', 'reason', 'mof_amount', 'amount_diff', 'hierarchy'], m3.map(r => [...r, trees.get(String(r[0]))?.hierarchy ?? '']));

// ---------------------------------------------------------------- 出力の残り
writeCsv('m0-entities.csv', ['request_source', 'level', 'request_code_name', 'request_name', 'mof_key', 'status', 'reason'], m0);
// kou_not_matched 判定は kou 行の索引で行う（findIndex は重いので索引化）
const kouKeyIdx = { general: new Map<string, number>(), special: new Map<string, number>() };
for (const a of ['general', 'special'] as Acct[]) mofRaw[`kou-${a}`].forEach((k, i) => { const key = kjKey(k, a); if (!kouKeyIdx[a].has(key)) kouKeyIdx[a].set(key, i); });
const unmatchedFast = (table: 'kou' | 'jikou' | 'moku', refs: Set<string>) => {
  const rows: unknown[][] = []; const counts: Record<string, number> = {};
  for (const a of ['general', 'special'] as Acct[]) mofRaw[`${table}-${a}`].forEach((r, i) => {
    const rid = id(`${table}-${a}`, i); if (refs.has(rid)) return;
    let reason = 'no_request_row';
    if (table !== 'kou') { const kk = kouKeyIdx[a].get(kjKey(r, a)); reason = kk !== undefined && refKou.has(id(`kou-${a}`, kk)) ? 'kou_matched_no_request_row' : 'kou_not_matched'; }
    counts[reason] = (counts[reason] ?? 0) + 1;
    rows.push([rid, a, r['項コード'], r['項名'], table === 'jikou' ? r['事項名'] : table === 'moku' ? r['目名'] : '', reason, r['所管'] ?? '', r['組織'] ?? r['共管組織名'] ?? '', r['特別会計'] ?? '', r['勘定'] ?? '']);
  });
  return { rows, counts };
};
const uk = unmatchedFast('kou', refKou), uj = unmatchedFast('jikou', refJikou), um = unmatchedFast('moku', refMoku);
const uh = ['mof_row', 'account', 'kou_code', 'kou_name', 'item_name', 'reason', 'ministry', 'organization', 'special_account', 'sub_account'];
writeCsv('unmatched-mof-kou.csv', uh, uk.rows); writeCsv('unmatched-mof-jikou.csv', uh, uj.rows); writeCsv('unmatched-mof-moku.csv', uh, um.rows);

const noToc: unknown[][] = [];
for (const s of sources) if (!trees.has(s)) {
  for (const [doc, m, col] of [['total', totalV, '区分'], ['detail', detailV, '事項']] as const) (m.get(s) ?? []).forEach((r, i) => noToc.push([s, doc, r['row_type'], i + 1, r[col], 'OUT_OF_SCOPE', 'no_toc']));
}
writeCsv('request-no-toc.csv', ['request_source', 'doc', 'row_type', 'row_index', 'text', 'status', 'reason'], noToc);
writeCsv('sets.csv', ['toc_source', 'attached_source', 'matched_kou_keys'], setRows);
const tally = (rows: unknown[][], statusIdx: number) => { const c: Record<string, number> = {}; for (const r of rows) c[String(r[statusIdx])] = (c[String(r[statusIdx])] ?? 0) + 1; return c; };
const mofTotals = { kou: mofRaw['kou-general'].length + mofRaw['kou-special'].length, jikou: mofRaw['jikou-general'].length + mofRaw['jikou-special'].length, moku: mofRaw['moku-general'].length + mofRaw['moku-special'].length };
const summary = {
  request_year: yearArg, mof_version: ver, input_sha256: sha(inputHashes.join('\n')), sources: sources.length,
  m0_status: tally(m0, 5), m1_status: tally(m1, 8), m2_status: tally(m2, 9), m3_status: tally(m3, 11),
  mof_rows: mofTotals, mof_rows_referenced: { kou: refKou.size, jikou: refJikou.size, moku: refMoku.size },
  unmatched_mof_reasons: { kou: uk.counts, jikou: uj.counts, moku: um.counts },
  request_links: linkStats, attached_sources: setRows.length, no_toc_rows: noToc.length, no_toc_sources: new Set(noToc.map(r => r[0])).size, request_unclassified_toc_rows: [...trees.values()].reduce((n, t) => n + t.unclassified, 0), request_moku_rows_without_kou: orphanMoku,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
