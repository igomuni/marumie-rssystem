'use client';

/**
 * 財務省 予算書「事項」一覧の確認用ビュー。
 *
 * 行政事業レビューのデータとは接続せず、MOF 単独で何が見えるかを確認するためのページ。
 * データは /api/mof-jikou（npm run generate-mof-jikou で生成）。
 * 表の列定義・並べ替え・描画は client/components/mof-jikou/ 側に置き、
 * ここは状態管理・API 呼び出し・レイアウトに限る。
 *
 * レイアウトは /quality に合わせている（画面高さいっぱいの表＋枠内フッタのページャ）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import type { MOFAccountType, MOFJikouData, MOFJikouHistory } from '@/types/mof-jikou';
import type { MofRsLinkageRecord } from '@/types/mof-rs-linkage';
import { formatYen } from '@/client/components/mof-jikou/format';
import { JikouTable } from '@/client/components/mof-jikou/JikouTable';
import {
  COLUMNS,
  DEFAULT_WIDTHS,
  defaultDirFor,
  orgColumn,
  sortItems,
  type ColumnSpec,
  type SortDir,
  type SortKey,
} from '@/client/components/mof-jikou/columns';

const PAGE_SIZE = 100;

export default function MOFJikouPage() {
  const [data, setData] = useState<MOFJikouData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 選択中の会計年度。null は「収録済みの最新年度」をAPIに任せる */
  const [year, setYear] = useState<number | null>(null);

  const [account, setAccount] = useState<'all' | MOFAccountType>('all');
  const [budgetType, setBudgetType] = useState('');
  const [ministry, setMinistry] = useState('');
  const [organization, setOrganization] = useState('');
  const [subAccount, setSubAccount] = useState('');
  const [majorExpense, setMajorExpense] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [history, setHistory] = useState<MOFJikouHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [linkageLinks, setLinkageLinks] = useState<MofRsLinkageRecord[] | null>(null);
  const [linkageAvailable, setLinkageAvailable] = useState(false);
  const [linkageRsYear, setLinkageRsYear] = useState<number | null>(null);
  const [linkageLoading, setLinkageLoading] = useState(false);
  const [linkageError, setLinkageError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(year === null ? '/api/mof-jikou' : `/api/mof-jikou?year=${year}`)
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      // ここで setYear すると year が null から数値へ変わって effect が再実行され、
      // 同じ年度をもう一度取りに行ってしまう。選択中の年度は data から読む。
      .then((json: MOFJikouData) => !cancelled && setData(json))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [year]);

  /**
   * 展開した事項の経年推移を取る。
   * 再利用コンポーネントから直接APIを叩かないよう、取得はページ層に置く。
   */
  const expandedKey = data?.items.find(i => i.id === expanded)?.key ?? null;
  useEffect(() => {
    if (!expandedKey) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    fetch(`/api/mof-jikou/history?key=${encodeURIComponent(expandedKey)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: MOFJikouHistory) => !cancelled && setHistory(json))
      .catch((e: Error) => !cancelled && setHistoryError(e.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [expandedKey]);

  /**
   * その年度の RS 事業との紐づけを一括で取る（自動突合。v1は一般会計・当初予算のみ対応）。
   * 237件・184KB程度と小さいため、行の展開ごとではなく年度が決まった時点で1回だけ取得し、
   * 一覧の列表示・詳細パネルの両方をクライアント側の Map で賄う。
   */
  const linkageYear = data?.metadata.fiscalYear ?? null;
  useEffect(() => {
    if (linkageYear === null) {
      setLinkageLinks(null);
      setLinkageAvailable(false);
      setLinkageRsYear(null);
      setLinkageError(null);
      setLinkageLoading(false);
      return;
    }
    let cancelled = false;
    setLinkageLinks(null);
    setLinkageError(null);
    setLinkageLoading(true);
    fetch(`/api/mof-jikou/linkage?year=${linkageYear}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: { available: boolean; rsYear: number | null; links: MofRsLinkageRecord[] }) => {
        if (cancelled) return;
        setLinkageAvailable(json.available);
        setLinkageRsYear(json.rsYear);
        setLinkageLinks(json.links);
      })
      .catch((e: Error) => !cancelled && setLinkageError(e.message))
      .finally(() => !cancelled && setLinkageLoading(false));
    return () => {
      cancelled = true;
    };
  }, [linkageYear]);

  /** identity → その事項に紐づく RS 事業のリスト。列表示・詳細パネルの両方から引く */
  const linkageByIdentity = useMemo(() => {
    const map = new Map<string, MofRsLinkageRecord[]>();
    for (const link of linkageLinks ?? []) {
      const list = map.get(link.jikouIdentity) ?? [];
      list.push(link);
      map.set(link.jikouIdentity, list);
    }
    return map;
  }, [linkageLinks]);

  // 年度を変えると収録帳票が変わるので、絞り込みも初期化する
  function changeYear(next: number) {
    setYear(next);
    setData(null);
    setAccount('all');
    setBudgetType('');
    setMinistry('');
    setOrganization('');
    setSubAccount('');
    setMajorExpense('');
    setExpanded(null);
  }

  // フィルタ条件が変わったら1ページ目に戻す
  useEffect(() => {
    setPage(1);
  }, [account, budgetType, ministry, organization, subAccount, majorExpense, keyword]);

  /**
   * 絞り込みの選択肢は上位の条件で連鎖させる。
   * 上位を変えたときに下位の値が残っていると、候補に無い値で0件になるため。
   */
  const baseRows = useMemo(() => {
    if (!data) return [];
    return data.items.filter(i => {
      if (account !== 'all' && i.accountType !== account) return false;
      if (budgetType && i.budgetType !== budgetType) return false;
      return true;
    });
  }, [data, account, budgetType]);

  const ministries = useMemo(
    () => [...new Set(baseRows.map(i => i.ministry || i.agency).filter(Boolean))].sort(),
    [baseRows]
  );

  const organizations = useMemo(
    () =>
      [
        ...new Set(
          baseRows
            .filter(i => !ministry || (i.ministry || i.agency) === ministry)
            .map(orgColumn)
            .filter(Boolean)
        ),
      ].sort(),
    [baseRows, ministry]
  );

  const scopedRows = useMemo(
    () =>
      baseRows
        .filter(i => !ministry || (i.ministry || i.agency) === ministry)
        .filter(i => !organization || orgColumn(i) === organization),
    [baseRows, ministry, organization]
  );

  const subAccounts = useMemo(
    () => [...new Set(scopedRows.map(i => i.subAccount).filter(Boolean))].sort(),
    [scopedRows]
  );

  const majorExpenses = useMemo(
    () => [...new Set(scopedRows.map(i => i.majorExpenseName).filter(Boolean))].sort(),
    [scopedRows]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    const rows = scopedRows.filter(item => {
      if (subAccount && item.subAccount !== subAccount) return false;
      if (majorExpense && item.majorExpenseName !== majorExpense) return false;
      if (kw) {
        const haystack = `${item.name}\n${item.sectionName}\n${item.description}\n${item.ministry}\n${orgColumn(item)}`;
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
    return sortItems(rows, sortKey, sortDir);
  }, [scopedRows, subAccount, majorExpense, keyword, sortKey, sortDir]);

  /**
   * 絞り込み結果の合計。
   * 当初・暫定・補正は同じ予算の別断面で、会計区分をまたぐと会計間の繰入も重なる。
   * 種別や会計が混ざったまま足した数字は意味を持たないので、
   * どちらも1つに絞られているときだけ合計を出す。
   */
  const filteredTotal = useMemo(() => {
    if (filtered.length === 0) return null;
    const budgetTypes = new Set(filtered.map(i => i.budgetType));
    const accountTypes = new Set(filtered.map(i => i.accountType));
    if (budgetTypes.size > 1 || accountTypes.size > 1) return null;
    return filtered.reduce((sum, i) => sum + i.amount, 0);
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const widthsChanged = COLUMNS.some(c => (widths[c.key] ?? c.width) !== c.width);

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
      setSortDir(defaultDirFor(column));
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

  const selectClass =
    'max-w-[13rem] truncate rounded-lg border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <div className="flex h-screen flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex shrink-0 items-start justify-between gap-4 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            予算書「事項」一覧
          </h1>
          {/* 集計はカードにすると縦を食うので1行に畳む */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span>{data.metadata.eraLabel}／財務省 予算書・決算書データベース</span>
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            <span>
              全{' '}
              <b className="font-semibold text-neutral-700 dark:text-neutral-300">
                {data.summary.count.toLocaleString()}
              </b>{' '}
              事項
            </span>
            {data.summary.byBudgetType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            {data.summary.byAccountType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
          </p>
        </div>
        {/* 年度とページ切替。全ページ共通で右上に置く */}
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect
            value={String(data.metadata.fiscalYear)}
            onChange={y => changeYear(Number(y))}
            years={data.metadata.availableYears ?? [data.metadata.fiscalYear]}
          />
          <PageNavMenu current="/mof-jikou" />
        </div>
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
                setOrganization('');
                setSubAccount('');
                setMajorExpense('');
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
          onChange={e => {
            setBudgetType(e.target.value);
            setMajorExpense('');
          }}
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
            setMajorExpense('');
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
            setMajorExpense('');
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
          <option value="">勘定: すべて（{subAccounts.length}）</option>
          {subAccounts.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={majorExpense}
          onChange={e => setMajorExpense(e.target.value)}
          disabled={majorExpenses.length === 0}
          className={`${selectClass} disabled:opacity-40`}
        >
          <option value="">主要経費: すべて（{majorExpenses.length}）</option>
          {majorExpenses.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="事項名・項名・説明を検索"
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
                （合計は種別・会計が混在のため非表示）
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
      </section>

      {/*
        外枠（枠線・角丸）とスクロールする内箱を分ける。ページャを枠内フッタに固定するため、
        枠自体はスクロールさせない。内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。
      */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <JikouTable
              items={pageItems}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              widths={widths}
              onWidthsChange={setWidths}
              expandedId={expanded}
              onToggleExpand={setExpanded}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              linkageByIdentity={linkageByIdentity}
              linkageAvailable={linkageAvailable}
              linkageRsYear={linkageRsYear}
              linkageLoading={linkageLoading}
              linkageError={linkageError}
            />
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
