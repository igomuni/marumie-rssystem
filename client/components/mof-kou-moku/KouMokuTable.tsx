'use client';

/**
 * 科目別内訳（項・目）一覧の表。並べ替え・列幅リサイズ・行の詳細展開を持つ。
 * `/mof-jikou` の JikouTable.tsx と同じ構成。データの絞り込みとページングは呼び出し側の責務。
 */

import { Fragment } from 'react';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouMokuHistory, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { changeRate, executionRate, formatChangeRate, formatRate, formatYen } from '@/client/components/mof-jikou/format';
import { KouMokuHistory } from './KouMokuHistory';
import {
  ACCOUNT_LABEL,
  bestLink,
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
  /** 展開中の行の経年推移。取得はページ層の責務 */
  history: MOFKouMokuHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  /**
   * kouMokuKey → 紐づくRS事業。年度分を一括取得したもの（取得はページ層の責務）。
   * 一覧の列と詳細パネルの両方をここから引く。
   */
  linkageByKey: Map<string, MofRsKouMokuLinkageRecord[]>;
  linkageAvailable: boolean;
  /** /sankey-svg へのリンクに使うRS事業年度。紐づけデータ未生成なら null */
  linkageRsYear: number | null;
  linkageLoading: boolean;
  linkageError: string | null;
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
  history,
  historyLoading,
  historyError,
  linkageByKey,
  linkageAvailable,
  linkageRsYear,
  linkageLoading,
  linkageError,
  emptyMessage = '条件に合う目がありません。',
}: Props) {
  const RS_COLUMN_WIDTH = 52;
  const tableWidth =
    COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0) + RS_COLUMN_WIDTH;
  const totalColumnCount = COLUMNS.length + 1;

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
        <col style={{ width: RS_COLUMN_WIDTH }} />
        {COLUMNS.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-neutral-100 text-left text-neutral-500 dark:bg-neutral-800">
        <tr>
          <th
            scope="col"
            title="紐づく RS 事業があれば /sankey-svg へ移動できます（所管×組織×項×目の完全一致）"
            className="p-0 text-center font-medium"
          >
            <span className="block px-1 py-2">RS</span>
          </th>
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
          const exec = executionRate(item);
          const isOpen = expandedId === item.id;
          const rowLinks = linkageByKey.get(item.key) ?? [];
          const rowBestLink = bestLink(rowLinks);
          return (
            <Fragment key={item.id}>
              <tr
                onClick={() => onToggleExpand(isOpen ? null : item.id)}
                className={`cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                  isOpen ? 'bg-neutral-50 dark:bg-neutral-900' : ''
                }`}
              >
                <td className="px-1 py-1.5 text-center">
                  {rowBestLink && linkageRsYear !== null ? (
                    <a
                      href={sankeySvgProjectUrl(rowBestLink.projectId, rowBestLink.projectName, linkageRsYear)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title={`/sankey-svg で「${rowBestLink.projectName}」を開く（完全一致${
                        rowLinks.length > 1 ? `・他${rowLinks.length - 1}件` : ''
                      }）`}
                      className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:underline dark:bg-emerald-900/40 dark:text-emerald-300"
                    >
                      RS↗
                    </a>
                  ) : (
                    <span className="text-neutral-300 dark:text-neutral-700">—</span>
                  )}
                </td>
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
                  {item.budgetType}
                </td>
                <td className="truncate px-2 py-1.5 text-neutral-500">{ACCOUNT_LABEL[item.accountType]}</td>
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
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.currentAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatYen(item.spent)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.unused)}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${
                    exec === null
                      ? 'text-neutral-400'
                      : exec < 0.5
                        ? 'text-red-600 dark:text-red-400'
                        : exec < 0.9
                          ? 'text-amber-700 dark:text-amber-500'
                          : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  {formatRate(exec)}
                </td>
              </tr>
              {isOpen && (
                <tr className="bg-neutral-50 dark:bg-neutral-900">
                  <td
                    colSpan={totalColumnCount}
                    className="border-b border-neutral-200 p-0 dark:border-neutral-800"
                  >
                    <div className="sticky left-0 w-[calc(100vw-3rem)] px-4 py-3">
                      <div className="flex flex-wrap gap-x-10 gap-y-4">
                        <KouMokuHistory history={history} loading={historyLoading} error={historyError} />
                        <div className="min-w-[20rem] max-w-2xl">
                          <div className="mb-1 text-[11px] font-medium text-neutral-400">
                            紐づく RS 事業（完全一致・
                            {linkageLoading ? '読込中…' : `${rowLinks.length} 件`}）
                          </div>
                          {linkageError ? (
                            <p className="text-[11px] text-red-600">紐づけの取得に失敗しました: {linkageError}</p>
                          ) : !linkageAvailable ? (
                            <p className="max-w-[18rem] text-[11px] text-neutral-400">
                              この年度は RS 事業との紐づけデータが未生成です。
                            </p>
                          ) : rowLinks.length === 0 ? (
                            <p className="text-[11px] text-neutral-400">
                              紐づく RS 事業は見つかりませんでした。RS 側で使われていない目、または科目名の表記差の可能性があります。
                            </p>
                          ) : (
                            <>
                              <ul className="space-y-1 text-[11px]">
                                {rowLinks.map(l => (
                                  <li key={l.projectId} className="flex items-start gap-1.5">
                                    <span className="flex-1">
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
                                        <span className="text-neutral-700 dark:text-neutral-300">
                                          {l.projectName}
                                        </span>
                                      )}
                                      <span className="ml-1 text-neutral-400">
                                        （{l.projectMinistry}・{formatYen(l.rsAmount)}）
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
                                所管×組織×項×目の完全一致キーによる紐づけです（RSの `2-2` CSV が
                                MOFの科目別内訳と同じ語彙を持つため、名前照合は行っていません）。
                              </p>
                            </>
                          )}
                        </div>
                        <dl className="grid shrink-0 grid-cols-[8rem_auto] gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                          <dt className="text-neutral-400">合成キー</dt>
                          <dd className="max-w-[34rem] break-all font-mono">{item.key}</dd>
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
                          <dt className="text-neutral-400">帳票・ページ</dt>
                          <dd>
                            {item.page !== null ? (
                              <>
                                {item.documentId} p.{item.page}{' '}
                                <a
                                  href={item.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="underline hover:text-neutral-700"
                                >
                                  出典XML
                                </a>
                              </>
                            ) : (
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="underline hover:text-neutral-700"
                              >
                                出典なし（帳票トップ）
                              </a>
                            )}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={totalColumnCount} className="px-3 py-10 text-center text-neutral-500">
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
