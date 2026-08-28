'use client';

/**
 * 項の詳細サイドパネル。行クリックで開く。タブで「年度推移・事項・目・RS」を切り替える。
 * 各タブの一覧は列見出し付きのグリッド（DataGrid）で表示する。
 * データ取得（詳細・経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 */

import { useState } from 'react';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionSummary } from '@/types/mof-kou';
import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import type { MofRsLinkageRecord } from '@/types/mof-rs-linkage';
import { changeRate, formatChangeRate, formatYen } from '@/client/components/mof-jikou/format';
import { AccountBadge, BudgetTypeBadge } from './Badge';
import { orgColumn } from './columns';
import { DataGrid, type GridColumn } from './DataGrid';

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
  width: number;
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
  width,
}: Props) {
  const [tab, setTab] = useState<Tab>('history');

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-xs dark:border-neutral-800 dark:bg-neutral-950"
      style={{ width }}
    >
      <div className="shrink-0 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.sectionName}</p>
            <BudgetTypeBadge budgetType={row.budgetType} />
            <AccountBadge accountType={row.accountType} />
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

        <p className="mt-1 truncate text-xs text-neutral-500">
          {row.ministry || '—'} ・ {orgColumn(row) || '—'}
          {row.subAccount ? ` ・ ${row.subAccount}` : ''}
          {row.page !== null && (
            <>
              {' ・ '}
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                出典 p.{row.page}
              </a>
            </>
          )}
        </p>

        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatYen(row.amount)}</span>
          <span className="text-xs text-neutral-500">前年度 {formatYen(row.previousAmount)}</span>
          <span className={`text-xs font-medium ${rateClass(changeRate(row.amount, row.previousAmount))}`}>
            {formatChangeRate(changeRate(row.amount, row.previousAmount))}
          </span>
        </div>
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

      <div className="min-h-0 flex-1 overflow-auto text-xs">
        {tab === 'history' && <HistoryTab history={history} loading={historyLoading} error={historyError} />}
        {tab === 'jikou' && <JikouTab detail={detail} loading={detailLoading} error={detailError} />}
        {tab === 'koumoku' && <KouMokuTab detail={detail} loading={detailLoading} error={detailError} />}
        {tab === 'rs' && <RsTab detail={detail} loading={detailLoading} error={detailError} linkageRsYear={linkageRsYear} />}
      </div>
    </aside>
  );
}

interface HistoryRow {
  fiscalYear: number;
  eraLabel: string;
  row: MOFKouSectionSummary;
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
  if (error) return <p className="p-3 text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const flatRows: HistoryRow[] = history.years.flatMap(y =>
    y.rows.map(r => ({ fiscalYear: y.fiscalYear, eraLabel: y.eraLabel, row: r }))
  );

  const columns: GridColumn<HistoryRow>[] = [
    {
      key: 'year',
      label: '年度',
      width: 130,
      sortValue: r => r.fiscalYear,
      render: r => `${r.eraLabel}（${r.fiscalYear}）`,
    },
    {
      key: 'budgetType',
      label: '予算種別',
      width: 68,
      sortValue: r => r.row.budgetType,
      render: r => <BudgetTypeBadge budgetType={r.row.budgetType} />,
    },
    {
      key: 'jikou',
      label: '事項',
      width: 56,
      numeric: true,
      sortValue: r => r.row.jikouCount,
      render: r => r.row.jikouCount,
    },
    {
      key: 'koumoku',
      label: '目',
      width: 56,
      numeric: true,
      sortValue: r => r.row.kouMokuCount,
      render: r => r.row.kouMokuCount,
    },
    {
      key: 'rs',
      label: 'RS',
      width: 56,
      numeric: true,
      sortValue: r => r.row.rsProjectCount,
      render: r => r.row.rsProjectCount || '—',
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: r => r.row.amount,
      render: r => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(r.row.amount)}</span>,
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: r => {
        const rate = changeRate(r.row.amount, r.row.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: r => {
        const rate = changeRate(r.row.amount, r.row.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <div>
      <DataGrid
        rows={flatRows}
        columns={columns}
        rowKey={r => `${r.fiscalYear}-${r.row.budgetType}`}
        defaultSortKey="year"
        defaultSortDir="asc"
        emptyMessage="推移データがありません。"
      />
      {history.years.length < history.availableYears.length && (
        <p className="px-2 pb-2 pt-1.5 text-[11px] text-neutral-400">
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

  const rsByJikouKey = new Map<string, MofRsLinkageRecord[]>();
  for (const l of detail.jikouRsLinks ?? []) {
    const list = rsByJikouKey.get(l.jikouKey) ?? [];
    list.push(l);
    rsByJikouKey.set(l.jikouKey, list);
  }

  const columns: GridColumn<MOFJikouItem>[] = [
    {
      key: 'name',
      label: '事項名',
      width: 200,
      sortValue: it => it.name,
      render: it => (
        <a
          href={it.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          {it.name}
        </a>
      ),
    },
    {
      key: 'majorExpense',
      label: '主要経費',
      width: 110,
      sortValue: it => it.majorExpenseName,
      render: it => it.majorExpenseName || '—',
    },
    {
      key: 'rs',
      label: 'RS',
      width: 60,
      numeric: true,
      sortValue: it => new Set((rsByJikouKey.get(it.key) ?? []).map(l => l.projectId)).size,
      render: it => {
        const links = rsByJikouKey.get(it.key) ?? [];
        const count = new Set(links.map(l => l.projectId)).size;
        return (
          <span
            className={count > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-300 dark:text-neutral-700'}
            title={links.map(l => l.projectName).join('\n') || undefined}
          >
            {count || '—'}
          </span>
        );
      },
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.amount,
      render: it => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(it.amount)}</span>,
    },
    {
      key: 'previousAmount',
      label: '前年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.previousAmount,
      render: it => formatYen(it.previousAmount),
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <DataGrid
      rows={detail.jikouItems}
      columns={columns}
      rowKey={it => it.id}
      defaultSortKey="amount"
      emptyMessage="この項に事項はありません。"
    />
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

  const rsByKouMokuKey = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const l of detail.rsLinks) {
    const list = rsByKouMokuKey.get(l.kouMokuKey) ?? [];
    list.push(l);
    rsByKouMokuKey.set(l.kouMokuKey, list);
  }

  const columns: GridColumn<MOFKouMokuItem>[] = [
    {
      key: 'name',
      label: '目名',
      width: 190,
      sortValue: it => it.subItemName,
      render: it => (
        <a
          href={it.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          {it.subItemName}
        </a>
      ),
    },
    {
      key: 'majorExpense',
      label: '主要経費',
      width: 110,
      sortValue: it => it.majorExpenseName,
      render: it => it.majorExpenseName || '—',
    },
    {
      key: 'purpose',
      label: '使途別',
      width: 100,
      sortValue: it => it.purposeName,
      render: it => it.purposeName || '—',
    },
    {
      key: 'rs',
      label: 'RS',
      width: 60,
      numeric: true,
      sortValue: it => new Set((rsByKouMokuKey.get(it.key) ?? []).map(l => l.projectId)).size,
      render: it => {
        const links = rsByKouMokuKey.get(it.key) ?? [];
        const count = new Set(links.map(l => l.projectId)).size;
        return (
          <span
            className={count > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-300 dark:text-neutral-700'}
            title={links.map(l => l.projectName).join('\n') || undefined}
          >
            {count || '—'}
          </span>
        );
      },
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.amount,
      render: it => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(it.amount)}</span>,
    },
    {
      key: 'previousAmount',
      label: '前年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.previousAmount,
      render: it => formatYen(it.previousAmount),
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <DataGrid
      rows={detail.kouMokuItems}
      columns={columns}
      rowKey={it => it.id}
      defaultSortKey="amount"
      emptyMessage="この項に目はありません。"
    />
  );
}

function RsTab({
  detail,
  loading,
  error,
  linkageRsYear,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  linkageRsYear: number | null;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const columns: GridColumn<MofRsKouMokuLinkageRecord>[] = [
    {
      key: 'projectName',
      label: '事業名',
      width: 200,
      sortValue: l => l.projectName,
      render: l =>
        linkageRsYear !== null ? (
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
        ),
    },
    { key: 'subItemName', label: '目名', width: 150, sortValue: l => l.subItemName, render: l => l.subItemName },
    {
      key: 'rsAmount',
      label: 'RS計上額',
      width: 100,
      numeric: true,
      sortValue: l => l.rsAmount,
      render: l => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(l.rsAmount)}</span>,
    },
    {
      key: 'carriedOverFrom',
      label: '引継ぎ',
      width: 110,
      sortValue: l => l.carriedOverFrom ?? '',
      render: l => l.carriedOverFrom || '—',
    },
  ];

  return (
    <DataGrid
      rows={detail.rsLinks}
      columns={columns}
      rowKey={l => `${l.projectId}-${l.kouMokuKey}`}
      defaultSortKey="rsAmount"
      emptyMessage="紐づく RS 事業は見つかりませんでした。"
    />
  );
}
