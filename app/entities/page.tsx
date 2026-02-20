'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { EntitiesResponse, EntityListItem } from '@/app/api/entities/route';
import type { EntityType } from '@/types/structured';

// ========================================
// 定数
// ========================================

const ENTITY_TYPES: EntityType[] = [
  '民間企業',
  '地方公共団体',
  '国の機関',
  '独立行政法人',
  '公益法人・NPO',
  '外国法人',
  'その他',
];

const ENTITY_TYPE_COLORS: Record<string, string> = {
  '民間企業': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  '地方公共団体': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  '国の機関': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  '独立行政法人': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  '公益法人・NPO': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  '外国法人': 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  'その他': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

// 円グラフ用の塗りつぶし色
const ENTITY_TYPE_FILL: Record<string, string> = {
  '民間企業': '#3b82f6',
  '地方公共団体': '#22c55e',
  '国の機関': '#ef4444',
  '独立行政法人': '#a855f7',
  '公益法人・NPO': '#eab308',
  '外国法人': '#ec4899',
  'その他': '#9ca3af',
};

const PAGE_SIZE = 50;
const CLUSTER_PAGE_SIZE = 50;

// ========================================
// ユーティリティ
// ========================================

function formatAmount(yen: number): string {
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(2)}兆円`;
  if (yen >= 1e8) return `${(yen / 1e8).toFixed(1)}億円`;
  if (yen >= 1e4) return `${(yen / 1e4).toFixed(0)}万円`;
  return `${yen.toLocaleString()}円`;
}

// ========================================
// コンポーネント
// ========================================

// ========================================
// ドーナツチャート
// ========================================

interface DonutSlice {
  label: string;
  value: number;
  fill: string;
}

function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const cx = 80, cy = 80, r = 64, innerR = 40;

  // 0 の slice を除外して角度計算
  const nonZero = slices.filter(s => s.value > 0);
  let cumAngle = -Math.PI / 2;
  const paths = nonZero.map(slice => {
    const angle = (slice.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');
    return { ...slice, d, angle };
  });

  const activeSlice = hovered ? nonZero.find(s => s.label === hovered) : null;
  const pct = activeSlice ? ((activeSlice.value / total) * 100).toFixed(1) : null;

  return (
    <div className="flex items-center gap-4">
      <svg width={160} height={160} className="shrink-0">
        {paths.map(p => (
          <path
            key={p.label}
            d={p.d}
            fill={p.fill}
            opacity={hovered && hovered !== p.label ? 0.35 : 1}
            stroke="white"
            strokeWidth={1.5}
            onMouseEnter={() => setHovered(p.label)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
          />
        ))}
        {/* 中央ラベル */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={9} fill="#6b7280">
          {activeSlice ? activeSlice.label : '支出総額'}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fontWeight="600" fill="#111827">
          {activeSlice ? formatAmount(activeSlice.value) : formatAmount(total)}
        </text>
        {pct && (
          <text x={cx} y={cy + 20} textAnchor="middle" fontSize={9} fill="#6b7280">
            {pct}%
          </text>
        )}
      </svg>
      {/* 凡例 */}
      <div className="flex flex-col gap-1 min-w-0">
        {slices.map(s => (
          <div
            key={s.label}
            className="flex items-center gap-1.5 cursor-pointer"
            onMouseEnter={() => setHovered(s.label)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: s.fill, opacity: hovered && hovered !== s.label ? 0.35 : 1 }}
            />
            <span className={`text-xs truncate ${hovered === s.label ? 'font-semibold' : 'text-gray-600 dark:text-gray-300'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-gray-400">-</span>;
  const colors = ENTITY_TYPE_COLORS[type] ?? ENTITY_TYPE_COLORS['その他'];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {type}
    </span>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ========================================
// ページ本体
// ========================================

type TabType = '一覧' | '正規化クラスタ';

export default function EntitiesPage() {
  const [data, setData] = useState<EntitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<EntityType | 'すべて'>('すべて');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<TabType>('一覧');
  const [clusterSearch, setClusterSearch] = useState('');
  const [clusterPage, setClusterPage] = useState(1);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/entities')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EntitiesResponse>;
      })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // フィルタリング（一覧タブ）
  const filtered = useMemo<EntityListItem[]>(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.entities.filter(e => {
      if (selectedType !== 'すべて' && e.entityType !== selectedType) return false;
      if (q) {
        const haystack = `${e.displayName} ${e.spendingName} ${e.parentName ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data, searchQuery, selectedType]);

  // 正規化クラスタ（displayName が同一のものをグルーピング）
  const clusters = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, EntityListItem[]>();
    for (const e of data.entities) {
      const key = e.displayName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    // 2バリエーション以上のもののみ
    const result = Array.from(map.entries())
      .filter(([, items]) => items.length > 1)
      .map(([displayName, items]) => ({
        displayName,
        items,
        totalAmount: items.reduce((s, i) => s + i.totalSpendingAmount, 0),
        entityType: items[0].entityType,
      }))
      .sort((a, b) => b.items.length - a.items.length);
    return result;
  }, [data]);

  const filteredClusters = useMemo(() => {
    const q = clusterSearch.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter(c => c.displayName.toLowerCase().includes(q));
  }, [clusters, clusterSearch]);

  const clusterTotalPages = Math.ceil(filteredClusters.length / CLUSTER_PAGE_SIZE);
  const clusterPageItems = filteredClusters.slice(
    (clusterPage - 1) * CLUSTER_PAGE_SIZE,
    clusterPage * CLUSTER_PAGE_SIZE,
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleTypeChange = (type: EntityType | 'すべて') => {
    setSelectedType(type);
    setPage(1);
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setPage(1);
  };

  // ========== ローディング ==========
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">支出先データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold mb-2">データの読み込みに失敗しました</p>
          <p className="text-sm text-gray-500">{error}</p>
          <Link href="/" className="mt-4 inline-block text-blue-500 underline">トップへ戻る</Link>
        </div>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* ヘッダー */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">
            ← トップ
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            🏢 支出先ブラウザ
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            2024年度 行政事業レビュー
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* サマリーカード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryCard
            label="総支出先数"
            value={summary.total.toLocaleString()}
            sub="ユニーク法人数"
          />
          <SummaryCard
            label="総支出額"
            value={formatAmount(summary.totalAmount)}
          />
          <SummaryCard
            label="民間企業"
            value={(summary.byEntityType['民間企業']?.count ?? 0).toLocaleString()}
            sub={formatAmount(summary.byEntityType['民間企業']?.totalAmount ?? 0)}
          />
          <SummaryCard
            label="地方公共団体"
            value={(summary.byEntityType['地方公共団体']?.count ?? 0).toLocaleString()}
            sub={formatAmount(summary.byEntityType['地方公共団体']?.totalAmount ?? 0)}
          />
        </div>

        {/* entityType 別集計（バー + ドーナツ） */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 mb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">エンティティ種別 × 支出総額</p>
          <div className="flex flex-col md:flex-row gap-6">
            {/* バーチャート */}
            <div className="flex-1 space-y-2">
              {ENTITY_TYPES.map(type => {
                const info = summary.byEntityType[type] ?? { count: 0, totalAmount: 0 };
                const pct = summary.totalAmount > 0
                  ? (info.totalAmount / summary.totalAmount) * 100
                  : 0;
                const fill = ENTITY_TYPE_FILL[type] ?? ENTITY_TYPE_FILL['その他'];
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span className="w-28 text-xs text-gray-600 dark:text-gray-300 shrink-0">{type}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: fill }}
                      />
                    </div>
                    <span className="w-20 text-xs text-right text-gray-500 dark:text-gray-400 shrink-0">
                      {formatAmount(info.totalAmount)}
                    </span>
                    <span className="w-16 text-xs text-right text-gray-400 dark:text-gray-500 shrink-0">
                      {info.count.toLocaleString()}件
                    </span>
                  </div>
                );
              })}
            </div>
            {/* ドーナツチャート */}
            <div className="shrink-0">
              <DonutChart
                total={summary.totalAmount}
                slices={ENTITY_TYPES.map(type => ({
                  label: type,
                  value: summary.byEntityType[type]?.totalAmount ?? 0,
                  fill: ENTITY_TYPE_FILL[type] ?? ENTITY_TYPE_FILL['その他'],
                }))}
              />
            </div>
          </div>
        </div>

        {/* タブ切替 */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          {(['一覧', '正規化クラスタ'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab}
              {tab === '正規化クラスタ' && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {clusters.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ===== 一覧タブ ===== */}
        {activeTab === '一覧' && (
          <>
            {/* 検索とフィルタ */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <input
                type="text"
                placeholder="支出先名を検索..."
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>

            {/* entityType フィルタチップ */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(['すべて', ...ENTITY_TYPES] as const).map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedType === type
                      ? 'bg-green-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {type}
                  {type !== 'すべて' && (
                    <span className="ml-1 opacity-70">
                      ({(summary.byEntityType[type]?.count ?? 0).toLocaleString()})
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* 検索結果件数 */}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {filtered.length.toLocaleString()}件
              {filtered.length !== summary.total && ` / 全${summary.total.toLocaleString()}件`}
              {totalPages > 1 && `（${page}/${totalPages}ページ）`}
            </p>

            {/* テーブル */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">支出先名</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">種別</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">支出額</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden sm:table-cell">事業数</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {pageItems.map(entity => (
                    <tr
                      key={entity.spendingId}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {entity.displayName}
                          </span>
                          {entity.displayName !== entity.spendingName && (
                            <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {entity.spendingName}
                            </span>
                          )}
                          {entity.parentName && (
                            <span className="block text-xs text-blue-500 dark:text-blue-400 mt-0.5">
                              ↑ {entity.parentName}
                            </span>
                          )}
                          <span className="md:hidden mt-1 inline-block">
                            <EntityTypeBadge type={entity.entityType} />
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <EntityTypeBadge type={entity.entityType} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                        {formatAmount(entity.totalSpendingAmount)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                        {entity.projectCount}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <Link
                          href={`/sankey?recipient=${encodeURIComponent(entity.spendingName)}`}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline whitespace-nowrap"
                        >
                          Sankeyで見る →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pageItems.length === 0 && (
                <div className="py-12 text-center text-gray-400 dark:text-gray-500">
                  該当する支出先が見つかりません
                </div>
              )}
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  ←
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  →
                </button>
              </div>
            )}
          </>
        )}

        {/* ===== 正規化クラスタタブ ===== */}
        {activeTab === '正規化クラスタ' && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              同一の正規化名（displayName）に紐づく複数の表記バリエーションを持つグループ。
              名寄せ品質の確認に使用できます。
            </p>
            <div className="mb-4">
              <input
                type="text"
                placeholder="正規化名を検索..."
                value={clusterSearch}
                onChange={e => { setClusterSearch(e.target.value); setClusterPage(1); }}
                className="w-full sm:w-80 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {filteredClusters.length.toLocaleString()}グループ
              {clusterTotalPages > 1 && `（${clusterPage}/${clusterTotalPages}ページ）`}
            </p>
            <div className="space-y-2">
              {clusterPageItems.map(cluster => {
                const isExpanded = expandedClusters.has(cluster.displayName);
                return (
                  <div
                    key={cluster.displayName}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      onClick={() => {
                        setExpandedClusters(prev => {
                          const next = new Set(prev);
                          if (next.has(cluster.displayName)) next.delete(cluster.displayName);
                          else next.add(cluster.displayName);
                          return next;
                        });
                      }}
                    >
                      <EntityTypeBadge type={cluster.entityType} />
                      <span className="font-medium text-gray-900 dark:text-gray-100 flex-1">
                        {cluster.displayName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                        {cluster.items.length}バリエーション
                      </span>
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0 w-24 text-right">
                        {formatAmount(cluster.totalAmount)}
                      </span>
                      <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                        {cluster.items.map(item => (
                          <div key={item.spendingId} className="flex items-center gap-3 px-6 py-2 bg-gray-50 dark:bg-gray-900/30">
                            <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                              {item.spendingName}
                              {item.spendingName === item.displayName && (
                                <span className="ml-1.5 text-xs text-gray-400">（表示名と同一）</span>
                              )}
                            </span>
                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0 w-24 text-right">
                              {formatAmount(item.totalSpendingAmount)}
                            </span>
                            <Link
                              href={`/sankey?recipient=${encodeURIComponent(item.spendingName)}`}
                              className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline whitespace-nowrap shrink-0"
                            >
                              Sankey →
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {clusterTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setClusterPage(p => Math.max(1, p - 1))}
                  disabled={clusterPage === 1}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  ←
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {clusterPage} / {clusterTotalPages}
                </span>
                <button
                  onClick={() => setClusterPage(p => Math.min(clusterTotalPages, p + 1))}
                  disabled={clusterPage === clusterTotalPages}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
