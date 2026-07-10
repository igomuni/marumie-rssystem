'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { useScoreDetailData } from '@/client/hooks/useScoreDetailData';
import { scoreColor, formatAmount, pct } from '@/client/components/quality/score-format';

const PAGE_SIZE = 50;

type SortField = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisStructure' | 'axisEffective'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name';
type SortDir = 'asc' | 'desc';

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 text-xs">-</span>;
  const w = Math.max(0, Math.min(100, score));
  let bg = 'bg-red-400';
  if (score >= 90) bg = 'bg-green-400';
  else if (score >= 70) bg = 'bg-blue-400';
  else if (score >= 50) bg = 'bg-yellow-400';
  return (
    <div className="flex items-center gap-1">
      <div className="w-8 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs font-mono ${scoreColor(score)}`}>{score.toFixed(0)}</span>
    </div>
  );
}

function parseAmountInput(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/,/g, '');
  const match = trimmed.match(/^([\d.]+)\s*(兆|億|万|千)?円?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  switch (match[2]) {
    case '兆': return value * 1e12;
    case '億': return value * 1e8;
    case '万': return value * 1e4;
    case '千': return value * 1e3;
    default: return value;
  }
}

type ScoreRange = 'all' | '0-9' | '10-19' | '20-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70-79' | '80-89' | '90-99' | '100-100';

type DistMetric = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisEffective';
const DIST_METRICS: { key: DistMetric; label: string }[] = [
  { key: 'totalScore', label: '総合' },
  { key: 'axisIdentify', label: '特定可能性' },
  { key: 'axisPurpose', label: '使途説明性' },
  { key: 'axisBudget', label: '収支整合性' },
  { key: 'axisEffective', label: '有効性' },
];

export default function QualityPage() {
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  const [data, setData] = useState<QualityScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all');
  const [distMetric, setDistMetric] = useState<DistMetric>('totalScore');
  const [amountFilters, setAmountFilters] = useState<Record<string, { min: string; max: string }>>({
    budgetAmount: { min: '', max: '' },
    execAmount: { min: '', max: '' },
    spendTotal: { min: '', max: '' },
    spendNetTotal: { min: '', max: '' },
  });
  const [sortField, setSortField] = useState<SortField>('spendNetTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [dialogItem, setDialogItem] = useState<QualityScoreItem | null>(null);
  // ダイアログ用データはページ側で取得し ScoreDetailDialog へ props で渡す（Issue #246）
  const dialogData = useScoreDetailData(dialogItem?.pid ?? null, year);

  // 初回のみ URL の ?year= を年度に反映（/sankey-svg サイドパネル等からの年度付きリンク対応）。
  // フェッチ効果の先頭で判定することで、パラメータ指定時にデフォルト年度の無駄な全件取得を避ける。
  const urlYearAppliedRef = useRef(false);
  useEffect(() => {
    if (!urlYearAppliedRef.current) {
      urlYearAppliedRef.current = true;
      const y = new URLSearchParams(window.location.search).get('year');
      if ((y === '2024' || y === '2025') && y !== year) {
        setYear(y);
        return; // setYear で本エフェクトが再実行され、そちらでフェッチする
      }
    }
    setData(null);
    setLoading(true);
    setError(null);
    setSelectedMinistry('');
    fetch(`/api/quality-scores?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: QualityScoresResponse) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  const filtered = useMemo<QualityScoreItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedMinistry) {
      items = items.filter(i => i.ministry === selectedMinistry);
    }

    if (scoreRange !== 'all') {
      const [lo, hi] = scoreRange.split('-').map(Number);
      items = items.filter(i => {
        const s = i[distMetric] as number | null | undefined;
        if (s === null || s === undefined) return false;
        return s >= lo && s <= hi;
      });
    }

    if (searchQuery.trim()) {
      const normalize = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
      const q = normalize(searchQuery.trim());
      items = items.filter(i =>
        normalize(i.name).includes(q) ||
        i.pid.includes(q) ||
        normalize(i.bureau).includes(q) ||
        normalize(i.section).includes(q) ||
        normalize(i.division).includes(q)
      );
    }

    for (const [field, { min, max }] of Object.entries(amountFilters)) {
      const minVal = parseAmountInput(min);
      const maxVal = parseAmountInput(max);
      if (minVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) >= minVal);
      if (maxVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) <= maxVal);
    }

    items = [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'pid') {
        cmp = parseInt(a.pid) - parseInt(b.pid);
      } else {
        const av = a[sortField];
        const bv = b[sortField];
        if (typeof av === 'string' && typeof bv === 'string') {
          cmp = av.localeCompare(bv, 'ja');
        } else {
          cmp = ((av as number) ?? -1) - ((bv as number) ?? -1);
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [data, selectedMinistry, scoreRange, distMetric, searchQuery, amountFilters, sortField, sortDir]);

  // Reset page on filter change
  const amountFilterKey = Object.values(amountFilters).map(f => `${f.min}-${f.max}`).join(',');
  const filterKey = `${selectedMinistry}|${scoreRange}|${distMetric}|${searchQuery}|${amountFilterKey}|${sortField}|${sortDir}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'pid' ? 'asc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-500 ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !data) return (
    <div className="p-8 text-red-600 dark:text-red-400">
      <p className="font-semibold">データを読み込めません</p>
      <p className="text-sm mt-1">{error}</p>
      <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
          python3 scripts/score-project-quality.py
        </code> を実行してください
      </p>
    </div>
  );

  const { summary } = data;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {dialogItem && (
        <ScoreDetailDialog
          item={dialogItem}
          onClose={() => setDialogItem(null)}
          recipients={dialogData.recipients}
          recipientsError={dialogData.recipientsError}
          projectInfo={dialogData.projectInfo}
          year={year}
        />
      )}
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
              ← トップ
            </Link>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              事業別 支出先データ品質スコア
            </h1>
            <select
              value={year}
              onChange={e => setYear(e.target.value as '2024' | '2025')}
              className="ml-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 cursor-pointer"
            >
              <option value="2025">2025年度</option>
              <option value="2024">2024年度</option>
            </select>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {summary.total.toLocaleString()}事業 / 平均 {summary.avgScore.toFixed(1)} / 中央値 {summary.medianScore.toFixed(1)} / 最頻値 {summary.modeScore}
          </p>
        </div>
      </div>

      {/* Score distribution summary (10-point bins) + histogram */}
      <div className="max-w-[1600px] mx-auto px-4 py-3">
        {(() => {
          const binRanges: { label: string; range: ScoreRange; lo: number; hi: number }[] = [
            { label: '100', range: '100-100', lo: 100, hi: 100 },
            { label: '90-99', range: '90-99', lo: 90, hi: 99 },
            { label: '80-89', range: '80-89', lo: 80, hi: 89 },
            { label: '70-79', range: '70-79', lo: 70, hi: 79 },
            { label: '60-69', range: '60-69', lo: 60, hi: 69 },
            { label: '50-59', range: '50-59', lo: 50, hi: 59 },
            { label: '40-49', range: '40-49', lo: 40, hi: 49 },
            { label: '30-39', range: '30-39', lo: 30, hi: 39 },
            { label: '20-29', range: '20-29', lo: 20, hi: 29 },
            { label: '10-19', range: '10-19', lo: 10, hi: 19 },
            { label: '0-9', range: '0-9', lo: 0, hi: 9 },
          ];
          const metricVal = (i: QualityScoreItem) => i[distMetric] as number | null | undefined;
          const counts = binRanges.map(({ lo, hi }) =>
            data.items.filter(i => { const s = metricVal(i); return s != null && s >= lo && s <= hi; }).length
          );
          const maxCount = Math.max(...counts, 1);
          const binColor = (lo: number) => {
            if (lo >= 90) return { bg: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', bar: 'bg-green-400' };
            if (lo >= 70) return { bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', bar: 'bg-blue-400' };
            if (lo >= 50) return { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', bar: 'bg-yellow-400' };
            return { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', bar: 'bg-red-400' };
          };
          return (
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex items-end gap-0.5">
                {binRanges.map(({ label, range, lo }, i) => {
                  const count = counts[i];
                  const h = Math.max(2, Math.round((count / maxCount) * 48));
                  const { bar } = binColor(lo);
                  const isActive = scoreRange === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setScoreRange(isActive ? 'all' : range)}
                      className={`flex flex-col items-center transition-all ${isActive ? 'ring-1 ring-blue-500 rounded' : ''}`}
                      title={`${label}点: ${count}件`}
                    >
                      <span className="text-[9px] font-mono text-gray-500 mb-0.5">{count || ''}</span>
                      <div className={`w-5 rounded-sm ${bar}`} style={{ height: `${h}px` }} />
                      <span className="text-[8px] font-mono text-gray-400 mt-0.5">{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1 self-end">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 leading-none">分布の軸</span>
                  <select
                    value={distMetric}
                    onChange={e => { setDistMetric(e.target.value as DistMetric); setScoreRange('all'); }}
                    className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {DIST_METRICS.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => setScoreRange('all')}
                  className={`rounded-lg px-3 py-1.5 text-center transition-all ${
                    scoreRange === 'all'
                      ? 'ring-2 ring-blue-500 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:opacity-100 opacity-80'
                  }`}
                >
                  <div className="text-[10px] font-medium">全件</div>
                  <div className="text-sm font-bold">{summary.total.toLocaleString()}</div>
                </button>
              </div>
              <div className="flex flex-col gap-1.5 self-end flex-1 min-w-[200px]">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="事業名・PID・組織名で検索..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <select
                    value={selectedMinistry}
                    onChange={e => setSelectedMinistry(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">全府省庁</option>
                    {summary.ministries.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {([
                    { key: 'budgetAmount', label: '予算' },
                    { key: 'execAmount', label: '執行' },
                    { key: 'spendTotal', label: '支出計' },
                    { key: 'spendNetTotal', label: '実質' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-0.5 shrink-0">
                      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5">{label}</span>
                      <input
                        type="text"
                        placeholder="下限"
                        title="下限 (例: 100億, 1兆)"
                        value={amountFilters[key].min}
                        onChange={e => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      <span className="text-gray-400 mx-0.5">〜</span>
                      <input
                        type="text"
                        placeholder="上限"
                        title="上限 (例: 1兆, 5000億)"
                        value={amountFilters[key].max}
                        onChange={e => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      {(amountFilters[key].min || amountFilters[key].max) && (
                        <button
                          onClick={() => setAmountFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                          className="ml-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {filtered.length.toLocaleString()}件表示
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Table */}
      <div className="max-w-[1600px] mx-auto px-4 pb-8">
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap" onClick={() => handleSort('pid')}>
                  PID<SortIcon field="pid" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer min-w-[200px]" onClick={() => handleSort('name')}>
                  事業名<SortIcon field="name" />
                </th>
                <th className="px-2 py-2 text-left whitespace-nowrap">府省庁</th>
                <th className="px-2 py-2 text-left whitespace-nowrap">局・庁</th>
                <th className="px-2 py-2 text-center whitespace-nowrap">支出先</th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('totalScore')}>
                  総合<SortIcon field="totalScore" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisIdentify')} title="A: 支出先の特定可能性（AI判定 28%）">
                  特定可能性<SortIcon field="axisIdentify" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisPurpose')} title="B: 使途の説明性（AI判定 22%）">
                  使途説明性<SortIcon field="axisPurpose" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisBudget')} title="C: 収支の整合性（機械計算 15%）">
                  収支整合性<SortIcon field="axisBudget" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisEffective')} title="E: 有効性／成果設計の明確さ（AI判定 35%・意図ベース）">
                  有効性<SortIcon field="axisEffective" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('budgetAmount')}>
                  予算額<SortIcon field="budgetAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('execAmount')}>
                  執行額<SortIcon field="execAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('spendTotal')}>
                  支出先合計<SortIcon field="spendTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('spendNetTotal')}>
                  実質支出額<SortIcon field="spendNetTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('redelegationDepth')}>
                  再委託階層<SortIcon field="redelegationDepth" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('rowCount')}>
                  支出先数<SortIcon field="rowCount" />
                </th>
                <th className="px-2 py-2 text-center cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisStructure')} title="構造の整合性: ブロック金額の整合・孤立ブロック有無（総合スコアには不算入の参考）">
                  構造<SortIcon field="axisStructure" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageItems.map(item => (
                <React.Fragment key={item.pid}>
                  <tr
                    className="hover:bg-blue-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(expandedRow === item.pid ? null : item.pid)}
                  >
                    <td className="px-2 py-1.5 font-mono text-gray-500">{item.pid}</td>
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white truncate max-w-[300px]" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.ministry}</td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.bureau || '-'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); setDialogItem(item); }}
                        className="px-2 py-1 text-[11px] font-medium rounded-md border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
                        title="支出先一覧・スコア計算根拠を表示"
                      >
                        詳細
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={`font-bold ${scoreColor(item.totalScore)}`}>
                        {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisIdentify ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisPurpose ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisBudget ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisEffective ?? null} /></td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.budgetAmount ? formatAmount(item.budgetAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.execAmount ? formatAmount(item.execAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendTotal ? formatAmount(item.spendTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendNetTotal ? formatAmount(item.spendNetTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.redelegationDepth || '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-500">{item.recipientCount ?? item.rowCount}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      {item.axisStructure == null
                        ? <span className="text-gray-300 dark:text-gray-600">-</span>
                        : item.axisStructure >= 100
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200">整合</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200" title={`構造スコア ${item.axisStructure}（金額不整合・孤立ブロック）`}>不整合</span>}
                    </td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={17} className="px-4 py-3">
                        <div>{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">組織</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>府省庁: {item.ministry}</div>
                              <div>局・庁: {item.bureau || '-'}</div>
                              <div>部: {item.division || '-'}</div>
                              <div>課: {item.section || '-'}</div>
                              <div>室: {item.office || '-'}</div>
                              <div>班: {item.team || '-'}</div>
                              <div>係: {item.unit || '-'}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">特定可能性・使途（{item.aiSource && item.aiSource !== 'heuristic' ? 'AI' : 'ヒューリスティック'}）</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              {item.identifyLevelAvg != null && <div>特定可能性 平均Lv: {item.identifyLevelAvg.toFixed(2)}/3 → {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : '-'}点</div>}
                              {item.purposeLevelAvg != null && <div>使途説明性 平均Lv: {item.purposeLevelAvg.toFixed(2)}/3 → {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : '-'}点</div>}
                              <div>valid: {item.validCount}{item.govAgencyCount > 0 && <span className="text-green-600"> (+行政{item.govAgencyCount})</span>}{item.suppValidCount > 0 && <span className="text-blue-500"> (+補助{item.suppValidCount})</span>} / invalid: {item.invalidCount}</div>
                              <div>法人番号記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">有効性（{item.aiSource && item.aiSource !== 'heuristic' ? 'AI' : 'ヒューリスティック'}）</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>レベル: {item.effectiveLevel ?? '-'}/10 → {item.axisEffective != null ? `${item.axisEffective.toFixed(0)}点` : '-'}</div>
                              {item.effectiveReason && item.effectiveReason !== 'heuristic'
                                ? <div className="text-gray-500 dark:text-gray-400 leading-relaxed">根拠: {item.effectiveReason}</div>
                                : <div className="text-gray-400">根拠: なし（ヒューリスティック）</div>}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">予算・支出</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>予算額: {formatAmount(item.budgetAmount)}</div>
                              <div>執行額: {formatAmount(item.execAmount)}</div>
                              <div>支出先合計（全ブロック）: {formatAmount(item.spendTotal)}</div>
                              <div>実質支出額（ルートのみ）: {formatAmount(item.spendNetTotal)}</div>
                              <div>乖離率（実質 vs 執行）: {pct(item.gapRatio)}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">ブロック構造</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>ブロック数: {item.blockCount}{item.orphanBlockCount > 0 && <span className="text-red-500"> (孤立: {item.orphanBlockCount})</span>}</div>
                              <div>再委託: {item.hasRedelegation ? `あり (階層${item.redelegationDepth})` : 'なし'}</div>
                              <div>不透明支出比: {pct(item.opaqueRatio)}</div>
                              <div className="text-[10px] text-gray-400">（不透明キーワード辞書にマッチする支出先への支出額の割合）</div>
                              <div>支出先行数: {item.rowCount}</div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              次へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
