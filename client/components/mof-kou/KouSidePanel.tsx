'use client';

/**
 * 項の詳細サイドパネル。行クリックで開く。タブで「年度推移・事項・目・RS」を切り替える。
 * データ取得（詳細・経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 */

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
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'history', label: '年度推移' },
  { key: 'jikou', label: '事項' },
  { key: 'koumoku', label: '目' },
  { key: 'rs', label: 'RS' },
];

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
}: Props) {
  const [tab, setTab] = useState<Tab>('history');

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="shrink-0 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
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

      <div className="flex shrink-0 border-b border-neutral-200 text-xs dark:border-neutral-800">
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

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {tab === 'history' && (
          <HistoryTab history={history} loading={historyLoading} error={historyError} />
        )}
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

function HistoryTab({
  history,
  loading,
  error,
}: {
  history: MOFKouSectionHistory | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <p className="text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="text-neutral-400">読み込み中…</p>;

  const flatRows = history.years.flatMap(y =>
    y.rows.map(r => ({ fiscalYear: y.fiscalYear, eraLabel: y.eraLabel, row: r }))
  );

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-neutral-400">
        年度推移（{history.years.length} / {history.availableYears.length} 年度に計上）
      </div>
      {flatRows.length === 0 ? (
        <p className="text-neutral-400">推移データがありません。</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead className="text-neutral-400">
            <tr>
              <th className="whitespace-nowrap px-1.5 py-1 text-left font-medium">年度</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-left font-medium">予算種別</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-right font-medium">事項</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-right font-medium">目</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-right font-medium">RS</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-right font-medium">本年度額</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-right font-medium">増減率</th>
            </tr>
          </thead>
          <tbody className="text-neutral-600 dark:text-neutral-400">
            {flatRows.map(({ fiscalYear, eraLabel, row }) => {
              const rate = changeRate(row.amount, row.previousAmount);
              return (
                <tr key={`${fiscalYear}-${row.budgetType}`} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="whitespace-nowrap px-1.5 py-1">{eraLabel}</td>
                  <td className="whitespace-nowrap px-1.5 py-1">{row.budgetType}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{row.jikouCount}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{row.kouMokuCount}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{row.rsProjectCount || '—'}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatYen(row.amount)}
                  </td>
                  <td className={`whitespace-nowrap px-1.5 py-1 text-right tabular-nums ${rateClass(rate)}`}>
                    {formatChangeRate(rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {history.years.length < history.availableYears.length && (
        <p className="mt-1.5 text-neutral-400">
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
  if (error) return <p className="text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="text-neutral-400">読み込み中…</p>;
  if (detail.jikouItems.length === 0) return <p className="text-neutral-400">この項に事項はありません。</p>;
  return (
    <ul className="space-y-1.5">
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
            <span className="shrink-0 tabular-nums text-neutral-400">{formatYen(it.amount)}</span>
          </li>
        ))}
    </ul>
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
  if (error) return <p className="text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="text-neutral-400">読み込み中…</p>;
  if (detail.kouMokuItems.length === 0) return <p className="text-neutral-400">この項に目はありません。</p>;
  return (
    <ul className="space-y-1.5">
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
            <span className="shrink-0 tabular-nums text-neutral-400">{formatYen(it.amount)}</span>
          </li>
        ))}
    </ul>
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
  if (error) return <p className="text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="text-neutral-400">読み込み中…</p>;
  if (detail.rsLinks.length === 0) {
    return <p className="text-neutral-400">紐づく RS 事業は見つかりませんでした。</p>;
  }
  return (
    <div>
      {linkageIsCarriedOver && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          この年度自体のRS紐づけデータはまだ無いため、{linkageSourceBudgetYear}
          年度時点の紐づけを識別子で参考表示しています。
        </p>
      )}
      <ul className="space-y-1.5">
        {[...detail.rsLinks]
          .sort((a, b) => b.rsAmount - a.rsAmount)
          .map(l => (
            <li key={`${l.projectId}-${l.kouMokuKey}`} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
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
                <span className="block text-[10px] text-neutral-400">{l.subItemName}</span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-400">
                {formatYen(l.rsAmount)}
                {l.carriedOverFrom ? `（${l.carriedOverFrom}）` : ''}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
