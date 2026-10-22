/**
 * /budget-request-mof（概算要求と MOF 当初予算の差）用のデータを作る。仕様: docs/budget-request-mof-ui.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-mof-ui.ts   # → public/data/v2/ui/budget-request-mof/{kou,detail}.json.gz、tests/fixtures/budget-request-mof/summary.json
 * 入力: tests/fixtures/mof-budget-request-match/{ver}/{m1-kou,unmatched-mof-kou}.csv（突合）、同 {year}/request-kou.csv（要求側の所属・前年度予算額）、
 *       tests/fixtures/mof-archive-csv/{ver}/kou-{general,special}.csv（MOF の項の所属・額）、tests/fixtures/budget-request-trend/kou.csv（PDF の頁）、
 *       tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json（PDF の URL）、
 *       tests/fixtures/budget-request-jikou-youkyu/kou.csv と public/data/v2/ui/budget-request-trend/jikou.json.gz（事項要求・要求0・一括計上）、
 *       tests/fixtures/budget-request-trend/{jikou.csv,moku/{year}.csv} と tests/fixtures/mof-archive-csv/{ver}/{jikou,moku}-{general,special}.csv（詳細の事項・目）
 * 年度推移 CSV・事項要求の検知（build-budget-request-jikou-youkyu.ts）・事項と目の年度推移（build-budget-request-trend-detail-csv.ts）の後に実行する。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { mofAmountKou, ns, readCsv, type Rec } from './lib/mof-budget-request-match';
import { mofMokuCode, pairByName, reqMokuCode, type Side } from './lib/budget-request-mof-detail';
import type { BudgetRequestJikouData } from '../../types/budget-request-trend';
import type { BudgetRequestMofData, BudgetRequestMofDetail, BudgetRequestMofRow, BudgetRequestMofType } from '../../types/budget-request-mof';

/** 年度 → MOF の版（すべて国会への提出時の政府案。令和7年度は成立後の版もあるが提出時にそろえる） */
const VERSIONS: [number, string][] = [[2023, '2023'], [2024, '2024'], [2025, '2025_teishutsu'], [2026, '2026']];
const MATCH = path.join('tests', 'fixtures', 'mof-budget-request-match');
const rd = (p: string) => readCsv(fs.readFileSync(p, 'utf8'));
const num = (s: string | undefined): number | null => { const t = (s ?? '').replace(/[\s,]/g, ''); if (!/^△?\d+$/.test(t)) return null; return t.startsWith('△') ? -Number(t.slice(1)) : Number(t); };
/** 編成で決まる項: 編成で地方財政対策・金利・財投計画・受け側の会計などに合わせて決まる項（予備費・国債費・地方交付税交付金・地方特例交付金・繰入） */
const PLACEHOLDER = /予備費|国債費|地方交付税交付金|地方特例交付金|繰入$/;

const trend = rd(path.join('tests', 'fixtures', 'budget-request-trend', 'kou.csv'));
const jikouKou = rd(path.join('tests', 'fixtures', 'budget-request-jikou-youkyu', 'kou.csv'));
const jikouUi = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join('public', 'data', 'v2', 'ui', 'budget-request-trend', 'jikou.json.gz'))).toString('utf8')) as BudgetRequestJikouData;
// 年度推移・事項要求の行の識別（会計区分 + 所管（特別会計は特別会計名）+ 勘定 + 組織 + 項名）
const idOf = (r: Rec) => [r['年度'], r['会計区分'], r['会計区分'] === '特別' ? r['特別会計'] : r['所管'], r['勘定'], r['組織'], r['項名']].join('|');
// 要求側の事項・目（年度推移の内訳。行の識別でまとめる）
const groupBy = (rs: Rec[], key: (r: Rec) => string) => { const m = new Map<string, Rec[]>(); for (const r of rs) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r); return m; };
const reqJikou = groupBy(rd(path.join('tests', 'fixtures', 'budget-request-trend', 'jikou.csv')), idOf);
const reqMoku = groupBy(VERSIONS.flatMap(([y]) => rd(path.join('tests', 'fixtures', 'budget-request-trend', 'moku', `${y}.csv`))), idOf);
/** 行のキー（app/lib/budget-request-mof.ts の mofRowKey と同じ並び。scripts は app/lib を import しないので複製） */
const rowKey = (r: BudgetRequestMofRow) => [r.y, r.kind, r.acct, r.grp, r.min, r.sub, r.org, r.name].join('|');
const details: Record<string, BudgetRequestMofDetail> = {};

const urls: string[] = []; const urlIdx = new Map<string, number>();
const urlIndex = (u: string) => { let i = urlIdx.get(u); if (i === undefined) { i = urls.length; urls.push(u); urlIdx.set(u, i); } return i; };
const rows: BudgetRequestMofRow[] = [];
const summary: Record<string, unknown> = {};

for (const [year, ver] of VERSIONS) {
  const Y = String(year);
  // PDF の URL（slug → URL）
  const urlOf = new Map<string, string>();
  const freeze = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-pdf-corpus', Y, 'pdf-corpus-freeze.json'), 'utf8')) as { documents: { localPdfPath: string; sourceUrl: string }[] };
  for (const d of freeze.documents) { const slug = d.localPdfPath.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__'); urlOf.set(slug, d.sourceUrl); urlOf.set(slug.replace(/\$/g, '%24'), d.sourceUrl); }

  // MOF の項（id: kou-general:N / kou-special:N。N は CSV のデータ行の 1 始まり）
  const mof = new Map<string, Rec>();
  for (const a of ['general', 'special'] as const) rd(path.join('tests', 'fixtures', 'mof-archive-csv', ver, `kou-${a}.csv`)).forEach((r, i) => mof.set(`kou-${a}:${i + 1}`, r));
  // 額の列名は版で違う（提出時の令和6・7年度は「…要求額の合計」で「(千円)」なし。単位はどれも千円）。突合と同じ関数で読む
  const mofAmt = mofAmountKou;
  const mofPrevOf = (r: Rec) => num(r[Object.keys(r).find(k => /^前年度予算額.*の合計$/.test(k)) ?? '']);
  // MOF の事項・目を項の id へ（項の識別: 一般会計は所管＋組織＋項コード＋項名、特別会計は特別会計＋勘定＋項コード＋項名。どちらも項の CSV で一意）
  const kouKey = (a: 'general' | 'special', r: Rec) => (a === 'general' ? [r['所管'], r['組織']] : [r['特別会計'], r['勘定']]).concat(r['項コード'], r['項名']).join('|');
  const mofJikou = new Map<string, Side[]>(), mofMoku = new Map<string, Side[]>();
  for (const a of ['general', 'special'] as const) {
    const ids = new Map<string, string>();
    for (const [id, r] of mof) if (id.startsWith(`kou-${a}:`)) { const k = kouKey(a, r); if (ids.has(k)) throw new Error(`${ver} ${a}: 項の識別が重複 ${k}`); ids.set(k, id); }
    const amtOf = (r: Rec) => num(r[Object.keys(r).find(k => /^令和\d+年度(要求|予定)額/.test(k)) ?? '']);
    const put = (m: Map<string, Side[]>, r: Rec, x: Side) => { const id = ids.get(kouKey(a, r)); if (!id) throw new Error(`${ver} ${a}: 項の無い行 ${kouKey(a, r)}`); (m.get(id) ?? m.set(id, []).get(id)!).push(x); };
    for (const r of rd(path.join('tests', 'fixtures', 'mof-archive-csv', ver, `jikou-${a}.csv`))) put(mofJikou, r, { name: ns(r['事項名']), amt: amtOf(r) });
    for (const r of rd(path.join('tests', 'fixtures', 'mof-archive-csv', ver, `moku-${a}.csv`))) put(mofMoku, r, { name: ns(r['目名']), code: mofMokuCode(r), amt: amtOf(r) });
  }
  // 詳細の事項・目。要求側は年度推移の行（統合は項ごと）の内訳を足す。req が null なら要求側の無い行（MOF のみ）、mofId が null なら MOF の無い行
  const detailOf = (req: (Rec | undefined)[] | null, mofId: string | null): BudgetRequestMofDetail => {
    // 同じ項が複数の府省の要求書に載ると（複数所管・持ち分）、年度推移の内訳は書ごとに行を持つ。行の要求書の公開元（slug の先頭のドメイン）で、
    // 選んだ年度推移の行と同じ府省の行だけを取る（取らないと書の数だけ足してしまう）
    const hostOf = (slug: string) => slug.split('__')[0];
    const srcs = req === null ? [] : [...new Map(req.filter((t): t is Rec => !!t).map(t => [`${idOf(t)}#${hostOf(t['要求書'])}`, t])).values()];
    const pick = (g: Map<string, Rec[]>) => srcs.flatMap(t => (g.get(idOf(t)) ?? []).filter(r => hostOf(r['要求書']) === hostOf(t['要求書'])));
    const rj = pick(reqJikou).map(r => ({ name: ns(r['事項名']), amt: num(r['要求額_千円']) }));
    const rm = pick(reqMoku).map(r => ({ name: ns(r['目名']), code: reqMokuCode(r['目コード(原文)']), amt: num(r['要求額_千円']) }));
    const noReq = req !== null && rj.length === 0 && rm.length === 0;
    const j = pairByName(rj, mofId ? mofJikou.get(mofId) ?? [] : []).map(([n, , a, b]) => [n, '', a, b] as [string, string, number | null, number | null]);
    return { j, m: pairByName(rm, mofId ? mofMoku.get(mofId) ?? [] : []), ...(noReq ? { noReq: 1 as const } : {}) };
  };

  // 要求側: request-kou.csv（要求の年度のディレクトリ。2025_teishutsu には無い）と、年度推移 CSV の行（PDF の頁・識別）
  const reqKou = new Map(rd(path.join(MATCH, Y, 'request-kou.csv')).map(r => [`${r['request_source']}#${r['toc_kou_idx']}`, r]));
  const trendY = trend.filter(r => r['年度'] === Y);
  const trendOf = (src: string, code: string, name: string, org: string, sub: string): Rec | undefined => {
    const c = trendY.filter(t => t['要求書'] === src && t['項コード'] === code && t['項名'] === name);
    return c.find(t => (org && t['組織'] === org) || (sub && t['勘定'] === sub)) ?? c[0];
  };
  const formsOf = new Map<string, string[]>(); for (const r of jikouKou) if (r['年度'] === Y) formsOf.set(idOf(r), r['形'].split(';'));
  const jikouTextOf = new Map<string, string>(); for (const r of jikouKou) if (r['年度'] === Y && r['根拠の行']) jikouTextOf.set(idOf(r), r['根拠の行']);
  const orgJikou = new Map(jikouUi.orgs?.[Y] ?? []);
  // 一括計上の配分先: 同じ所管・組織に一括計上の項がある年度の、要求0 の項（例: 国際観光旅客税財源観光振興推進費 → 観光振興費）
  const lumpPlaces = new Set(jikouKou.filter(r => r['年度'] === Y && r['形'].includes('一括計上')).map(r => `${r['所管']}|${r['組織']}`));

  type Req = { m: Rec; k: Rec | undefined; t: Rec | undefined };
  const reqOf = (m: Rec): Req => { const k = reqKou.get(`${m['request_source']}#${m['toc_kou_idx']}`); return { m, k, t: trendOf(m['request_source'], m['request_code3'], ns(m['request_name']), k?.['org'] ?? '', k?.['sub'] ?? '') }; };
  const bookOf = (q: Req): [number, string, string, number | null] => {
    const slug = q.t?.['PDFの要求書'] || q.m['request_source']; const u = urlOf.get(slug) ?? urlOf.get(q.m['request_source']);
    if (!u) throw new Error(`no URL for ${Y} ${slug}`);
    return [urlIndex(u), q.m['request_page'], q.t?.['PDF頁'] ?? '', num(q.m['request_amount'])];
  };
  // 要求側の型（事項要求・要求0・一括計上）と、事項要求の本文
  const reqTypes = (qs: Req[]) => {
    const types = new Set<BudgetRequestMofType>(); let jikouText: string | undefined; let orgJikouText: string | undefined;
    for (const q of qs) {
      if (!q.t) continue;
      const id = idOf(q.t); const forms = formsOf.get(id) ?? [];
      if (forms.includes('印') || forms.includes('文')) { types.add('事項要求'); jikouText ??= jikouTextOf.get(id); }
      if (forms.some(f => f.startsWith('要求0'))) types.add(lumpPlaces.has(`${q.t['所管']}|${q.t['組織']}`) ? '一括計上の配分先' : '要求額0');
      if (forms.includes('一括計上')) types.add('一括計上');
      const acct = q.t['会計区分'] === '特別' ? 1 : 0;
      const ok = [acct, acct === 1 ? q.t['特別会計'] : q.t['所管'], q.t['勘定'], q.t['組織']].join('|'); // jikouOrgKeyOf と同じ並び
      if (q.t['組織'] && orgJikou.has(ok)) { types.add('組織に事項要求'); orgJikouText ??= orgJikou.get(ok) || undefined; }
    }
    return { types, jikouText, orgJikouText };
  };

  const m1 = rd(path.join(MATCH, ver, 'm1-kou.csv'));
  const count: Record<string, number> = {};
  const cmp: Record<'jikou' | 'moku', Record<string, number>> = { jikou: {}, moku: {} };
  const push = (r0: Omit<BudgetRequestMofRow, 'nJikou' | 'nMoku'>, d: BudgetRequestMofDetail) => {
    const r: BudgetRequestMofRow = { ...r0, nJikou: d.j.length, nMoku: d.m.length };
    rows.push(r); count[r.kind] = (count[r.kind] ?? 0) + 1;
    const k = rowKey(r); if (details[k]) throw new Error(`行のキーが重複 ${k}`); details[k] = d;
    if (r.kind !== 'matched') return;
    // 対応ありの項の、事項・目の一致の数（要求側の内訳が取れない項は数えない）
    for (const [what, ps] of [['jikou', d.j], ['moku', d.m]] as const) {
      const c = cmp[what]; const inc = (n: string) => { c[n] = (c[n] ?? 0) + 1; };
      if (d.noReq) { inc('noReq'); continue; }
      inc('kou'); if (ps.every(p => p[2] !== null && p[3] !== null)) inc('sameSet');
      for (const p of ps) {
        if (p[2] !== null && p[3] !== null) inc(p[2] === p[3] ? 'bothEq' : 'bothNe');
        else if (p[3] === null) inc(p[2] === 0 ? 'reqOnlyZero' : 'reqOnly');
        else inc(p[3] === 0 ? 'mofOnlyZero' : 'mofOnly');
      }
    }
  };

  // 対応あり: MOF の項ごとに、対応する要求行をまとめる
  const byMof = new Map<string, Req[]>();
  for (const m of m1) if (m['status'] === 'MATCHED' || m['status'] === 'NEAR_NAME') (byMof.get(m['mof_row']) ?? byMof.set(m['mof_row'], []).get(m['mof_row'])!).push(reqOf(m));
  for (const [id, qs] of byMof) {
    const r = mof.get(id); if (!r) throw new Error(`no MOF row ${ver} ${id}`);
    const acct = id.startsWith('kou-special') ? 1 : 0;
    const amts = qs.map(q => num(q.m['request_amount']));
    const top = qs.reduce((a, q) => ((num(q.m['request_amount']) ?? -Infinity) > (num(a.m['request_amount']) ?? -Infinity) ? q : a), qs[0]);
    const { types, jikouText, orgJikouText } = reqTypes(qs);
    const books = qs.map(bookOf).filter((b, i, all) => all.findIndex(x => x[0] === b[0] && x[1] === b[1]) === i);
    // 統合: 名前の違う複数の要求の項が、1 つの予算の項になった（突合の項名の対応表。例: FY2023 こども家庭推進費 + こども家庭調査研究等推進費 → こども政策推進費）。
    // 要求額・前年度予算額は、要求の項ごとの値（その項の最も大きい額）を足す。同じ名前の行どうしは複数書・持ち分
    const names = [...new Set(qs.map(q => ns(q.m['request_name'])))];
    // 同じ書に項コードの違う同名の項があり、どちらも同じ予算の項に対応する（例: FY2023 国土交通本省の情報化推進費 642 と 800（自動車分））も統合
    const sameBookCodes = qs.some(a => qs.some(b => a.m['request_source'] === b.m['request_source'] && a.m['request_code3'] !== b.m['request_code3']));
    const itemOf = (q: Req) => (sameBookCodes ? `${ns(q.m['request_name'])}|${q.m['request_code3']}` : ns(q.m['request_name']));
    const items = [...new Set(qs.map(itemOf))];
    let req = num(top.m['request_amount']), reqPrev = num(top.k?.['previous_amount']);
    let detailReq = [top.t];
    if (items.length > 1) {
      types.add('統合');
      const tops = items.map(n => qs.filter(q => itemOf(q) === n).reduce((a, q) => ((num(q.m['request_amount']) ?? -Infinity) > (num(a.m['request_amount']) ?? -Infinity) ? q : a)));
      detailReq = tops.map(q => q.t);
      req = tops.reduce((s, q) => s + (num(q.m['request_amount']) ?? 0), 0); reqPrev = tops.reduce((s, q) => s + (num(q.k?.['previous_amount']) ?? 0), 0);
    } else if (books.length > 1) {
      // 複数書: 同じ府省（公開元のドメイン）の要求書が複数あるときだけ（複数所管の項は、所管の列で分かるので付けない）。額が違えば持ち分
      const hosts = new Set(books.map(([u]) => new URL(urls[u]).hostname.replace(/^www\./, '')));
      // 額の取れない書（総表の無い分冊。例: FY2023 金融庁の明細表だけの PDF）は比べない
      if (new Set(amts.filter(x => x !== null)).size > 1) types.add('持ち分'); else if (hosts.size === 1) types.add('複数書');
    }
    if (qs.some(q => q.m['status'] === 'NEAR_NAME')) types.add('名前が近い');
    if (qs.some(q => q.m['reason'] === 'kou_renamed')) types.add('改称');
    if (PLACEHOLDER.test(ns(r['項名']))) types.add('編成で決まる');
    const mofName = ns(r['項名']) !== ns(top.m['request_name']) || names.length > 1 ? ns(r['項名']) : undefined;
    push({
      y: year, kind: 'matched', acct, grp: ns(r['所管']), min: acct === 0 ? ns(r['所管']) : ns(r['特別会計']), sub: acct === 1 ? ns(r['勘定']) : '', org: acct === 0 ? ns(r['組織']) : '',
      name: names.length > 1 ? names.join(' ＋ ') : ns(top.m['request_name']), mof: mofAmt(r), mofPrev: mofPrevOf(r), req, reqPrev, books, types: [...types],
      ...(jikouText ? { jikouText } : {}), ...(orgJikouText ? { orgJikouText } : {}), ...(mofName ? { mofName } : {}),
    }, detailOf(detailReq, id));
  }

  // 概算要求のみ・額0の項: 要求側の所属ごとにまとめる（同じ項が複数の書に載ることがある）
  const byReq = new Map<string, Req[]>();
  for (const m of m1) {
    if (m['status'] !== 'NO_CANDIDATE' && m['status'] !== 'ZERO_AMOUNT') continue;
    const q = reqOf(m); const k = q.k;
    const key = [m['status'], k?.['acct'], k?.['ministry'], k?.['account'], k?.['sub'], k?.['org'] || q.t?.['組織'] || '', ns(m['request_name'])].join('|');
    (byReq.get(key) ?? byReq.set(key, []).get(key)!).push(q);
  }
  for (const qs of byReq.values()) {
    const q0 = qs[0]; const k = q0.k; const acct = k?.['acct'] === 'special' ? 1 : 0;
    const { types, jikouText, orgJikouText } = reqTypes(qs);
    const books = qs.map(bookOf).filter((b, i, all) => all.findIndex(x => x[0] === b[0] && x[1] === b[1]) === i);
    if (books.length > 1 && new Set(books.map(([u]) => new URL(urls[u]).hostname.replace(/^www\./, ''))).size === 1) types.add('複数書'); // 同じ府省の要求書が複数あるときだけ
    if (PLACEHOLDER.test(ns(q0.m['request_name']))) types.add('編成で決まる');
    const top = qs.reduce((a, q) => ((num(q.m['request_amount']) ?? -Infinity) > (num(a.m['request_amount']) ?? -Infinity) ? q : a), q0);
    push({
      y: year, kind: q0.m['status'] === 'ZERO_AMOUNT' ? 'zero' : 'reqOnly', acct,
      grp: acct === 0 ? (k?.['ministry'] ?? '') : (q0.t?.['所管'] || ''), min: acct === 0 ? (k?.['ministry'] ?? '') : (k?.['account'] ?? ''), sub: acct === 1 ? (k?.['sub'] ?? '') : '',
      org: acct === 0 ? (k?.['org'] || q0.t?.['組織'] || '') : '', name: ns(q0.m['request_name']),
      mof: null, mofPrev: null, req: num(top.m['request_amount']), reqPrev: num(top.k?.['previous_amount']), books, types: [...types],
      ...(jikouText ? { jikouText } : {}), ...(orgJikouText ? { orgJikouText } : {}),
    }, detailOf([top.t], null));
  }

  // MOF のみ
  for (const u of rd(path.join(MATCH, ver, 'unmatched-mof-kou.csv'))) {
    const r = mof.get(u['mof_row']); if (!r) throw new Error(`no MOF row ${ver} ${u['mof_row']}`);
    const acct = u['mof_row'].startsWith('kou-special') ? 1 : 0;
    push({
      // 所管: 特別会計で予算書に共管所管名があればそれ（東日本大震災復興は項ごとに復興庁・総務省・財務省）。無ければ予算書の所管（共管の会計は「、」「及び」で列挙）
      y: year, kind: 'mofOnly', acct, grp: acct === 1 && ns(r['共管所管名']) ? ns(r['共管所管名']) : ns(r['所管']), min: acct === 0 ? ns(r['所管']) : ns(r['特別会計']), sub: acct === 1 ? ns(r['勘定']) : '', org: acct === 0 ? ns(r['組織']) : '',
      name: ns(r['項名']), mof: mofAmt(r), mofPrev: mofPrevOf(r), req: null, reqPrev: null, books: [], types: PLACEHOLDER.test(ns(r['項名'])) ? ['編成で決まる'] : [],
    }, detailOf(null, u['mof_row']));
  }
  const yearRows = rows.filter(x => x.y === year && (x.kind === 'matched' || x.kind === 'mofOnly'));
  if (yearRows.length > 0 && yearRows.every(x => x.mof === null)) throw new Error(`${ver}: MOF の額の列が読めない（列名を確認）`);
  const typeCount: Record<string, number> = {}; for (const r of rows.filter(x => x.y === year)) for (const t of r.types) typeCount[t] = (typeCount[t] ?? 0) + 1;
  summary[Y] = { version: ver, rows: count, types: typeCount, jikou: cmp.jikou, moku: cmp.moku };
}

const data: BudgetRequestMofData = { years: VERSIONS.map(([y]) => y), versions: Object.fromEntries(VERSIONS.map(([y, v]) => [String(y), v])), urls, rows };
const uiDir = path.join('public', 'data', 'v2', 'ui', 'budget-request-mof'); fs.mkdirSync(uiDir, { recursive: true });
fs.writeFileSync(path.join(uiDir, 'kou.json.gz'), zlib.gzipSync(JSON.stringify(data), { level: 9, mtime: 0 } as zlib.ZlibOptions));
fs.writeFileSync(path.join(uiDir, 'detail.json.gz'), zlib.gzipSync(JSON.stringify({ rows: details }), { level: 9, mtime: 0 } as zlib.ZlibOptions));
const outDir = path.join('tests', 'fixtures', 'budget-request-mof'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
