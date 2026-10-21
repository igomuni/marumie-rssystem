/**
 * /budget-request-mof（概算要求と MOF 当初予算の差）の絞り込み・並べ替え。純粋関数のみ。
 * データ: types/budget-request-mof.ts。仕様: docs/budget-request-mof-ui.md。
 */

import type { BudgetRequestMofKind, BudgetRequestMofRow, BudgetRequestMofType } from '@/types/budget-request-mof';
import { publisherOf, textMatches } from '@/app/lib/budget-request-trend';

export type MofSortKey = 'group' | 'acct' | 'org' | 'name' | 'req' | 'mof' | 'diff' | 'rate';
export type MofSortDir = 1 | -1;
/** 差の大きさ: abs1 / abs10 / abs100 = |差| が 1 億・10 億・100 億円以上、up10 / dn10 = 差率が +10% 以上・−10% 以下 */
export type MofDiffFilter = '' | 'abs1' | 'abs10' | 'abs100' | 'up10' | 'dn10';

export interface MofFilters {
  /** 行の種類（空なら絞り込まない） */
  kinds: BudgetRequestMofKind[];
  groups: string[];
  accts: string[];
  org: string;
  orgRegex: boolean;
  name: string;
  nameRegex: boolean;
  /** 型（どれかを持てば一致。空なら絞り込まない） */
  types: BudgetRequestMofType[];
  /** 編成で決まる項（予備費・国債費・地方交付税交付金・地方特例交付金・繰入）を除く */
  noPlaceholder: boolean;
  diff: MofDiffFilter;
}

/** 額0の項は既定で隠す */
export const INITIAL_MOF_FILTERS: MofFilters = { kinds: ['matched', 'mofOnly', 'reqOnly'], groups: [], accts: [], org: '', orgRegex: false, name: '', nameRegex: false, types: [], noPlaceholder: false, diff: '' };

export const KIND_LABEL: Record<BudgetRequestMofKind, string> = { matched: '対応あり', mofOnly: 'MOFのみ', reqOnly: '概算要求のみ', zero: '額0の項' };

/** 差 = 当初予算額 − 要求額（正なら要求より予算が大きい）。どちらかが無ければ null */
export const diffOf = (r: BudgetRequestMofRow): number | null => (r.mof !== null && r.req !== null ? r.mof - r.req : null);
export const rateOf = (r: BudgetRequestMofRow): number | null => { const d = diffOf(r); return d !== null && r.req ? d / r.req : null; };

export const acctLabelOf = (r: BudgetRequestMofRow): string => (r.acct === 0 ? '一般会計' : `${r.min}特別会計`);
export const orgOf = (r: BudgetRequestMofRow): string => (r.acct === 0 ? r.org : r.sub);

/**
 * 所管（一覧の列・フィルタ）。年度推移（/budget-request-trend）と同じく、要求書の公開元の府省（PDF のドメイン由来。複数は「、」）。
 * 内閣府の外局（こども家庭庁・消費者庁・金融庁など）は、それぞれの府省になる（予算書の所管はどれも内閣府）。
 * 要求書の無い行（MOF のみ）は MOF の所管で、共管（「、」「及び」で列挙）は「共管」とする
 */
export function groupOf(r: BudgetRequestMofRow, urls: readonly string[]): string {
  const pubs = [...new Set(r.books.map(([u]) => publisherOf(urls[u])))];
  if (pubs.length > 0) return pubs.join('、');
  return /、|及び/.test(r.grp) ? '共管' : r.grp;
}

const DIFF_THRESHOLD: Record<'abs1' | 'abs10' | 'abs100', number> = { abs1: 100_000, abs10: 1_000_000, abs100: 10_000_000 }; // 千円

export function filterMofRows(rows: readonly BudgetRequestMofRow[], f: MofFilters, year: number, urls: readonly string[]): BudgetRequestMofRow[] {
  const kinds = new Set(f.kinds), groups = new Set(f.groups), types = new Set(f.types);
  return rows.filter(r => {
    if (r.y !== year) return false;
    if (kinds.size > 0 && !kinds.has(r.kind)) return false;
    if (f.accts.length > 0 && !f.accts.includes(acctLabelOf(r))) return false;
    if (groups.size > 0 && !groupOf(r, urls).split('、').some(g => groups.has(g))) return false;
    if (!textMatches(orgOf(r), f.org, f.orgRegex)) return false;
    if (!textMatches(`${r.name} ${r.mofName ?? ''}`, f.name, f.nameRegex)) return false;
    if (types.size > 0 && !r.types.some(t => types.has(t))) return false;
    if (f.noPlaceholder && r.types.includes('編成で決まる')) return false;
    if (f.diff) {
      const d = diffOf(r), t = rateOf(r);
      if (f.diff === 'up10' || f.diff === 'dn10') { if (t === null || (f.diff === 'up10' ? t < 0.1 : t > -0.1)) return false; }
      else if (d === null || Math.abs(d) < DIFF_THRESHOLD[f.diff]) return false;
    }
    return true;
  });
}

/** 並べ替え。金額・差は値の無い行を末尾に置く。差は絶対値ではなく符号つき（既定の降順で、予算が要求を大きく上回る項が先頭） */
export function sortMofRows(rows: readonly BudgetRequestMofRow[], key: MofSortKey, dir: MofSortDir, urls: readonly string[]): BudgetRequestMofRow[] {
  const val = (r: BudgetRequestMofRow): string | number | null => {
    switch (key) {
      case 'group': return groupOf(r, urls);
      case 'acct': return acctLabelOf(r);
      case 'org': return orgOf(r);
      case 'name': return r.name;
      case 'req': return r.req;
      case 'mof': return r.mof;
      case 'diff': return diffOf(r);
      case 'rate': return rateOf(r);
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (typeof x === 'string' && typeof y === 'string') return dir * x.localeCompare(y, 'ja');
    return dir * ((x as number) - (y as number));
  });
}

/** 一覧の行のキー（年度の中で一意） */
export const mofRowKey = (r: BudgetRequestMofRow): string => [r.y, r.kind, r.acct, r.grp, r.min, r.sub, r.org, r.name].join('|');
