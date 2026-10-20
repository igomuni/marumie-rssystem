'use client';

import { useMemo, useState } from 'react';
import type { BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { MultiSelectCombo } from '@/client/components/mof-kou/MultiSelectCombo';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { MAX_REGEX_PATTERN_LENGTH } from '@/app/lib/sankey-query';
import { INITIAL_TREND_FILTERS, acctLabelOf, groupsOf, inAllYears, isGone, isNew, yearOf, type ChangeFilter, type PatternFilter, type TrendFilters } from '@/app/lib/budget-request-trend';

const section = 'flex flex-col gap-1.5 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800';
const heading = 'text-[11px] font-semibold tracking-wide text-neutral-500';
const row = 'flex cursor-pointer items-center gap-1.5 text-xs text-neutral-800 dark:text-neutral-200';
const count = 'ml-auto tabular-nums text-neutral-400';

export function TrendFilterPane({
  rows,
  years,
  urls,
  year,
  filters,
  onChange,
}: {
  rows: readonly BudgetRequestTrendRow[];
  years: readonly number[];
  urls: readonly string[];
  year: number;
  filters: TrendFilters;
  onChange: (f: TrendFilters) => void;
}) {
  const first = years[0];
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (yearOf(r, year)) for (const g of groupsOf(r, year, urls)) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, year, urls]);
  // 会計の選択肢: 一般会計と、特別会計ごと（件数の多い順）。件数は選択年度に載る項
  const accts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (yearOf(r, year)) m.set(acctLabelOf(r), (m.get(acctLabelOf(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] === '一般会計' ? -1 : b[0] === '一般会計' ? 1 : b[1] - a[1]));
  }, [rows, year]);
  const counts = useMemo(
    () => ({
      all5: rows.filter(r => inAllYears(r, years)).length,
      isNew: rows.filter(r => isNew(r, year, first)).length,
      isGone: rows.filter(r => isGone(r, year, first)).length,
      shared: rows.filter(r => (yearOf(r, year)?.src.length ?? 0) > 1).length,
      mismatch: rows.filter(r => yearOf(r, year)?.mismatch).length,
    }),
    [rows, years, year, first]
  );
  const [open, setOpen] = useState<'group' | 'acct' | null>(null);
  // コンボの選択肢は「名称（件数）」。選択状態は名称で持つ（年度を替えて選択肢に無い名称は、そのまま残す）
  const comboProps = (entries: [string, number][], selected: string[], key: 'groups' | 'accts', field: 'group' | 'acct') => {
    const labelOf = new Map(entries.map(([name, n]) => [name, `${name}（${n.toLocaleString()}）`]));
    const nameOf = new Map([...labelOf].map(([name, label]) => [label, name]));
    return {
      options: [...labelOf.values()],
      selected: selected.filter(v => labelOf.has(v)).map(v => labelOf.get(v)!),
      onChange: (next: string[]) => set({ [key]: [...selected.filter(v => !labelOf.has(v)), ...next.map(l => nameOf.get(l)!)] } as Partial<TrendFilters>),
      open: open === field,
      onOpenChange: (o: boolean) => setOpen(o ? field : open === field ? null : open),
    };
  };
  const set = (patch: Partial<TrendFilters>) => onChange({ ...filters, ...patch });
  const newGoneDisabled = year === first;
  const pattern = (value: PatternFilter, label: string, n: number | null, disabled = false) => (
    <label className={`${row} ${disabled ? 'opacity-40' : ''}`}>
      <input type="radio" name="pattern" checked={filters.pattern === value} disabled={disabled} onChange={() => set({ pattern: value })} />
      {label}
      {n !== null && <span className={count}>{n.toLocaleString()}</span>}
    </label>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-semibold text-neutral-500">フィルタ</span>
        <button type="button" onClick={() => onChange(INITIAL_TREND_FILTERS)} className="rounded border border-neutral-300 px-2 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          解除
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={section}>
          <h3 className={heading}>所管</h3>
          <MultiSelectCombo label="所管" {...comboProps(groups, filters.groups, 'groups', 'group')} />
        </div>
        <div className={section}>
          <h3 className={heading}>会計</h3>
          <MultiSelectCombo label="会計" {...comboProps(accts, filters.accts, 'accts', 'acct')} />
        </div>
        <div className={`${section} text-xs`}>
          <RegexTextFilter
            label="組織／勘定"
            value={filters.org}
            onChange={org => set({ org })}
            useRegex={filters.orgRegex}
            onToggleRegex={orgRegex => set({ orgRegex })}
            maxRegexLength={MAX_REGEX_PATTERN_LENGTH}
          />
          <RegexTextFilter
            label="項名"
            value={filters.name}
            onChange={name => set({ name })}
            useRegex={filters.nameRegex}
            onToggleRegex={nameRegex => set({ nameRegex })}
            maxRegexLength={MAX_REGEX_PATTERN_LENGTH}
          />
        </div>
        <div className={section}>
          <h3 className={heading}>出現パターン</h3>
          {pattern('all', 'すべて', null)}
          {pattern('all5', `${years.length}年度とも`, counts.all5)}
          {pattern('new', '新規（前年度の要求書に無い）', newGoneDisabled ? null : counts.isNew, newGoneDisabled)}
          {pattern('gone', '消滅（前年度にあり、この年度に無い）', newGoneDisabled ? null : counts.isGone, newGoneDisabled)}
        </div>
        <div className={section}>
          <h3 className={heading}>要求額の前年度予算額比</h3>
          <select
            value={filters.change}
            onChange={e => set({ change: e.target.value as ChangeFilter })}
            aria-label="要求額の前年度予算額比"
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">指定なし</option>
            <option value="up10">+10%以上</option>
            <option value="up50">+50%以上</option>
            <option value="dn10">−10%以下</option>
            <option value="dn50">−50%以下</option>
          </select>
        </div>
        <div className={section}>
          <h3 className={heading}>印</h3>
          <label className={row}>
            <input type="checkbox" checked={filters.shared} onChange={e => set({ shared: e.target.checked })} />
            複数の要求書に載る
            <span className={count}>{counts.shared}</span>
          </label>
          <label className={row}>
            <input type="checkbox" checked={filters.mismatch} onChange={e => set({ mismatch: e.target.checked })} />
            金額不一致
            <span className={count}>{counts.mismatch}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
