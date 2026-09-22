'use client';

/**
 * 財務省 予算書「項」一覧の確認用ビュー。
 *
 * `/mof-jikou`（事項＝目的別内訳）と `/mof-kou-moku`（目＝性質別内訳）を、共通の親である
 * 「項」の粒度まで引いて見る。1行=1項×1予算種別で、その項に事項が何件・目が何件あり、
 * 目の完全一致でRS事業に何件紐づいているかを一覧できる。
 * データは /api/mof-kou（app/lib/api/mof-kou-loader.ts が正準データ mof-budget-{年度}.json
 * を直接読み、RS紐づけだけをリクエスト時に上乗せする）。
 *
 * 事項・目一覧と違い、行クリックの詳細は右のサイドパネルに出す（インライン展開ではない）。
 * 項単位に集約したことで件数が大きく減ったため、ページングは無い。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import type { MOFKouData, MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionSummary } from '@/types/mof-kou';
import { changeRate, formatYen } from '@/client/components/mof-jikou/format';
import { KouTable } from '@/client/components/mof-kou/KouTable';
import { KouSidePanel, createDefaultPanelGridStates, type PanelGridStates, type Tab } from '@/client/components/mof-kou/KouSidePanel';
import type { GridViewState } from '@/client/components/mof-kou/DataGrid';
import { FilterSidebar, type FilterDomains, type FilterSidebarState, type NumRange } from '@/client/components/mof-kou/FilterSidebar';
import { mofArchiveUrl } from '@/app/lib/mof-archive-url';
import { MINISTRY_ORDER, sortBudgetTypes, sortByCodeOrder } from '@/app/lib/mof-classification-order';
import { textMatches } from '@/client/components/mof-kou/RegexTextFilter';
import {
  ACCOUNT_LABEL,
  COLUMNS,
  DEFAULT_WIDTHS,
  defaultDirFor,
  orgColumn,
  sortItems,
  type ColumnSpec,
  type SortDir,
  type SortKey,
} from '@/client/components/mof-kou/columns';
import {
  availableReviewYearsForFiscalYear,
  buildV2SectionProjectCounts,
  fetchV2MofIndex,
  fetchV2MofSection,
  fetchV2RootManifest,
  fetchV2RsIndex,
  fetchV2StandaloneLinks,
  legacyBudgetTypeToV2Stage,
  lookupV2Section,
  mapLegacySectionsToV2,
  v2StageKey,
  type V2MofIndex,
  type V2MofSectionDetail,
  type V2RootManifest,
  type V2RsIndex,
  type V2StandaloneLinksProduct,
} from '@/app/lib/v2-public-linkage';
import type { V2PanelData } from '@/client/components/mof-kou/KouSidePanel';

const EMPTY_RANGE: NumRange = [null, null];

const INITIAL_FILTERS: FilterSidebarState = {
  account: [],
  budgetType: [],
  ministry: [],
  organization: [],
  subAccount: [],
  sectionNameQuery: '',
  sectionNameRegex: false,
  detailQuery: '',
  detailRegex: false,
  jikouCountRange: EMPTY_RANGE,
  kouMokuCountRange: EMPTY_RANGE,
  rsProjectCountRange: EMPTY_RANGE,
  amountRange: EMPTY_RANGE,
  previousAmountRange: EMPTY_RANGE,
  differenceRange: EMPTY_RANGE,
  rateRange: EMPTY_RANGE,
};

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256;

const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 900;

function inRange(value: number | null, range: NumRange): boolean {
  const [min, max] = range;
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function boundsOf(values: number[]): [number, number] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
}

export default function MOFKouPage() {
  const [data, setData] = useState<MOFKouData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 選択中の会計年度。null は「収録済みの最新年度」をAPIに任せる。
   * localStorageから同期的に読む（`usePersistedState`はハイドレーション後に反映されるため
   * 使うと初回マウント時にnullで一度APIを叩いてしまう。年度はフェッチを起動する値なので
   * 二重フェッチを避けるためここだけ自前にする）
   */
  const [year, setYear] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('mof-kou:year');
      return raw !== null ? (JSON.parse(raw) as number) : null;
    } catch {
      return null;
    }
  });

  const [filters, setFilters] = useState<FilterSidebarState>(INITIAL_FILTERS);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarWidth, setSidebarWidth] = usePersistedState('mof-kou:sidebarWidth', SIDEBAR_DEFAULT_WIDTH);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<string | null>(null);
  const [widths, setWidths] = usePersistedState<Record<string, number>>('mof-kou:widths', DEFAULT_WIDTHS);
  const [panelWidth, setPanelWidth] = usePersistedState('mof-kou:panelWidth', 420);
  const [panelTab, setPanelTab] = usePersistedState<Tab>('mof-kou:panelTab', 'history');
  const [panelGridStates, setPanelGridStates] = usePersistedState<PanelGridStates>(
    'mof-kou:panelGridStates',
    createDefaultPanelGridStates()
  );
  const [detail, setDetail] = useState<MOFKouSectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [history, setHistory] = useState<MOFKouSectionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Pipeline V2 linkage overlay（既存UIは変えず、RS紐づけだけV2 public dataへ差し替える） ---
  const [v2Manifest, setV2Manifest] = useState<V2RootManifest | null>(null);
  const [reviewYear, setReviewYear] = useState<number | null>(null);
  const [v2MofIndex, setV2MofIndex] = useState<V2MofIndex | null>(null);
  const [v2Links, setV2Links] = useState<V2StandaloneLinksProduct | null>(null);
  const [v2RsIndex, setV2RsIndex] = useState<V2RsIndex | null>(null);
  const [v2SectionDetail, setV2SectionDetail] = useState<V2MofSectionDetail | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchV2RootManifest(controller.signal)
      .then(setV2Manifest)
      .catch(() => setV2Manifest(null));
    return () => controller.abort();
  }, []);

  const reviewYearOptions = useMemo(
    () => (v2Manifest && data ? availableReviewYearsForFiscalYear(v2Manifest, data.metadata.fiscalYear) : []),
    [v2Manifest, data]
  );

  // fiscalYearが変わって選択中のreviewYearが候補から外れたら、最新のreviewYearへ揃える
  useEffect(() => {
    setReviewYear(prev => {
      if (reviewYearOptions.length === 0) return null;
      return prev !== null && reviewYearOptions.includes(prev) ? prev : reviewYearOptions[0];
    });
  }, [reviewYearOptions]);

  useEffect(() => {
    // manifestのmof一覧に無い年度はV2 MOFデータが未生成のため、404を承知で叩かない
    if (!data || !v2Manifest?.mof.some(m => m.fiscalYear === data.metadata.fiscalYear)) {
      setV2MofIndex(null);
      return;
    }
    const controller = new AbortController();
    fetchV2MofIndex(data.metadata.fiscalYear, controller.signal)
      .then(setV2MofIndex)
      .catch(() => setV2MofIndex(null));
    return () => controller.abort();
  }, [data, v2Manifest]);

  useEffect(() => {
    if (!data || reviewYear === null) {
      setV2Links(null);
      return;
    }
    const controller = new AbortController();
    fetchV2StandaloneLinks(reviewYear, data.metadata.fiscalYear, controller.signal)
      .then(setV2Links)
      .catch(() => setV2Links(null));
    return () => controller.abort();
  }, [data, reviewYear]);

  useEffect(() => {
    if (reviewYear === null) {
      setV2RsIndex(null);
      return;
    }
    const controller = new AbortController();
    fetchV2RsIndex(reviewYear, controller.signal)
      .then(setV2RsIndex)
      .catch(() => setV2RsIndex(null));
    return () => controller.abort();
  }, [reviewYear]);

  /** legacy「項」行 → V2 section の一括接続。実データでの診断（matched/unmatched/ambiguous）はconsoleへ出す */
  const sectionMapping = useMemo(() => {
    if (!data || !v2MofIndex) return null;
    const mapping = mapLegacySectionsToV2(data.sections, v2MofIndex.sections);
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.info(
        `[mof-kou V2 overlay] fiscalYear=${data.metadata.fiscalYear} legacyRows=${data.sections.length} matched=${mapping.matchedCount} unmatched=${mapping.unmatchedCount} ambiguous=${mapping.ambiguousCount}`
      );
    }
    return mapping;
  }, [data, v2MofIndex]);

  const v2ProjectCounts = useMemo(() => (v2Links ? buildV2SectionProjectCounts(v2Links.links) : null), [v2Links]);

  /** V2 overlayがこの画面全体で有効かどうか。有効/無効は画面単位で切り替え、行ごとにV1/V2を混在させない */
  const v2Active = v2MofIndex !== null && v2Links !== null && sectionMapping !== null;

  function v2RsProjectCountFor(row: MOFKouSectionSummary): number {
    if (!v2Active || !sectionMapping || !v2ProjectCounts) return row.rsProjectCount;
    const v2Section = lookupV2Section(sectionMapping, row);
    const stage = legacyBudgetTypeToV2Stage(row.budgetType);
    if (!v2Section || !stage) return 0;
    const key = `${v2Section.id}\x1f${v2StageKey(stage)}`;
    return v2ProjectCounts.get(key)?.size ?? 0;
  }

  const sections = useMemo(() => {
    if (!data) return [];
    if (!v2Active) return data.sections;
    return data.sections.map(row => ({ ...row, rsProjectCount: v2RsProjectCountFor(row) }));
    // v2RsProjectCountForはsectionMapping/v2ProjectCounts/v2Activeにのみ依存する（rowはmapが渡す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, v2Active, sectionMapping, v2ProjectCounts]);

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

  // 選んだ年度を覚えておく（項の詳細サンキーから戻ったときなどに初期値へ戻らないように）。
  // year=null（初回マウント時、APIが最新年度を選ぶ）でも、確定した年度を保存しておく
  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem('mof-kou:year', JSON.stringify(data.metadata.fiscalYear));
    } catch {
      // 保存できなくても致命的ではないので無視
    }
  }, [data]);

  function changeYear(next: number) {
    setYear(next);
    setData(null);
  }

  function setFilter<K extends keyof FilterSidebarState>(key: K, value: FilterSidebarState[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function updatePanelGridState(tab: Tab, updater: (prev: GridViewState) => GridViewState) {
    setPanelGridStates(prev => ({ ...prev, [tab]: updater(prev[tab]) }));
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

  const { account, budgetType, ministry, organization, subAccount } = filters;

  const baseRows = useMemo(() => {
    return sections.filter(s => {
      if (account.length > 0 && !account.includes(ACCOUNT_LABEL[s.accountType])) return false;
      if (budgetType.length > 0 && !budgetType.includes(s.budgetType)) return false;
      return true;
    });
  }, [sections, account, budgetType]);

  const ministries = useMemo(
    () => sortByCodeOrder([...new Set(baseRows.map(s => s.ministry || s.agency).filter(Boolean))], MINISTRY_ORDER),
    [baseRows]
  );

  const organizations = useMemo(
    () =>
      [
        ...new Set(
          baseRows.filter(s => ministry.length === 0 || ministry.includes(s.ministry || s.agency)).map(orgColumn).filter(Boolean)
        ),
      ].sort(),
    [baseRows, ministry]
  );

  const scopedRows = useMemo(
    () =>
      baseRows
        .filter(s => ministry.length === 0 || ministry.includes(s.ministry || s.agency))
        .filter(s => organization.length === 0 || organization.includes(orgColumn(s))),
    [baseRows, ministry, organization]
  );

  const subAccounts = useMemo(
    () => [...new Set(scopedRows.map(s => s.subAccount).filter(Boolean))].sort(),
    [scopedRows]
  );

  /** 数値スライダーの可動域は年度全体（他の絞り込みの影響を受けない）から求める */
  const domains: FilterDomains = useMemo(() => {
    const rows = sections;
    const rates = rows.map(s => changeRate(s.amount, s.previousAmount)).filter((v): v is number => typeof v === 'number');
    return {
      jikouCount: boundsOf(rows.map(s => s.jikouCount)),
      kouMokuCount: boundsOf(rows.map(s => s.kouMokuCount)),
      rsProjectCount: boundsOf(rows.map(s => s.rsProjectCount)),
      amount: boundsOf(rows.map(s => s.amount)),
      previousAmount: boundsOf(rows.map(s => s.previousAmount).filter((v): v is number => v !== null)),
      difference: boundsOf(rows.map(s => s.difference).filter((v): v is number => v !== null)),
      rate: boundsOf(rates),
    };
  }, [sections]);

  const filtered = useMemo(() => {
    function rateOf(row: MOFKouSectionSummary): number | null {
      const r = changeRate(row.amount, row.previousAmount);
      return typeof r === 'number' ? r : null;
    }
    const rows = scopedRows.filter(row => {
      if (filters.subAccount.length > 0 && !filters.subAccount.includes(row.subAccount)) return false;
      if (!textMatches(row.sectionName, filters.sectionNameQuery.trim(), filters.sectionNameRegex)) return false;
      const detailQuery = filters.detailQuery.trim();
      if (detailQuery && !row.detailNames.some(name => textMatches(name, detailQuery, filters.detailRegex))) return false;
      if (!inRange(row.jikouCount, filters.jikouCountRange)) return false;
      if (!inRange(row.kouMokuCount, filters.kouMokuCountRange)) return false;
      if (!inRange(row.rsProjectCount, filters.rsProjectCountRange)) return false;
      if (!inRange(row.amount, filters.amountRange)) return false;
      if (!inRange(row.previousAmount, filters.previousAmountRange)) return false;
      if (!inRange(row.difference, filters.differenceRange)) return false;
      if (!inRange(rateOf(row), filters.rateRange)) return false;
      return true;
    });
    return sortItems(rows, sortKey, sortDir);
  }, [scopedRows, filters, sortKey, sortDir]);

  /** 絞り込み結果の合計 */
  const filteredTotal = useMemo(() => {
    if (filtered.length === 0) return null;
    return filtered.reduce((sum, s) => sum + s.amount, 0);
  }, [filtered]);

  const widthsChanged = COLUMNS.some(c => (widths[c.key] ?? c.width) !== c.width);
  const activeFilterCount = [
    account.length > 0,
    budgetType.length > 0,
    ministry.length > 0,
    organization.length > 0,
    subAccount.length > 0,
    filters.sectionNameQuery !== '',
    filters.detailQuery !== '',
    filters.jikouCountRange[0] !== null || filters.jikouCountRange[1] !== null,
    filters.kouMokuCountRange[0] !== null || filters.kouMokuCountRange[1] !== null,
    filters.rsProjectCountRange[0] !== null || filters.rsProjectCountRange[1] !== null,
    filters.amountRange[0] !== null || filters.amountRange[1] !== null,
    filters.previousAmountRange[0] !== null || filters.previousAmountRange[1] !== null,
    filters.differenceRange[0] !== null || filters.differenceRange[1] !== null,
    filters.rateRange[0] !== null || filters.rateRange[1] !== null,
  ].filter(Boolean).length;

  function toggleSort(column: ColumnSpec) {
    if (sortKey === column.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column.key);
      setSortDir(defaultDirFor(column));
    }
  }

  function startSidebarResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (e.clientX - startX)));
      setSidebarWidth(next);
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

  function startPanelResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (e: MouseEvent) => {
      // パネルは画面右側に置くため、ハンドルを左へ引くほど広がる
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth - (e.clientX - startX)));
      setPanelWidth(next);
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

  const selectedRow = selected ? (filtered.find(r => r.id === selected) ?? sections.find(r => r.id === selected)) : undefined;

  const selectedV2Section = useMemo(
    () => (selectedRow && sectionMapping ? lookupV2Section(sectionMapping, selectedRow) : null),
    [selectedRow, sectionMapping]
  );

  useEffect(() => {
    if (!selectedV2Section || !data) {
      setV2SectionDetail(null);
      return;
    }
    const controller = new AbortController();
    fetchV2MofSection(data.metadata.fiscalYear, selectedV2Section.id, controller.signal)
      .then(setV2SectionDetail)
      .catch(() => setV2SectionDetail(null));
    return () => controller.abort();
  }, [selectedV2Section, data]);

  const v2PanelData: V2PanelData | null = useMemo(() => {
    if (!v2Active || !selectedRow) return null;
    const stage = legacyBudgetTypeToV2Stage(selectedRow.budgetType);
    const links = stage && v2SectionDetail?.rsLinks
      ? v2SectionDetail.rsLinks.filter(
          l => l.reviewYear === reviewYear && l.phase === stage.phase && l.revision === stage.revision
        )
      : null;
    const itemNames = v2SectionDetail ? new Map(v2SectionDetail.items.map(it => [it.id, it.name])) : null;
    const projectNames = v2RsIndex
      ? new Map(v2RsIndex.projects.map(p => [p.projectId, { name: p.projectName, ministry: p.ministry }]))
      : null;
    return {
      reviewYear,
      sectionMatched: selectedV2Section !== null,
      stageSupported: stage !== null,
      links,
      itemNames,
      projectNames,
    };
  }, [v2Active, selectedRow, selectedV2Section, v2SectionDetail, v2RsIndex, reviewYear]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データの読み込みに失敗しました: {error}
          <br />
          <code className="text-xs">npm run generate-mof-budget</code> を実行してください。
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
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">予算書「項」一覧</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <a
              href={mofArchiveUrl(data.metadata.fiscalYear)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              {data.metadata.eraLabel}／財務省 予算書データベース
            </a>
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
          </button>

          <span className="whitespace-nowrap text-neutral-500">
            該当 {filtered.length.toLocaleString()} 件
            {filteredTotal !== null && <> / {formatYen(filteredTotal)}</>}
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

          {reviewYearOptions.length > 0 && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-neutral-500">
              RS review
              <select
                value={reviewYear ?? ''}
                onChange={e => setReviewYear(Number(e.target.value))}
                className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              >
                {reviewYearOptions.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <span className={v2Active ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-400'}>
                {v2Active ? 'V2' : '旧集計'}
              </span>
            </label>
          )}
        </div>
      </section>

      <div className="flex min-h-0 flex-1 px-3 pb-3">
        {showFilters && (
          <>
            <FilterSidebar
              state={filters}
              onChange={setFilter}
              budgetTypes={sortBudgetTypes(data.metadata.budgetTypes)}
              ministries={ministries}
              organizations={organizations}
              subAccounts={subAccounts}
              domains={domains}
              activeCount={activeFilterCount}
              onReset={() => setFilters(INITIAL_FILTERS)}
              width={sidebarWidth}
            />
            {/* 幅調整ハンドル: サイドパネルと一覧の間のマージン全体で反応させる */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="フィルタパネルの幅を変更"
              onMouseDown={startSidebarResize}
              className="flex w-3 shrink-0 cursor-col-resize items-stretch justify-center"
            >
              <div className="w-1 rounded-full transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700" />
            </div>
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
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
          <>
            {/* 幅調整ハンドル: 一覧とサイドパネルの間のマージン全体で反応させる */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="詳細パネルの幅を変更"
              onMouseDown={startPanelResize}
              className="flex w-3 shrink-0 cursor-col-resize items-stretch justify-center"
            >
              <div className="w-1 rounded-full transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700" />
            </div>
            <KouSidePanel
              row={selectedRow}
              fiscalYear={data.metadata.fiscalYear}
              onClose={() => setSelected(null)}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              linkageRsYear={data.metadata.linkage.rsYear}
              v2={v2PanelData}
              width={panelWidth}
              tab={panelTab}
              onTabChange={setPanelTab}
              gridStates={panelGridStates}
              onGridStateChange={updatePanelGridState}
            />
          </>
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
