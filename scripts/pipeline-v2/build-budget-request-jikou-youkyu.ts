/**
 * 概算要求の「金額を示さない要求」（事項要求など）の候補を、項の単位で拾う。仕様: docs/budget-request-jikou-youkyu.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-jikou-youkyu.ts [out-dir]   # 既定 tests/fixtures/budget-request-jikou-youkyu
 * 入力: tests/fixtures/budget-request-trend/kou.csv（項の一覧と金額）、tests/fixtures/budget-request-csv/{year}/detail-table/sources/*.csv（明細表の行）、
 *       data/work/budget-request-plain-text/{year}/*.txt（備考の文字。明細表 CSV は備考を持たない）、tests/fixtures/mof-budget-request-match/{year}/m1-kou.csv（MOF の当初額。参考）
 * 出力: kou.csv（形が 1 つ以上ある項）、marks.csv（「事項要求」の出現ごとの行）、summary.json、public/data/v2/ui/budget-request-trend/jikou.json.gz（/budget-request-trend 用）
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { BudgetRequestJikouData } from '../../types/budget-request-trend';
import { ns, readCsv, type Rec } from './lib/mof-budget-request-match';

const OUT = process.argv[2] ?? path.join('tests', 'fixtures', 'budget-request-jikou-youkyu');
const YEARS = [2023, 2024, 2025, 2026, 2027];
const TEXT = path.join('data', 'work', 'budget-request-plain-text');
const rd = (p: string) => readCsv(fs.readFileSync(p, 'utf8'));
const num = (s: string | undefined): number | null => { const t = (s ?? '').replace(/[\s,]/g, ''); if (!/^△?\d+$/.test(t)) return null; return t.startsWith('△') ? -Number(t.slice(1)) : Number(t); };
const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (name: string, header: string[], rows: unknown[][]) => fs.writeFileSync(path.join(OUT, name), [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n');
fs.mkdirSync(OUT, { recursive: true });

const LEVEL: Record<string, string> = { CODE3: '項', DETAIL: '事項', CODE_5_4_2_4: '目', CODE2: '特別会計', CODE1: '勘定', CONTEXT: '見出し' };
const MARK = /[（(]事項要求[)）]/; // 印。空白を除いた行で見る
// 書（分冊の連番を除いた slug）。内閣府・内閣官房などは、1 つの項の明細が複数の分冊 PDF にまたがる。年度推移 CSV と同じ規則
const bookOf = (slug: string): string => slug.replace(/\d{8}[-_]/, '').replace(/(_+[a-z]?)\d+$/, '$1');
type Hit = { kind: '印' | '文'; level: string; rowName: string; page: number; line: number; text: string };

const trend = rd(path.join('tests', 'fixtures', 'budget-request-trend', 'kou.csv'));
const kouRows: unknown[][] = []; const markRows: unknown[][] = [];
const summary: Record<string, unknown> = {};
const ui: BudgetRequestJikouData = { years: {} };

for (const year of YEARS) {
  const detailDir = path.join('tests', 'fixtures', 'budget-request-csv', String(year), 'detail-table', 'sources');
  const rowsY = trend.filter(r => r['年度'] === String(year));
  const keyOf = (slug: string, code: string, name: string) => `${bookOf(slug)}\t${code}\t${name}`;
  // 年度推移 CSV にある項（要求書・PDF の要求書のどちらでも）。明細表の CODE3 のうち、これに当たる行だけを項の区切りにする（内閣府などは事項にも 3 桁のコードが付く）
  const knownKou = new Set(rowsY.flatMap(r => [keyOf(r['要求書'], r['項コード'], r['項名']), ...(r['PDFの要求書'] ? [keyOf(r['PDFの要求書'], r['項コード'], r['項名'])] : [])]));
  // 項ごと（`${slug}\t${code}\t${name}`）: 範囲内の「事項要求」と、目の名前
  const hitsOf = new Map<string, Hit[]>(); const mokuOf = new Map<string, string[]>();
  const orgHits: Hit[] = []; let unplaced = 0; let total = 0;
  for (const f of fs.readdirSync(path.join(TEXT, String(year))).filter(x => x.endsWith('.txt')).sort()) {
    const slug = f.slice(0, -4);
    const lines = fs.readFileSync(path.join(TEXT, String(year), f), 'utf8').split('\n');
    const pageOf: number[] = []; let p = 1; for (const l of lines) { p += (l.match(/\f/g) ?? []).length; pageOf.push(p); }
    const dpath = path.join(detailDir, `${slug}.csv`);
    const rows = fs.existsSync(dpath) ? rd(dpath).filter(r => Number(r['source_line_start'])) : [];
    // 明細表の行を、項の範囲に分ける。組織の見出し（CODE3 の直後に CODE3 が続く行）と、特別会計・勘定・見出しの行で範囲を区切る
    const kouAt: (string | null)[] = []; const role: string[] = []; let cur: string | null = null; let special = false; // role: CODE3 の行の階層（項・組織・事項）
    rows.forEach((r, i) => {
      const t = r['row_type'];
      if (t === 'CODE3') {
        const codeKey = (x: Rec | undefined) => { const mm = x && x['row_type'] === 'CODE3' ? /^(\d+)(.*)$/.exec(ns(x['事項'])) : null; return mm ? keyOf(slug, mm[1], mm[2]) : ''; };
        const m = /^(\d+)(.*)$/.exec(ns(r['事項'])); const key = codeKey(r);
        const isOrg = knownKou.has(codeKey(rows[i + 1])); // 組織の見出し: 直後が項の行（直後が項でない 3 桁の行なら事項の見出し。例: 011 経常事務費 → 006 一般事務費）
        if (knownKou.has(key)) { cur = key; role.push('項'); } else if (isOrg || !m) { cur = null; role.push('組織'); } else role.push('事項'); // 項でない CODE3（事項の 3 桁コード）は範囲を区切らない
      } else if (t === 'CONTEXT') { cur = null; special = /特別会計/.test(ns(r['事項'])); }
      else if ((t === 'CODE2' || t === 'CODE1') && special) cur = null; // 一般会計の書の 2 桁・1 桁の行は事項の番号（例: 文部科学省の 02 産業教育総合推進事業）
      if (t !== 'CODE3') role.push((t === 'CODE2' || t === 'CODE1') && !special ? '事項' : LEVEL[t] ?? t);
      if (t === 'CODE_5_4_2_4' && cur) { const nm = ns(r['事項']).replace(/^[\d‑-]+/, ''); (mokuOf.get(cur) ?? mokuOf.set(cur, []).get(cur)!).push(nm); }
      kouAt.push(cur);
    });
    const starts = rows.map(r => Number(r['source_line_start']));
    lines.forEach((l, li) => {
      const flat = ns(l); if (!flat.includes('事項要求')) return; total++;
      const line = li + 1; const page = pageOf[li];
      let k = -1; for (let j = starts.length - 1; j >= 0; j--) if (starts[j] <= line) { k = j; break; }
      const near = k >= 0 && Number(rows[k]['source_page']) === page && line - starts[k] <= 12;
      const r = near ? rows[k] : null;
      const level = r ? role[k] : '不明';
      const hit: Hit = { kind: MARK.test(flat) ? '印' : '文', level, rowName: r ? ns(r['事項']) : '', page, line, text: l.replace(/\f/g, '').replace(/\s+/g, ' ').trim() }; // 列の位置合わせの空白は詰める
      const kou = near ? kouAt[k] : null;
      markRows.push([year, slug, page, line, hit.kind, level, hit.rowName, kou ? kou.split('\t')[2] : '', hit.text]);
      if (kou) (hitsOf.get(kou) ?? hitsOf.set(kou, []).get(kou)!).push(hit);
      else if (level === '組織') orgHits.push(hit); else unplaced++;
    });
  }

  // MOF の当初額（参考）と状態: m1-kou.csv。当初額は MATCHED / NEAR_NAME の行（同じ項が複数の行に対応するときは最初の行）
  const mofOf = new Map<string, number>(); const statusOf = new Map<string, string>();
  const m1 = path.join('tests', 'fixtures', 'mof-budget-request-match', String(year), 'm1-kou.csv');
  const hasMof = fs.existsSync(m1);
  if (hasMof) for (const r of rd(m1)) {
    const key = keyOf(r['request_source'], r['request_code3'], ns(r['request_name']));
    if (!statusOf.has(key)) statusOf.set(key, r['status']);
    if ((r['status'] === 'MATCHED' || r['status'] === 'NEAR_NAME') && num(r['mof_amount']) !== null && !mofOf.has(key)) mofOf.set(key, num(r['mof_amount'])!);
  }

  // 勘定ごと（組織ごと）0: 同じ場所（特別会計は特別会計＋勘定、一般会計は所管＋組織）の項が 2 つ以上あり、すべて要求額 0、前年度の合計が正
  const placeOf = (r: Rec) => r['会計区分'] === '特別' ? `特別\t${r['特別会計']}\t${r['勘定']}` : `一般\t${r['所管']}\t${r['組織']}`;
  const byPlace = new Map<string, Rec[]>(); for (const r of rowsY) (byPlace.get(placeOf(r)) ?? byPlace.set(placeOf(r), []).get(placeOf(r))!).push(r);
  const wholeZero = new Set([...byPlace].filter(([, rs]) => new Set(rs.map(r => r['項名'])).size >= 2 && rs.every(r => num(r['要求額_千円']) === 0) && rs.reduce((a, r) => a + (num(r['前年度予算額_千円']) ?? 0), 0) > 0).map(([p]) => p));

  // 項（場所＋項名）ごとにまとめる。同じ項が複数の書に載るときは 1 行にし、要求書を並べる
  type Item = { r: Rec; forms: Set<string>; hits: Hit[]; mof: number | null; books: string[] };
  const items = new Map<string, Item>(); let joined = 0;
  for (const r of rowsY) {
    const key = keyOf(r['PDFの要求書'] || r['要求書'], r['項コード'], r['項名']); const reqKey = keyOf(r['要求書'], r['項コード'], r['項名']);
    const prev = num(r['前年度予算額_千円']); const req = num(r['要求額_千円']);
    const hits = hitsOf.get(key) ?? []; if (hitsOf.has(key)) joined++;
    const moku = mokuOf.get(key) ?? [];
    const forms: string[] = [];
    if (hits.some(h => h.kind === '印')) forms.push('印');
    if (hits.some(h => h.kind === '文')) forms.push('文');
    if (prev !== null && prev > 0 && req === 0) forms.push(wholeZero.has(placeOf(r)) ? '要求0・場所ごと' : '要求0');
    // 一括計上: 目が括弧書きの 1 つだけ（例: （国際観光旅客税財源観光振興推進費））、前年度 0・要求額あり、予算書に同じ項がない（MOF 突合の状態が候補なし。MOF の無い年度は問わない）。
    // 予備費・予備経費と、予算書にもある移し替えの推進費・調査費（例: 沖縄振興推進調査費）は除く
    if (prev === 0 && req !== null && req > 0 && moku.length >= 1 && moku.every(m => /^[（(]/.test(m)) && !/予備(費|経費)/.test(r['項名']) && (!hasMof || statusOf.get(reqKey) === 'NO_CANDIDATE')) forms.push('一括計上');
    if (forms.length === 0) continue;
    const id = [placeOf(r), r['項名']].join('\t');
    const it = items.get(id) ?? items.set(id, { r, forms: new Set(), hits: [], mof: null, books: [] }).get(id)!;
    for (const f of forms) it.forms.add(f); it.hits.push(...hits); if (it.mof === null) it.mof = mofOf.get(reqKey) ?? null; if (!it.books.includes(r['要求書'])) it.books.push(r['要求書']);
  }
  const count: Record<string, number> = {};
  for (const it of items.values()) {
    const r = it.r; const forms = [...it.forms]; for (const fm of forms) count[fm] = (count[fm] ?? 0) + 1;
    const req = num(r['要求額_千円']) ?? 0;
    // MOF との比較（参考）: 要求0 の項は、当初予算でも 0（終了など）か、編成で額が付いたか
    const vsMof = !hasMof ? '' : it.mof === null ? 'MOFに対応なし' : it.mof > req ? '当初>要求' : it.mof === req ? '当初=要求' : '当初<要求';
    const acct = r['会計区分'] === '特別' ? 1 : 0;
    // 行のキーは UI の jikouKeyOf（app/lib/budget-request-trend.ts）と同じ並び: 会計区分 | 所管（特別会計は特別会計名）| 勘定 | 組織 | 項名
    (ui.years[String(year)] ??= []).push([[acct, acct === 1 ? r['特別会計'] : r['所管'], r['勘定'], r['組織'], r['項名']].join('|'), forms, it.hits[0]?.text ?? '']);
    kouRows.push([year, r['会計区分'], r['所管'], r['特別会計'], r['勘定'], r['組織'], r['項名'], r['項コード'], r['前年度予算額_千円'], r['要求額_千円'], it.mof ?? '', vsMof, forms.join(';'), [...new Set(it.hits.map(h => h.level))].join('・'), it.hits[0]?.text ?? '', it.books.join(' '), r['頁'], r['PDF頁']]);
  }
  summary[String(year)] = { occurrences: total, joined_to_kou: [...hitsOf.values()].reduce((a, h) => a + h.length, 0), on_org_rows: orgHits.length, unplaced, kou_with_forms: items.size, kou_trend_rows_with_marks: joined, forms: count };
}

writeCsv('kou.csv', ['年度', '会計区分', '所管', '特別会計', '勘定', '組織', '項名', '項コード', '前年度予算額_千円', '要求額_千円', 'MOF当初額_千円(参考)', 'MOFとの比較(参考)', '形', '印の行の階層', '根拠の行', '要求書', '頁', 'PDF頁'], kouRows);
writeCsv('marks.csv', ['年度', '要求書', 'PDF頁', '行', '種類', '階層', '行の名前', '項名', '本文'], markRows);
const uiDir = path.join('public', 'data', 'v2', 'ui', 'budget-request-trend'); fs.mkdirSync(uiDir, { recursive: true });
fs.writeFileSync(path.join(uiDir, 'jikou.json.gz'), zlib.gzipSync(JSON.stringify(ui), { level: 9, mtime: 0 } as zlib.ZlibOptions));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
