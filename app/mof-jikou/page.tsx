'use client';

/**
 * 財務省 予算書「事項」一覧の確認用ビュー。
 *
 * 行政事業レビューのデータとは接続せず、MOF 単独で何が見えるかを確認するためのページ。
 * データは /api/mof-jikou（npm run generate-mof-jikou で生成）。
 */

import { useEffect, useMemo, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import type { MOFJikouData, MOFJikouItem } from '@/types/mof-jikou';
import {
  changeRate,
  formatChangeRate,
  formatThousandYen,
} from '@/client/components/mof-jikou/format';

const PAGE_SIZE = 100;

type AccountFilter = 'all' | 'general' | 'special';
type SortField = 'amount' | 'difference' | 'name';

const SORT_LABELS: Record<SortField, string> = {
  amount: '金額の大きい順',
  difference: '増減額の大きい順',
  name: '事項名順',
};

/** 所管・組織・勘定をまとめた表示名 */
function orgLabel(item: MOFJikouItem): string {
  if (item.accountType === 'general') {
    return item.organization ? `${item.ministry} / ${item.organization}` : item.ministry;
  }
  return item.subAccount
    ? `${item.specialAccount} / ${item.subAccount}`
    : item.specialAccount;
}

export default function MOFJikouPage() {
  const [data, setData] = useState<MOFJikouData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [account, setAccount] = useState<AccountFilter>('all');
  const [ministry, setMinistry] = useState('');
  const [majorExpense, setMajorExpense] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sortField, setSortField] = useState<SortField>('amount');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/mof-jikou')
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((json: MOFJikouData) => setData(json))
      .catch((e: Error) => setError(e.message));
  }, []);

  // フィルタ条件が変わったら表示件数を戻す
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [account, ministry, majorExpense, keyword, sortField]);

  const ministries = useMemo(() => {
    if (!data) return [];
    const set = new Set(
      data.items
        .filter(i => account === 'all' || i.accountType === account)
        .map(i => i.ministry)
    );
    return [...set].sort();
  }, [data, account]);

  const majorExpenses = useMemo(() => {
    if (!data) return [];
    return data.summary.byMajorExpense.map(g => g.key);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim();
    const rows = data.items.filter(item => {
      if (account !== 'all' && item.accountType !== account) return false;
      if (ministry && item.ministry !== ministry) return false;
      if (majorExpense && item.majorExpenseName !== majorExpense) return false;
      if (kw) {
        const haystack = `${item.name}\n${item.sectionName}\n${item.description}\n${orgLabel(item)}`;
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (sortField === 'name') return a.name.localeCompare(b.name, 'ja');
      if (sortField === 'difference') return Math.abs(b.difference) - Math.abs(a.difference);
      return b.amount - a.amount;
    });
    return rows;
  }, [data, account, ministry, majorExpense, keyword, sortField]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, i) => sum + i.amount, 0),
    [filtered]
  );

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データの読み込みに失敗しました: {error}
          <br />
          <code className="text-xs">npm run generate-mof-jikou</code> で生成してください。
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

  const general = data.summary.byAccountType.find(g => g.key === '一般会計');
  const special = data.summary.byAccountType.find(g => g.key === '特別会計');

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            予算書「事項」一覧
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            {data.metadata.eraLabel}
            {data.metadata.budgetType}／財務省 予算書・決算書データベース
          </p>
        </div>
        <PageNavMenu current="/mof-jikou" />
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="事項数" value={`${data.summary.count.toLocaleString()} 件`} />
        <SummaryCard
          label="一般会計"
          value={general ? formatThousandYen(general.amount) : '-'}
          note={general ? `${general.count.toLocaleString()} 件` : undefined}
        />
        <SummaryCard
          label="特別会計"
          value={special ? formatThousandYen(special.amount) : '-'}
          note={special ? `${special.count.toLocaleString()} 件` : undefined}
        />
        <SummaryCard
          label="表示中の合計"
          value={formatThousandYen(filteredTotal)}
          note={`${filtered.length.toLocaleString()} 件`}
        />
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(
            [
              ['all', 'すべて'],
              ['general', '一般会計'],
              ['special', '特別会計'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setAccount(value);
                setMinistry('');
              }}
              className={`px-3 py-1.5 ${
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
          value={ministry}
          onChange={e => setMinistry(e.target.value)}
          className="max-w-[16rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">所管: すべて</option>
          {ministries.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={majorExpense}
          onChange={e => setMajorExpense(e.target.value)}
          className="max-w-[16rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">主要経費: すべて</option>
          {majorExpenses.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={sortField}
          onChange={e => setSortField(e.target.value as SortField)}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {(Object.keys(SORT_LABELS) as SortField[]).map(f => (
            <option key={f} value={f}>
              {SORT_LABELS[f]}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="事項名・項名・説明を検索"
          className="min-w-[12rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </section>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[52rem] border-collapse text-xs">
          <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2 font-medium">事項</th>
              <th className="px-3 py-2 font-medium">所管・組織</th>
              <th className="px-3 py-2 font-medium">項</th>
              <th className="px-3 py-2 font-medium">主要経費</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">本年度</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">前年度比</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map(item => {
              const rate = changeRate(item.amount, item.previousAmount);
              const isOpen = expanded === item.id;
              return (
                <tr
                  key={item.id}
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {item.name}
                    </div>
                    {isOpen && (
                      <div className="mt-2 space-y-2 text-neutral-600 dark:text-neutral-400">
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {item.description || '（説明なし）'}
                        </p>
                        <p className="text-[11px] text-neutral-400">
                          項コード {item.sectionCode} ／ 主要経費コード{' '}
                          {item.majorExpenseCode} ／ p.{item.page} ／{' '}
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="underline hover:text-neutral-600"
                          >
                            出典XML
                          </a>
                        </p>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {orgLabel(item)}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.sectionName}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.majorExpenseName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatThousandYen(item.amount)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      rate === null
                        ? 'text-blue-600'
                        : rate > 0
                          ? 'text-emerald-700 dark:text-emerald-500'
                          : rate < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-neutral-400'
                    }`}
                  >
                    {formatChangeRate(rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-xs text-neutral-500">
          条件に合う事項がありません。
        </p>
      )}

      {limit < filtered.length && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setLimit(l => l + PAGE_SIZE)}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            さらに表示（残り {(filtered.length - limit).toLocaleString()} 件）
          </button>
        </div>
      )}

      <footer className="mt-8 space-y-1 border-t border-neutral-200 pt-4 text-[11px] text-neutral-500 dark:border-neutral-800">
        {data.metadata.notes.map(note => (
          <p key={note}>・{note}</p>
        ))}
      </footer>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
      {note && <div className="text-[11px] text-neutral-400">{note}</div>}
    </div>
  );
}
