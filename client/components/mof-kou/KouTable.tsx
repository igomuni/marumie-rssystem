'use client';

/**
 * 項一覧の表。並べ替え・列幅リサイズ・行の詳細展開を持つ。
 * `/mof-kou-moku` の KouMokuTable.tsx と同じ構成だが、行そのものが集計値
 * （事項数・目数・RS事業数）を持つため、一覧側にRS紐づけ用のバッジ列は無い。
 * 展開時の詳細（事項一覧・目一覧・RS事業一覧）だけをオンデマンドで取得する。
 */

import { Fragment } from 'react';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouSectionDetail, MOFKouSectionSummary } from '@/types/mof-kou';
import { changeRate, formatChangeRate, formatYen } from '@/client/components/mof-jikou/format';
import { ACCOUNT_LABEL, COLUMNS, DEFAULT_WIDTHS, MIN_COLUMN_WIDTH, orgColumn, type ColumnSpec, type SortDir, type SortKey } from './columns';

interface Props {
  items: MOFKouSectionSummary[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (column: ColumnSpec) => void;
  widths: Record<string, number>;
  onWidthsChange: (next: Record<string, number>) => void;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  detail: MOFKouSectionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  /** /sankey-svg へのリンクに使うRS事業年度。紐づけデータ未生成なら null */
  linkageRsYear: number | null;
  linkageIsCarriedOver: boolean;
  linkageSourceBudgetYear: number | null;
  emptyMessage?: string;
}

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouTable({
  items,
  sortKey,
  sortDir,
  onToggleSort,
  widths,
  onWidthsChange,
  expandedId,
  onToggleExpand,
  detail,
  detailLoading,
  detailError,
  linkageRsYear,
  linkageIsCarriedOver,
  linkageSourceBudgetYear,
  emptyMessage = '条件に合う項がありません。',
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

  if (items.length === 0) {
    return <p className="p-6 text-center text-xs text-neutral-400">{emptyMessage}</p>;
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
                className={`relative select-none p-0 font-medium ${active ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
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
        {items.map(row => {
          const rate = changeRate(row.amount, row.previousAmount);
          const isOpen = expandedId === row.id;
          return (
            <Fragment key={row.id}>
              <tr
                onClick={() => onToggleExpand(isOpen ? null : row.id)}
                className={`cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                  isOpen ? 'bg-neutral-50 dark:bg-neutral-900' : ''
                }`}
              >
                <td className="truncate px-2 py-1.5 text-neutral-500">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`${row.sectionName} の詳細`}
                    onClick={e => {
                      e.stopPropagation();
                      onToggleExpand(isOpen ? null : row.id);
                    }}
                    className="mr-1 align-middle text-[9px] text-neutral-400"
                  >
                    {isOpen ? '▼' : '▶'}
                  </button>
                  {row.budgetType}
                </td>
                <td className="truncate px-2 py-1.5 text-neutral-500">{ACCOUNT_LABEL[row.accountType]}</td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{row.ministry || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{orgColumn(row) || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{row.subAccount || '—'}</span>
                </td>
                <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{row.sectionCode}</td>
                <td className="px-2 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="line-clamp-2">{row.sectionName}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">
                    {row.majorExpenseName || '—'}
                    {row.majorExpenseMixed && (
                      <span
                        className="ml-1 text-amber-600 dark:text-amber-400"
                        title="この項には複数の主要経費が混在します。表示は金額最大のもの"
                      >
                        他
                      </span>
                    )}
                  </span>
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                  {row.jikouCount.toLocaleString()}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                  {row.kouMokuCount.toLocaleString()}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${
                    row.rsProjectCount > 0
                      ? 'font-medium text-emerald-700 dark:text-emerald-400'
                      : 'text-neutral-300 dark:text-neutral-700'
                  }`}
                >
                  {row.rsProjectCount.toLocaleString()}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatYen(row.amount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(row.previousAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(row.difference)}
                </td>
                <td className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}>
                  {formatChangeRate(rate)}
                </td>
              </tr>
              {isOpen && (
                <tr className="bg-neutral-50 dark:bg-neutral-900">
                  <td colSpan={COLUMNS.length} className="border-b border-neutral-200 p-0 dark:border-neutral-800">
                    <div className="sticky left-0 w-[calc(100vw-3rem)] px-4 py-3">
                      {detailError ? (
                        <p className="text-[11px] text-red-600">詳細の取得に失敗しました: {detailError}</p>
                      ) : detailLoading || !detail ? (
                        <p className="text-[11px] text-neutral-400">読み込み中…</p>
                      ) : (
                        <div className="flex flex-wrap gap-x-10 gap-y-4">
                          <div className="min-w-[18rem] max-w-md">
                            <div className="mb-1 text-[11px] font-medium text-neutral-400">
                              事項一覧（目的別内訳・{detail.jikouItems.length} 件）
                            </div>
                            {detail.jikouItems.length === 0 ? (
                              <p className="text-[11px] text-neutral-400">この項に事項はありません。</p>
                            ) : (
                              <ul className="max-h-64 space-y-1 overflow-y-auto text-[11px]">
                                {[...detail.jikouItems]
                                  .sort((a, b) => b.amount - a.amount)
                                  .map(it => (
                                    <li key={it.id} className="flex items-start justify-between gap-2">
                                      <a
                                        href={it.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                                      >
                                        {it.name}
                                      </a>
                                      <span className="shrink-0 tabular-nums text-neutral-400">
                                        {formatYen(it.amount)}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>

                          <div className="min-w-[18rem] max-w-md">
                            <div className="mb-1 text-[11px] font-medium text-neutral-400">
                              目一覧（性質別内訳・{detail.kouMokuItems.length} 件）
                            </div>
                            {detail.kouMokuItems.length === 0 ? (
                              <p className="text-[11px] text-neutral-400">この項に目はありません。</p>
                            ) : (
                              <ul className="max-h-64 space-y-1 overflow-y-auto text-[11px]">
                                {[...detail.kouMokuItems]
                                  .sort((a, b) => b.amount - a.amount)
                                  .map(it => (
                                    <li key={it.id} className="flex items-start justify-between gap-2">
                                      <a
                                        href={it.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                                      >
                                        {it.subItemName}
                                      </a>
                                      <span className="shrink-0 tabular-nums text-neutral-400">
                                        {formatYen(it.amount)}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>

                          <div className="min-w-[18rem] max-w-md">
                            <div className="mb-1 text-[11px] font-medium text-neutral-400">
                              紐づく RS 事業（目の完全一致・
                              {linkageIsCarriedOver ? `${linkageSourceBudgetYear}年度から引継ぎ・` : ''}
                              {detail.rsLinks.length} 件）
                            </div>
                            {detail.rsLinks.length === 0 ? (
                              <p className="max-w-[18rem] text-[11px] text-neutral-400">
                                紐づく RS 事業は見つかりませんでした。
                              </p>
                            ) : (
                              <ul className="max-h-64 space-y-1 overflow-y-auto text-[11px]">
                                {[...detail.rsLinks]
                                  .sort((a, b) => b.rsAmount - a.rsAmount)
                                  .map(l => (
                                    <li key={`${l.projectId}-${l.kouMokuKey}`} className="flex items-start justify-between gap-2">
                                      {linkageRsYear !== null ? (
                                        <a
                                          href={sankeySvgProjectUrl(l.projectId, l.projectName, linkageRsYear)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                                        >
                                          {l.projectName}
                                        </a>
                                      ) : (
                                        <span className="text-neutral-700 dark:text-neutral-300">{l.projectName}</span>
                                      )}
                                      <span className="shrink-0 tabular-nums text-neutral-400">
                                        {formatYen(l.rsAmount)}
                                        {l.carriedOverFrom ? `（${l.carriedOverFrom}）` : ''}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
