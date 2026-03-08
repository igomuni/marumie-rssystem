'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import type { RecipientRow } from '@/app/api/quality-scores/recipients/route';

const PAGE_SIZE = 50;

type SortField = 'totalScore' | 'axis1' | 'axis2' | 'axis3' | 'axis4' | 'axis5'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name';
type SortDir = 'asc' | 'desc';

const STATUS_META: Record<RecipientRow['s'], { label: string; cls: string }> = {
  valid:   { label: '厳密OK',  cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  gov:     { label: '行政機関', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  supp:    { label: '補助辞書', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  invalid: { label: '不一致',  cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  unknown: { label: '未登録',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

function ScoreDetailDialog({ item, onClose }: { item: QualityScoreItem; onClose: () => void }) {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a' | 'a2'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);

  useEffect(() => {
    setRecipients(null);
    setRecipientsError(false);
    setRecipientSearch('');
    setRecipientSortField('chain');
    setRecipientSortDir('asc');
    setShowAxisDetail(false);
    fetch(`/api/quality-scores/recipients?pid=${item.pid}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((rows: RecipientRow[]) => setRecipients(rows))
      .catch(() => setRecipientsError(true));
  }, [item.pid]);

  const displayedRecipients = useMemo(() => {
    if (!recipients) return [];
    let rows = recipients;
    if (recipientSearch.trim()) {
      const q = recipientSearch.trim().toLowerCase();
      rows = rows.filter(r => r.n.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (recipientSortField === 'chain') cmp = (a.chain ?? a.b).localeCompare(b.chain ?? b.b) || (b.a ?? -1) - (a.a ?? -1);
      else if (recipientSortField === 'b') cmp = a.b.localeCompare(b.b) || (b.a ?? -1) - (a.a ?? -1);
      else if (recipientSortField === 's') cmp = a.s.localeCompare(b.s);
      else if (recipientSortField === 'c') cmp = (b.c ? 1 : 0) - (a.c ? 1 : 0);
      else if (recipientSortField === 'o') cmp = (b.o ? 1 : 0) - (a.o ? 1 : 0);
      else if (recipientSortField === 'a') cmp = (b.a ?? -1) - (a.a ?? -1);
      else if (recipientSortField === 'a2') cmp = (b.a2 ?? -1) - (a.a2 ?? -1);
      return recipientSortDir === 'desc' ? -cmp : cmp;
    });
  }, [recipients, recipientSearch, recipientSortField, recipientSortDir]);

  function handleRecipientSort(field: typeof recipientSortField) {
    if (recipientSortField === field) {
      setRecipientSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setRecipientSortField(field);
      setRecipientSortDir(field === 'a' || field === 'a2' ? 'desc' : 'asc');
    }
  }

  const axes = [
    { key: 'axis1', label: '軸1: 支出先名品質', weight: 40, score: item.axis1 },
    { key: 'axis2', label: '軸2: CN記入率', weight: 20, score: item.axis2 },
    { key: 'axis3', label: '軸3: 予算・支出バランス', weight: 20, score: item.axis3 },
    { key: 'axis4', label: '軸4: ブロック構造', weight: 10, score: item.axis4 },
    { key: 'axis5', label: '軸5: 透明性', weight: 10, score: item.axis5 },
  ] as const;

  const axis1Total = item.validCount + item.govAgencyCount + item.suppValidCount + item.invalidCount;
  const axis1Num = item.validCount + item.govAgencyCount + item.suppValidCount;
  const axis4RedelDeduct = item.hasRedelegation ? Math.min(item.redelegationDepth * 10, 40) : 0;
  const axis4TotalDeduct = item.axis4 !== null ? Math.round(100 - item.axis4) : null;
  const axis4IncoDeduct = axis4TotalDeduct !== null ? Math.max(0, axis4TotalDeduct - axis4RedelDeduct) : null;

  function AxisBar({ score }: { score: number | null }) {
    if (score === null) return <span className="text-gray-400 text-xs">-</span>;
    const w = Math.max(0, Math.min(100, score));
    let bg = 'bg-red-400';
    if (score >= 90) bg = 'bg-green-400';
    else if (score >= 70) bg = 'bg-blue-400';
    else if (score >= 50) bg = 'bg-yellow-400';
    return (
      <div className="flex items-center gap-2">
        <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${bg}`} style={{ width: `${w}%` }} />
        </div>
        <span className={`text-xs font-bold font-mono w-10 ${scoreColor(score)}`}>{score.toFixed(1)}</span>
      </div>
    );
  }

  function RSortIcon({ field }: { field: typeof recipientSortField }) {
    if (recipientSortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-400 ml-0.5">{recipientSortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-2 shrink-0">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">PID {item.pid} · {item.ministry}</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{item.name}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none mt-0.5 shrink-0">×</button>
        </div>

        {/* Score summary (compact) */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-start gap-5">
            <div className="shrink-0">
              <div className="text-[10px] text-gray-400 dark:text-gray-500">総合スコア</div>
              <div className={`text-2xl font-bold font-mono ${scoreColor(item.totalScore)}`}>
                {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
              </div>
            </div>
            <div className="flex-1 space-y-0.5">
              {axes.map(a => (
                <div key={a.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 w-36 shrink-0">
                    {a.label} <span className="text-gray-400">({a.weight}%)</span>
                  </span>
                  <AxisBar score={a.score} />
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowAxisDetail(d => !d)}
            className="mt-1.5 text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
          >
            {showAxisDetail ? '▲ 計算根拠を閉じる' : '▼ スコア計算根拠を表示'}
          </button>
        </div>

        {/* Axis detail (collapsible) */}
        {showAxisDetail && (
          <div className="border-b border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 shrink-0 overflow-y-auto max-h-64">
            {/* Axis 1 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">軸1: 支出先名品質（重み40%）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span className="text-green-600 dark:text-green-400">厳密valid: {item.validCount}</span>
                  {item.govAgencyCount > 0 && <span className="text-emerald-500">行政機関: {item.govAgencyCount}</span>}
                  {item.suppValidCount > 0 && <span className="text-blue-500">補助辞書: {item.suppValidCount}</span>}
                  <span className="text-red-500">invalid: {item.invalidCount}</span>
                  <span className="text-gray-400">計: {axis1Total}</span>
                </div>
                {axis1Total > 0 && (
                  <div className="font-mono text-gray-400">
                    ({axis1Num} / {axis1Total}) × 100 = {item.axis1 !== null ? item.axis1.toFixed(1) : '-'}点
                  </div>
                )}
              </div>
            </div>

            {/* Axis 2 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">軸2: 法人番号記入率（重み20%）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span className="text-green-600 dark:text-green-400">CN記入: {item.cnFilled}</span>
                  <span className="text-red-500">未記入: {item.cnEmpty}</span>
                </div>
                <div className="font-mono text-gray-400">
                  ({item.cnFilled} / {item.cnFilled + item.cnEmpty}) × 100 = {item.axis2 !== null ? item.axis2.toFixed(1) : '-'}点
                </div>
              </div>
            </div>

            {/* Axis 3 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">軸3: 予算・支出バランス（重み20%）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>予算額: {formatAmount(item.budgetAmount)}</span>
                  <span>執行額: {formatAmount(item.execAmount)}</span>
                  <span>実質支出: {formatAmount(item.spendNetTotal)}</span>
                </div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.budgetAmount > 0 && <span>予算執行率: {pct(item.execAmount / item.budgetAmount)}</span>}
                  <span>
                    {item.gapRefIsBudget ? '予算 vs 実質支出 乖離' : '執行 vs 実質支出 乖離'}: {pct(item.gapRatio)}
                  </span>
                </div>
                <div className="font-mono text-gray-400">
                  基準額({item.gapRefIsBudget ? '予算額' : '執行額'}) − 実質支出 の乖離率 {pct(item.gapRatio)} → (1 − {pct(item.gapRatio)}) × 100 = {item.axis3 !== null ? item.axis3.toFixed(1) : '-'}点
                </div>
              </div>
            </div>

            {/* Axis 4 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">軸4: ブロック構造（重み10%）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>ブロック数: {item.blockCount}</span>
                  {item.orphanBlockCount > 0 && <span className="text-orange-500">孤立: {item.orphanBlockCount}</span>}
                </div>
                <div className="flex gap-2 flex-wrap font-mono text-gray-400">
                  <span>基礎: 100点</span>
                  {axis4RedelDeduct > 0 && (
                    <span className="text-red-400">再委託深度{item.redelegationDepth}: −{axis4RedelDeduct}点</span>
                  )}
                  {axis4IncoDeduct !== null && axis4IncoDeduct > 0 && (
                    <span className="text-red-400">金額不整合: −{axis4IncoDeduct}点</span>
                  )}
                  <span>= {item.axis4 !== null ? item.axis4.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis 5 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">軸5: 支出先名の透明性（重み10%）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>不透明支出先率: {pct(item.opaqueRatio)}</div>
                <div className="font-mono text-gray-400">
                  (1 − {pct(item.opaqueRatio)} / 50%) × 100 = {item.axis5 !== null ? item.axis5.toFixed(1) : '-'}点
                </div>
              </div>
            </div>

            {/* Weighted sum */}
            <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800">
              <div className="text-xs font-mono text-gray-400">
                {axes.filter(a => a.score !== null).map(a => `${a.score!.toFixed(1)}×${a.weight}`).join(' + ')}
                {' '}= <span className={`font-bold ${scoreColor(item.totalScore)}`}>{item.totalScore?.toFixed(1)}</span>点
              </div>
            </div>
          </div>
        )}

        {/* Recipients */}
        <div className="flex flex-col flex-1 min-h-0 border-t border-gray-200 dark:border-gray-700">
          <div className="px-5 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                支出先一覧
                {recipients && (
                  <span className="ml-1 text-gray-400 font-normal">
                    {recipientSearch.trim() && displayedRecipients.length !== recipients.length
                      ? `${displayedRecipients.length} / ${recipients.length}件`
                      : `${recipients.length}件`}
                  </span>
                )}
              </div>
              {recipients && recipients.length > 0 && (
                <input
                  type="text"
                  placeholder="支出先名で検索..."
                  value={recipientSearch}
                  onChange={e => setRecipientSearch(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
            </div>
          </div>

          {recipientsError && (
            <div className="px-5 py-3 text-xs text-gray-400">
              データを読み込めません（<code>python3 scripts/score-project-quality.py</code> を実行してください）
            </div>
          )}
          {!recipientsError && recipients === null && (
            <div className="px-5 py-3 flex items-center gap-2 text-xs text-gray-400">
              <div className="animate-spin h-3 w-3 border border-gray-400 border-t-transparent rounded-full" />
              読み込み中...
            </div>
          )}
          {recipients && recipients.length === 0 && (
            <div className="px-5 py-3 text-xs text-gray-400">支出先データなし</div>
          )}
          {recipients && recipients.length > 0 && (
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                  <tr className="text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-1.5 text-left font-medium">支出先名</th>
                    <th
                      className="px-2 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('chain')}
                      title="委託チェーン（組織→A→B→C）でソート"
                    >
                      委託チェーン<RSortIcon field="chain" />
                    </th>
                    <th
                      className="px-2 py-1.5 text-center font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('s')}
                    >
                      軸1判定<RSortIcon field="s" />
                    </th>
                    <th
                      className="px-2 py-1.5 text-center font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('c')}
                    >
                      CN<RSortIcon field="c" />
                    </th>
                    <th
                      className="px-2 py-1.5 text-center font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('o')}
                    >
                      透明性<RSortIcon field="o" />
                    </th>
                    <th
                      className="px-2 py-1.5 text-right font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('a')}
                      title="支出先の合計支出額（CSVの「支出先の合計支出額」列）"
                    >
                      支出先合計額<RSortIcon field="a" />
                    </th>
                    <th
                      className="px-2 py-1.5 text-right font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => handleRecipientSort('a2')}
                      title="個別支出額（CSVの「金額」列）"
                    >
                      金額<RSortIcon field="a2" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {displayedRecipients.map((row, i) => {
                    const sm = STATUS_META[row.s];
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-3 py-1 text-gray-800 dark:text-gray-200 max-w-[220px] truncate" title={row.n}>
                          {row.n}
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-500 whitespace-nowrap" title={row.chain}>
                          {row.chain
                            ? (row.chain.startsWith('組織→') ? row.chain.slice('組織→'.length) : row.chain)
                            : (row.b || '-')}
                          {row.r && <span className="ml-1 text-[9px] text-green-500">●</span>}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${sm.cls}`}>
                            {sm.label}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {row.c
                            ? <span className="text-green-500">✓</span>
                            : <span className="text-gray-300 dark:text-gray-600">-</span>
                          }
                        </td>
                        <td className="px-2 py-1 text-center">
                          {row.o
                            ? <span className="text-red-500" title="不透明キーワードにマッチ">⚠</span>
                            : <span className="text-gray-300 dark:text-gray-600">-</span>
                          }
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {row.a === null ? <span className="text-gray-300 dark:text-gray-600">-</span> : formatAmount(row.a)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {row.a2 === null ? <span className="text-gray-300 dark:text-gray-600">-</span> : formatAmount(row.a2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const [dialogItem, setDialogItem] = useState<QualityScoreItem | null>(null);

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
      {dialogItem && <ScoreDetailDialog item={dialogItem} onClose={() => setDialogItem(null)} />}
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
                    <td className="px-2 py-1.5 text-right" onClick={e => { e.stopPropagation(); setDialogItem(item); }}>
                      <span className={`font-bold cursor-pointer hover:underline decoration-dotted ${scoreColor(item.totalScore)}`}>
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
                              <div>valid: {item.validCount}{item.govAgencyCount > 0 && <span className="text-green-600"> (+行政{item.govAgencyCount})</span>}{item.suppValidCount > 0 && <span className="text-blue-500"> (+補助{item.suppValidCount})</span>} / invalid: {item.invalidCount}</div>
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
                              <div>ブロック数: {item.blockCount}{item.orphanBlockCount > 0 && <span className="text-red-500"> (孤立: {item.orphanBlockCount})</span>}</div>
                              <div>再委託: {item.hasRedelegation ? `あり (階層${item.redelegationDepth})` : 'なし'}</div>
                              <div>不透明支出先率: {pct(item.opaqueRatio)}</div>
                              <div className="text-[10px] text-gray-400">（不透明キーワード辞書にマッチする行の割合）</div>
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
