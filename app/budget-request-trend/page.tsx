'use client';

/**
 * 概算要求の年度推移（項の粒度, FY2023〜）。
 *
 * 左にフィルタ、中に選択年度の一覧（前年度予算額・要求額・増減）、右に選んだ項の全年度分の表・グラフ・元の PDF へのリンク。
 * データは /api/budget-request-trend（public/data/v2/ui/budget-request-trend/kou.json.gz）。仕様: docs/budget-request-trend-csv.md。
 * MOF の予算書との突合には依存しない。名称が変わった項は別の行（新規・消滅）になる。
 */

import { useEffect, useMemo, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import type { BudgetRequestTrendData, BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { INITIAL_TREND_FILTERS, filterRows, sortRows, type TrendFilters, type TrendSortDir, type TrendSortKey } from '@/app/lib/budget-request-trend';
import { TrendFilterPane } from '@/client/components/budget-request-trend/TrendFilterPane';
import { TrendListPane } from '@/client/components/budget-request-trend/TrendListPane';
import { TrendDetailPane } from '@/client/components/budget-request-trend/TrendDetailPane';

const rowKey = (r: BudgetRequestTrendRow): string => [r.acct, r.code, r.min, r.sub, r.org, r.name].join('|');
const pane = 'min-h-0 min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';

export default function BudgetRequestTrendPage() {
  const [data, setData] = useState<BudgetRequestTrendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = usePersistedState<number | null>('budget-request-trend:year', null);
  const [filters, setFilters] = useState<TrendFilters>(INITIAL_TREND_FILTERS);
  const [sortKey, setSortKey] = useState<TrendSortKey>('req');
  const [sortDir, setSortDir] = useState<TrendSortDir>(-1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/budget-request-trend')
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as BudgetRequestTrendData;
      })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const years = data?.years ?? [];
  const activeYear = data ? (year !== null && years.includes(year) ? year : years[years.length - 1]) : null;

  const rows = useMemo(() => {
    if (!data || activeYear === null) return [];
    return sortRows(filterRows(data.rows, filters, activeYear, data.years), sortKey, sortDir, activeYear);
  }, [data, filters, sortKey, sortDir, activeYear]);

  const selected = useMemo(() => (data && selectedKey ? data.rows.find(r => rowKey(r) === selectedKey) ?? null : null), [data, selectedKey]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">データの読み込みに失敗しました: {error}</p>
      </main>
    );
  }
  if (!data || activeYear === null) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-neutral-500">読み込み中…</p>
      </main>
    );
  }

  const lastYear = years[years.length - 1];
  const onSort = (k: TrendSortKey) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === 'group' || k === 'org' || k === 'name' ? 1 : -1); }
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold">概算要求 年度推移</h1>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            項の粒度 · FY{years[0]}–FY{lastYear} · 全 {data.rows.length.toLocaleString()} 項 · 出典: 各府省の歳出概算要求書
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect value={String(activeYear)} onChange={y => setYear(Number(y))} years={years} />
          <PageNavMenu current="/budget-request-trend" />
        </div>
      </header>
      {activeYear === lastYear && (
        <p className="mx-3 mb-2 shrink-0 border-l-[3px] border-amber-600 bg-amber-50 px-2.5 py-1.5 text-xs dark:bg-amber-950/40">
          FY{lastYear} は厚生労働省の歳出概算要求書（文字層なし）が未収録のため、厚労省の項が出ません。合計や「消滅」の絞り込みは、この欠けを含みます。
        </p>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_430px]">
        <section aria-label="フィルタ" className={pane}>
          <TrendFilterPane rows={data.rows} years={years} year={activeYear} filters={filters} onChange={setFilters} />
        </section>
        <section aria-label="項の一覧" className={pane}>
          <TrendListPane
            rows={rows}
            year={activeYear}
            firstYear={years[0]}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            selectedKey={selectedKey}
            rowKey={rowKey}
            onSelect={r => setSelectedKey(rowKey(r))}
          />
        </section>
        <section aria-label="詳細（全年度）" className={`${pane} overflow-auto lg:col-span-2 xl:col-span-1`}>
          <TrendDetailPane row={selected} years={years} year={activeYear} urls={data.urls} />
        </section>
      </main>
    </div>
  );
}
