'use client';

import type { BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { changeAmount, changeRate, groupOf, isGone, isNew, orgOf, yearOf, type TrendSortDir, type TrendSortKey } from '@/app/lib/budget-request-trend';
import { changeColor, formatRate, formatSen, formatSenSigned } from './format';

const MAX_ROWS = 600;
const MIN_COLUMN_WIDTH = 48;

/** 列幅の既定（px）。所管は「［特］子ども・子育て支援」が折り返さない幅 */
export const DEFAULT_COLUMN_WIDTHS: Record<TrendSortKey, number> = { group: 184, org: 130, name: 220, prev: 112, req: 100, diff: 100, rate: 76 };

const chip = 'ml-1 rounded-full border px-1.5 text-[10px] align-middle';

export function TrendListPane({
  rows,
  year,
  firstYear,
  sortKey,
  sortDir,
  onSort,
  selectedKey,
  rowKey,
  onSelect,
  widths,
  onWidthsChange,
}: {
  /** 絞り込み・並べ替え済み */
  rows: readonly BudgetRequestTrendRow[];
  year: number;
  firstYear: number;
  sortKey: TrendSortKey;
  sortDir: TrendSortDir;
  onSort: (k: TrendSortKey) => void;
  selectedKey: string | null;
  rowKey: (r: BudgetRequestTrendRow) => string;
  onSelect: (r: BudgetRequestTrendRow) => void;
  widths: Record<string, number>;
  onWidthsChange: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
}) {
  const sum = rows.reduce(
    (s, r) => {
      const a = yearOf(r, year);
      return { req: s.req + (a?.req ?? 0), prev: s.prev + (a?.prev ?? 0) };
    },
    { req: 0, prev: 0 }
  );
  const cols: { key: TrendSortKey; label: string; left?: boolean }[] = [
    { key: 'group', label: '所管', left: true },
    { key: 'org', label: '組織', left: true },
    { key: 'name', label: '項名', left: true },
    { key: 'prev', label: '前年度予算額' },
    { key: 'req', label: '要求額' },
    { key: 'diff', label: '増減' },
    { key: 'rate', label: '増減率' },
  ];
  const shown = rows.slice(0, MAX_ROWS);
  const widthOf = (k: TrendSortKey) => widths[k] ?? DEFAULT_COLUMN_WIDTHS[k];
  const tableWidth = cols.reduce((n, c) => n + widthOf(c.key), 0);

  function startResize(e: React.MouseEvent, key: TrendSortKey) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startWidth = widthOf(key);
    const onMove = (ev: MouseEvent) => onWidthsChange(w => ({ ...w, [key]: Math.max(MIN_COLUMN_WIDTH, startWidth + ev.clientX - startX) }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
        <span><b className="tabular-nums text-neutral-800 dark:text-neutral-100">{rows.length.toLocaleString()}</b> 項</span>
        <span>要求額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.req)}</b></span>
        <span>前年度予算額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.prev)}</b></span>
        <span className="text-neutral-400">共管で複数の要求書に載る同一キーは1行にまとめて数えています</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <colgroup>{cols.map(c => <col key={c.key} style={{ width: widthOf(c.key) }} />)}</colgroup>
          <thead>
            <tr>
              {cols.map(c => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : undefined}
                  className={`sticky top-0 z-10 cursor-pointer select-none overflow-hidden whitespace-nowrap border-b border-neutral-200 bg-neutral-100 px-2 py-1.5 font-semibold text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800 ${c.left ? 'text-left' : 'text-right'}`}
                  onClick={() => onSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`${c.label}の列幅`}
                    onMouseDown={e => startResize(e, c.key)}
                    onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-emerald-500/40"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const a = yearOf(r, year);
              const d = changeAmount(r, year), t = changeRate(r, year);
              const key = rowKey(r);
              const selected = key === selectedKey;
              return (
                <tr
                  key={key}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(r)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }}
                  className={`cursor-pointer border-b border-neutral-100 dark:border-neutral-800 ${selected ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}`}
                >
                  <td className="break-words px-2 py-1 text-left">{groupOf(r)}</td>
                  <td className="break-words px-2 py-1 text-left">{orgOf(r)}</td>
                  <td className="break-words px-2 py-1 text-left font-medium">
                    {r.name}
                    {isNew(r, year, firstYear) && <span className={`${chip} border-emerald-600 text-emerald-700 dark:text-emerald-400`}>新規</span>}
                    {isGone(r, year, firstYear) && <span className={`${chip} border-orange-600 text-orange-700 dark:text-orange-400`}>この年度に無い</span>}
                    {a && a.src.length > 1 && <span className={`${chip} border-neutral-300 text-neutral-500 dark:border-neutral-600`}>共管</span>}
                    {a?.mismatch && <span className={`${chip} border-amber-600 text-amber-700 dark:text-amber-400`}>額不一致</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(a?.prev ?? null)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(a?.req ?? null)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(d)}`}>{formatSenSigned(d)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(t)}`}>{formatRate(t)}</td>
                </tr>
              );
            })}
            {rows.length > MAX_ROWS && (
              <tr><td colSpan={7} className="px-2 py-2 text-neutral-500">上位 {MAX_ROWS} 項を表示（全 {rows.length.toLocaleString()} 項）。絞り込みで減らしてください。</td></tr>
            )}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-8 text-center text-neutral-500">条件に合う項がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
