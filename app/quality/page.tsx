'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';

const PAGE_SIZE = 50;

type SortField = 'totalScore' | 'axis1' | 'axis2' | 'axis3' | 'axis4' | 'axis5'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name';
type SortDir = 'asc' | 'desc';

function formatAmount(yen: number): string {
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(2)}兆`;
  if (yen >= 1e8)  return `${(yen / 1e8).toFixed(1)}億`;
  if (yen >= 1e4)  return `${(yen / 1e4).toFixed(0)}万`;
  return yen.toLocaleString();
}

function pct(v: number | null): string {
  if (v === null) return '-';
  return `${(v * 100).toFixed(1)}%`;
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-400';
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 70) return 'text-blue-600 dark:text-blue-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

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

type ScoreRange = 'all' | '0-9' | '10-19' | '20-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70-79' | '80-89' | '90-99' | '100-100';

export default function QualityPage() {
  const [data, setData] = useState<QualityScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all');
  const [sortField, setSortField] = useState<SortField>('totalScore');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/quality-scores')
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: QualityScoresResponse) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo<QualityScoreItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedMinistry) {
      items = items.filter(i => i.ministry === selectedMinistry);
    }

    if (scoreRange !== 'all') {
      const [lo, hi] = scoreRange.split('-').map(Number);
      items = items.filter(i => {
        const s = i.totalScore;
        if (s === null) return false;
        return s >= lo && s <= hi;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.pid.includes(q) ||
        i.bureau.toLowerCase().includes(q) ||
        i.section.toLowerCase().includes(q) ||
        i.division.toLowerCase().includes(q)
      );
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
  }, [data, selectedMinistry, scoreRange, searchQuery, sortField, sortDir]);

  // Reset page on filter change
  const filterKey = `${selectedMinistry}|${scoreRange}|${searchQuery}|${sortField}|${sortDir}`;
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
          const counts = binRanges.map(({ lo, hi }) =>
            data.items.filter(i => i.totalScore !== null && i.totalScore >= lo && i.totalScore <= hi).length
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
              <button
                onClick={() => setScoreRange('all')}
                className={`rounded-lg px-3 py-1.5 text-center transition-all self-end ${
                  scoreRange === 'all'
                    ? 'ring-2 ring-blue-500 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:opacity-100 opacity-80'
                }`}
              >
                <div className="text-[10px] font-medium">全件</div>
                <div className="text-sm font-bold">{summary.total.toLocaleString()}</div>
              </button>
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
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('totalScore')}>
                  総合<SortIcon field="totalScore" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axis1')}>
                  名称<SortIcon field="axis1" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axis2')}>
                  CN<SortIcon field="axis2" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axis3')}>
                  収支<SortIcon field="axis3" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axis4')}>
                  構造<SortIcon field="axis4" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axis5')}>
                  透明性<SortIcon field="axis5" />
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
                  行数<SortIcon field="rowCount" />
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
                    <td className="px-2 py-1.5 text-right">
                      <span className={`font-bold ${scoreColor(item.totalScore)}`}>
                        {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axis1} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axis2} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axis3} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axis4} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axis5} /></td>
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
                    <td className="px-2 py-1.5 text-right font-mono text-gray-500">{item.rowCount}</td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={16} className="px-4 py-3">
                        <div>{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
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
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">支出先名品質</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>valid: {item.validCount} / invalid: {item.invalidCount}</div>
                              <div>valid率: {pct(item.validRatio)}</div>
                              <div>CN記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                              <div>CN記入率: {pct(item.cnFillRatio)}</div>
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
                              <div>ブロック数: {item.blockCount}</div>
                              <div>再委託: {item.hasRedelegation ? `あり (階層${item.redelegationDepth})` : 'なし'}</div>
                              <div>支出先名不明率: {pct(item.unknownNameRatio)}</div>
                              <div className="text-[10px] text-gray-400">（支出先名「その他」行の割合）</div>
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
