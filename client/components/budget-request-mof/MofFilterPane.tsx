'use client';

import { useMemo, useState } from 'react';
import type { BudgetRequestMofKind, BudgetRequestMofRow } from '@/types/budget-request-mof';
import { MultiSelectCombo } from '@/client/components/mof-kou/MultiSelectCombo';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { MAX_REGEX_PATTERN_LENGTH } from '@/app/lib/sankey-query';
import { INITIAL_MOF_FILTERS, KIND_LABEL, acctLabelOf, groupOf, type MofDiffFilter, type MofFilters } from '@/app/lib/budget-request-mof';
import { TYPE_INFO, TYPE_ORDER } from './typeInfo';

const section = 'flex flex-col gap-1.5 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800';
const heading = 'text-[11px] font-semibold tracking-wide text-neutral-500';
const row = 'flex cursor-pointer items-center gap-1.5 text-xs text-neutral-800 dark:text-neutral-200';
const count = 'ml-auto tabular-nums text-neutral-400';
const KINDS: BudgetRequestMofKind[] = ['matched', 'mofOnly', 'reqOnly', 'zero'];
const KIND_NOTE: Record<BudgetRequestMofKind, string> = { matched: '', mofOnly: '（概算要求に無い）', reqOnly: '（予算書に無い）', zero: '（前年度・要求とも 0）' };

export function MofFilterPane({ rows, urls, year, filters, onChange }: { rows: readonly BudgetRequestMofRow[]; urls: readonly string[]; year: number; filters: MofFilters; onChange: (f: MofFilters) => void }) {
  const inYear = useMemo(() => rows.filter(r => r.y === year), [rows, year]);
  const tally = (keys: string[][]) => { const m = new Map<string, number>(); for (const ks of keys) for (const k of ks) m.set(k, (m.get(k) ?? 0) + 1); return m; };
  const groups = useMemo(() => [...tally(inYear.map(r => groupOf(r, urls).split('、')))].sort((a, b) => b[1] - a[1]), [inYear, urls]);
  const accts = useMemo(() => [...tally(inYear.map(r => [acctLabelOf(r)]))].sort((a, b) => (a[0] === '一般会計' ? -1 : b[0] === '一般会計' ? 1 : b[1] - a[1])), [inYear]);
  const kindCount = useMemo(() => tally(inYear.map(r => [r.kind])), [inYear]);
  const typeCount = useMemo(() => tally(inYear.map(r => r.types)), [inYear]);
  const [open, setOpen] = useState<'group' | 'acct' | null>(null);
  const set = (patch: Partial<MofFilters>) => onChange({ ...filters, ...patch });
  // コンボの選択肢は「名称（件数）」。選択状態は名称で持つ（年度を替えて選択肢に無い名称は、そのまま残す）
  const comboProps = (entries: [string, number][], selected: string[], key: 'groups' | 'accts', field: 'group' | 'acct') => {
    const labelOf = new Map(entries.map(([name, n]) => [name, `${name}（${n.toLocaleString()}）`]));
    const nameOf = new Map([...labelOf].map(([name, label]) => [label, name]));
    return {
      options: [...labelOf.values()],
      selected: selected.filter(v => labelOf.has(v)).map(v => labelOf.get(v)!),
      onChange: (next: string[]) => set({ [key]: [...selected.filter(v => !labelOf.has(v)), ...next.map(l => nameOf.get(l)!)] } as Partial<MofFilters>),
      open: open === field,
      onOpenChange: (o: boolean) => setOpen(o ? field : open === field ? null : open),
    };
  };
  const toggle = <T,>(list: T[], v: T, on: boolean): T[] => (on ? [...list, v] : list.filter(x => x !== v));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-semibold text-neutral-500">フィルタ</span>
        <button type="button" onClick={() => onChange(INITIAL_MOF_FILTERS)} className="rounded border border-neutral-300 px-2 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
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
          <RegexTextFilter label="組織／勘定" value={filters.org} onChange={org => set({ org })} useRegex={filters.orgRegex} onToggleRegex={orgRegex => set({ orgRegex })} maxRegexLength={MAX_REGEX_PATTERN_LENGTH} />
          <RegexTextFilter label="項名" value={filters.name} onChange={name => set({ name })} useRegex={filters.nameRegex} onToggleRegex={nameRegex => set({ nameRegex })} maxRegexLength={MAX_REGEX_PATTERN_LENGTH} />
        </div>
        <div className={section}>
          <h3 className={heading}>行の種類</h3>
          {KINDS.map(k => (
            <label key={k} className={row}>
              <input type="checkbox" checked={filters.kinds.includes(k)} onChange={e => set({ kinds: toggle(filters.kinds, k, e.target.checked) })} />
              {KIND_LABEL[k]}{KIND_NOTE[k]}
              <span className={count}>{(kindCount.get(k) ?? 0).toLocaleString()}</span>
            </label>
          ))}
        </div>
        <div className={section}>
          <h3 className={heading}>差（当初予算額 − 要求額）</h3>
          <select value={filters.diff} onChange={e => set({ diff: e.target.value as MofDiffFilter })} aria-label="差の大きさ" className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <option value="">指定なし</option>
            <option value="abs1">|差| が 1 億円以上</option>
            <option value="abs10">|差| が 10 億円以上</option>
            <option value="abs100">|差| が 100 億円以上</option>
            <option value="up10">差率 +10% 以上</option>
            <option value="dn10">差率 −10% 以下</option>
          </select>
          <label className={row}>
            <input type="checkbox" checked={filters.noPlaceholder} onChange={e => set({ noPlaceholder: e.target.checked })} />
            仮置きの項を除く
            <span className={count}>{(typeCount.get('仮置き') ?? 0).toLocaleString()}</span>
          </label>
        </div>
        <div className={section}>
          <h3 className={heading}>差の理由の型（どれかを持つ項）</h3>
          {TYPE_ORDER.map(t => (
            <label key={t} className={row} title={TYPE_INFO[t].text}>
              <input type="checkbox" checked={filters.types.includes(t)} onChange={e => set({ types: toggle(filters.types, t, e.target.checked) })} />
              {t}
              <span className={count}>{(typeCount.get(t) ?? 0).toLocaleString()}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
