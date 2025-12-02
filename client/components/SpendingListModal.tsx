'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '@/types/structured';

export interface SpendingListFilters {
  ministries?: string[];
  projectName?: string;
  spendingName?: string;
  groupBySpending?: boolean; // 事業名でまとめる
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectRecipient: (recipientName: string) => void;
  onSelectMinistry?: (ministryName: string) => void;
  onSelectProject?: (projectName: string) => void;
  initialFilters?: SpendingListFilters;
}

interface SpendingDetail {
  spendingName: string;
  projectName: string;
  ministry: string;
  totalBudget: number;
  totalSpendingAmount: number;
  executionRate: number;
  projectCount?: number; // まとめる場合の事業件数
}

type SortColumn = 'spendingName' | 'projectName' | 'ministry' | 'totalBudget' | 'totalSpendingAmount' | 'executionRate';
type SortDirection = 'asc' | 'desc';

export default function SpendingListModal({ isOpen, onClose, onSelectRecipient, onSelectMinistry, onSelectProject, initialFilters }: Props) {
  const [allData, setAllData] = useState<BudgetRecord[]>([]);
  const [spendingsData, setSpendingsData] = useState<SpendingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalSpendingAmount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [spendingNameFilter, setSpendingNameFilter] = useState('');
  const [projectNameFilter, setProjectNameFilter] = useState('');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [availableMinistries, setAvailableMinistries] = useState<string[]>([]);
  const [groupBySpending, setGroupBySpending] = useState(true); // 事業名でまとめる
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  const [isFilterExpanded, setIsFilterExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // データ読み込みと府省庁リスト初期化
  useEffect(() => {
    if (!isOpen) return;

    async function loadData() {
      setLoading(true);
      try {
        const response = await fetch('/data/rs2024-structured.json');
        const structuredData: RS2024StructuredData = await response.json();
        setAllData(structuredData.budgets);
        setSpendingsData(structuredData.spendings);

        // 府省庁別の予算総額を計算
        const ministryBudgets = new Map<string, number>();
        structuredData.budgets.forEach(b => {
          const current = ministryBudgets.get(b.ministry) || 0;
          ministryBudgets.set(b.ministry, current + b.totalBudget);
        });

        // 府省庁リスト作成（予算額の降順）
        const ministries = Array.from(ministryBudgets.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name);

        setAvailableMinistries(ministries);

        // Apply initial filters
        if (initialFilters) {
          if (initialFilters.ministries) {
            setSelectedMinistries(initialFilters.ministries);
          } else {
            setSelectedMinistries(ministries);
          }

          if (initialFilters.spendingName !== undefined) {
            setSpendingNameFilter(initialFilters.spendingName);
          } else {
            setSpendingNameFilter('');
          }

          if (initialFilters.projectName !== undefined) {
            setProjectNameFilter(initialFilters.projectName);
          } else {
            setProjectNameFilter('');
          }

          if (initialFilters.groupBySpending !== undefined) {
            setGroupBySpending(initialFilters.groupBySpending);
          }
        } else {
          setSelectedMinistries(ministries);
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isOpen, initialFilters]);

  // フィルタリング＆集計ロジック
  const processedData = useMemo(() => {
    const result: SpendingDetail[] = [];
    const spendingMap = new Map<number, SpendingRecord>();

    // SpendingRecordをMapに格納
    spendingsData.forEach(s => {
      spendingMap.set(s.spendingId, s);
    });

    // フィルタリング対象の事業を取得
    const filteredProjects = allData.filter(project => {
      // 府省庁フィルタ
      if (!selectedMinistries.includes(project.ministry)) return false;

      // 事業名フィルタ
      if (projectNameFilter && !project.projectName.includes(projectNameFilter)) return false;

      return true;
    });

    // 支出先ごとにデータを作成
    filteredProjects.forEach(project => {
      project.spendingIds.forEach(spendingId => {
        const spending = spendingMap.get(spendingId);
        if (!spending) return;

        // 支出先名フィルタ
        if (spendingNameFilter && !spending.spendingName.includes(spendingNameFilter)) return;

        // この事業からの支出額を取得
        const projectSpending = spending.projects.find(p => p.projectId === project.projectId);
        if (!projectSpending) return;

        result.push({
          spendingName: spending.spendingName,
          projectName: project.projectName,
          ministry: project.ministry,
          totalBudget: project.totalBudget,
          totalSpendingAmount: projectSpending.amount,
          executionRate: project.executionRate,
        });
      });
    });

    // 事業名でまとめる場合
    if (groupBySpending) {
      const grouped = new Map<string, SpendingDetail>();

      result.forEach(item => {
        const key = item.spendingName;
        const existing = grouped.get(key);

        if (existing) {
          existing.totalBudget += item.totalBudget;
          existing.totalSpendingAmount += item.totalSpendingAmount;
          existing.projectCount = (existing.projectCount || 1) + 1;
          // 執行率は加重平均で再計算
          existing.executionRate = existing.totalBudget > 0
            ? (existing.totalSpendingAmount / existing.totalBudget) * 100
            : 0;
        } else {
          grouped.set(key, {
            ...item,
            projectCount: 1,
          });
        }
      });

      return Array.from(grouped.values());
    }

    return result;
  }, [allData, spendingsData, selectedMinistries, projectNameFilter, spendingNameFilter, groupBySpending]);

  // ソート
  const sortedData = useMemo(() => {
    return [...processedData].sort((a, b) => {
      let aVal: string | number = a[sortColumn];
      let bVal: string | number = b[sortColumn];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal, 'ja')
          : bVal.localeCompare(aVal, 'ja');
      }

      aVal = aVal as number;
      bVal = bVal as number;
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [processedData, sortColumn, sortDirection]);

  // ページネーション
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);

  // ソート変更ハンドラ
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // ドロップダウン外クリック検知
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ページ変更時にトップにスクロール
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMinistries, projectNameFilter, spendingNameFilter, groupBySpending]);

  if (!isOpen) return null;

  const formatCurrency = (value: number) => {
    if (value >= 1e12) {
      return `${(value / 1e12).toFixed(2)}兆円`;
    } else if (value >= 1e8) {
      return `${(value / 1e8).toFixed(2)}億円`;
    } else if (value >= 1e4) {
      return `${(value / 1e4).toFixed(2)}万円`;
    }
    return `${value.toLocaleString()}円`;
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return <span className="text-gray-400">⇅</span>;
    return sortDirection === 'asc' ? <span>↑</span> : <span>↓</span>;
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* ヘッダー */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              支出先一覧
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* フィルタセクション */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="w-full md:hidden flex justify-between items-center text-left font-semibold text-gray-900 dark:text-gray-100 mb-2"
          >
            <span>フィルタ設定</span>
            <span>{isFilterExpanded ? '▲' : '▼'}</span>
          </button>

          <div className={`space-y-4 ${!isFilterExpanded ? 'hidden md:block' : ''}`}>
            {/* 検索フィルタ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  支出先名で検索
                </label>
                <input
                  type="text"
                  value={spendingNameFilter}
                  onChange={(e) => setSpendingNameFilter(e.target.value)}
                  placeholder="支出先名を入力..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  事業名で検索
                </label>
                <input
                  type="text"
                  value={projectNameFilter}
                  onChange={(e) => setProjectNameFilter(e.target.value)}
                  placeholder="事業名を入力..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            {/* 府省庁フィルタ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                府省庁フィルタ
              </label>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-left flex justify-between items-center"
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {selectedMinistries.length === availableMinistries.length
                      ? 'すべて'
                      : `${selectedMinistries.length}件選択中`}
                  </span>
                  <span>{isDropdownOpen ? '▲' : '▼'}</span>
                </button>

                {isDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                      <button
                        onClick={() => {
                          if (selectedMinistries.length === availableMinistries.length) {
                            setSelectedMinistries([]);
                          } else {
                            setSelectedMinistries(availableMinistries);
                          }
                        }}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {selectedMinistries.length === availableMinistries.length ? 'すべて解除' : 'すべて選択'}
                      </button>
                    </div>
                    {availableMinistries.map(ministry => (
                      <label
                        key={ministry}
                        className="flex items-center px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMinistries.includes(ministry)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedMinistries([...selectedMinistries, ministry]);
                            } else {
                              setSelectedMinistries(selectedMinistries.filter(m => m !== ministry));
                            }
                          }}
                          className="mr-2"
                        />
                        <span className="text-gray-900 dark:text-gray-100">{ministry}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* まとめるチェックボックス */}
            <div>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={groupBySpending}
                  onChange={(e) => setGroupBySpending(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  事業名をまとめる
                </span>
              </label>
            </div>

            {/* 統計表示 */}
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {loading ? (
                <span>読み込み中...</span>
              ) : (
                <span>
                  {sortedData.length.toLocaleString()}件
                  {groupBySpending && ' (事業名でまとめて表示)'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* テーブル */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th
                      onClick={() => handleSort('spendingName')}
                      className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      支出先 <SortIcon column="spendingName" />
                    </th>
                    <th
                      onClick={() => handleSort('projectName')}
                      className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      事業名 <SortIcon column="projectName" />
                      {groupBySpending && <span className="text-xs text-gray-500 ml-1">(件数)</span>}
                    </th>
                    <th
                      onClick={() => handleSort('ministry')}
                      className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      府省庁 <SortIcon column="ministry" />
                    </th>
                    <th
                      onClick={() => handleSort('totalBudget')}
                      className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      予算 <SortIcon column="totalBudget" />
                    </th>
                    <th
                      onClick={() => handleSort('totalSpendingAmount')}
                      className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      支出 <SortIcon column="totalSpendingAmount" />
                    </th>
                    <th
                      onClick={() => handleSort('executionRate')}
                      className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      執行率 <SortIcon column="executionRate" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((item, index) => (
                    <tr
                      key={index}
                      className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onSelectRecipient(item.spendingName)}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-left"
                        >
                          {item.spendingName}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {groupBySpending ? (
                          <span className="text-gray-900 dark:text-gray-100">
                            {item.projectCount}件
                          </span>
                        ) : (
                          <button
                            onClick={() => onSelectProject && onSelectProject(item.projectName)}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-left"
                          >
                            {item.projectName}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onSelectMinistry && onSelectMinistry(item.ministry)}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-left"
                        >
                          {item.ministry}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.totalBudget)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.totalSpendingAmount)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                        {item.executionRate.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              前へ
            </button>
            <span className="text-gray-700 dark:text-gray-300">
              {currentPage} / {totalPages} ページ
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              次へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
