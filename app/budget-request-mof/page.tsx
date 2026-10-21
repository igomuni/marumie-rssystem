'use client';

/**
 * 概算要求と当初予算（MOF の予算書・政府案）の差（項の粒度, FY2023〜2026）。
 *
 * 左にフィルタ、中に選択年度の一覧（要求額・当初予算額・差）または分布図（横軸 = 要求額、縦軸 = 当初予算額）、右に選んだ項の要求書へのリンクと差の理由の型。
 * データは静的ファイル /data/v2/ui/budget-request-mof/kou.json.gz をブラウザが直接取得する（Vercel の関数には public/data を同梱しないため API を経由しない）。
 * 仕様: docs/budget-request-mof-ui.md。年度推移（/budget-request-trend）とは別のページ（MOF との突合を年度推移に混ぜない）。
 */

import { useEffect, useMemo, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import { fetchGzipJson } from '@/app/lib/v2-public-linkage';
import type { BudgetRequestMofData } from '@/types/budget-request-mof';
import { INITIAL_MOF_FILTERS, filterMofRows, mofRowKey, sortMofRows, type MofFilters, type MofSortDir, type MofSortKey } from '@/app/lib/budget-request-mof';
import { MofFilterPane } from '@/client/components/budget-request-mof/MofFilterPane';
import { MofListPane } from '@/client/components/budget-request-mof/MofListPane';
import { MofDetailPane } from '@/client/components/budget-request-mof/MofDetailPane';
import { MofScatter } from '@/client/components/budget-request-mof/MofScatter';

const FILTER_WIDTH = { def: 240, min: 180, max: 420 };
const DETAIL_WIDTH = { def: 400, min: 300, max: 700 };
// overflow は枠ごとに付ける（overflow-hidden と overflow-auto を同時に付けると hidden が効き、詳細がスクロールできない）
const pane = 'min-h-0 min-w-0 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';

/** ペイン間のつまみ（/budget-request-trend と同じ）。ドラッグで隣のペインの幅を変える（xl 以上のみ） */
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
  return <div role="separator" aria-orientation="vertical" aria-label={label} onMouseDown={start} className="hidden w-1.5 shrink-0 cursor-col-resize rounded hover:bg-emerald-500/40 xl:block" />;
}

export default function BudgetRequestMofPage() {
  const [data, setData] = useState<BudgetRequestMofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = usePersistedState<number | null>('budget-request-mof:year', null);
  const [filters, setFilters] = useState<MofFilters>(INITIAL_MOF_FILTERS);
  const [sortKey, setSortKey] = useState<MofSortKey>('diff');
  const [sortDir, setSortDir] = useState<MofSortDir>(-1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filterWidth, setFilterWidth] = usePersistedState('budget-request-mof:filterWidth', FILTER_WIDTH.def);
  const [detailWidth, setDetailWidth] = usePersistedState('budget-request-mof:detailWidth', DETAIL_WIDTH.def);
  const [columnWidths, setColumnWidths] = usePersistedState<Record<string, number>>('budget-request-mof:columnWidths', {});
  const [view, setView] = usePersistedState<'list' | 'scatter'>('budget-request-mof:view', 'list');

  useEffect(() => {
    const controller = new AbortController();
    fetchGzipJson<BudgetRequestMofData>('/data/v2/ui/budget-request-mof/kou.json.gz', controller.signal)
      .then(setData)
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, []);

  const years = data?.years ?? [];
  const activeYear = data ? (year !== null && years.includes(year) ? year : years[years.length - 1]) : null;
  const rows = useMemo(() => (data && activeYear !== null ? sortMofRows(filterMofRows(data.rows, filters, activeYear, data.urls), sortKey, sortDir, data.urls) : []), [data, filters, sortKey, sortDir, activeYear]);
  const selected = useMemo(() => (data && selectedKey ? data.rows.find(r => mofRowKey(r) === selectedKey) ?? null : null), [data, selectedKey]);

  if (error) return <main className="mx-auto max-w-3xl p-8"><p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">データの読み込みに失敗しました: {error}</p></main>;
  if (!data || activeYear === null) return <main className="mx-auto max-w-3xl p-8"><p className="text-sm text-neutral-500">読み込み中…</p></main>;

  const onSort = (k: MofSortKey) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === 'group' || k === 'acct' || k === 'org' || k === 'name' ? 1 : -1); }
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold">概算要求と当初予算</h1>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            項の粒度 · FY{years[0]}–FY{years[years.length - 1]} · 差 = 当初予算額（予算書・国会提出時の政府案）− 概算要求額 · 出典: 各府省の歳出概算要求書、財務省の予算書
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect value={String(activeYear)} onChange={y => { setYear(Number(y)); setSelectedKey(null); }} years={years} />
          <PageNavMenu current="/budget-request-mof" />
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[240px_minmax(0,1fr)] xl:flex xl:gap-0">
        <section aria-label="フィルタ" className={`${pane} overflow-hidden xl:w-[var(--fw)] xl:shrink-0`} style={{ '--fw': `${filterWidth}px` } as React.CSSProperties}>
          <MofFilterPane rows={data.rows} urls={data.urls} year={activeYear} filters={filters} onChange={setFilters} />
        </section>
        <Splitter label="フィルタの幅" width={filterWidth} limits={FILTER_WIDTH} dir={1} onChange={setFilterWidth} />
        <section aria-label="項の一覧" className={`${pane} flex flex-col overflow-hidden xl:min-w-0 xl:flex-1`}>
          <div role="tablist" aria-label="表示" className="flex shrink-0 gap-1 border-b border-neutral-200 px-3 pt-2 text-xs dark:border-neutral-800">
            {(['list', 'scatter'] as const).map(v => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-t border-b-2 px-2.5 py-1 ${view === v ? 'border-emerald-600 font-semibold text-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}>
                {v === 'list' ? '一覧' : '分布図'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {view === 'list'
              ? <MofListPane rows={rows} urls={data.urls} sortKey={sortKey} sortDir={sortDir} onSort={onSort} selectedKey={selectedKey} onSelect={r => setSelectedKey(mofRowKey(r))} widths={columnWidths} onWidthsChange={setColumnWidths} />
              : <MofScatter rows={rows} selectedKey={selectedKey} onSelect={r => setSelectedKey(mofRowKey(r))} />}
          </div>
        </section>
        <Splitter label="詳細の幅" width={detailWidth} limits={DETAIL_WIDTH} dir={-1} onChange={setDetailWidth} />
        <section aria-label="詳細" className={`${pane} overflow-auto lg:col-span-2 xl:col-span-1 xl:w-[var(--dw)] xl:shrink-0`} style={{ '--dw': `${detailWidth}px` } as React.CSSProperties}>
          <MofDetailPane row={selected} urls={data.urls} version={data.versions[String(activeYear)] ?? ''} />
        </section>
      </main>
    </div>
  );
}
