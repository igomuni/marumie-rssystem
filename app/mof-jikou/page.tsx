'use client';

/**
 * 財務省 予算書「事項」一覧の確認用ビュー。
 *
 * 行政事業レビューのデータとは接続せず、MOF 単独で何が見えるかを確認するためのページ。
 * データは /api/mof-jikou（npm run generate-mof-jikou で生成）。
 * 予算書のデータ構造そのものを確認する用途なので、列は省略せず全部出す。
 */

import { useEffect, useMemo, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import type { MOFAccountType, MOFJikouData, MOFJikouItem } from '@/types/mof-jikou';
import {
  changeRate,
  formatChangeRate,
  formatThousandYen,
} from '@/client/components/mof-jikou/format';

const PAGE_SIZE = 100;

const ACCOUNT_LABEL: Record<MOFAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

/** ソート可能な列 */
type SortKey =
  | 'budgetType'
  | 'accountType'
  | 'ministry'
  | 'organization'
  | 'subAccount'
  | 'sectionCode'
  | 'sectionName'
  | 'majorExpenseName'
  | 'name'
  | 'amount'
  | 'previousAmount'
  | 'difference'
  | 'rate';

type SortDir = 'asc' | 'desc';

interface ColumnSpec {
  key: SortKey;
  label: string;
  /** 数値列は右寄せ・降順スタート */
  numeric?: boolean;
  headerNote?: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: 'budgetType', label: '予算種別' },
  { key: 'accountType', label: '会計区分' },
  { key: 'ministry', label: '所管' },
  { key: 'organization', label: '組織／特別会計', headerNote: '一般会計は組織、特別会計は会計名、政府関係機関は機関名' },
  { key: 'subAccount', label: '勘定／業務' },
  { key: 'sectionCode', label: '項コード' },
  { key: 'sectionName', label: '項名' },
  { key: 'majorExpenseName', label: '主要経費' },
  { key: 'name', label: '事項名' },
  { key: 'amount', label: '本年度額', numeric: true },
  { key: 'previousAmount', label: '比較対象額', numeric: true, headerNote: '当初は前年度予算額、補正は補正前の成立予算額、暫定は欄なし' },
  { key: 'difference', label: '増減額', numeric: true },
  { key: 'rate', label: '増減率', numeric: true },
];

/** 一般会計は組織、特別会計は会計名、政府関係機関は機関名 */
function orgColumn(item: MOFJikouItem): string {
  if (item.accountType === 'general') return item.organization;
  if (item.accountType === 'special') return item.specialAccount;
  return item.agency;
}

/** ソート用の値を取り出す */
function sortValue(item: MOFJikouItem, key: SortKey): string | number | null {
  switch (key) {
    case 'accountType':
      return ACCOUNT_LABEL[item.accountType];
    case 'organization':
      return orgColumn(item);
    case 'rate': {
      const r = changeRate(item.amount, item.previousAmount);
      return r === null || r === 'new' ? null : r;
    }
    default:
      return item[key];
  }
}

export default function MOFJikouPage() {
  const [data, setData] = useState<MOFJikouData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [account, setAccount] = useState<'all' | MOFAccountType>('all');
  const [budgetType, setBudgetType] = useState('');
  const [ministry, setMinistry] = useState('');
  const [majorExpense, setMajorExpense] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
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
  }, [account, budgetType, ministry, majorExpense, keyword]);

  const ministries = useMemo(() => {
    if (!data) return [];
    const set = new Set(
      data.items
        .filter(i => account === 'all' || i.accountType === account)
        .map(i => i.ministry || i.agency)
        .filter(Boolean)
    );
    return [...set].sort();
  }, [data, account]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim();
    const rows = data.items.filter(item => {
      if (account !== 'all' && item.accountType !== account) return false;
      if (budgetType && item.budgetType !== budgetType) return false;
      if (ministry && (item.ministry || item.agency) !== ministry) return false;
      if (majorExpense && item.majorExpenseName !== majorExpense) return false;
      if (kw) {
        const haystack = `${item.name}\n${item.sectionName}\n${item.description}\n${item.ministry}\n${orgColumn(item)}`;
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
    const factor = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      // null（該当欄なし）は方向によらず末尾へ
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'ja') * factor;
    });
    return rows;
  }, [data, account, budgetType, ministry, majorExpense, keyword, sortKey, sortDir]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, i) => sum + i.amount, 0),
    [filtered]
  );

  function toggleSort(column: ColumnSpec) {
    if (sortKey === column.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column.key);
      setSortDir(column.numeric ? 'desc' : 'asc');
    }
    setLimit(PAGE_SIZE);
  }

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

  return (
    <main className="w-full px-3 py-4 sm:px-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            予算書「事項」一覧
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            {data.metadata.eraLabel}（{data.metadata.budgetTypes.join('・')}）／財務省
            予算書・決算書データベース
          </p>
        </div>
        <PageNavMenu current="/mof-jikou" />
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 lg:grid-cols-6">
        <SummaryCard label="事項数" value={`${data.summary.count.toLocaleString()} 件`} />
        {data.summary.byBudgetType.map(g => (
          <SummaryCard
            key={g.key}
            label={g.key}
            value={formatThousandYen(g.amount)}
            note={`${g.count.toLocaleString()} 件`}
          />
        ))}
        {data.summary.byAccountType.map(g => (
          <SummaryCard
            key={g.key}
            label={g.key}
            value={formatThousandYen(g.amount)}
            note={`${g.count.toLocaleString()} 件`}
          />
        ))}
      </section>

      <section className="mb-3 flex flex-wrap items-center gap-2 text-xs">
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
          value={budgetType}
          onChange={e => setBudgetType(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
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
          onChange={e => setMinistry(e.target.value)}
          className="max-w-[16rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">所管・機関: すべて</option>
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
          {data.summary.byMajorExpense.map(g => (
            <option key={g.key} value={g.key}>
              {g.key}
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

        <span className="whitespace-nowrap text-neutral-500">
          {filtered.length.toLocaleString()} 件 / {formatThousandYen(filteredTotal)}
        </span>
      </section>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
            <tr>
              {COLUMNS.map(col => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    title={col.headerNote}
                    onClick={() => toggleSort(col)}
                    className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      col.numeric ? 'text-right' : 'text-left'
                    } ${active ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
                  >
                    {col.label}
                    <span className="ml-1 text-[10px]">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : '　'}
                    </span>
                  </th>
                );
              })}
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
                  <td className="whitespace-nowrap px-2 py-2 text-neutral-500">
                    {item.budgetType}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-neutral-500">
                    {ACCOUNT_LABEL[item.accountType]}
                  </td>
                  <td className="px-2 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.ministry || '—'}
                  </td>
                  <td className="px-2 py-2 text-neutral-600 dark:text-neutral-400">
                    {orgColumn(item) || '—'}
                  </td>
                  <td className="px-2 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.subAccount || '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-neutral-500">
                    {item.sectionCode}
                  </td>
                  <td className="px-2 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.sectionName}
                  </td>
                  <td className="px-2 py-2 text-neutral-600 dark:text-neutral-400">
                    {item.majorExpenseName || (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {item.name}
                    </div>
                    {isOpen && (
                      <div className="mt-2 max-w-[48rem] space-y-2 font-normal text-neutral-600 dark:text-neutral-400">
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {item.description || '（説明なし）'}
                        </p>
                        <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                          <dt>合成キー</dt>
                          <dd className="break-all font-mono">{item.key}</dd>
                          <dt>行ID</dt>
                          <dd className="font-mono">{item.id}</dd>
                          <dt>主要経費コード</dt>
                          <dd>{item.majorExpenseCode}</dd>
                          <dt>帳票・ページ</dt>
                          <dd>
                            {item.documentId} p.{item.page}{' '}
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="underline hover:text-neutral-600"
                            >
                              出典XML
                            </a>
                          </dd>
                        </dl>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatThousandYen(item.amount)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-neutral-500">
                    {formatThousandYen(item.previousAmount)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-neutral-500">
                    {formatThousandYen(item.difference)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${
                      rate === null
                        ? 'text-neutral-400'
                        : rate === 'new'
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

      <footer className="mt-8 space-y-2 border-t border-neutral-200 pt-4 text-[11px] text-neutral-500 dark:border-neutral-800">
        <div className="space-y-1">
          {data.metadata.notes.map(note => (
            <p key={note}>・{note}</p>
          ))}
        </div>
        <details>
          <summary className="cursor-pointer">取り込み元の帳票（{data.metadata.documents.length}件）</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {data.metadata.documents.map(doc => (
              <li key={doc.documentId}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-neutral-700"
                >
                  {doc.documentId} {doc.title}
                </a>
                {' — '}
                {doc.pages} ページ / {doc.count.toLocaleString()} 件
              </li>
            ))}
          </ul>
        </details>
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
      <div className="truncate text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
      {note && <div className="text-[11px] text-neutral-400">{note}</div>}
    </div>
  );
}
