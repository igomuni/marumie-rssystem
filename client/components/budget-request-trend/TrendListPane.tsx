'use client';

import { useEffect, useRef } from 'react';
import type { BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { acctLabelOf, isShares, isSharedBooks, orgOf, patternOf, publisherOf, recordChange, recordRate, yearOf, type TrendRecord, type TrendSortDir, type TrendSortKey } from '@/app/lib/budget-request-trend';
import { changeColor, formatRate, formatSen, formatSenSigned } from './format';

const MAX_ROWS = 600;
const MIN_COLUMN_WIDTH = 48;

/** 列幅の既定（px）。所管は「［特］子ども・子育て支援」が折り返さない幅 */
export const DEFAULT_COLUMN_WIDTHS: Record<TrendSortKey, number> = { group: 184, acct: 150, org: 130, name: 220, pattern: 76, prev: 112, req: 100, diff: 100, rate: 76, nJikou: 56, nMoku: 56 };

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
  urls,
  onSelect,
  widths,
  onWidthsChange,
}: {
  /** 絞り込み・並べ替え済み */
  rows: readonly TrendRecord[];
  year: number;
  firstYear: number;
  sortKey: TrendSortKey;
  sortDir: TrendSortDir;
  onSort: (k: TrendSortKey) => void;
  selectedKey: string | null;
  rowKey: (r: BudgetRequestTrendRow) => string;
  /** 要求書の URL（src の添字が指す） */
  urls: readonly string[];
  onSelect: (x: TrendRecord) => void;
  widths: Record<string, number>;
  onWidthsChange: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
}) {
  const sum = rows.reduce(
    (s, x) => ({ req: s.req + (x.req ?? 0), prev: s.prev + (x.prev ?? 0) }),
    { req: 0, prev: 0 }
  );
  const cols: { key: TrendSortKey; label: string; left?: boolean }[] = [
    { key: 'group', label: '所管', left: true },
    { key: 'acct', label: '会計', left: true },
    { key: 'org', label: '組織／勘定', left: true },
    { key: 'name', label: '項名', left: true },
    { key: 'pattern', label: '出現パターン', left: true },
    { key: 'prev', label: '前年度予算額' },
    { key: 'req', label: '要求額' },
    { key: 'diff', label: '増減' },
    { key: 'rate', label: '増減率' },
    { key: 'nJikou', label: '事項' },
    { key: 'nMoku', label: '目' },
  ];
  // 選択中の項が上位 MAX_ROWS 件の外にあっても表示に含め、年度の切り替え・選択の変更のときに一覧をそこまでスクロールする
  const selectedIdx = selectedKey === null ? -1 : rows.findIndex(x => rowKey(x.row) === selectedKey);
  const shown = rows.slice(0, Math.max(MAX_ROWS, selectedIdx + 1));
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedKey === null) return;
    const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('tr[data-row-key]') ?? [])].find(e => e.dataset.rowKey === selectedKey);
    el?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 年度の切り替えと選択の変更だけで動かす（フィルタや並べ替えでは動かさない）
  }, [year, selectedKey]);
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
        <span><b className="tabular-nums text-neutral-800 dark:text-neutral-100">{rows.length.toLocaleString()}</b> 件</span>
        <span>要求額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.req)}</b></span>
        <span>前年度予算額 合計 <b className="tabular-nums text-neutral-800 dark:text-neutral-100">{formatSen(sum.prev)}</b></span>
        <span className="text-neutral-400">複数の府省の要求書に載る項（複数所管）も1行です（金額は合計の書の額）</span>
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
            {shown.map(x => {
              const r = x.row;
              const a = yearOf(r, year);
              const d = recordChange(x), t = recordRate(x);
              const rk = rowKey(r);
              const key = rk;
              const pattern = patternOf(r, year, firstYear);
              const selected = rk === selectedKey;
              return (
                <tr
                  key={key}
                  data-row-key={rk}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(x)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(x); } }}
                  className={`cursor-pointer border-b border-neutral-100 dark:border-neutral-800 ${selected ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}`}
                >
                  <td className={`break-words px-2 py-1 text-left ${x.groups.length > 1 ? 'text-neutral-500' : ''}`} title={x.groups.length > 1 ? x.groups.join('、') : undefined}>{x.group}</td>
                  <td className="break-words px-2 py-1 text-left">{acctLabelOf(r)}</td>
                  <td className="break-words px-2 py-1 text-left">
                    {orgOf(r)}
                    {a?.orgJikou !== undefined && <span title={`組織として事項要求（金額を示さない要求）があります。どの項に含まれるかは要求書に書かれていません${a.orgJikou ? `（備考: ${a.orgJikou}）` : ''}`} className={`${chip} border-neutral-300 text-neutral-500 dark:border-neutral-600`}>事項要求</span>}
                  </td>
                  <td className="break-words px-2 py-1 text-left font-medium">
                    {r.name}
                    {r.kou && <span className="ml-1 text-[10px] text-neutral-400">({r.kou})</span>}
                    {a && isSharedBooks(x) && <span title={`同じ所管（${x.groups[0]}）の複数の要求書に載る（${a.src.length} 書）`} className={`${chip} border-neutral-300 text-neutral-500 dark:border-neutral-600`}>複数書</span>}
                    {a?.jikou && <span title={`項の中に事項要求（金額を示さない要求）あり: ${a.jikou.forms.join('、')}${a.jikou.text ? `（${a.jikou.text}）` : ''}`} className={`${chip} border-fuchsia-600 text-fuchsia-700 dark:text-fuchsia-400`}>事項要求</span>}
                    {a?.xfer && a.xfer.length > 0 && <span title={`${a.xfer.join('、')}（会計をまたぐ合計では二重になりえます）`} className={`${chip} border-sky-600 text-sky-700 dark:text-sky-400`}>繰入</span>}
                    {a?.from !== undefined && <span title="前年度に消えた同名の項と金額が近い。詳細で確認できます" className={`${chip} border-violet-600 text-violet-700 dark:text-violet-400`}>紐づけ候補</span>}
                    {a?.moved && <span title={`${a.moved.kind}: ${a.moved.from} から`} className={`${chip} border-violet-600 text-violet-700 dark:text-violet-400`}>{a.moved.kind}</span>}
                    {a?.newAcct && <span title="この会計・勘定は前年度に無く、この年度に初出です" className={`${chip} border-emerald-600 text-emerald-700 dark:text-emerald-400`}>会計新設</span>}
                    {a?.codeChanged && <span title="所管コードが前の年度から変わりました" className={`${chip} border-neutral-400 text-neutral-500`}>コード変更</span>}
                    {x.imagePageBy.length > 0 && <span title={`${x.groups.length > 1 ? `${x.imagePageBy.join('、')}の書: ` : ''}PDF の該当頁は画像で文字層がなく、明細表の目以下が取り込めていません。リンクの頁は推定です`} className={`${chip} border-rose-500 text-rose-600 dark:text-rose-400`}>画像頁</span>}
                    {x.noPdfPageBy.length > 0 && <span title={`${x.groups.length > 1 ? `${x.noPdfPageBy.join('、')}の書: ` : ''}PDF の頁が引けなかったため、リンクは PDF の先頭を開きます`} className={`${chip} border-neutral-400 text-neutral-500`}>PDF頁なし</span>}
                    {a?.mismatch && (isShares(r, year, urls)
                      ? <span title="各府省が持ち分を載せ、合計の書（最も大きい額）がある。金額は合計の書の額" className={`${chip} border-neutral-400 text-neutral-500`}>持ち分</span>
                      : <span title="同じ項で、要求書によって額が違う" className={`${chip} border-amber-600 text-amber-700 dark:text-amber-400`}>額不一致</span>)}
                  </td>
                  <td className={`whitespace-nowrap px-2 py-1 text-left ${pattern === '新規' ? 'text-emerald-700 dark:text-emerald-400' : pattern === '消滅' ? 'text-orange-700 dark:text-orange-400' : 'text-neutral-500'}`}>{pattern ?? '–'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(x.prev)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatSen(x.req)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(d)}`}>{formatSenSigned(d)}</td>
                  <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${changeColor(t)}`}>{formatRate(t)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-neutral-600 dark:text-neutral-300" title="事項の数（総表・明細表）">{a?.nJikou ?? '–'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-neutral-600 dark:text-neutral-300" title="目の数（事項をまたいで目名 + 目別で数える）">{a?.nMoku ?? '–'}</td>
                </tr>
              );
            })}
            {rows.length > shown.length && (
              <tr><td colSpan={11} className="px-2 py-2 text-neutral-500">上位 {shown.length.toLocaleString()} 件を表示（全 {rows.length.toLocaleString()} 項）。絞り込みで減らしてください。</td></tr>
            )}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-2 py-8 text-center text-neutral-500">条件に合う項がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
