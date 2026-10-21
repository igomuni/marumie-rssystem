/**
 * 概算要求の年度推移（項）の絞り込み・並べ替え。純粋関数のみ（HTTP・React 禁止）。
 * データ: types/budget-request-trend.ts。仕様: docs/budget-request-trend-csv.md。
 * 増減・増減率は、その年度の「要求額 − 前年度予算額」（その年度の要求書が載せる値どうし）。
 */
import type { BudgetRequestJikouData, BudgetRequestTrendData, BudgetRequestTrendRow, BudgetRequestTrendYear } from '@/types/budget-request-trend';
import { MAX_REGEX_PATTERN_LENGTH } from '@/app/lib/sankey-query';

export type PatternFilter = 'all' | 'all5' | 'new' | 'gone';
export type ChangeFilter = '' | 'up10' | 'up50' | 'dn10' | 'dn50';
export type TrendSortKey = 'acct' | 'group' | 'org' | 'name' | 'pattern' | 'prev' | 'req' | 'diff' | 'rate';
/** 出現パターン（選択年度と前年度の比較）。最初の年度は判定しない */
export type TrendPattern = '新規' | '継続' | '消滅';
export type TrendSortDir = 1 | -1;

export interface TrendFilters {
  /** 項名の検索。regex が true なら正規表現（/sankey-svg の事業名・支出先名と同じ: 大文字小文字を区別しない、128 文字まで） */
  name: string;
  nameRegex: boolean;
  /** 組織（特別会計は勘定）の検索。規則は項名と同じ */
  org: string;
  orgRegex: boolean;
  /** 会計の絞り込み（acctLabelOf の値: 一般会計 / ○○特別会計）。空なら絞り込まない */
  accts: string[];
  /** 所管の絞り込み（groupsOf の値。どれかが載っていれば一致）。空なら絞り込まない */
  groups: string[];
  pattern: PatternFilter;
  change: ChangeFilter;
  /** その年度に複数の要求書に載る行だけ */
  shared: boolean;
  /** その年度に金額が一致しない要求書がある行だけ */
  mismatch: boolean;
  /** その年度に、目に「繰入」を含む項だけ */
  transfer: boolean;
  /** その年度に所管コードが前の年度から変わった行だけ */
  codeChange: boolean;
  /** その年度に会計・勘定が新設された行だけ */
  newAcct: boolean;
  /** その年度に前の項からつないだ（移管・改称）行だけ */
  moved: boolean;
  /** その年度に PDF の該当頁が画像（文字層なし）の行だけ */
  imagePage: boolean;
  /** その年度に PDF の頁が引けなかった行だけ */
  noPdfPage: boolean;
  /** その年度に、備考に事項要求の記載がある行だけ */
  jikou: boolean;
}

export const INITIAL_TREND_FILTERS: TrendFilters = { name: '', nameRegex: false, org: '', orgRegex: false, accts: [], groups: [], pattern: 'all', change: '', shared: false, mismatch: false, transfer: false, codeChange: false, newAcct: false, moved: false, imagePage: false, noPdfPage: false, jikou: false };

/**
 * 所管 = 載っている要求書の公開元（PDF のドメイン由来の府省庁名）。会計の区別は acct（一般 / 特別）の列で示す。
 * その年度に無い行（消滅）は、直近の載っている年度の要求書で決める。要求書が引けなければ表紙の所管名（特別会計は特別会計名）
 */
export function groupsOf(r: BudgetRequestTrendRow, year: number, urls: readonly string[]): string[] {
  const ys = Object.keys(r.y).map(Number).sort((a, b) => b - a);
  const y = ys.find(v => v <= year) ?? ys[0];
  const a = y === undefined ? undefined : r.y[String(y)];
  const names = a ? [...new Set(a.src.map(([u]) => publisherOf(urls[u] ?? '')).filter(Boolean))] : [];
  return names.length > 0 ? names : [r.min];
}
export const groupOf = (r: BudgetRequestTrendRow, year: number, urls: readonly string[]): string => groupsOf(r, year, urls).join('、');

/** 一覧の 1 行 = 項 × 所管（公開元の府省）。複数の府省の書に載る項は府省ごとに 1 件。金額はその府省の書の値 */
export interface TrendRecord {
  row: BudgetRequestTrendRow;
  group: string;
  prev: number | null;
  req: number | null;
  /** この所管の書の載り先に、PDF の頁が引けなかったものがある */
  noPdfPage: boolean;
  /** この所管の書の載り先に、推定した頁が画像（文字層なし）のものがある */
  imagePage: boolean;
}

export function recordsOf(r: BudgetRequestTrendRow, year: number, urls: readonly string[]): TrendRecord[] {
  const a = yearOf(r, year);
  return groupsOf(r, year, urls).map(group => {
    // この所管の書の載り先だけで、頁の状態を判定する（複数の府省の書に載る項で、片方だけ頁が引けなくても、もう片方には付けない）
    const mySrc = a ? a.src.filter(s => publisherOf(urls[s[0]] ?? '') === group) : [];
    const flags = { noPdfPage: mySrc.some(s => !s[2]), imagePage: mySrc.some(s => s[3] === 'i') };
    if (!a) return { row: r, group, prev: null, req: null, ...flags };
    // 書ごとの額（額不一致のときだけ持つ）があれば、その府省の書のうち最も大きい額
    const mine = a.srcAmt ? a.src.map((s, i) => ({ g: publisherOf(urls[s[0]] ?? ''), amt: a.srcAmt![i] })).filter(x => x.g === group) : [];
    if (mine.length === 0) return { row: r, group, prev: a.prev, req: a.req, ...flags };
    const best = mine.reduce((m, x) => ((x.amt[1] ?? 0) > (m.amt[1] ?? 0) ? x : m));
    return { row: r, group, prev: best.amt[0], req: best.amt[1], ...flags };
  });
}

export const recordChange = (x: TrendRecord): number | null => (x.req !== null && x.prev !== null ? x.req - x.prev : null);
export const recordRate = (x: TrendRecord): number | null => (x.req !== null && x.prev !== null && x.prev !== 0 ? (x.req - x.prev) / x.prev : null);
/** 会計の表示名。一般会計、または特別会計ごと（○○特別会計） */
export const acctLabelOf = (r: BudgetRequestTrendRow): string => (r.acct === 0 ? '一般会計' : `${r.min}特別会計`);
/** 組織の列の表示。特別会計は勘定 */
export const orgOf = (r: BudgetRequestTrendRow): string => (r.acct === 0 ? r.org : r.sub);

export const yearOf = (r: BudgetRequestTrendRow, year: number): BudgetRequestTrendYear | undefined => r.y[String(year)];

/** 事項要求の候補（jikou.json.gz）の行のキー: 会計区分 + 所管（特別会計は特別会計名）+ 勘定 + 組織 + 項名。項コードは含めない（同じキーの行すべてに付ける） */
export const jikouKeyOf = (r: Pick<BudgetRequestTrendRow, 'acct' | 'min' | 'sub' | 'org' | 'name'>): string => [r.acct, r.min, r.sub, r.org, r.name].join('|');

/** 組織の行の事項要求のキー: 会計区分 + 所管（特別会計は特別会計名）+ 勘定 + 組織 */
export const jikouOrgKeyOf = (r: Pick<BudgetRequestTrendRow, 'acct' | 'min' | 'sub' | 'org'>): string => [r.acct, r.min, r.sub, r.org].join('|');

/** 事項要求の記載を、行の年度の値に合流させる（項の記載は jikou、組織の行の記載は orgJikou）。元のデータは変えない */
export function mergeJikou(data: BudgetRequestTrendData, jk: BudgetRequestJikouData): BudgetRequestTrendData {
  const byYear = new Map(Object.entries(jk.years).map(([y, list]) => [y, new Map(list.map(([k, forms, text]) => [k, { forms, text }]))]));
  const orgByYear = new Map(Object.entries(jk.orgs ?? {}).map(([y, list]) => [y, new Map(list)]));
  const rows = data.rows.map(r => {
    const key = jikouKeyOf(r); const orgKey = jikouOrgKeyOf(r);
    let y: BudgetRequestTrendRow['y'] | null = null;
    for (const [yr, v] of Object.entries(r.y)) {
      const hit = byYear.get(yr)?.get(key); const org = r.org ? orgByYear.get(yr)?.get(orgKey) : undefined;
      if (hit || org !== undefined) { y ??= { ...r.y }; y[yr] = { ...v, ...(hit ? { jikou: hit } : {}), ...(org !== undefined ? { orgJikou: org } : {}) }; }
    }
    return y ? { ...r, y } : r;
  });
  return { ...data, rows };
}

export function changeAmount(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year);
  return a && a.req !== null && a.prev !== null ? a.req - a.prev : null;
}
export function changeRate(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year);
  return a && a.req !== null && a.prev !== null && a.prev !== 0 ? (a.req - a.prev) / a.prev : null;
}
/** その年度に載り、前年度（の要求書）に無い。最初の年度では判定しない */
export const isNew = (r: BudgetRequestTrendRow, year: number, firstYear: number): boolean =>
  year > firstYear && !!yearOf(r, year) && !yearOf(r, year - 1);
/** 前年度にあり、その年度に無い */
export const isGone = (r: BudgetRequestTrendRow, year: number, firstYear: number): boolean =>
  year > firstYear && !yearOf(r, year) && !!yearOf(r, year - 1);
export const inAllYears = (r: BudgetRequestTrendRow, years: readonly number[]): boolean => years.every(y => !!yearOf(r, y));

/**
 * 文字列フィルタの判定。空の検索語は全件一致。正規表現は /sankey-svg と同じく大文字小文字を区別せず、
 * 不正・長すぎる（128 文字超）ときは何も一致させない。通常は大文字小文字を区別しない部分一致。
 */
export function textMatches(haystack: string, query: string, regex: boolean): boolean {
  const q = query.trim();
  if (!q) return true;
  if (regex) {
    if (q.length > MAX_REGEX_PATTERN_LENGTH) return false;
    try { return new RegExp(q, 'i').test(haystack); } catch { return false; }
  }
  return haystack.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

export function patternOf(r: BudgetRequestTrendRow, year: number, firstYear: number): TrendPattern | null {
  if (year <= firstYear) return null;
  const now = !!yearOf(r, year), before = !!yearOf(r, year - 1);
  return now && before ? '継続' : now ? '新規' : before ? '消滅' : null;
}

export function filterRows(rows: readonly BudgetRequestTrendRow[], f: TrendFilters, year: number, years: readonly number[], urls: readonly string[]): TrendRecord[] {
  const first = years[0];
  const groups = new Set(f.groups);
  const kept = rows.filter(r => {
    const a = yearOf(r, year);
    if (f.pattern === 'gone') { if (!isGone(r, year, first)) return false; } else if (!a) return false;
    if (f.accts.length > 0 && !f.accts.includes(acctLabelOf(r))) return false;
    if (!textMatches(r.name, f.name, f.nameRegex)) return false;
    if (!textMatches(`${r.org} ${r.sub}`, f.org, f.orgRegex)) return false;
    if (f.pattern === 'all5' && !inAllYears(r, years)) return false;
    if (f.pattern === 'new' && !isNew(r, year, first)) return false;
    if (f.shared && !(a && a.src.length > 1)) return false;
    if (f.mismatch && !(a && a.mismatch)) return false;
    if (f.transfer && !(a?.xfer && a.xfer.length > 0)) return false;
    if (f.codeChange && !a?.codeChanged) return false;
    if (f.newAcct && !a?.newAcct) return false;
    if (f.moved && !a?.moved) return false;
    if (f.jikou && !a?.jikou) return false;
    return true;
  });
  return kept.flatMap(r => recordsOf(r, year, urls)).filter(x => {
    if (groups.size > 0 && !groups.has(x.group)) return false;
    if (f.imagePage && !x.imagePage) return false;
    if (f.noPdfPage && !x.noPdfPage) return false;
    if (f.change) {
      const t = recordRate(x);
      if (t === null) return false;
      if (f.change === 'up10' && !(t >= 0.1)) return false;
      if (f.change === 'up50' && !(t >= 0.5)) return false;
      if (f.change === 'dn10' && !(t <= -0.1)) return false;
      if (f.change === 'dn50' && !(t <= -0.5)) return false;
    }
    return true;
  });
}

const PATTERN_ORDER: Record<TrendPattern, number> = { 新規: 0, 継続: 1, 消滅: 2 };

function sortValue(x: TrendRecord, key: TrendSortKey, year: number, firstYear: number): string | number | null {
  const r = x.row;
  switch (key) {
    case 'acct': return `${r.acct}${r.min}`;
    case 'pattern': { const p = patternOf(r, year, firstYear); return p === null ? null : PATTERN_ORDER[p]; }
    case 'group': return x.group;
    case 'org': return orgOf(r);
    case 'name': return r.name;
    case 'prev': return x.prev;
    case 'req': return x.req;
    case 'diff': return recordChange(x);
    case 'rate': return recordRate(x);
  }
}

/** 値の無い行は昇順・降順どちらでも末尾 */
export function sortRows(records: readonly TrendRecord[], key: TrendSortKey, dir: TrendSortDir, year: number, firstYear: number): TrendRecord[] {
  return [...records].sort((a, b) => {
    const x = sortValue(a, key, year, firstYear), y = sortValue(b, key, year, firstYear);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'string' && typeof y === 'string') return dir * x.localeCompare(y, 'ja');
    return dir * ((x as number) - (y as number));
  });
}

/** 翌年度の要求書が載せる前年度予算額 − その年度の要求額（要求→予算の査定。負なら要求より予算が少ない） */
export function assessmentGap(r: BudgetRequestTrendRow, year: number): number | null {
  const a = yearOf(r, year), n = yearOf(r, year + 1);
  return a && n && a.req !== null && n.prev !== null ? n.prev - a.req : null;
}

/** 要求書の公開元（PDF のドメイン）→ 府省庁名。載っている要求書の「どの府省の書か」を示す（キーには使わない） */
const PUBLISHER_BY_HOST: Record<string, string> = {
  'aoc.go.jp': 'サイバー通信情報監理委員会', 'caa.go.jp': '消費者庁', 'cao.go.jp': '内閣府', 'cas.go.jp': '内閣官房', 'cfa.go.jp': 'こども家庭庁', 'clb.go.jp': '内閣法制局',
  'courts.go.jp': '裁判所', 'dangai.go.jp': '裁判官弾劾裁判所', 'digital.go.jp': 'デジタル庁', 'env.go.jp': '環境省', 'fsa.go.jp': '金融庁', 'jbaudit.go.jp': '会計検査院',
  'jcrc.go.jp': '公害等調整委員会', 'jftc.go.jp': '公正取引委員会', 'jinji.go.jp': '人事院', 'kunaicho.go.jp': '宮内庁', 'maff.go.jp': '農林水産省', 'meti.go.jp': '経済産業省',
  'mext.go.jp': '文部科学省', 'mhlw.go.jp': '厚生労働省', 'mlit.go.jp': '国土交通省', 'mod.go.jp': '防衛省', 'mof.go.jp': '財務省', 'mofa.go.jp': '外務省', 'moj.go.jp': '法務省',
  'ndl.go.jp': '国立国会図書館', 'npa.go.jp': '警察庁', 'ppc.go.jp': '個人情報保護委員会', 'reconstruction.go.jp': '復興庁', 'sangiin.go.jp': '参議院', 'shugiin.go.jp': '衆議院',
  'sotsui.go.jp': '裁判官訴追委員会', 'soumu.go.jp': '総務省',
};

/** 要求書の URL → 公開元の府省庁名（未知のドメインはドメインのまま） */
export function publisherOf(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  return PUBLISHER_BY_HOST[host] ?? host;
}
