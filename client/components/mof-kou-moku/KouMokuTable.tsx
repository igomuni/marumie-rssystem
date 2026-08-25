'use client';

/**
 * 科目別内訳（項・目）一覧の表。並べ替え・列幅リサイズ・行の詳細展開を持つ。
 * `/mof-jikou` の JikouTable.tsx と同じ構成。データの絞り込みとページングは呼び出し側の責務。
 */

import { Fragment } from 'react';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import { changeRate, formatChangeRate, formatYen } from '@/client/components/mof-jikou/format';
import {
  ACCOUNT_LABEL,
  COLUMNS,
  DEFAULT_WIDTHS,
  MIN_COLUMN_WIDTH,
  orgColumn,
  type ColumnSpec,
  type SortDir,
  type SortKey,
} from './columns';

interface Props {
  /** 表示するページ分の目 */
  items: MOFKouMokuItem[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (column: ColumnSpec) => void;
  widths: Record<string, number>;
  onWidthsChange: (next: Record<string, number>) => void;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  emptyMessage?: string;
}

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouMokuTable({
  items,
  sortKey,
  sortDir,
  onToggleSort,
  widths,
  onWidthsChange,
  expandedId,
  onToggleExpand,
  emptyMessage = '条件に合う目がありません。',
}: Props) {
  const tableWidth = COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);

  function startResize(event: React.MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] ?? DEFAULT_WIDTHS[key];
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + e.clientX - startX);
      onWidthsChange({ ...widths, [key]: next });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: tableWidth }}>
      <colgroup>
        {COLUMNS.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-neutral-100 text-left text-neutral-500 dark:bg-neutral-800">
        <tr>
          {COLUMNS.map(col => {
            const active = sortKey === col.key;
            return (
              <th
                key={col.key}
                scope="col"
                title={col.note}
                aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`relative select-none p-0 font-medium ${
                  active ? 'text-neutral-900 dark:text-neutral-100' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleSort(col)}
                  className={`w-full px-2 py-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                    col.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  <span className="truncate align-middle">{col.label}</span>
                  <span className="ml-0.5 inline-block w-2.5 align-middle text-[9px]">
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${col.label}の列幅を変更`}
                  onMouseDown={e => startResize(e, col.key)}
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-neutral-400/60"
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const rate = changeRate(item.amount, item.previousAmount);
          const isOpen = expandedId === item.id;
          return (
            <Fragment key={item.id}>
              <tr
                onClick={() => onToggleExpand(isOpen ? null : item.id)}
                className={`cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                  isOpen ? 'bg-neutral-50 dark:bg-neutral-900' : ''
                }`}
              >
                <td className="truncate px-2 py-1.5 text-neutral-500">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`${item.subItemName} の詳細`}
                    onClick={e => {
                      e.stopPropagation();
                      onToggleExpand(isOpen ? null : item.id);
                    }}
                    className="mr-1 align-middle text-[9px] text-neutral-400"
                  >
                    {isOpen ? '▼' : '▶'}
                  </button>
                  {ACCOUNT_LABEL[item.accountType]}
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.ministry || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{orgColumn(item) || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.subAccount || '—'}</span>
                </td>
                <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{item.sectionCode}</td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.sectionName}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">
                    {item.majorExpenseName || (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                  </span>
                </td>
                <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{item.subItemCode}</td>
                <td className="px-2 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="line-clamp-2">{item.subItemName}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">
                    {item.purposeName || (item.purposeCode ? `(${item.purposeCode})` : '—')}
                  </span>
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatYen(item.amount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.previousAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.difference)}
                </td>
                <td className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}>
                  {formatChangeRate(rate)}
                </td>
              </tr>
              {isOpen && (
                <tr className="bg-neutral-50 dark:bg-neutral-900">
                  <td colSpan={COLUMNS.length} className="border-b border-neutral-200 p-0 dark:border-neutral-800">
                    <div className="sticky left-0 w-[calc(100vw-3rem)] px-4 py-3">
                      <dl className="grid grid-cols-[8rem_auto] gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                        <dt className="text-neutral-400">合成キー</dt>
                        <dd className="max-w-[40rem] break-all font-mono">{item.key}</dd>
                        <dt className="text-neutral-400">行ID</dt>
                        <dd className="font-mono">{item.id}</dd>
                        <dt className="text-neutral-400">目分類コード</dt>
                        <dd className="font-mono">{item.subItemCode || '—'}</dd>
                        <dt className="text-neutral-400">使途別分類コード</dt>
                        <dd className="font-mono">
                          {item.purposeCode || '—'}
                          {item.purposeName ? `（${item.purposeName}）` : ''}
                        </dd>
                        <dt className="text-neutral-400">主要経費コード</dt>
                        <dd className="font-mono">{item.majorExpenseCode || '—'}</dd>
                      </dl>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-neutral-500">
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
