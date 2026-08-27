'use client';

/**
 * 財務省 予算書「項」一覧の確認用ビュー。
 *
 * `/mof-jikou`（事項＝目的別内訳）と `/mof-kou-moku`（目＝性質別内訳）を、共通の親である
 * 「項」の粒度まで引いて見る。1行=1項×1予算種別で、その項に事項が何件・目が何件あり、
 * 目の完全一致でRS事業に何件紐づいているかを一覧できる。
 * データは /api/mof-kou（app/lib/api/mof-kou-loader.ts がリクエスト時に集計。専用の
 * 生成JSONファイルは持たない）。
 *
 * 事項・目一覧と違い、行クリックの詳細は右のサイドパネルに出す（インライン展開ではない）。
 * 項単位に集約したことで件数が大きく減ったため、ページングは無い。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import type { MOFKouData, MOFKouSectionDetail, MOFKouSectionHistory } from '@/types/mof-kou';
import type { MOFKouMokuAccountType } from '@/types/mof-kou-moku';
import { formatYen } from '@/client/components/mof-jikou/format';
import { KouTable } from '@/client/components/mof-kou/KouTable';
import { KouSidePanel } from '@/client/components/mof-kou/KouSidePanel';
import {
  COLUMNS,
  DEFAULT_WIDTHS,
  defaultDirFor,
  orgColumn,
  sortItems,
  type ColumnSpec,
  type SortDir,
  type SortKey,
} from '@/client/components/mof-kou/columns';

/** RS事業との紐づけの有無で絞り込む */
type RsFilter = 'all' | 'linked' | 'unlinked';

export default function MOFKouPage() {
  const [data, setData] = useState<MOFKouData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 選択中の会計年度。null は「収録済みの最新年度」をAPIに任せる */
  const [year, setYear] = useState<number | null>(null);

  const [account, setAccount] = useState<'all' | MOFKouMokuAccountType>('all');
  const [budgetType, setBudgetType] = useState('');
  const [ministry, setMinistry] = useState('');
  const [organization, setOrganization] = useState('');
  const [subAccount, setSubAccount] = useState('');
  const [rsFilter, setRsFilter] = useState<RsFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [panelWidth, setPanelWidth] = useState(420);
  const [detail, setDetail] = useState<MOFKouSectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [history, setHistory] = useState<MOFKouSectionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(year === null ? '/api/mof-kou' : `/api/mof-kou?year=${year}`)
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((json: MOFKouData) => !cancelled && setData(json))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [year]);

  function changeYear(next: number) {
    setYear(next);
    setData(null);
    setAccount('all');
    setBudgetType('');
    setMinistry('');
    setOrganization('');
    setSubAccount('');
    setRsFilter('all');
    setSelected(null);
  }

  /** 選択中の項の詳細（事項一覧・目一覧・RS事業一覧）を取る */
  useEffect(() => {
    if (!selected || data === null) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(`/api/mof-kou/detail?year=${data.metadata.fiscalYear}&id=${encodeURIComponent(selected)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: MOFKouSectionDetail) => !cancelled && setDetail(json))
      .catch((e: Error) => !cancelled && setDetailError(e.message))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, data]);

  /** 選択中の項の経年推移を取る */
  useEffect(() => {
    if (!selected || data === null) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    fetch(`/api/mof-kou/history?year=${data.metadata.fiscalYear}&id=${encodeURIComponent(selected)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: MOFKouSectionHistory) => !cancelled && setHistory(json))
      .catch((e: Error) => !cancelled && setHistoryError(e.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, data]);

  const baseRows = useMemo(() => {
    if (!data) return [];
    return data.sections.filter(s => {
      if (account !== 'all' && s.accountType !== account) return false;
      if (budgetType && s.budgetType !== budgetType) return false;
      return true;
    });
  }, [data, account, budgetType]);

  const ministries = useMemo(
    () => [...new Set(baseRows.map(s => s.ministry || s.agency).filter(Boolean))].sort(),
    [baseRows]
  );

  const organizations = useMemo(
    () =>
      [...new Set(baseRows.filter(s => !ministry || (s.ministry || s.agency) === ministry).map(orgColumn).filter(Boolean))].sort(),
    [baseRows, ministry]
  );

  const scopedRows = useMemo(
    () =>
      baseRows
        .filter(s => !ministry || (s.ministry || s.agency) === ministry)
        .filter(s => !organization || orgColumn(s) === organization),
    [baseRows, ministry, organization]
  );

  const subAccounts = useMemo(
    () => [...new Set(scopedRows.map(s => s.subAccount).filter(Boolean))].sort(),
    [scopedRows]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    const rows = scopedRows.filter(row => {
      if (subAccount && row.subAccount !== subAccount) return false;
      if (rsFilter === 'linked' && row.rsProjectCount === 0) return false;
      if (rsFilter === 'unlinked' && row.rsProjectCount > 0) return false;
      if (kw) {
        const haystack = `${row.sectionName}\n${row.ministry}\n${orgColumn(row)}`;
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
    return sortItems(rows, sortKey, sortDir);
  }, [scopedRows, subAccount, rsFilter, keyword, sortKey, sortDir]);

  /**
   * 絞り込み結果の合計。
   * 当初・暫定・補正は同じ予算の別断面で、会計区分をまたぐと会計間の繰入も重なる。
   * 種別や会計が混ざったまま足した数字は意味を持たないので、どちらも1つに絞られているときだけ出す。
   */
  const filteredTotal = useMemo(() => {
    if (filtered.length === 0) return null;
    if (new Set(filtered.map(s => s.accountType)).size > 1) return null;
    if (new Set(filtered.map(s => s.budgetType)).size > 1) return null;
    return filtered.reduce((sum, s) => sum + s.amount, 0);
  }, [filtered]);

  const widthsChanged = COLUMNS.some(c => (widths[c.key] ?? c.width) !== c.width);
  const activeFilterCount = [
    account !== 'all',
    budgetType !== '',
    ministry !== '',
    organization !== '',
    subAccount !== '',
    rsFilter !== 'all',
  ].filter(Boolean).length;

  function toggleSort(column: ColumnSpec) {
    if (sortKey === column.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column.key);
      setSortDir(defaultDirFor(column));
    }
  }

  const selectedRow = selected ? (filtered.find(r => r.id === selected) ?? data?.sections.find(r => r.id === selected)) : undefined;

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データの読み込みに失敗しました: {error}
          <br />
          <code className="text-xs">npm run generate-mof-jikou</code> と{' '}
          <code className="text-xs">npm run generate-mof-kou-moku</code> を実行してください。
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-neutral-500">読み込み中…</p>
      </main>
    );
  }

  const selectClass =
    'max-w-[13rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <div className="flex h-screen flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex shrink-0 items-start justify-between gap-4 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">予算書「項」一覧</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span>{data.metadata.eraLabel}／財務省 予算書データベース</span>
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            <span>
              全 <b className="font-semibold text-neutral-700 dark:text-neutral-300">{data.summary.count.toLocaleString()}</b> 項
            </span>
            {data.summary.byBudgetType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            {data.summary.byAccountType.map(g => (
              <span key={g.key}>
                {g.key === 'general' ? '一般会計' : g.key === 'special' ? '特別会計' : '政府関係機関'}{' '}
                {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect
            value={String(data.metadata.fiscalYear)}
            onChange={y => changeYear(Number(y))}
            years={data.metadata.availableYears ?? [data.metadata.fiscalYear]}
          />
          <PageNavMenu current="/mof-kou" />
        </div>
      </header>

      <section className="shrink-0 px-3 pb-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            aria-expanded={showFilters}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
              showFilters || activeFilterCount > 0
                ? 'border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900'
                : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 3h12M4 8h8M6.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            フィルタ
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{activeFilterCount}</span>
            )}
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <input
            type="search"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="項名を検索"
            className="min-w-[10rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          />

          <span className="whitespace-nowrap text-neutral-500">
            該当 {filtered.length.toLocaleString()} 件
            {filteredTotal === null ? (
              filtered.length > 0 && (
                <span
                  className="ml-1 text-neutral-400"
                  title="当初・暫定・補正は同じ予算の別断面で、会計区分をまたぐと会計間の繰入も重なります。予算種別と会計区分を1つに絞ると合計を表示します。"
                >
                  （合計は予算種別・会計区分が混在のため非表示）
                </span>
              )
            ) : (
              <> / {formatYen(filteredTotal)}</>
            )}
          </span>

          {widthsChanged && (
            <button
              type="button"
              onClick={() => setWidths(DEFAULT_WIDTHS)}
              className="whitespace-nowrap rounded border border-neutral-300 px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              列幅をリセット
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
              {(
                [
                  ['all', 'すべて'],
                  ['general', '一般会計'],
                  ['special', '特別会計'],
                  ['agency', '政府関係機関'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setAccount(value);
                    setMinistry('');
                    setOrganization('');
                    setSubAccount('');
                  }}
                  className={`px-2.5 py-1 ${
                    account === value
                      ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
                      : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={budgetType}
              onChange={e => setBudgetType(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">予算種別: すべて</option>
              {data.metadata.budgetTypes.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              value={ministry}
              onChange={e => {
                setMinistry(e.target.value);
                setOrganization('');
                setSubAccount('');
              }}
              className={selectClass}
            >
              <option value="">所管: すべて</option>
              {ministries.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={organization}
              onChange={e => {
                setOrganization(e.target.value);
                setSubAccount('');
              }}
              className={selectClass}
            >
              <option value="">組織: すべて（{organizations.length}）</option>
              {organizations.map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>

            <select
              value={subAccount}
              onChange={e => setSubAccount(e.target.value)}
              disabled={subAccounts.length === 0}
              className={`${selectClass} disabled:opacity-40`}
            >
              <option value="">勘定／業務: すべて（{subAccounts.length}）</option>
              {subAccounts.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <div
              className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
              title="目の完全一致で紐づいたRS事業の有無で絞り込みます"
            >
              {(
                [
                  ['all', 'RS: すべて'],
                  ['linked', 'RSあり'],
                  ['unlinked', 'RSなし'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRsFilter(value)}
                  className={`px-2.5 py-1 ${
                    rsFilter === value
                      ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
                      : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <KouTable
              items={filtered}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              widths={widths}
              onWidthsChange={setWidths}
              selectedId={selected}
              onSelectRow={id => setSelected(cur => (cur === id ? null : id))}
            />
          </div>
        </div>

        {selectedRow && (
          <KouSidePanel
            row={selectedRow}
            onClose={() => setSelected(null)}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            linkageRsYear={data.metadata.linkage.rsYear}
            linkageIsCarriedOver={data.metadata.linkage.isCarriedOver}
            linkageSourceBudgetYear={data.metadata.linkage.sourceBudgetYear}
            width={panelWidth}
            onWidthChange={setPanelWidth}
          />
        )}
      </div>

      <div className="shrink-0 px-3 pb-3">
        <details className="text-[11px] text-neutral-500">
          <summary className="cursor-pointer">データの読み方</summary>
          <div className="mt-1 space-y-1 pl-4">
            {data.metadata.notes.map(note => (
              <p key={note}>・{note}</p>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
