'use client';

import { useEffect, useRef } from 'react';
import type { BudgetRequestMofRow } from '@/types/budget-request-mof';
import { KIND_LABEL, acctLabelOf, diffOf, groupOf, mofRowKey, orgOf, rateOf, type MofSortDir, type MofSortKey } from '@/app/lib/budget-request-mof';
import { changeColor, formatRate, formatSen, formatSenSigned } from '@/client/components/budget-request-trend/format';
import { TYPE_INFO } from './typeInfo';

const MAX_ROWS = 600;
const MIN_COLUMN_WIDTH = 48;
export const DEFAULT_COLUMN_WIDTHS: Record<MofSortKey, number> = { group: 150, acct: 140, org: 130, name: 240, req: 100, mof: 100, diff: 100, rate: 76 };
const chip = 'ml-1 rounded-full border px-1.5 text-[10px] align-middle';

export function MofListPane({
  rows,
  urls,
  sortKey,
  sortDir,
  onSort,
  selectedKey,
  onSelect,
  widths,
  onWidthsChange,
}: {
  /** 絞り込み・並べ替え済み */
  rows: readonly BudgetRequestMofRow[];
  urls: readonly string[];
  sortKey: MofSortKey;
  sortDir: MofSortDir;
  onSort: (k: MofSortKey) => void;
  selectedKey: string | null;
  onSelect: (r: BudgetRequestMofRow) => void;
  widths: Record<string, number>;
  onWidthsChange: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
}) {
  const sum = rows.reduce((s, r) => ({ req: s.req + (r.req ?? 0), mof: s.mof + (r.mof ?? 0) }), { req: 0, mof: 0 });
  const cols: { key: MofSortKey; label: string; left?: boolean }[] = [
    { key: 'group', label: '所管', left: true },
    { key: 'acct', label: '会計', left: true },
    { key: 'org', label: '組織／勘定', left: true },
    { key: 'name', label: '項名', left: true },
    { key: 'req', label: '要求額' },
    { key: 'mof', label: '当初予算額' },
    { key: 'diff', label: '差' },
    { key: 'rate', label: '差率' },
  ];
  const selectedIdx = selectedKey === null ? -1 : rows.findIndex(r => mofRowKey(r) === selectedKey);
  const shown = rows.slice(0, Math.max(MAX_ROWS, selectedIdx + 1));
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedKey === null) return;
    const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('tr[data-row-key]') ?? [])].find(e => e.dataset.rowKey === selectedKey);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);
  const widthOf = (k: MofSortKey) => widths[k] ?? DEFAULT_COLUMN_WIDTHS[k];
  const tableWidth = cols.reduce((n, c) => n + widthOf(c.key), 0);

  function startResize(e: React.MouseEvent, key: MofSortKey) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startWidth = widthOf(key);
    const onMove = (ev: MouseEvent) => onWidthsChange(w => ({ ...w, [key]: Math.max(MIN_COLUMN_WIDTH, startWidth + ev.clientX - startX) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
        <span><b className="tabular-nums text-neutral-800 dark:text-neutral-100">{rows.length.toLocaleString()}</b> 件</span>
        <span>要求額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.req)}</b></span>
        <span>当初予算額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.mof)}</b></span>
        <span className="text-neutral-400">一般会計と特別会計をまたぐ合計は、繰入の分が二重になります</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
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
                  <span role="separator" aria-orientation="vertical" aria-label={`${c.label}の列幅`} onMouseDown={e => startResize(e, c.key)} onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-emerald-500/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const k = mofRowKey(r); const d = diffOf(r), t = rateOf(r); const selected = k === selectedKey;
              return (
                <tr
                  key={k}
                  data-row-key={k}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(r)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }}
                  className={`cursor-pointer border-b border-neutral-100 dark:border-neutral-800 ${selected ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}`}
                >
                  <td className="break-words px-2 py-1 text-left">{groupOf(r, urls)}</td>
                  <td className="break-words px-2 py-1 text-left">{acctLabelOf(r)}</td>
                  <td className="break-words px-2 py-1 text-left">
                    {orgOf(r)}
                    {r.types.includes('組織に事項要求') && <span title={`${TYPE_INFO['組織に事項要求'].text}${r.orgJikouText ? `（備考: ${r.orgJikouText}）` : ''}`} className={`${chip} ${TYPE_INFO['組織に事項要求'].color}`}>事項要求</span>}
                  </td>
                  <td className="break-words px-2 py-1 text-left font-medium">
                    {r.name}
                    {r.kind !== 'matched' && <span className={`${chip} border-neutral-400 text-neutral-500`}>{KIND_LABEL[r.kind]}</span>}
                    {r.types.filter(x => x !== '組織に事項要求').map(x => (
                      <span key={x} title={x === '事項要求' && r.jikouText ? `${TYPE_INFO[x].text}（${r.jikouText}）` : TYPE_INFO[x].text} className={`${chip} ${TYPE_INFO[x].color}`}>{x}</span>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(r.req)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(r.mof)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(d)}`}>{formatSenSigned(d)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(t)}`}>{formatRate(t)}</td>
                </tr>
              );
            })}
            {rows.length > shown.length && <tr><td colSpan={8} className="px-2 py-2 text-neutral-500">上位 {shown.length.toLocaleString()} 件を表示（全 {rows.length.toLocaleString()} 件）。絞り込みで減らしてください。</td></tr>}
            {rows.length === 0 && <tr><td colSpan={8} className="px-2 py-8 text-center text-neutral-500">条件に合う項がありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
