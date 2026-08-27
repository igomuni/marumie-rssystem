'use client';

/**
 * 項の詳細サイドパネル。行クリックで開く。タブで「年度推移・事項・目・RS」を切り替える。
 * 各タブの一覧は列見出し付きのグリッド（DataGrid）で表示する。
 * データ取得（詳細・経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionSummary } from '@/types/mof-kou';
import { changeRate, formatChangeRate, formatYen } from '@/client/components/mof-jikou/format';
import { ACCOUNT_LABEL, orgColumn } from './columns';

type Tab = 'history' | 'jikou' | 'koumoku' | 'rs';

interface Props {
  row: MOFKouSectionSummary;
  onClose: () => void;
  detail: MOFKouSectionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  history: MOFKouSectionHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  linkageRsYear: number | null;
  linkageIsCarriedOver: boolean;
  linkageSourceBudgetYear: number | null;
  width: number;
  onWidthChange: (width: number) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'history', label: '年度推移' },
  { key: 'jikou', label: '事項' },
  { key: 'koumoku', label: '目' },
  { key: 'rs', label: 'RS' },
];

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouSidePanel({
  row,
  onClose,
  detail,
  detailLoading,
  detailError,
  history,
  historyLoading,
  historyError,
  linkageRsYear,
  linkageIsCarriedOver,
  linkageSourceBudgetYear,
  width,
  onWidthChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('history');

  function startResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (e: MouseEvent) => {
      // パネルは画面右側に置くため、ハンドルを左へ引くほど広がる
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (e.clientX - startX)));
      onWidthChange(next);
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
    <aside
      className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="サイドパネルの幅を変更"
        onMouseDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-neutral-400/60"
      />
      <div className="shrink-0 border-b border-neutral-200 px-3 py-2 pl-4 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{row.sectionName}</p>
            <p className="mt-0.5 truncate text-[11px] text-neutral-500">
              {row.budgetType} ・ {ACCOUNT_LABEL[row.accountType]} ・ {row.ministry || '—'} ・ {orgColumn(row) || '—'}
              {row.subAccount ? ` ・ ${row.subAccount}` : ''} ・ 項{row.sectionCode}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          本年度額 <b className="font-medium text-neutral-800 dark:text-neutral-200">{formatYen(row.amount)}</b>
          {' ・ '}事項{row.jikouCount}件 ・ 目{row.kouMokuCount}件 ・ RS事業{row.rsProjectCount}件
        </p>
      </div>

      <div className="flex shrink-0 border-b border-neutral-200 pl-1 text-xs dark:border-neutral-800">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex-1 px-2 py-1.5 font-medium ${
              tab === t.key
                ? 'border-b-2 border-neutral-800 text-neutral-900 dark:border-neutral-200 dark:text-neutral-100'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            {t.label}
            {t.key === 'jikou' && ` (${row.jikouCount})`}
            {t.key === 'koumoku' && ` (${row.kouMokuCount})`}
            {t.key === 'rs' && ` (${row.rsProjectCount})`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pl-1 text-xs">
        {tab === 'history' && <HistoryTab history={history} loading={historyLoading} error={historyError} />}
        {tab === 'jikou' && <JikouTab detail={detail} loading={detailLoading} error={detailError} />}
        {tab === 'koumoku' && <KouMokuTab detail={detail} loading={detailLoading} error={detailError} />}
        {tab === 'rs' && (
          <RsTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            linkageRsYear={linkageRsYear}
            linkageIsCarriedOver={linkageIsCarriedOver}
            linkageSourceBudgetYear={linkageSourceBudgetYear}
          />
        )}
      </div>
    </aside>
  );
}

/** タブ共通のグリッド見出しスタイル */
const gridHeadClass = 'sticky top-0 z-10 bg-neutral-50 text-left text-[11px] font-medium text-neutral-400 dark:bg-neutral-900';
const gridCellClass = 'truncate px-2 py-1.5';
const gridRowClass = 'border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900';

function HistoryTab({
  history,
  loading,
  error,
}: {
  history: MOFKouSectionHistory | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <p className="p-3 text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const flatRows = history.years.flatMap(y =>
    y.rows.map(r => ({ fiscalYear: y.fiscalYear, eraLabel: y.eraLabel, row: r }))
  );

  return (
    <div>
      <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-neutral-400">
        年度推移（{history.years.length} / {history.availableYears.length} 年度に計上）
      </div>
      {flatRows.length === 0 ? (
        <p className="px-2 pb-2 text-neutral-400">推移データがありません。</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead className={gridHeadClass}>
            <tr>
              <th className={gridCellClass}>年度</th>
              <th className={gridCellClass}>予算種別</th>
              <th className={`${gridCellClass} text-right`}>事項</th>
              <th className={`${gridCellClass} text-right`}>目</th>
              <th className={`${gridCellClass} text-right`}>RS</th>
              <th className={`${gridCellClass} text-right`}>本年度額</th>
              <th className={`${gridCellClass} text-right`}>増減率</th>
            </tr>
          </thead>
          <tbody className="text-neutral-600 dark:text-neutral-400">
            {flatRows.map(({ fiscalYear, eraLabel, row }) => {
              const rate = changeRate(row.amount, row.previousAmount);
              return (
                <tr key={`${fiscalYear}-${row.budgetType}`} className={gridRowClass}>
                  <td className={gridCellClass}>{eraLabel}</td>
                  <td className={gridCellClass}>{row.budgetType}</td>
                  <td className={`${gridCellClass} text-right tabular-nums`}>{row.jikouCount}</td>
                  <td className={`${gridCellClass} text-right tabular-nums`}>{row.kouMokuCount}</td>
                  <td className={`${gridCellClass} text-right tabular-nums`}>{row.rsProjectCount || '—'}</td>
                  <td className={`${gridCellClass} text-right tabular-nums text-neutral-900 dark:text-neutral-100`}>
                    {formatYen(row.amount)}
                  </td>
                  <td className={`${gridCellClass} text-right tabular-nums ${rateClass(rate)}`}>
                    {formatChangeRate(rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {history.years.length < history.availableYears.length && (
        <p className="px-2 pb-2 pt-1.5 text-neutral-400">
          計上のない年度は行がありません。所管表記の変更や項コードの振り直しがあると、実態としては継続でも別の項として扱われ欠けて見えることがあります。
        </p>
      )}
    </div>
  );
}

function JikouTab({
  detail,
  loading,
  error,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;
  if (detail.jikouItems.length === 0) return <p className="p-3 text-neutral-400">この項に事項はありません。</p>;
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className={gridHeadClass}>
        <tr>
          <th className={gridCellClass}>事項名</th>
          <th className={gridCellClass}>主要経費</th>
          <th className={`${gridCellClass} text-right`}>本年度額</th>
          <th className={`${gridCellClass} text-right`}>前年度額</th>
          <th className={`${gridCellClass} text-right`}>増減率</th>
        </tr>
      </thead>
      <tbody className="text-neutral-600 dark:text-neutral-400">
        {[...detail.jikouItems]
          .sort((a, b) => b.amount - a.amount)
          .map(it => {
            const rate = changeRate(it.amount, it.previousAmount);
            return (
              <tr key={it.id} className={gridRowClass}>
                <td className={gridCellClass}>
                  <a
                    href={it.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                  >
                    {it.name}
                  </a>
                </td>
                <td className={gridCellClass}>{it.majorExpenseName || '—'}</td>
                <td className={`${gridCellClass} text-right tabular-nums text-neutral-900 dark:text-neutral-100`}>
                  {formatYen(it.amount)}
                </td>
                <td className={`${gridCellClass} text-right tabular-nums`}>{formatYen(it.previousAmount)}</td>
                <td className={`${gridCellClass} text-right tabular-nums ${rateClass(rate)}`}>
                  {formatChangeRate(rate)}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

function KouMokuTab({
  detail,
  loading,
  error,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;
  if (detail.kouMokuItems.length === 0) return <p className="p-3 text-neutral-400">この項に目はありません。</p>;
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className={gridHeadClass}>
        <tr>
          <th className={gridCellClass}>目名</th>
          <th className={gridCellClass}>主要経費</th>
          <th className={gridCellClass}>使途別</th>
          <th className={`${gridCellClass} text-right`}>本年度額</th>
          <th className={`${gridCellClass} text-right`}>前年度額</th>
          <th className={`${gridCellClass} text-right`}>増減率</th>
        </tr>
      </thead>
      <tbody className="text-neutral-600 dark:text-neutral-400">
        {[...detail.kouMokuItems]
          .sort((a, b) => b.amount - a.amount)
          .map(it => {
            const rate = changeRate(it.amount, it.previousAmount);
            return (
              <tr key={it.id} className={gridRowClass}>
                <td className={gridCellClass}>
                  <a
                    href={it.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                  >
                    {it.subItemName}
                  </a>
                </td>
                <td className={gridCellClass}>{it.majorExpenseName || '—'}</td>
                <td className={gridCellClass}>{it.purposeName || '—'}</td>
                <td className={`${gridCellClass} text-right tabular-nums text-neutral-900 dark:text-neutral-100`}>
                  {formatYen(it.amount)}
                </td>
                <td className={`${gridCellClass} text-right tabular-nums`}>{formatYen(it.previousAmount)}</td>
                <td className={`${gridCellClass} text-right tabular-nums ${rateClass(rate)}`}>
                  {formatChangeRate(rate)}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

function RsTab({
  detail,
  loading,
  error,
  linkageRsYear,
  linkageIsCarriedOver,
  linkageSourceBudgetYear,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  linkageRsYear: number | null;
  linkageIsCarriedOver: boolean;
  linkageSourceBudgetYear: number | null;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;
  if (detail.rsLinks.length === 0) {
    return <p className="p-3 text-neutral-400">紐づく RS 事業は見つかりませんでした。</p>;
  }
  return (
    <div>
      {linkageIsCarriedOver && (
        <p className="mx-2 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          この年度自体のRS紐づけデータはまだ無いため、{linkageSourceBudgetYear}
          年度時点の紐づけを識別子で参考表示しています。
        </p>
      )}
      <table className="w-full border-collapse text-[11px]">
        <thead className={gridHeadClass}>
          <tr>
            <th className={gridCellClass}>事業名</th>
            <th className={gridCellClass}>目名</th>
            <th className={`${gridCellClass} text-right`}>RS計上額</th>
            <th className={gridCellClass}>引継ぎ</th>
          </tr>
        </thead>
        <tbody className="text-neutral-600 dark:text-neutral-400">
          {[...detail.rsLinks]
            .sort((a, b) => b.rsAmount - a.rsAmount)
            .map(l => (
              <tr key={`${l.projectId}-${l.kouMokuKey}`} className={gridRowClass}>
                <td className={gridCellClass}>
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
                    l.projectName
                  )}
                </td>
                <td className={gridCellClass}>{l.subItemName}</td>
                <td className={`${gridCellClass} text-right tabular-nums text-neutral-900 dark:text-neutral-100`}>
                  {formatYen(l.rsAmount)}
                </td>
                <td className={gridCellClass}>{l.carriedOverFrom || '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
