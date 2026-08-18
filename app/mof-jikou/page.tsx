'use client';

/**
 * 財務省 予算書「事項」一覧の確認用ビュー。
 *
 * 行政事業レビューのデータとは接続せず、MOF 単独で何が見えるかを確認するためのページ。
 * データは /api/mof-jikou（npm run generate-mof-jikou で生成）。
 * 予算書のデータ構造そのものを確認する用途なので、列は省略せず全部出す。
 *
 * レイアウトは /quality に合わせている（画面高さいっぱいの表＋枠内フッタのページャ）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** table-fixed の列幅（px）。ソートで中身が変わっても幅が動かないようにする */
  width: number;
  /** 数値列は右寄せ・降順スタート */
  numeric?: boolean;
  note?: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: 'budgetType', label: '予算種別', width: 124 },
  { key: 'accountType', label: '会計区分', width: 92 },
  { key: 'ministry', label: '所管', width: 150 },
  {
    key: 'organization',
    label: '組織／特会',
    width: 160,
    note: '一般会計は組織、特別会計は会計名、政府関係機関は機関名',
  },
  { key: 'subAccount', label: '勘定／業務', width: 130 },
  { key: 'sectionCode', label: '項', width: 48, note: '項コード（組織・勘定内の連番）' },
  { key: 'sectionName', label: '項名', width: 190 },
  { key: 'majorExpenseName', label: '主要経費', width: 130, note: '政府関係機関の帳票には主要経費の列が無い' },
  { key: 'name', label: '事項名', width: 340 },
  { key: 'amount', label: '本年度額', width: 100, numeric: true },
  {
    key: 'previousAmount',
    label: '比較対象額',
    width: 100,
    numeric: true,
    note: '当初は前年度予算額、補正は補正前の成立予算額、暫定は欄なし',
  },
  { key: 'difference', label: '増減額', width: 100, numeric: true },
  { key: 'rate', label: '増減率', width: 84, numeric: true },
];

const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

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
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/mof-jikou')
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((json: MOFJikouData) => setData(json))
      .catch((e: Error) => setError(e.message));
  }, []);

  // フィルタ条件が変わったら1ページ目に戻す
  useEffect(() => {
    setPage(1);
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** ページを送ったら表の先頭に戻す */
  function goToPage(next: number) {
    setPage(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function toggleSort(column: ColumnSpec) {
    if (sortKey === column.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column.key);
      setSortDir(column.numeric ? 'desc' : 'asc');
    }
    goToPage(1);
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
    <div className="flex h-screen flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex shrink-0 items-start justify-between gap-4 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            予算書「事項」一覧
          </h1>
          {/* 集計はカードにすると縦を食うので1行に畳む */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span>
              {data.metadata.eraLabel}／財務省 予算書・決算書データベース
            </span>
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            <span>
              全 <b className="font-semibold text-neutral-700 dark:text-neutral-300">{data.summary.count.toLocaleString()}</b> 事項
            </span>
            {data.summary.byBudgetType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatThousandYen(g.amount)}
              </span>
            ))}
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            {data.summary.byAccountType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatThousandYen(g.amount)}
              </span>
            ))}
          </p>
        </div>
        <PageNavMenu current="/mof-jikou" />
      </header>

      <section className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2 text-xs">
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
          onChange={e => setMinistry(e.target.value)}
          className="max-w-[15rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
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
          className="max-w-[15rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
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
          className="min-w-[12rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />

        <span className="whitespace-nowrap text-neutral-500">
          該当 {filtered.length.toLocaleString()} 件 / {formatThousandYen(filteredTotal)}
        </span>
      </section>

      {/*
        外枠（枠線・角丸）とスクロールする内箱を分ける。ページャを枠内フッタに固定するため、
        枠自体はスクロールさせない。内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。
      */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            {/* table-fixed + colgroup: ソートで中身が変わっても列幅が動かないようにする */}
            <table
              className="w-full table-fixed border-collapse text-xs"
              style={{ minWidth: TABLE_MIN_WIDTH }}
            >
              <colgroup>
                {COLUMNS.map(c => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-neutral-100 text-left text-neutral-500 dark:bg-neutral-800">
                <tr>
                  {COLUMNS.map(col => {
                    const active = sortKey === col.key;
                    return (
                      <th
                        key={col.key}
                        title={col.note}
                        onClick={() => toggleSort(col)}
                        className={`cursor-pointer select-none px-2 py-2 font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                          col.numeric ? 'text-right' : 'text-left'
                        } ${active ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
                      >
                        <span className="truncate align-middle">{col.label}</span>
                        {/* ソート記号は常に同じ幅を占有させ、切替で列幅も文字位置も動かさない */}
                        <span className="ml-0.5 inline-block w-2.5 text-[9px] align-middle">
                          {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageItems.map(item => {
                  const rate = changeRate(item.amount, item.previousAmount);
                  const isOpen = expanded === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setExpanded(isOpen ? null : item.id)}
                      className="cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                    >
                      <td className="truncate px-2 py-1.5 text-neutral-500">{item.budgetType}</td>
                      <td className="truncate px-2 py-1.5 text-neutral-500">
                        {ACCOUNT_LABEL[item.accountType]}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className={isOpen ? '' : 'line-clamp-2'}>{item.ministry || '—'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className={isOpen ? '' : 'line-clamp-2'}>{orgColumn(item) || '—'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className={isOpen ? '' : 'line-clamp-2'}>{item.subAccount || '—'}</span>
                      </td>
                      <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">
                        {item.sectionCode}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className={isOpen ? '' : 'line-clamp-2'}>{item.sectionName}</span>
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className={isOpen ? '' : 'line-clamp-2'}>
                          {item.majorExpenseName ||
                            (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div
                          className={`font-medium text-neutral-900 dark:text-neutral-100 ${
                            isOpen ? '' : 'line-clamp-2'
                          }`}
                        >
                          {item.name}
                        </div>
                        {isOpen && (
                          <div className="mt-2 space-y-2 font-normal text-neutral-600 dark:text-neutral-400">
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {item.description || '（説明なし）'}
                            </p>
                            <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                              <dt>合成キー</dt>
                              <dd className="break-all font-mono">{item.key}</dd>
                              <dt>行ID</dt>
                              <dd className="font-mono">{item.id}</dd>
                              <dt>主要経費コード</dt>
                              <dd>{item.majorExpenseCode || '—'}</dd>
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
                      <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                        {formatThousandYen(item.amount)}
                      </td>
                      <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                        {formatThousandYen(item.previousAmount)}
                      </td>
                      <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                        {formatThousandYen(item.difference)}
                      </td>
                      <td
                        className={`truncate px-2 py-1.5 text-right tabular-nums ${
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
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-3 py-10 text-center text-neutral-500"
                    >
                      条件に合う事項がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ページャは表の枠内フッタ。表とページ番号が離れて見えないようにする */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
            <button
              type="button"
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              前へ
            </button>
            <span className="font-mono text-xs text-neutral-500">
              {page} / {totalPages}
              <span className="ml-2 text-neutral-400">
                {filtered.length === 0
                  ? '0 件'
                  : `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} 件目`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              次へ
            </button>
          </div>
        </div>

        <details className="mt-1.5 shrink-0 text-[11px] text-neutral-500">
          <summary className="cursor-pointer">
            データの読み方と取り込み元（{data.metadata.documents.length}帳票）
          </summary>
          <div className="mt-1 space-y-1 pl-4">
            {data.metadata.notes.map(note => (
              <p key={note}>・{note}</p>
            ))}
            <ul className="mt-1 space-y-0.5">
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
          </div>
        </details>
      </div>
    </div>
  );
}
