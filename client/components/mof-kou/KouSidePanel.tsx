'use client';

/**
 * 項の詳細サイドパネル。行クリックで開く。タブで「年度推移・事項・目・RS」を切り替える。
 * 各タブの一覧は列見出し付きのグリッド（DataGrid）で表示する。
 * データ取得（詳細・経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 *
 * タブの選択状態・各タブのグリッドのソート/列幅は、ページ層（app/mof-kou/page.tsx）が
 * controlled で持つ。年度切替時は一瞬 selectedRow が無くなりこのコンポーネント自体が
 * アンマウントされるため、このコンポーネント内部のuseStateに置くと毎回リセットされてしまう。
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionSummary } from '@/types/mof-kou';
import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { legacyItemNaturalKey, phaseLabel, type V2MofRsLink, type V2SettlementIdentity } from '@/app/lib/v2-public-linkage';
import { MatchMethodBadge } from '@/client/components/mof-rs/MatchMethodBadge';
import { changeRate, formatChangeRate, formatRate, formatYen } from '@/client/components/mof-jikou/format';
import { AccountBadge, BudgetTypeBadge } from './Badge';
import { orgColumn } from './columns';
import { DataGrid, type GridColumn, type GridViewState } from './DataGrid';
import { buildV2KouMokuReconciliations } from '@/app/lib/mof-kou-moku-v2-linkage';
import type { MofKouMokuV2LinkGroup, MofKouMokuV2Project } from '@/types/mof-kou-moku-v2-linkage';

/**
 * Pipeline V2 linkage overlay用にページ層（app/mof-kou/page.tsx）が組み立てて渡すデータ。
 * null のときはこのパネルは完全に旧V1 linkage（detail.rsLinks）で描画する
 * （V1/V2を画面内で混在させないため、V2利用可能時はKouMokuTab/RsTabの両方をV2側へ揃える）。
 */
export interface V2PanelData {
  reviewYear: number | null;
  /** 選択中の項がV2 sectionへ一意に接続できたか */
  sectionMatched: boolean;
  /** 当初・補正は金額link、決算はsettlement identity（public settlement.json.gz authority）、暫定等は未対応 */
  mode: 'budget-link' | 'settlement-identity' | 'unsupported';
  /** budget-linkモードでのみ使う、絞ったV2 link group。section detail取得前は null */
  links: V2MofRsLink[] | null;
  /**
   * settlement-identityモードでのみ使う。選択中V2 sectionのsettlementSectionIdへ
   * 一致するpublic settlement identity（budget側rsLinksから再構成しない、B3b）。
   */
  settlementIdentities: V2SettlementIdentity[] | null;
  /** itemNaturalKey → 目名（V2 section detail由来）。settlement-identityモードでは
   *  selectedV2SectionがsettlementItemIdと同じ体系のためsettlementItemIdの表示名にも使える */
  itemNames: Map<string, string> | null;
  /** projectId → 事業名・府省庁（V2 RS index由来） */
  projectNames: Map<string, { name: string; ministry: string }> | null;
  /**
   * 当初・補正時のPID別2-2内訳（budget-linkモード）、または決算sourceのPID別evidence
   * （settlement-identityモード）。いずれもlinkId × itemNaturalKeyでprojectionから絞ったもの。
   */
  projectionGroups: MofKouMokuV2LinkGroup[] | null;
  projectionLoading: boolean;
  projectionError: string | null;
  sectionLoading: boolean;
  sectionError: string | null;
}

export type Tab = 'history' | 'jikou' | 'koumoku' | 'rs';

export interface PanelGridStates {
  history: GridViewState;
  jikou: GridViewState;
  koumoku: GridViewState;
  rs: GridViewState;
}

/** タブ・各グリッドのソート/列幅の既定値 */
export function createDefaultPanelGridStates(): PanelGridStates {
  return {
    history: { sortKey: 'year', sortDir: 'asc', widths: {} },
    jikou: { sortKey: 'amount', sortDir: 'desc', widths: {} },
    koumoku: { sortKey: 'amount', sortDir: 'desc', widths: {} },
    rs: { sortKey: 'rsAmount', sortDir: 'desc', widths: {} },
  };
}

interface Props {
  row: MOFKouSectionSummary;
  /** 項単位サンキー（/mof-kou/[id]）へのリンクに使う会計年度 */
  fiscalYear: number;
  onClose: () => void;
  detail: MOFKouSectionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  history: MOFKouSectionHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  linkageRsYear: number | null;
  v2: V2PanelData | null;
  width: number;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  gridStates: PanelGridStates;
  onGridStateChange: (tab: Tab, updater: (prev: GridViewState) => GridViewState) => void;
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
  fiscalYear,
  onClose,
  detail,
  detailLoading,
  detailError,
  history,
  historyLoading,
  historyError,
  linkageRsYear,
  v2,
  width,
  tab,
  onTabChange,
  gridStates,
  onGridStateChange,
}: Props) {
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
          {' ・ '}
          <Link
            href={`/mof-kou/${encodeURIComponent(row.id)}?year=${fiscalYear}`}
            className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            サンキーで見る
          </Link>
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
            onClick={() => onTabChange(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex-1 px-2 py-1.5 font-medium ${
              tab === t.key
                ? 'border-b-2 border-neutral-800 text-neutral-900 dark:border-neutral-200 dark:text-neutral-100'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            {t.key === 'rs' && v2?.mode === 'settlement-identity' ? '関連RS事業' : t.label}
            {t.key === 'jikou' && ` (${row.jikouCount})`}
            {t.key === 'koumoku' && ` (${row.kouMokuCount})`}
            {t.key === 'rs' && ` (${row.rsProjectCount})`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto text-xs">
        {tab === 'history' && (
          <HistoryTab
            history={history}
            loading={historyLoading}
            error={historyError}
            gridState={gridStates.history}
            onGridStateChange={updater => onGridStateChange('history', updater)}
          />
        )}
        {tab === 'jikou' && (
          <JikouTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            gridState={gridStates.jikou}
            onGridStateChange={updater => onGridStateChange('jikou', updater)}
          />
        )}
        {tab === 'koumoku' && (
          <KouMokuTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            v2={v2}
            gridState={gridStates.koumoku}
            onGridStateChange={updater => onGridStateChange('koumoku', updater)}
          />
        )}
        {tab === 'rs' && (
          <RsTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            linkageRsYear={linkageRsYear}
            v2={v2}
            gridState={gridStates.rs}
            onGridStateChange={updater => onGridStateChange('rs', updater)}
          />
        )}
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
  gridState,
  onGridStateChange,
}: {
  history: MOFKouSectionHistory | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
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
        state={gridState}
        onStateChange={onGridStateChange}
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
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  const [descriptionItem, setDescriptionItem] = useState<MOFJikouItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ダイアログを開いたらフォーカスを中に移し、Tabで背後の一覧へ抜けないよう閉じ込める。
  // 閉じたら開く前にフォーカスしていた要素（説明アイコン）へ戻す。
  useEffect(() => {
    if (!descriptionItem) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDescriptionItem(null);
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [descriptionItem]);

  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const columns: GridColumn<MOFJikouItem>[] = [
    {
      key: 'name',
      label: '事項名',
      width: 200,
      sortValue: it => it.name,
      render: it => (
        <span className="flex w-full min-w-0 items-center gap-1">
          <a
            href={it.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {it.name}
          </a>
          {it.description && (
            <button
              type="button"
              aria-label={`${it.name} の説明を表示`}
              title="説明を表示"
              onClick={e => {
                e.stopPropagation();
                setDescriptionItem(it);
              }}
              className="ml-auto shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
                <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
              </svg>
            </button>
          )}
        </span>
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
    <>
      <DataGrid
        rows={detail.jikouItems}
        columns={columns}
        rowKey={it => it.id}
        state={gridState}
        onStateChange={onGridStateChange}
        emptyMessage="この項に事項はありません。"
      />
      {descriptionItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDescriptionItem(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${descriptionItem.name} の説明`}
            tabIndex={-1}
            className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-2xl outline-none dark:bg-neutral-900"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{descriptionItem.name}</h3>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setDescriptionItem(null)}
                className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
              {descriptionItem.description}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function KouMokuTab({
  detail,
  loading,
  error,
  v2,
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  v2: V2PanelData | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const reconciliations = buildV2KouMokuReconciliations(v2?.projectionGroups ?? []);

  const rsByKouMokuKey = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const l of detail.rsLinks) {
    const list = rsByKouMokuKey.get(l.kouMokuKey) ?? [];
    list.push(l);
    rsByKouMokuKey.set(l.kouMokuKey, list);
  }

  /** V2利用可能時は目ごとのRS件数もV2側から再計算する（V1と混在させない） */
  function v2ProjectIdsFor(it: MOFKouMokuItem): Set<string> | null {
    if (!v2 || !v2.sectionMatched || v2.mode === 'unsupported') return null;
    if (v2.mode === 'budget-link') {
      if (v2.projectionGroups === null) return null;
      return new Set(
        v2.projectionGroups
          .filter(group => group.kouMokuKey === it.key)
          .flatMap(group => group.projectIds)
      );
    }
    // settlement-identity: public settlement identity（settlementItemId）をauthorityとする。
    // budget側rsLinksからは再構成しない（B3b）。
    if (v2.settlementIdentities === null) return null;
    const itemKey = legacyItemNaturalKey(it, { subItemCode: it.subItemCode, subItemName: it.subItemName });
    const identity = v2.settlementIdentities.find(i => i.settlementItemId === itemKey);
    return identity ? new Set(identity.projectIds) : new Set();
  }

  const columns: GridColumn<MOFKouMokuItem>[] = [
    {
      key: 'name',
      label: '目名',
      width: 190,
      sortValue: it => it.subItemName,
      render: it =>
        it.sourceUrl ? (
          <a
            href={it.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {it.subItemName}
          </a>
        ) : (
          <span title="出典ページ不明">{it.subItemName}</span>
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
      label: 'RS事業',
      width: 60,
      numeric: true,
      sortValue: it => {
        if (v2) return v2ProjectIdsFor(it)?.size ?? 0;
        return new Set((rsByKouMokuKey.get(it.key) ?? []).map(l => l.projectId)).size;
      },
      render: it => {
        if (v2) {
          const ids = v2ProjectIdsFor(it);
          if (ids === null) {
            return <span className="text-neutral-300 dark:text-neutral-700" title="V2でこの項に接続できませんでした">—</span>;
          }
          const names = v2.projectNames;
          const title = names ? [...ids].map(id => names.get(id)?.name ?? id).join('\n') : undefined;
          return (
            <span
              className={ids.size > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-300 dark:text-neutral-700'}
              title={title}
            >
              {ids.size || '—'}
            </span>
          );
        }
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
      key: 'amount', label: '本年度額', width: 100, numeric: true,
      sortValue: it => it.amount,
      render: it => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(it.amount)}</span>,
    },
    {
      key: 'previousAmount', label: '比較対象額', width: 100, numeric: true,
      sortValue: it => it.previousAmount,
      render: it => formatYen(it.previousAmount),
    },
    {
      key: 'rate', label: '増減率', width: 80, numeric: true,
      sortValue: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
    ...(v2?.mode === 'budget-link' && v2.projectionGroups !== null ? [
      {
        key: 'rs22Amount', label: 'RS金額', width: 110, numeric: true,
        sortValue: (it: MOFKouMokuItem) => reconciliations.get(it.key)?.rsAmountYen ?? null,
        render: (it: MOFKouMokuItem) => {
          const value = reconciliations.get(it.key)?.rsAmountYen;
          return value === undefined ? '—' : formatYen(value);
        },
      },
      {
        key: 'rsMinusMof', label: 'RS差', headerTitle: '当初は RS 2-2当初額 − MOF本年度額、補正は RS 2-2補正額 − MOF増減額', width: 110, numeric: true,
        sortValue: (it: MOFKouMokuItem) => reconciliations.get(it.key)?.rsMinusMofYen ?? null,
        render: (it: MOFKouMokuItem) => {
          const value = reconciliations.get(it.key)?.rsMinusMofYen;
          return value === undefined ? '—' : formatYen(value);
        },
      },
      {
        key: 'rsToMof', label: 'RS比', headerTitle: '当初は RS 2-2当初額 ÷ MOF本年度額、補正は RS 2-2補正額 ÷ MOF増減額', width: 80, numeric: true,
        sortValue: (it: MOFKouMokuItem) => reconciliations.get(it.key)?.rsToMofRate ?? null,
        render: (it: MOFKouMokuItem) => formatRate(reconciliations.get(it.key)?.rsToMofRate ?? null),
      },
    ] : []),
  ];

  return (
    <DataGrid
      rows={detail.kouMokuItems}
      columns={columns}
      rowKey={it => it.id}
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="この項に目はありません。"
    />
  );
}

function RsTab({
  detail,
  loading,
  error,
  linkageRsYear,
  v2,
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  linkageRsYear: number | null;
  v2: V2PanelData | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (v2) return <V2RsTab v2={v2} gridState={gridState} onGridStateChange={onGridStateChange} />;
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
  if (!detail) return <p className="p-3 text-neutral-400">紐づく RS 事業は見つかりませんでした。</p>;

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
    { key: 'projectMinistry', label: '府省庁', width: 110, sortValue: l => l.projectMinistry, render: l => l.projectMinistry },
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
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="紐づく RS 事業は見つかりませんでした。"
    />
  );
}

function V2RsTab({
  v2,
  gridState,
  onGridStateChange,
}: {
  v2: V2PanelData;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (!v2.sectionMatched) {
    return (
      <p className="p-3 text-neutral-400">
        この項はV2データへ一意に接続できませんでした（項名・所管などの表記差の可能性があります）。
      </p>
    );
  }
  if (v2.mode === 'unsupported') {
    return <p className="p-3 text-neutral-400">この予算種別（決算・暫定）はV2のMOF↔RSリンクの対象外です。</p>;
  }

  if (v2.mode === 'settlement-identity') {
    return <V2SettlementIdentityRsTab v2={v2} gridState={gridState} onGridStateChange={onGridStateChange} />;
  }

  if (v2.links === null) {
    if (v2.sectionError) return <p className="p-3 text-red-600">V2リンクの取得に失敗しました: {v2.sectionError}</p>;
    if (v2.sectionLoading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
    return <p className="p-3 text-neutral-400">紐づく RS 事業は見つかりませんでした。</p>;
  }

  if (v2.projectionGroups === null) {
    if (v2.projectionError) return <p className="p-3 text-red-600">V2内訳の取得に失敗しました: {v2.projectionError}</p>;
    if (v2.projectionLoading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
    return <p className="p-3 text-neutral-400">V2内訳は利用できません。</p>;
  }

  /** 同じPIDが複数目に出ること自体を分析できるよう、目×PIDの粒度を保持する。 */
  type V2ProjectRow = { group: MofKouMokuV2LinkGroup; project: MofKouMokuV2Project };
  const rows: V2ProjectRow[] = v2.projectionGroups.flatMap(group =>
    group.projects.map(project => ({ group, project }))
  );
  const projectBudgetShare = (row: V2ProjectRow) =>
    row.project.projectBudgetAmountYen === null ? null : row.project.rsAmountYen / row.project.projectBudgetAmountYen;
  const mofItemShare = (row: V2ProjectRow) =>
    row.group.mofAmountYen === 0 ? null : row.project.rsAmountYen / row.group.mofAmountYen;
  const itemName = (row: V2ProjectRow) =>
    v2.itemNames?.get(row.group.itemNaturalKey) ?? row.group.itemNaturalKey;

  const columns: GridColumn<V2ProjectRow>[] = [
    {
      key: 'matchMethod',
      label: '根拠',
      width: 100,
      sortValue: row => row.group.matchMethod,
      render: row => <MatchMethodBadge method={row.group.matchMethod} />,
    },
    { key: 'item', label: '目', width: 180, sortValue: itemName, render: row => <span title={itemName(row)}>{itemName(row)}</span> },
    {
      key: 'project',
      label: 'RS事業',
      width: 200,
      sortValue: row => row.project.projectName || row.project.projectId,
      render: row => v2.reviewYear !== null ? <a href={sankeySvgProjectUrl(Number(row.project.projectId), row.project.projectName || row.project.projectId, v2.reviewYear)} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100" title={row.project.projectId}>{row.project.projectName || row.project.projectId}</a> : row.project.projectName || row.project.projectId,
    },
    { key: 'ministry', label: '府省庁', width: 120, sortValue: row => row.project.ministry, render: row => row.project.ministry || '—' },
    {
      key: 'projectRsAmount',
      label: 'RS事業額',
      width: 120,
      numeric: true,
      sortValue: row => row.project.rsAmountYen,
      render: row => <span className="font-medium text-neutral-900 dark:text-neutral-100" title={`RS 2-2 ${row.project.rsRecordCount}行の合計`}>{formatYen(row.project.rsAmountYen)}</span>,
    },
    {
      key: 'projectBudgetShare',
      label: 'RS事業%',
      width: 82,
      numeric: true,
      sortValue: projectBudgetShare,
      render: row => formatRate(projectBudgetShare(row)),
    },
    {
      key: 'mofItemShare',
      label: 'MOF目%',
      width: 82,
      numeric: true,
      sortValue: mofItemShare,
      render: row => formatRate(mofItemShare(row)),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={row => `${row.group.linkId}:${row.group.itemNaturalKey}:${row.project.projectId}`}
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="紐づく RS 事業は見つかりませんでした。"
    />
  );
}

/**
 * 決算タブ（B3b）: selectedV2SectionのsettlementSectionIdへ一致するpublic settlement
 * identityをauthorityとし、budget側rsLinksからは再構成しない。PID別の当初/補正stage
 * evidence（phase/revision/matchMethod/RS金額）は、`linkId + budgetItemId` で
 * v2.projectionGroups（UI budget projection group）とjoinして復元する
 * （public settlement sourceはこれらを重複保持していない）。
 * fallback（resolutionMethod=unique-name-fallback）ではbudgetItemId !== settlementItemId
 * となるため、目名の表示は常にsettlementItemId側（v2.itemNames、選択中sectionの決算側
 * items由来）で引く。
 */
function V2SettlementIdentityRsTab({
  v2,
  gridState,
  onGridStateChange,
}: {
  v2: V2PanelData;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (v2.settlementIdentities === null) {
    if (v2.sectionError) return <p className="p-3 text-red-600">V2決算identityの取得に失敗しました: {v2.sectionError}</p>;
    if (v2.sectionLoading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
    return <p className="p-3 text-neutral-400">紐づく RS 事業は見つかりませんでした。</p>;
  }
  if (v2.projectionGroups === null) {
    if (v2.projectionError) return <p className="p-3 text-red-600">V2内訳の取得に失敗しました: {v2.projectionError}</p>;
    if (v2.projectionLoading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
    return <p className="p-3 text-neutral-400">V2内訳は利用できません。</p>;
  }

  const itemName = (id: string) => v2.itemNames?.get(id) ?? id;
  const projectName = (id: string) => v2.projectNames?.get(id)?.name ?? id;
  const projectMinistry = (id: string) => v2.projectNames?.get(id)?.ministry ?? '';

  const settlementItemIdByGroupKey = new Map<string, string>();
  for (const identity of v2.settlementIdentities) {
    for (const source of identity.sources) {
      settlementItemIdByGroupKey.set(`${source.linkId}\x1f${source.budgetItemId}`, identity.settlementItemId);
    }
  }

  type SettlementRow = { group: MofKouMokuV2LinkGroup; project: MofKouMokuV2Project; settlementItemId: string };
  const rows: SettlementRow[] = v2.projectionGroups.flatMap(group => {
    const settlementItemId = settlementItemIdByGroupKey.get(`${group.linkId}\x1f${group.itemNaturalKey}`);
    if (!settlementItemId) return [];
    return group.projects.map(project => ({ group, project, settlementItemId }));
  });

  const columns: GridColumn<SettlementRow>[] = [
    {
      key: 'matchMethod', label: '根拠', width: 100, sortValue: row => row.group.matchMethod,
      render: row => <MatchMethodBadge method={row.group.matchMethod} />,
    },
    {
      key: 'item', label: '決算目', width: 200, sortValue: row => itemName(row.settlementItemId),
      render: row => <span title={itemName(row.settlementItemId)}>{itemName(row.settlementItemId)}</span>,
    },
    {
      key: 'project', label: 'RS事業', width: 220, sortValue: row => projectName(row.project.projectId),
      render: row => v2.reviewYear !== null ? <a href={sankeySvgProjectUrl(Number(row.project.projectId), projectName(row.project.projectId), v2.reviewYear)} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100" title={row.project.projectId}>{projectName(row.project.projectId)}</a> : projectName(row.project.projectId),
    },
    { key: 'ministry', label: '府省庁', width: 120, sortValue: row => projectMinistry(row.project.projectId), render: row => projectMinistry(row.project.projectId) || '—' },
    {
      key: 'projectRsAmount', label: 'RS事業額', width: 120, numeric: true, sortValue: row => row.project.rsAmountYen,
      render: row => <span className="font-medium text-neutral-900 dark:text-neutral-100" title={`RS 2-2 ${row.project.rsRecordCount}行の合計`}>{formatYen(row.project.rsAmountYen)}</span>,
    },
    {
      key: 'stages', label: 'リンク元', width: 100, sortValue: row => phaseLabel(row.group.phase, row.group.revision),
      render: row => <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{phaseLabel(row.group.phase, row.group.revision)}</span>,
    },
  ];
  const validSortKeys = new Set(columns.map(column => column.key));
  const effectiveState = gridState.sortKey !== null && validSortKeys.has(gridState.sortKey)
    ? gridState : { ...gridState, sortKey: 'project', sortDir: 'asc' as const };
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={row => `${row.group.linkId}:${row.group.itemNaturalKey}:${row.project.projectId}`}
      state={effectiveState}
      onStateChange={onGridStateChange}
      emptyMessage="予算段階で対応付けられたRS事業は見つかりませんでした。"
    />
  );
}
