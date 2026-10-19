'use client';

/**
 * 概算要求の年度推移（項の粒度, FY2023〜）。
 *
 * 左にフィルタ、中に選択年度の一覧（前年度予算額・要求額・増減）、右に選んだ項の全年度分の表・グラフ・元の PDF へのリンク。
 * データは静的ファイル /data/v2/ui/budget-request-trend/kou.json.gz をブラウザが直接取得する（Vercel の関数には public/data を同梱しないため API を経由しない。
 * 他の v2 データと同じ方式）。仕様: docs/budget-request-trend-csv.md。
 * MOF の予算書との突合には依存しない。名称が変わった項は別の行（新規・消滅）になる。
 */

import { useEffect, useMemo, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import { fetchGzipJson } from '@/app/lib/v2-public-linkage';
import type { BudgetRequestTrendData, BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { INITIAL_TREND_FILTERS, filterRows, sortRows, type TrendFilters, type TrendSortDir, type TrendSortKey } from '@/app/lib/budget-request-trend';
import { TrendFilterPane } from '@/client/components/budget-request-trend/TrendFilterPane';
import { TrendListPane } from '@/client/components/budget-request-trend/TrendListPane';
import { TrendDetailPane } from '@/client/components/budget-request-trend/TrendDetailPane';

const rowKey = (r: BudgetRequestTrendRow): string => [r.acct, r.code, r.min, r.sub, r.org, r.name, r.kou ?? ''].join('|');
const FILTER_WIDTH = { def: 240, min: 180, max: 420 };
const DETAIL_WIDTH = { def: 430, min: 320, max: 760 };
const pane = 'min-h-0 min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';

/** ペイン間のつまみ。ドラッグで隣のペインの幅を変える（xl 以上のみ）。dir: 1 = 右へ動かすと広がる、-1 = 左へ動かすと広がる */
function Splitter({ label, width, limits, dir, onChange }: { label: string; width: number; limits: { min: number; max: number }; dir: 1 | -1; onChange: (w: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (ev: MouseEvent) => onChange(Math.min(limits.max, Math.max(limits.min, w0 + dir * (ev.clientX - x0))));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} onMouseDown={start} className="hidden w-1.5 shrink-0 cursor-col-resize rounded hover:bg-emerald-500/40 xl:block" />
  );
}

export default function BudgetRequestTrendPage() {
  const [data, setData] = useState<BudgetRequestTrendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = usePersistedState<number | null>('budget-request-trend:year', null);
  const [filters, setFilters] = useState<TrendFilters>(INITIAL_TREND_FILTERS);
  const [sortKey, setSortKey] = useState<TrendSortKey>('req');
  const [sortDir, setSortDir] = useState<TrendSortDir>(-1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filterWidth, setFilterWidth] = usePersistedState('budget-request-trend:filterWidth', FILTER_WIDTH.def);
  const [detailWidth, setDetailWidth] = usePersistedState('budget-request-trend:detailWidth', DETAIL_WIDTH.def);
  const [columnWidths, setColumnWidths] = usePersistedState<Record<string, number>>('budget-request-trend:columnWidths', {});

  useEffect(() => {
    const controller = new AbortController();
    fetchGzipJson<BudgetRequestTrendData>('/data/v2/ui/budget-request-trend/kou.json.gz', controller.signal)
      .then(setData)
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, []);

  const years = data?.years ?? [];
  const activeYear = data ? (year !== null && years.includes(year) ? year : years[years.length - 1]) : null;

  const rows = useMemo(() => {
    if (!data || activeYear === null) return [];
    return sortRows(filterRows(data.rows, filters, activeYear, data.years), sortKey, sortDir, activeYear, data.years[0]);
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
    else { setSortKey(k); setSortDir(k === 'acct' || k === 'group' || k === 'org' || k === 'name' || k === 'pattern' ? 1 : -1); }
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
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[240px_minmax(0,1fr)] xl:flex xl:gap-0">
        <section aria-label="フィルタ" className={`${pane} xl:w-[var(--fw)] xl:shrink-0`} style={{ '--fw': `${filterWidth}px` } as React.CSSProperties}>
          <TrendFilterPane rows={data.rows} years={years} year={activeYear} filters={filters} onChange={setFilters} />
        </section>
        <Splitter label="フィルタの幅" width={filterWidth} limits={FILTER_WIDTH} dir={1} onChange={setFilterWidth} />
        <section aria-label="項の一覧" className={`${pane} xl:min-w-0 xl:flex-1`}>
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
            widths={columnWidths}
            onWidthsChange={setColumnWidths}
          />
        </section>
        <Splitter label="詳細の幅" width={detailWidth} limits={DETAIL_WIDTH} dir={-1} onChange={setDetailWidth} />
        <section aria-label="詳細（全年度）" className={`${pane} overflow-auto lg:col-span-2 xl:col-span-1 xl:w-[var(--dw)] xl:shrink-0`} style={{ '--dw': `${detailWidth}px` } as React.CSSProperties}>
          <TrendDetailPane row={selected} years={years} year={activeYear} urls={data.urls} />
        </section>
      </main>
    </div>
  );
}
